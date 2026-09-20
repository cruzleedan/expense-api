import type { PoolClient } from 'pg';
import { db } from '../db/client.js';
import { env } from '../config/env.js';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  StepUpRequiredError,
  UnauthorizedError,
  ValidationError,
  type Permission,
  type PermissionRiskLevel,
  type Role,
} from '../types/index.js';
import { assertNotSelfRoleMutation } from '../policies/userAdministration.js';
import {
  assertControlPlaneAdminRemains,
  assertSodCompliant,
  isStepUpFresh,
  type SodPolicyRule,
} from '../policies/rbac.js';
import { logAuditEvent } from './audit.service.js';

const RBAC_LOCK_NAME = 'expense-api:rbac-policy:v1';
const CONTROL_PLANE_PERMISSION_NAMES = new Set([
  'permission.create',
  'permission.edit',
  'permission.delete',
  'role.create',
  'role.edit',
  'role.delete',
  'role.assign',
  'role.assign.admin',
]);

export interface RbacMutationActor {
  id: string;
  rolesVersion: number;
  sessionId?: string;
}

export interface CreatePermissionInput {
  name: string;
  description?: string;
  category?: string;
  riskLevel?: PermissionRiskLevel;
  requiresMfa?: boolean;
}

export interface UpdatePermissionInput {
  description?: string;
  category?: string;
  riskLevel?: PermissionRiskLevel | null;
  requiresMfa?: boolean;
}

interface ActiveRole {
  id: string;
  name: string;
  is_system: boolean;
  is_active: boolean;
}

export async function acquireRbacMutationLock(client: PoolClient): Promise<void> {
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [RBAC_LOCK_NAME]);
}

async function assertActorAuthorized(
  client: PoolClient,
  actor: RbacMutationActor,
  requiredPermissions: string[]
): Promise<Set<string>> {
  const actorResult = await client.query<{ id: string; roles_version: number }>(
    `SELECT id, roles_version FROM users
     WHERE id = $1 AND is_active = true AND is_verified = true
     FOR UPDATE`,
    [actor.id]
  );
  if (actorResult.rows.length === 0) throw new ForbiddenError('Actor account is not active and verified');
  if (actorResult.rows[0].roles_version !== actor.rolesVersion) {
    throw new UnauthorizedError('Session invalidated due to permission changes. Please re-authenticate.');
  }

  const permissionResult = await client.query<{ name: string; requires_mfa: boolean }>(
    `SELECT DISTINCT p.name, p.requires_mfa
     FROM permissions p
     JOIN role_permissions rp ON rp.permission_id = p.id
     JOIN user_roles ur ON ur.role_id = rp.role_id
     JOIN roles r ON r.id = ur.role_id
     WHERE ur.user_id = $1 AND r.is_active = true`,
    [actor.id]
  );
  const effective = new Set(permissionResult.rows.map((row) => row.name));
  const missing = requiredPermissions.filter((permission) => !effective.has(permission));
  if (missing.length > 0) {
    throw new ForbiddenError(`Missing required permissions: ${missing.join(', ')}`);
  }

  const protectedNames = permissionResult.rows
    .filter((row) => row.requires_mfa && requiredPermissions.includes(row.name))
    .map((row) => row.name);
  if (protectedNames.length > 0) {
    if (!actor.sessionId) throw new StepUpRequiredError();
    const assuranceResult = await client.query<{ step_up_verified_at: Date | null }>(
      `SELECT step_up_verified_at
       FROM refresh_tokens
       WHERE id = $1
         AND user_id = $2
         AND revoked_at IS NULL
         AND expires_at > NOW()
       FOR UPDATE`,
      [actor.sessionId, actor.id]
    );
    if (
      !isStepUpFresh(
        assuranceResult.rows[0]?.step_up_verified_at,
        new Date(),
        env.STEP_UP_TTL_SECONDS
      )
    ) {
      throw new StepUpRequiredError(
        `Recent step-up authentication is required for: ${protectedNames.join(', ')}`
      );
    }
  }

  return effective;
}

