import { db } from '../db/client';
import type {
  Permission,
  Role,
  SodRule,
  SodValidationResult,
  PermissionCheckResult,
  AuthUser,
} from '../types';
import {
  buildOrderByClause,
  buildSearchCondition,
  ROLE_SORTABLE_FIELDS,
  ROLE_SEARCHABLE_FIELDS,
  type PaginationParams,
} from '../utils/pagination';

/**
 * Permission Service
 * Handles permission registry, role-permission mappings, and SoD validation
 */

// ============================================================================
// Permission Registry Operations
// ============================================================================

/**
 * Get all permissions from the registry
 */
export async function getAllPermissions(): Promise<Permission[]> {
  const result = await db.query<Permission>(
    `SELECT id, name, description, category, risk_level, requires_mfa, created_at
     FROM permissions
     ORDER BY category, name`
  );
  return result.rows;
}

/**
 * Get permissions by category
 */
export async function getPermissionsByCategory(category: string): Promise<Permission[]> {
  const result = await db.query<Permission>(
    `SELECT id, name, description, category, risk_level, requires_mfa, created_at
     FROM permissions
     WHERE category = $1
     ORDER BY name`,
    [category]
  );
  return result.rows;
}

/**
 * Get a permission by name
 */
export async function getPermissionByName(name: string): Promise<Permission | null> {
  const result = await db.query<Permission>(
    `SELECT id, name, description, category, risk_level, requires_mfa, created_at
     FROM permissions
     WHERE name = $1`,
    [name]
  );
  return result.rows[0] || null;
}

// ============================================================================
// Role Operations
// ============================================================================

/**
 * Get all roles
 */
