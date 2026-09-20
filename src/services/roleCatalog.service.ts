import type { PoolClient } from 'pg';
import { transaction } from '../db/client.js';
import { ConflictError, ValidationError } from '../types/index.js';
import {
  ADMIN_PERMISSION_NAMES,
  ADMIN_ROLE_CATALOG_VERSION,
  ORDINARY_SYSTEM_ROLE_NAMES,
} from '../policies/roleCatalog.js';
import { assertSodCompliant, type SodPolicyRule } from '../policies/rbac.js';
import { acquireRbacMutationLock } from './rbac.service.js';
import { logAuditEvent } from './audit.service.js';

interface CatalogRole {
  id: string;
  name: string;
  is_system: boolean;
  is_active: boolean;
}

export interface AdminCatalogMigrationOptions {
  apply?: boolean;
  operatorLabel?: string;
}

export interface AdminCatalogMigrationResult {
  catalogVersion: string;
  mode: 'dry-run' | 'apply';
  changed: boolean;
  databaseName: string;
  databaseOperator: string;
  roleId: string;
  previousPermissionNames: string[];
  permissionNames: string[];
  affectedUserCount: number;
  eligibleControlPlaneAdmins: number;
}

async function countControlPlaneAdmins(client: PoolClient): Promise<number> {
  const result = await client.query<{ count: string }>(
    `SELECT COUNT(DISTINCT u.id)::text AS count
     FROM users u
     JOIN user_roles ur ON ur.user_id = u.id
     JOIN roles r ON r.id = ur.role_id
     WHERE u.is_active AND u.is_verified AND r.is_active AND r.is_system
       AND r.name = 'super_admin'`
  );
  return Number(result.rows[0].count);
}