async function loadActiveRoles(
  client: PoolClient,
  roleIds: string[],
  includeInactive = false
): Promise<ActiveRole[]> {
  if (roleIds.length === 0) return [];
  const result = await client.query<ActiveRole>(
    `SELECT id, name, is_system, is_active
     FROM roles
     WHERE id = ANY($1::uuid[]) AND (is_active = true OR $2)
     ORDER BY id
     FOR UPDATE`,
    [roleIds, includeInactive]
  );
  if (result.rows.length !== new Set(roleIds).size) throw new NotFoundError('Role');
  return result.rows;
}

async function loadPermissionNames(
  client: PoolClient,
  permissionIds: string[]
): Promise<string[]> {
  if (permissionIds.length === 0) return [];
  const result = await client.query<{ id: string; name: string }>(
    `SELECT id, name FROM permissions
     WHERE id = ANY($1::uuid[])
     ORDER BY id
     FOR UPDATE`,
    [permissionIds]
  );
  if (result.rows.length !== new Set(permissionIds).size) throw new NotFoundError('Permission');
  return result.rows.map((row) => row.name);
}

async function loadSodRules(client: PoolClient): Promise<SodPolicyRule[]> {
  const result = await client.query<{
    name: string;
    description: string | null;
    permission_set: string[];
  }>(
    `SELECT name, description, permission_set
     FROM sod_rules
     WHERE is_active = true
     ORDER BY id
     FOR SHARE`
  );
  return result.rows.map((row) => ({
    name: row.name,
    description: row.description,
    permissionSet: row.permission_set,
  }));
}

async function loadEffectivePermissionsForRoles(
  client: PoolClient,
  roleIds: string[]
): Promise<string[]> {
  if (roleIds.length === 0) return [];
  const result = await client.query<{ name: string }>(
    `SELECT DISTINCT p.name
     FROM permissions p
     JOIN role_permissions rp ON rp.permission_id = p.id
     JOIN roles r ON r.id = rp.role_id
     WHERE rp.role_id = ANY($1::uuid[]) AND r.is_active = true`,
    [roleIds]
  );
  return result.rows.map((row) => row.name);
}

async function loadUserRoleIds(client: PoolClient, userId: string): Promise<string[]> {
  const result = await client.query<{ role_id: string }>(
    `SELECT ur.role_id
     FROM user_roles ur
     JOIN roles r ON r.id = ur.role_id
     WHERE ur.user_id = $1
     ORDER BY ur.role_id`,
    [userId]
  );
  return result.rows.map((row) => row.role_id);
}

function hasSuperAdminRole(roles: ActiveRole[]): boolean {
  return roles.some((role) => role.is_active && role.is_system && role.name === 'super_admin');
}

async function assertFinalUserSod(
  client: PoolClient,
  userId: string,
  roles: ActiveRole[]
): Promise<void> {
  // The system super_admin role is the explicit control-plane/break-glass role.
  // Its catch-all seed grant necessarily contains the configured toxic pairs.
  if (hasSuperAdminRole(roles)) return;
  const [permissions, rules] = await Promise.all([
    loadEffectivePermissionsForRoles(client, roles.map((role) => role.id)),
    loadSodRules(client),
  ]);
  assertSodCompliant(permissions, rules, `user ${userId}`);
}