export async function getAllRoles(params: PaginationParams): Promise<{ roles: Role[], total: number }> {
  const offset = (params.page - 1) * params.limit;
  const conditions: string[] = ['r.is_active = true'];
  const values: unknown[] = [];
  let paramIndex = 1;

  // Add search condition if provided
  const searchCondition = buildSearchCondition(
    params.search,
    ROLE_SEARCHABLE_FIELDS.map(f => `r.${f}`),
    paramIndex
  );
  if (searchCondition) {
    conditions.push(searchCondition.condition);
    values.push(searchCondition.value);
    paramIndex = searchCondition.nextParamIndex;
  }

  const whereClause = conditions.join(' AND ');

  // Get total count
  const countResult = await db.query<{ count: string }>(
    `SELECT COUNT(*) as count FROM roles r WHERE ${whereClause}`,
    values
  );
  const total = parseInt(countResult.rows[0].count);

  // Build ORDER BY clause with allowed fields, default to name ASC
  // Note: permission_count needs special handling since it's an aggregation
  let orderBy: string;
  if (params.sortBy === 'permissionCount') {
    orderBy = `permission_count ${params.sortOrder === 'desc' ? 'DESC' : 'ASC'}`;
  } else {
    orderBy = buildOrderByClause(
      params,
      // Prefix with 'r.' for role table columns
      Object.fromEntries(
        Object.entries(ROLE_SORTABLE_FIELDS)
          .filter(([key]) => key !== 'permissionCount')
          .map(([key, value]) => [key, `r.${value}`])
      ),
      'r.name ASC'
    );
  }

  // Get paginated roles with permission count
  const result = await db.query<Role & { permission_count: number }>(
    `SELECT r.id, r.name, r.description, r.is_system, r.is_active, r.created_at, r.updated_at,
            COUNT(rp.permission_id) as permission_count
     FROM roles r
     LEFT JOIN role_permissions rp ON r.id = rp.role_id
     WHERE ${whereClause}
     GROUP BY r.id, r.name, r.description, r.is_system, r.is_active, r.created_at, r.updated_at
     ORDER BY ${orderBy}
     LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
    [...values, params.limit, offset]
  );

  return { roles: result.rows, total };
}

/**
 * Get a role by name
 */
export async function getRoleByName(name: string): Promise<Role | null> {
  const result = await db.query<Role>(
    `SELECT id, name, description, is_system, is_active, created_at, updated_at
     FROM roles
     WHERE name = $1`,
    [name]
  );
  return result.rows[0] || null;
}

/**
 * Get a role by ID
 */
export async function getRoleById(id: string): Promise<Role | null> {
  const result = await db.query<Role>(
    `SELECT id, name, description, is_system, is_active, created_at, updated_at
     FROM roles
     WHERE id = $1`,
    [id]
  );
  return result.rows[0] || null;
}

/**
 * Get permissions assigned to a role
 */
export async function getRolePermissions(roleId: string): Promise<Permission[]> {
  const result = await db.query<Permission>(
    `SELECT p.id, p.name, p.description, p.category, p.risk_level, p.requires_mfa, p.created_at
     FROM permissions p
     JOIN role_permissions rp ON p.id = rp.permission_id
     WHERE rp.role_id = $1
     ORDER BY p.category, p.name`,
    [roleId]
  );
  return result.rows;
}

/**
 * Get all permission names for a role
 */
export async function getRolePermissionNames(roleId: string): Promise<string[]> {
  const result = await db.query<{ name: string }>(
    `SELECT p.name
     FROM permissions p
     JOIN role_permissions rp ON p.id = rp.permission_id
     WHERE rp.role_id = $1`,
    [roleId]
  );
  return result.rows.map(r => r.name);
}

// ============================================================================
// User Role & Permission Operations
// ============================================================================

/**
 * Get all roles assigned to a user
 */
export async function getUserRoles(userId: string): Promise<Role[]> {
  const result = await db.query<Role>(
    `SELECT r.id, r.name, r.description, r.is_system, r.is_active, r.created_at, r.updated_at
     FROM roles r
     JOIN user_roles ur ON r.id = ur.role_id
     WHERE ur.user_id = $1 AND r.is_active = true
     ORDER BY r.name`,
    [userId]
  );
  return result.rows;
}

/**
 * Get all role names for a user
 */
export async function getUserRoleNames(userId: string): Promise<string[]> {
  const result = await db.query<{ name: string }>(
    `SELECT r.name
     FROM roles r
     JOIN user_roles ur ON r.id = ur.role_id
     WHERE ur.user_id = $1 AND r.is_active = true`,
    [userId]
  );
  return result.rows.map(r => r.name);
}

/**
 * Get all effective permissions for a user (union of all role permissions)
 */
export async function getUserPermissions(userId: string): Promise<string[]> {
  const result = await db.query<{ name: string }>(
    `SELECT DISTINCT p.name
     FROM permissions p
     JOIN role_permissions rp ON p.id = rp.permission_id
     JOIN user_roles ur ON rp.role_id = ur.role_id
     JOIN roles r ON ur.role_id = r.id
     WHERE ur.user_id = $1 AND r.is_active = true`,
    [userId]
  );
  return result.rows.map(r => r.name);
}

/**
 * Get complete user auth context (roles, permissions, metadata)
 */
export async function getUserAuthContext(userId: string): Promise<AuthUser | null> {
  const userResult = await db.query<{
    id: string;
    email: string;
    username: string | null;
    roles_version: number;
    department_id: string | null;
    manager_id: string | null;
  }>(
    `SELECT id, email, username, roles_version, department_id, manager_id
     FROM users
     WHERE id = $1 AND is_active = true`,
    [userId]
  );

  if (userResult.rows.length === 0) {
    return null;
  }

  const user = userResult.rows[0];
  const roles = await getUserRoleNames(userId);
  const permissions = await getUserPermissions(userId);

  return {
    id: user.id,
    email: user.email,
    username: user.username,
    roles,
    roles_version: user.roles_version,
    permissions,
    department_id: user.department_id,
    manager_id: user.manager_id,
  };
}

/**
 * Assign a role to a user
 */
export async function assignRoleToUser(
  userId: string,
  roleId: string,
  assignedBy: string
): Promise<void> {
  // Insert role assignment
  await db.query(
    `INSERT INTO user_roles (user_id, role_id, assigned_by)
     VALUES ($1, $2, $3)
     ON CONFLICT (user_id, role_id) DO NOTHING`,
    [userId, roleId, assignedBy]
  );

  // Increment roles_version to invalidate existing tokens
  await db.query(
    `UPDATE users SET roles_version = roles_version + 1 WHERE id = $1`,
    [userId]
  );
}

/**
 * Remove a role from a user
 */
export async function removeRoleFromUser(userId: string, roleId: string): Promise<void> {
  await db.query(
    `DELETE FROM user_roles WHERE user_id = $1 AND role_id = $2`,
    [userId, roleId]
  );

  // Increment roles_version to invalidate existing tokens
  await db.query(
    `UPDATE users SET roles_version = roles_version + 1 WHERE id = $1`,
    [userId]
  );
}

/**
 * Set user roles (replace all existing roles)
 */
export async function setUserRoles(
  userId: string,
  roleIds: string[],
  assignedBy: string
): Promise<void> {
  const client = await db.getClient();

  try {
    await client.query('BEGIN');

    // Remove all existing roles
    await client.query(
      `DELETE FROM user_roles WHERE user_id = $1`,
      [userId]
    );

    // Add new roles
    for (const roleId of roleIds) {
      await client.query(
        `INSERT INTO user_roles (user_id, role_id, assigned_by)
         VALUES ($1, $2, $3)`,
        [userId, roleId, assignedBy]
      );
    }

    // Increment roles_version
    await client.query(
      `UPDATE users SET roles_version = roles_version + 1 WHERE id = $1`,
      [userId]
    );

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

// ============================================================================
// Permission Checking
// ============================================================================

/**
 * Check if a user has a specific permission
 */
export async function hasPermission(userId: string, permissionName: string): Promise<boolean> {
  const result = await db.query<{ count: string }>(
    `SELECT COUNT(*) as count
     FROM permissions p
     JOIN role_permissions rp ON p.id = rp.permission_id
     JOIN user_roles ur ON rp.role_id = ur.role_id
     JOIN roles r ON ur.role_id = r.id
     WHERE ur.user_id = $1 AND p.name = $2 AND r.is_active = true`,
    [userId, permissionName]
  );
  return parseInt(result.rows[0].count) > 0;
}

/**
 * Check if a user has all of the specified permissions
 */
export async function hasAllPermissions(
  userId: string,
  permissionNames: string[]
): Promise<PermissionCheckResult> {
  if (permissionNames.length === 0) {
    return { allowed: true };
  }

  const userPermissions = await getUserPermissions(userId);
  const userPermSet = new Set(userPermissions);

  const missingPermissions = permissionNames.filter(p => !userPermSet.has(p));

  if (missingPermissions.length > 0) {
    return {
      allowed: false,
      missing_permissions: missingPermissions,
      reason: `Missing required permissions: ${missingPermissions.join(', ')}`,
    };
  }

  return { allowed: true };
}

/**
 * Check if a user has any of the specified permissions
 */
export async function hasAnyPermission(
  userId: string,
  permissionNames: string[]
): Promise<boolean> {
  if (permissionNames.length === 0) {
    return true;
  }

  const userPermissions = await getUserPermissions(userId);
  const userPermSet = new Set(userPermissions);

  return permissionNames.some(p => userPermSet.has(p));
}

/**
 * Check permissions from an already-loaded AuthUser object (for middleware)
 */
export function checkPermissionsFromContext(
  user: AuthUser,
  requiredPermissions: string[]
): PermissionCheckResult {
  if (requiredPermissions.length === 0) {
    return { allowed: true };
  }

  const userPermSet = new Set(user.permissions);
  const missingPermissions = requiredPermissions.filter(p => !userPermSet.has(p));

  if (missingPermissions.length > 0) {
    return {
      allowed: false,
      missing_permissions: missingPermissions,
      reason: `Missing required permissions: ${missingPermissions.join(', ')}`,
    };
  }

  return { allowed: true };
}

// ============================================================================
// Separation of Duties (SoD) Validation
// ============================================================================

/**
 * Get all active SoD rules
 */
export async function getSodRules(): Promise<SodRule[]> {
  const result = await db.query<SodRule>(
    `SELECT id, name, description, permission_set, risk_level, is_active, created_at
     FROM sod_rules
     WHERE is_active = true`
  );
  return result.rows;
}

/**
 * Validate a set of permissions against SoD rules
 */
export async function validateSod(permissions: string[]): Promise<SodValidationResult> {
  const rules = await getSodRules();
  const permSet = new Set(permissions);
  const violations: SodValidationResult['violations'] = [];

  for (const rule of rules) {
    // Check if all permissions in the toxic combination are present
    const rulePermissions = rule.permission_set;
    const hasAllToxic = rulePermissions.every(p => permSet.has(p));

    if (hasAllToxic) {
      violations.push({
        rule_name: rule.name,
        description: rule.description || '',
        conflicting_permissions: rulePermissions,
      });
    }
  }

  return {
    valid: violations.length === 0,
    violations,
  };
}

/**
 * Validate a user's effective permissions against SoD rules
 */
export async function validateUserSod(userId: string): Promise<SodValidationResult> {
  const permissions = await getUserPermissions(userId);
  return validateSod(permissions);
}

/**
 * Validate if adding new roles to a user would violate SoD
 */
export async function validateRoleAssignmentSod(
  userId: string,
  newRoleIds: string[]
): Promise<SodValidationResult> {
  // Get current user permissions
  const currentPermissions = await getUserPermissions(userId);

  // Get permissions from new roles
  const newPermissions: string[] = [];
  for (const roleId of newRoleIds) {
    const rolePerms = await getRolePermissionNames(roleId);
    newPermissions.push(...rolePerms);
  }

  // Combine and deduplicate
  const allPermissions = [...new Set([...currentPermissions, ...newPermissions])];

  return validateSod(allPermissions);
}

/**
 * Validate if adding permissions to a role would violate SoD for any user with that role
 */
export async function validateRolePermissionChange(
  roleId: string,
  newPermissionNames: string[]
): Promise<SodValidationResult> {
  // Get current role permissions
  const currentPerms = await getRolePermissionNames(roleId);
  const allPerms = [...new Set([...currentPerms, ...newPermissionNames])];

  // Check the role's permission set itself
  const roleResult = await validateSod(allPerms);
  if (!roleResult.valid) {
    return roleResult;
  }

  // Check all users with this role
  const usersResult = await db.query<{ user_id: string }>(
    `SELECT user_id FROM user_roles WHERE role_id = $1`,
    [roleId]
  );

  for (const { user_id } of usersResult.rows) {
    // Get user's permissions from OTHER roles
    const otherPerms = await db.query<{ name: string }>(
      `SELECT DISTINCT p.name
       FROM permissions p
       JOIN role_permissions rp ON p.id = rp.permission_id
       JOIN user_roles ur ON rp.role_id = ur.role_id
       WHERE ur.user_id = $1 AND ur.role_id != $2`,
      [user_id, roleId]
    );

    const combinedPerms = [...allPerms, ...otherPerms.rows.map(r => r.name)];
    const userResult = await validateSod(combinedPerms);

    if (!userResult.valid) {
      return {
        valid: false,
        violations: userResult.violations.map(v => ({
          ...v,
          description: `${v.description} (affects user ${user_id})`,
        })),
      };
    }
  }

  return { valid: true, violations: [] };
}

// ============================================================================
// Role Management (Admin Operations)
// ============================================================================

/**
 * Create a new custom role
 */
export async function createRole(
  name: string,
  description: string | null,
  permissionIds: string[],
  createdBy: string
): Promise<Role> {
  const client = await db.getClient();

  try {
    await client.query('BEGIN');

    // Create the role
    const roleResult = await client.query<Role>(
      `INSERT INTO roles (name, description, is_system)
       VALUES ($1, $2, false)
       RETURNING id, name, description, is_system, is_active, created_at, updated_at`,
      [name, description]
    );

    const role = roleResult.rows[0];

    // Assign permissions
    for (const permissionId of permissionIds) {
      await client.query(
        `INSERT INTO role_permissions (role_id, permission_id, granted_by)
         VALUES ($1, $2, $3)`,
        [role.id, permissionId, createdBy]
      );
    }

    await client.query('COMMIT');
    return role;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Update a role's permissions
 */
export async function updateRolePermissions(
  roleId: string,
  permissionIds: string[],
  updatedBy: string
): Promise<void> {
  const client = await db.getClient();

  try {
    await client.query('BEGIN');

    // Remove existing permissions
    await client.query(
      `DELETE FROM role_permissions WHERE role_id = $1`,
      [roleId]
    );

    // Add new permissions
    for (const permissionId of permissionIds) {
      await client.query(
        `INSERT INTO role_permissions (role_id, permission_id, granted_by)
         VALUES ($1, $2, $3)`,
        [roleId, permissionId, updatedBy]
      );
    }

    // Update role's updated_at
    await client.query(
      `UPDATE roles SET updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
      [roleId]
    );

    // Increment roles_version for all users with this role
    await client.query(
      `UPDATE users SET roles_version = roles_version + 1
       WHERE id IN (SELECT user_id FROM user_roles WHERE role_id = $1)`,
      [roleId]
    );

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Delete a role (only non-system roles)
 */
export async function deleteRole(roleId: string): Promise<boolean> {
  const result = await db.query(
    `DELETE FROM roles WHERE id = $1 AND is_system = false RETURNING id`,
    [roleId]
  );
  return result.rowCount !== null && result.rowCount > 0;
}