/** Operator-only data migration. No route calls this function or bypasses system-role immutability. */
export async function migrateAdministratorRoleCatalog(
  options: AdminCatalogMigrationOptions = {}
): Promise<AdminCatalogMigrationResult> {
  const operatorLabel = options.operatorLabel?.trim();
  if (options.apply && !operatorLabel) {
    throw new ValidationError('An operator label is required to apply the administrator catalog');
  }

  return transaction(async (client) => {
    await acquireRbacMutationLock(client);
    const identity = await client.query<{ database_name: string; database_operator: string }>(
      'SELECT current_database() AS database_name, current_user AS database_operator'
    );
    const roles = await client.query<CatalogRole>(
      `SELECT id, name, is_system, is_active FROM roles
       WHERE name = ANY($1::text[]) ORDER BY id FOR UPDATE`,
      [[...ORDINARY_SYSTEM_ROLE_NAMES, 'super_admin']]
    );
    if (roles.rows.length !== ORDINARY_SYSTEM_ROLE_NAMES.length + 1 || roles.rows.some((role) => !role.is_system)) {
      throw new ConflictError('Expected system role catalog is missing or has been replaced; migration aborted');
    }
    const adminRole = roles.rows.find((role) => role.name === 'admin')!;
    const eligibleAdmins = await countControlPlaneAdmins(client);
    if (eligibleAdmins < 1) {
      throw new ConflictError('Migration requires an active verified system super administrator');
    }

    const permissions = await client.query<{ id: string; name: string }>(
      `SELECT id, name FROM permissions
       WHERE name = ANY($1::text[]) ORDER BY name FOR UPDATE`,
      [ADMIN_PERMISSION_NAMES]
    );
    const missing = ADMIN_PERMISSION_NAMES.filter((name) => !permissions.rows.some((permission) => permission.name === name));
    if (missing.length > 0) {
      throw new ConflictError(`Required administrator permissions are missing: ${missing.join(', ')}`);
    }

    const sod = await client.query<{ name: string; description: string | null; permission_set: string[] }>(
      `SELECT name, description, permission_set FROM sod_rules
       WHERE is_active ORDER BY id FOR SHARE`
    );
    const rules: SodPolicyRule[] = sod.rows.map((rule) => ({
      name: rule.name, description: rule.description, permissionSet: rule.permission_set,
    }));
    const grants = await client.query<{ role_id: string; name: string }>(
      `SELECT rp.role_id, p.name FROM role_permissions rp
       JOIN permissions p ON p.id = rp.permission_id
       WHERE rp.role_id = ANY($1::uuid[]) ORDER BY p.name`,
      [roles.rows.map((role) => role.id)]
    );
    for (const role of roles.rows.filter((role) => role.name !== 'super_admin')) {
      const finalNames = role.id === adminRole.id
        ? ADMIN_PERMISSION_NAMES
        : grants.rows.filter((grant) => grant.role_id === role.id).map((grant) => grant.name);
      assertSodCompliant(finalNames, rules, `system role ${role.name}`);
    }

    const users = await client.query<{ id: string; roles_version: number }>(
      `SELECT u.id, u.roles_version FROM users u
       JOIN user_roles ur ON ur.user_id = u.id
       WHERE ur.role_id = $1 ORDER BY u.id FOR UPDATE OF u`,
      [adminRole.id]
    );
    for (const user of users.rows) {
      const otherRoles = await client.query<CatalogRole>(
        `SELECT r.id, r.name, r.is_system, r.is_active FROM roles r
         JOIN user_roles ur ON ur.role_id = r.id
         WHERE ur.user_id = $1 AND r.id <> $2 AND r.is_active ORDER BY r.id FOR UPDATE OF r`,
        [user.id, adminRole.id]
      );
      if (otherRoles.rows.some((role) => role.is_system && role.name === 'super_admin')) continue;
      const otherPermissions = await client.query<{ name: string }>(
        `SELECT DISTINCT p.name FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id
         WHERE rp.role_id = ANY($1::uuid[])`,
        [otherRoles.rows.map((role) => role.id)]
      );
      assertSodCompliant(
        [...otherPermissions.rows.map((permission) => permission.name), ...(adminRole.is_active ? ADMIN_PERMISSION_NAMES : [])],
        rules, `user ${user.id}`
      );
    }

    const previousPermissionNames = grants.rows.filter((grant) => grant.role_id === adminRole.id).map((grant) => grant.name);
    const permissionNames = permissions.rows.map((permission) => permission.name);
    const changed = previousPermissionNames.length !== permissionNames.length
      || previousPermissionNames.some((name, index) => name !== permissionNames[index]);
    const result: AdminCatalogMigrationResult = {
      catalogVersion: ADMIN_ROLE_CATALOG_VERSION,
      mode: options.apply ? 'apply' : 'dry-run',
      changed,
      databaseName: identity.rows[0].database_name,
      databaseOperator: identity.rows[0].database_operator,
      roleId: adminRole.id,
      previousPermissionNames,
      permissionNames,
      affectedUserCount: users.rows.length,
      eligibleControlPlaneAdmins: eligibleAdmins,
    };
    if (!options.apply || !changed) return result;

    const permissionIds = permissions.rows.map((permission) => permission.id);
    await client.query(
      `DELETE FROM role_permissions
       WHERE role_id = $1 AND NOT (permission_id = ANY($2::uuid[]))`,
      [adminRole.id, permissionIds]
    );
    // Keep attribution/timestamps for retained grants; only missing grants are inserted.
    await client.query(
      `INSERT INTO role_permissions (role_id, permission_id)
       SELECT $1, permission_id FROM unnest($2::uuid[]) AS permission_id ON CONFLICT DO NOTHING`,
      [adminRole.id, permissionIds]
    );
    await client.query('UPDATE roles SET updated_at = NOW() WHERE id = $1', [adminRole.id]);
    const userIds = users.rows.map((user) => user.id);
    if (userIds.length > 0) {
      await client.query('UPDATE users SET roles_version = roles_version + 1 WHERE id = ANY($1::uuid[])', [userIds]);
    }
    if (await countControlPlaneAdmins(client) !== eligibleAdmins) {
      throw new ConflictError('Control-plane administrator eligibility changed; migration aborted');
    }
    await logAuditEvent({
      actorId: null,
      action: 'role.permissions.update',
      actionCategory: 'authorization',
      resourceType: 'role',
      resourceId: adminRole.id,
      changes: { permissionNames: { from: previousPermissionNames, to: permissionNames } },
      metadata: {
        work_item: 'WORK-0047', catalog_version: ADMIN_ROLE_CATALOG_VERSION,
        method: 'operator_migration', operator_label: operatorLabel,
        database_name: result.databaseName, database_operator: result.databaseOperator,
        invalidated_users: users.rows.map((user) => ({
          user_id: user.id, from_roles_version: user.roles_version, to_roles_version: user.roles_version + 1,
        })),
      },
      client,
    });
    return result;
  });
}