async function assertSpecialRoleAssignment(
  client: PoolClient,
  roles: ActiveRole[],
  actor: RbacMutationActor,
  actorPermissions: Set<string>
): Promise<void> {
  const additionalPermissions: string[] = [];
  if (
    roles.some((role) => role.name === 'admin' || role.name === 'super_admin') &&
    !actorPermissions.has('role.assign.admin')
  ) {
    throw new ForbiddenError('role.assign.admin permission required to assign admin roles');
  }
  if (roles.some((role) => role.name === 'admin' || role.name === 'super_admin')) {
    additionalPermissions.push('role.assign.admin');
  }
  if (
    roles.some((role) => role.name === 'finance') &&
    !actorPermissions.has('role.assign.finance')
  ) {
    throw new ForbiddenError('role.assign.finance permission required to assign finance role');
  }
  if (roles.some((role) => role.name === 'finance')) {
    additionalPermissions.push('role.assign.finance');
  }
  if (additionalPermissions.length > 0) {
    await assertActorAuthorized(client, actor, additionalPermissions);
  }
}

async function countEligibleControlPlaneAdmins(client: PoolClient): Promise<number> {
  const result = await client.query<{ count: string }>(
    `SELECT COUNT(DISTINCT u.id)::text AS count
     FROM users u
     JOIN user_roles ur ON ur.user_id = u.id
     JOIN roles r ON r.id = ur.role_id
     WHERE u.is_active = true
       AND u.is_verified = true
       AND r.is_active = true
       AND r.is_system = true
       AND r.name = 'super_admin'`
  );
  return Number(result.rows[0]?.count ?? 0);
}

export async function assertUserCanLoseControlPlaneEligibility(
  client: PoolClient,
  userId: string,
  targetWillRemainEligible: boolean
): Promise<void> {
  const target = await client.query<{
    is_active: boolean;
    is_verified: boolean;
    has_super_admin: boolean;
  }>(
    `SELECT u.is_active, u.is_verified,
            EXISTS (
              SELECT 1
              FROM user_roles ur
              JOIN roles r ON r.id = ur.role_id
              WHERE ur.user_id = u.id
                AND r.is_active = true
                AND r.is_system = true
                AND r.name = 'super_admin'
            ) AS has_super_admin
     FROM users u
     WHERE u.id = $1
     FOR UPDATE`,
    [userId]
  );
  if (target.rows.length === 0) throw new NotFoundError('User');
  const row = target.rows[0];
  const currentlyEligible = row.is_active && row.is_verified && row.has_super_admin;
  assertControlPlaneAdminRemains(
    await countEligibleControlPlaneAdmins(client),
    currentlyEligible,
    targetWillRemainEligible
  );
}

async function auditRbacMutation(
  client: PoolClient,
  actor: RbacMutationActor,
  action: string,
  resourceType: string,
  resourceId: string,
  changes?: Record<string, { from: unknown; to: unknown }>,
  metadata?: Record<string, unknown>
): Promise<void> {
  await logAuditEvent({
    actorId: actor.id,
    sessionId: actor.sessionId,
    action,
    actionCategory: 'authorization',
    resourceType,
    resourceId,
    changes,
    metadata,
    client,
  });
}

export async function createPermission(
  input: CreatePermissionInput,
  actor: RbacMutationActor
): Promise<Permission> {
  return db.transaction(async (client) => {
    await acquireRbacMutationLock(client);
    await assertActorAuthorized(client, actor, ['permission.create']);

    const existing = await client.query('SELECT 1 FROM permissions WHERE name = $1', [input.name]);
    if (existing.rows.length > 0) {
      throw new ConflictError(`Permission with name "${input.name}" already exists`);
    }
    const riskLevel = input.riskLevel ?? null;
    const requiresMfa = input.requiresMfa ?? riskLevel === 'critical';
    if (riskLevel === 'critical' && !requiresMfa) {
      throw new ValidationError('Critical permissions must require step-up authentication');
    }

    const result = await client.query<Permission>(
      `INSERT INTO permissions (name, description, category, risk_level, requires_mfa)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, name, description, category, risk_level, requires_mfa, created_at`,
      [input.name, input.description ?? null, input.category ?? null, riskLevel, requiresMfa]
    );
    const permission = result.rows[0];
    await auditRbacMutation(client, actor, 'permission.create', 'permission', permission.id, undefined, {
      name: permission.name,
      risk_level: permission.risk_level,
      requires_mfa: permission.requires_mfa,
    });
    return permission;
  });
}

export async function updatePermission(
  permissionId: string,
  input: UpdatePermissionInput,
  actor: RbacMutationActor
): Promise<Permission> {
  return db.transaction(async (client) => {
    await acquireRbacMutationLock(client);
    await assertActorAuthorized(client, actor, ['permission.edit']);

    const currentResult = await client.query<Permission>(
      `SELECT id, name, description, category, risk_level, requires_mfa, created_at
       FROM permissions WHERE id = $1 FOR UPDATE`,
      [permissionId]
    );
    const current = currentResult.rows[0];
    if (!current) throw new NotFoundError('Permission');

    const riskLevel = input.riskLevel === undefined ? current.risk_level : input.riskLevel;
    const requiresMfa = input.requiresMfa ?? current.requires_mfa;
    if (riskLevel === 'critical' && !requiresMfa) {
      throw new ValidationError('Critical permissions must require step-up authentication');
    }

    const affectedResult = await client.query<{ id: string }>(
      `SELECT u.id
       FROM users u
       WHERE u.id IN (
         SELECT ur.user_id
         FROM user_roles ur
         JOIN role_permissions rp ON rp.role_id = ur.role_id
         WHERE rp.permission_id = $1
       )
       ORDER BY u.id
       FOR UPDATE OF u`,
      [permissionId]
    );
    const updatedResult = await client.query<Permission>(
      `UPDATE permissions
       SET description = $2, category = $3, risk_level = $4, requires_mfa = $5
       WHERE id = $1
       RETURNING id, name, description, category, risk_level, requires_mfa, created_at`,
      [
        permissionId,
        input.description === undefined ? current.description : input.description,
        input.category === undefined ? current.category : input.category,
        riskLevel,
        requiresMfa,
      ]
    );
    const affectedUserIds = affectedResult.rows.map((row) => row.id);
    if (affectedUserIds.length > 0) {
      await client.query(
        `UPDATE users SET roles_version = roles_version + 1
         WHERE id = ANY($1::uuid[])`,
        [affectedUserIds]
      );
    }

    const updated = updatedResult.rows[0];
    await auditRbacMutation(client, actor, 'permission.update', 'permission', permissionId, {
      description: { from: current.description, to: updated.description },
      category: { from: current.category, to: updated.category },
      riskLevel: { from: current.risk_level, to: updated.risk_level },
      requiresMfa: { from: current.requires_mfa, to: updated.requires_mfa },
    }, { invalidated_user_ids: affectedUserIds });
    return updated;
  });
}

export async function deletePermission(
  permissionId: string,
  actor: RbacMutationActor
): Promise<void> {
  await db.transaction(async (client) => {
    await acquireRbacMutationLock(client);
    await assertActorAuthorized(client, actor, ['permission.delete']);
    const permissionResult = await client.query<Permission>(
      `SELECT id, name, description, category, risk_level, requires_mfa, created_at
       FROM permissions WHERE id = $1 FOR UPDATE`,
      [permissionId]
    );
    const permission = permissionResult.rows[0];
    if (!permission) throw new NotFoundError('Permission');
    if (CONTROL_PLANE_PERMISSION_NAMES.has(permission.name)) {
      throw new ConflictError('Core control-plane permissions cannot be deleted');
    }

    const affectedResult = await client.query<{ id: string }>(
      `SELECT u.id
       FROM users u
       WHERE u.id IN (
         SELECT ur.user_id
         FROM user_roles ur
         JOIN role_permissions rp ON rp.role_id = ur.role_id
         WHERE rp.permission_id = $1
       )
       ORDER BY u.id
       FOR UPDATE OF u`,
      [permissionId]
    );
    const roleResult = await client.query<{ role_id: string }>(
      'SELECT role_id FROM role_permissions WHERE permission_id = $1 ORDER BY role_id',
      [permissionId]
    );
    await client.query('DELETE FROM permissions WHERE id = $1', [permissionId]);
    const affectedUserIds = affectedResult.rows.map((row) => row.id);
    if (affectedUserIds.length > 0) {
      await client.query(
        `UPDATE users SET roles_version = roles_version + 1
         WHERE id = ANY($1::uuid[])`,
        [affectedUserIds]
      );
    }
    await auditRbacMutation(client, actor, 'permission.delete', 'permission', permissionId, undefined, {
      name: permission.name,
      affected_role_ids: roleResult.rows.map((row) => row.role_id),
      invalidated_user_ids: affectedUserIds,
    });
  });
}

export async function createRole(
  name: string,
  description: string | null,
  permissionIds: string[],
  actor: RbacMutationActor
): Promise<Role> {
  return db.transaction(async (client) => {
    await acquireRbacMutationLock(client);
    await assertActorAuthorized(client, actor, ['role.create']);
    const uniquePermissionIds = [...new Set(permissionIds)];
    const permissionNames = await loadPermissionNames(client, uniquePermissionIds);
    assertSodCompliant(permissionNames, await loadSodRules(client), `role ${name}`);

    const existing = await client.query('SELECT 1 FROM roles WHERE name = $1', [name]);
    if (existing.rows.length > 0) throw new ConflictError(`Role with name "${name}" already exists`);
    const roleResult = await client.query<Role>(
      `INSERT INTO roles (name, description, is_system)
       VALUES ($1, $2, false)
       RETURNING id, name, description, is_system, is_active, created_at, updated_at`,
      [name, description]
    );
    const role = roleResult.rows[0];
    if (uniquePermissionIds.length > 0) {
      await client.query(
        `INSERT INTO role_permissions (role_id, permission_id, granted_by)
         SELECT $1, permission_id, $2
         FROM unnest($3::uuid[]) AS permission_id`,
        [role.id, actor.id, uniquePermissionIds]
      );
    }
    await auditRbacMutation(client, actor, 'role.create', 'role', role.id, undefined, {
      name,
      permission_ids: uniquePermissionIds,
    });
    return role;
  });
}

export async function updateRolePermissions(
  roleId: string,
  permissionIds: string[],
  actor: RbacMutationActor
): Promise<void> {
  await db.transaction(async (client) => {
    await acquireRbacMutationLock(client);
    await assertActorAuthorized(client, actor, ['role.edit']);
    const roleResult = await client.query<Role>(
      `SELECT id, name, description, is_system, is_active, created_at, updated_at
       FROM roles WHERE id = $1 FOR UPDATE`,
      [roleId]
    );
    const role = roleResult.rows[0];
    if (!role) throw new NotFoundError('Role');
    if (role.is_system) throw new ForbiddenError('Cannot modify system roles');

    const uniquePermissionIds = [...new Set(permissionIds)];
    const newPermissionNames = await loadPermissionNames(client, uniquePermissionIds);
    const rules = await loadSodRules(client);
    assertSodCompliant(newPermissionNames, rules, `role ${role.name}`);

    const currentPermissionResult = await client.query<{ permission_id: string }>(
      'SELECT permission_id FROM role_permissions WHERE role_id = $1 ORDER BY permission_id',
      [roleId]
    );
    const affectedResult = await client.query<{ id: string }>(
      `SELECT u.id
       FROM users u
       JOIN user_roles ur ON ur.user_id = u.id
       WHERE ur.role_id = $1
       ORDER BY u.id
       FOR UPDATE OF u`,
      [roleId]
    );
    for (const { id: userId } of affectedResult.rows) {
      const otherRoleIds = (await loadUserRoleIds(client, userId)).filter((id) => id !== roleId);
      const otherRoles = await loadActiveRoles(client, otherRoleIds, true);
      if (role.is_active && !hasSuperAdminRole(otherRoles)) {
        const otherPermissions = await loadEffectivePermissionsForRoles(client, otherRoleIds);
        assertSodCompliant(
          [...new Set([...otherPermissions, ...newPermissionNames])],
          rules,
          `user ${userId}`
        );
      }
    }

    await client.query('DELETE FROM role_permissions WHERE role_id = $1', [roleId]);
    if (uniquePermissionIds.length > 0) {
      await client.query(
        `INSERT INTO role_permissions (role_id, permission_id, granted_by)
         SELECT $1, permission_id, $2
         FROM unnest($3::uuid[]) AS permission_id`,
        [roleId, actor.id, uniquePermissionIds]
      );
    }
    await client.query('UPDATE roles SET updated_at = NOW() WHERE id = $1', [roleId]);
    const affectedUserIds = affectedResult.rows.map((row) => row.id);
    if (affectedUserIds.length > 0) {
      await client.query(
        `UPDATE users SET roles_version = roles_version + 1
         WHERE id = ANY($1::uuid[])`,
        [affectedUserIds]
      );
    }
    await auditRbacMutation(client, actor, 'role.permissions.update', 'role', roleId, {
      permissionIds: {
        from: currentPermissionResult.rows.map((row) => row.permission_id),
        to: uniquePermissionIds,
      },
    }, { invalidated_user_ids: affectedUserIds });
  });
}

export async function deleteRole(roleId: string, actor: RbacMutationActor): Promise<void> {
  await db.transaction(async (client) => {
    await acquireRbacMutationLock(client);
    await assertActorAuthorized(client, actor, ['role.delete']);
    const roleResult = await client.query<Role>(
      `SELECT id, name, description, is_system, is_active, created_at, updated_at
       FROM roles WHERE id = $1 FOR UPDATE`,
      [roleId]
    );
    const role = roleResult.rows[0];
    if (!role) throw new NotFoundError('Role');
    if (role.is_system) throw new ForbiddenError('Cannot delete system roles');
    const affectedResult = await client.query<{ id: string }>(
      `SELECT u.id
       FROM users u
       JOIN user_roles ur ON ur.user_id = u.id
       WHERE ur.role_id = $1
       ORDER BY u.id
       FOR UPDATE OF u`,
      [roleId]
    );
    const affectedUserIds = affectedResult.rows.map((row) => row.id);
    await client.query('DELETE FROM roles WHERE id = $1', [roleId]);
    if (affectedUserIds.length > 0) {
      await client.query(
        `UPDATE users SET roles_version = roles_version + 1
         WHERE id = ANY($1::uuid[])`,
        [affectedUserIds]
      );
    }
    await auditRbacMutation(client, actor, 'role.delete', 'role', roleId, undefined, {
      name: role.name,
      invalidated_user_ids: affectedUserIds,
    });
  });
}

async function prepareUserRoleMutation(
  client: PoolClient,
  userId: string,
  actor: RbacMutationActor,
  buildFinalRoleIds: (currentRoleIds: string[]) => string[]
): Promise<{ currentRoleIds: string[]; finalRoles: ActiveRole[] }> {
  assertNotSelfRoleMutation({ id: actor.id, permissions: [] }, userId);
  await acquireRbacMutationLock(client);
  const actorPermissions = await assertActorAuthorized(client, actor, ['role.assign']);
  const target = await client.query('SELECT 1 FROM users WHERE id = $1 FOR UPDATE', [userId]);
  if (target.rows.length === 0) throw new NotFoundError('User');
  const currentRoleIds = await loadUserRoleIds(client, userId);
  const finalRoleIds = buildFinalRoleIds(currentRoleIds);
  const finalRoles = await loadActiveRoles(client, [...new Set(finalRoleIds)], true);
  const finalRoleIdSet = new Set(finalRoles.map((role) => role.id));
  const currentRoleIdSet = new Set(currentRoleIds);
  // Existing inactive assignments may be retained or removed, never newly granted.
  if (finalRoles.some((role) => !role.is_active && !currentRoleIdSet.has(role.id))) {
    throw new NotFoundError('Active role');
  }
  const changedRoleIds = [
    ...currentRoleIds.filter((id) => !finalRoleIdSet.has(id)),
    ...finalRoles.map((role) => role.id).filter((id) => !currentRoleIdSet.has(id)),
  ];
  const changedRoles = await loadActiveRoles(client, changedRoleIds, true);
  await assertSpecialRoleAssignment(client, changedRoles, actor, actorPermissions);
  await assertFinalUserSod(client, userId, finalRoles);

  const currentRoles = await loadActiveRoles(client, currentRoleIds, true);
  if (hasSuperAdminRole(currentRoles) && !hasSuperAdminRole(finalRoles)) {
    await assertUserCanLoseControlPlaneEligibility(client, userId, false);
  }
  return { currentRoleIds, finalRoles };
}

export async function assignRoleToUser(
  userId: string,
  roleId: string,
  actor: RbacMutationActor
): Promise<void> {
  await db.transaction(async (client) => {
    const { currentRoleIds, finalRoles } = await prepareUserRoleMutation(
      client, userId, actor, (current) => {
        if (current.includes(roleId)) throw new ConflictError('Role already assigned to user');
        return [...current, roleId];
      }
    );
    await client.query(
      `INSERT INTO user_roles (user_id, role_id, assigned_by) VALUES ($1, $2, $3)`,
      [userId, roleId, actor.id]
    );
    await client.query('UPDATE users SET roles_version = roles_version + 1 WHERE id = $1', [userId]);
    await auditRbacMutation(client, actor, 'user.role.assign', 'user', userId, {
      roleIds: { from: currentRoleIds, to: finalRoles.map((role) => role.id) },
    });
  });
}

export async function removeRoleFromUser(
  userId: string,
  roleId: string,
  actor: RbacMutationActor
): Promise<void> {
  await db.transaction(async (client) => {
    const { currentRoleIds, finalRoles } = await prepareUserRoleMutation(
      client, userId, actor, (current) => {
        if (!current.includes(roleId)) throw new NotFoundError('User role assignment');
        return current.filter((id) => id !== roleId);
      }
    );
    await client.query('DELETE FROM user_roles WHERE user_id = $1 AND role_id = $2', [userId, roleId]);
    await client.query('UPDATE users SET roles_version = roles_version + 1 WHERE id = $1', [userId]);
    await auditRbacMutation(client, actor, 'user.role.remove', 'user', userId, {
      roleIds: { from: currentRoleIds, to: finalRoles.map((role) => role.id) },
    });
  });
}

export async function setUserRoles(
  userId: string,
  roleIds: string[],
  actor: RbacMutationActor
): Promise<void> {
  await db.transaction(async (client) => {
    const uniqueRoleIds = [...new Set(roleIds)];
    const { currentRoleIds, finalRoles } = await prepareUserRoleMutation(
      client, userId, actor, () => uniqueRoleIds
    );
    const currentSet = [...currentRoleIds].sort();
    const finalSet = finalRoles.map((role) => role.id).sort();
    if (currentSet.length === finalSet.length && currentSet.every((id, index) => id === finalSet[index])) {
      return;
    }
    await client.query('DELETE FROM user_roles WHERE user_id = $1', [userId]);
    if (finalSet.length > 0) {
      await client.query(
        `INSERT INTO user_roles (user_id, role_id, assigned_by)
         SELECT $1, role_id, $2 FROM unnest($3::uuid[]) AS role_id`,
        [userId, actor.id, finalSet]
      );
    }
    await client.query('UPDATE users SET roles_version = roles_version + 1 WHERE id = $1', [userId]);
    await auditRbacMutation(client, actor, 'user.roles.replace', 'user', userId, {
      roleIds: { from: currentSet, to: finalSet },
    });
  });
}
