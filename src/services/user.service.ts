import { randomBytes, scrypt } from 'crypto';
import { promisify } from 'util';
import { query } from '../db/client.js';
import type { User, Role } from '../types/index.js';
import { NotFoundError, ConflictError, ValidationError } from '../types/index.js';
import {
  getOffset,
  buildOrderByClause,
  buildSearchCondition,
  USER_SORTABLE_FIELDS,
  USER_SEARCHABLE_FIELDS,
  type PaginationParams,
} from '../utils/pagination.js';

const scryptAsync = promisify(scrypt);

export interface UserRole {
  id: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  assignedAt: Date;
}

export interface CreateUserInput {
  email: string;
  username?: string;
  password: string;
  departmentId?: string;
  managerId?: string;
  costCenter?: string;
}

export interface UpdateUserInput {
  email?: string;
  username?: string;
  isActive?: boolean;
  departmentId?: string | null;
  managerId?: string | null;
  costCenter?: string | null;
}

export interface ListUsersFilters {
  isActive?: boolean;
  departmentId?: string;
}

// User type without sensitive fields
export type SafeUser = Omit<User, 'password_hash' | 'oauth_id' | 'failed_login_attempts' | 'locked_until' | 'roles_version'>;

export interface SafeUserWithRoles extends SafeUser {
  roles: UserRole[];
}

function toSafeUser(user: User): SafeUser {
  const { password_hash, oauth_id, roles_version, ...safe } = user;
  return safe;
}

async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex');
  const derivedKey = (await scryptAsync(password, salt, 64)) as Buffer;
  return `${salt}:${derivedKey.toString('hex')}`;
}

function validatePasswordStrength(password: string): void {
  if (password.length < 8) {
    throw new ValidationError('Password must be at least 8 characters');
  }
}

export async function createUser(input: CreateUserInput): Promise<SafeUser> {
  const existing = await query<User>(
    'SELECT id FROM users WHERE email = $1',
    [input.email]
  );
  if (existing.rows.length > 0) {
    throw new ConflictError('Email already registered');
  }

  validatePasswordStrength(input.password);

  if (input.managerId) {
    const manager = await query<User>(
      'SELECT id FROM users WHERE id = $1',
      [input.managerId]
    );
    if (manager.rows.length === 0) {
      throw new NotFoundError('Manager');
    }
  }

  if (input.departmentId) {
    const dept = await query<{ id: string }>(
      'SELECT id FROM departments WHERE id = $1',
      [input.departmentId]
    );
    if (dept.rows.length === 0) {
      throw new NotFoundError('Department');
    }
  }

  const passwordHash = await hashPassword(input.password);
  const username = input.username || input.email.split('@')[0];

  const result = await query<User>(
    `INSERT INTO users (email, username, password_hash, department_id, manager_id, cost_center, roles_version, is_active)
     VALUES ($1, $2, $3, $4, $5, $6, 1, true)
     RETURNING *`,
    [
      input.email,
      username,
      passwordHash,
      input.departmentId ?? null,
      input.managerId ?? null,
      input.costCenter ?? null,
    ]
  );

  // Assign default employee role
  const roleResult = await query<{ id: string }>(
    `SELECT id FROM roles WHERE name = 'employee' AND is_active = true`
  );
  if (roleResult.rows.length > 0) {
    await query(
      `INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [result.rows[0].id, roleResult.rows[0].id]
    );
  }

  return toSafeUser(result.rows[0]);
}

export async function getUserById(userId: string): Promise<SafeUser> {
  const result = await query<User>(
    'SELECT * FROM users WHERE id = $1',
    [userId]
  );

  if (result.rows.length === 0) {
    throw new NotFoundError('User');
  }

  return toSafeUser(result.rows[0]);
}

export async function listUsers(
  params: PaginationParams,
  filters?: ListUsersFilters
): Promise<{ users: SafeUser[]; total: number }> {
  const offset = getOffset(params);
  const conditions: string[] = [];
  const values: unknown[] = [];
  let paramIndex = 1;

  if (filters?.isActive !== undefined) {
    conditions.push(`is_active = $${paramIndex}`);
    values.push(filters.isActive);
    paramIndex++;
  }

  if (filters?.departmentId) {
    conditions.push(`department_id = $${paramIndex}`);
    values.push(filters.departmentId);
    paramIndex++;
  }

  // Add search condition if provided
  const searchCondition = buildSearchCondition(
    params.search,
    USER_SEARCHABLE_FIELDS,
    paramIndex
  );
  if (searchCondition) {
    conditions.push(searchCondition.condition);
    values.push(searchCondition.value);
    paramIndex = searchCondition.nextParamIndex;
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  // Build ORDER BY clause with allowed fields, default to created_at DESC
  const orderBy = buildOrderByClause(
    params,
    USER_SORTABLE_FIELDS,
    'created_at DESC'
  );

  // TODO: Instead of is_active, return status with values 'active', 'inactive', 'locked' or 'pending_verification'
  const [dataResult, countResult] = await Promise.all([
    query<User>(
      `SELECT
        id,
        email,
        username,
        first_name,
        last_name,
        department_id,
        manager_id,
        cost_center,
        CASE
          WHEN is_active then 'active'
          WHEN locked_until > NOW() then 'locked'
          WHEN is_verified = false then 'pending_verification'
        ELSE 'inactive'
        END AS status,
        locked_until,
        created_at,
        updated_at
       FROM users ${whereClause}
       ORDER BY ${orderBy}
       LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
      [...values, params.limit, offset]
    ),
    query<{ count: string }>(
      `SELECT COUNT(*) as count FROM users ${whereClause}`,
      values
    ),
  ]);

  return {
    users: dataResult.rows.map(toSafeUser),
    total: parseInt(countResult.rows[0].count, 10),
  };
}

export async function updateUser(
  userId: string,
  input: UpdateUserInput
): Promise<SafeUser> {
  await getUserById(userId);

  if (input.email) {
    const existing = await query<User>(
      'SELECT id FROM users WHERE email = $1 AND id != $2',
      [input.email, userId]
    );
    if (existing.rows.length > 0) {
      throw new ConflictError('Email already in use');
    }
  }

  if (input.managerId) {
    if (input.managerId === userId) {
      throw new ConflictError('User cannot be their own manager');
    }
    const manager = await query<User>(
      'SELECT id FROM users WHERE id = $1',
      [input.managerId]
    );
    if (manager.rows.length === 0) {
      throw new NotFoundError('Manager');
    }
  }

  if (input.departmentId) {
    const dept = await query<{ id: string }>(
      'SELECT id FROM departments WHERE id = $1',
      [input.departmentId]
    );
    if (dept.rows.length === 0) {
      throw new NotFoundError('Department');
    }
  }

  const updates: string[] = [];
  const values: unknown[] = [];
  let paramIndex = 1;

  if (input.email !== undefined) {
    updates.push(`email = $${paramIndex}`);
    values.push(input.email);
    paramIndex++;
  }

  if (input.username !== undefined) {
    updates.push(`username = $${paramIndex}`);
    values.push(input.username);
    paramIndex++;
  }

  if (input.isActive !== undefined) {
    updates.push(`is_active = $${paramIndex}`);
    values.push(input.isActive);
    paramIndex++;
  }

  if (input.departmentId !== undefined) {
    updates.push(`department_id = $${paramIndex}`);
    values.push(input.departmentId);
    paramIndex++;
  }

  if (input.managerId !== undefined) {
    updates.push(`manager_id = $${paramIndex}`);
    values.push(input.managerId);
    paramIndex++;
  }

  if (input.costCenter !== undefined) {
    updates.push(`cost_center = $${paramIndex}`);
    values.push(input.costCenter);
    paramIndex++;
  }

  if (updates.length === 0) {
    return getUserById(userId);
  }

  values.push(userId);

  const result = await query<User>(
    `UPDATE users SET ${updates.join(', ')}
     WHERE id = $${paramIndex}
     RETURNING *`,
    values
  );

  // If user was deactivated, revoke all their tokens
  if (input.isActive === false) {
    await query(
      'UPDATE refresh_tokens SET revoked_at = NOW() WHERE user_id = $1 AND revoked_at IS NULL',
      [userId]
    );
  }

  return toSafeUser(result.rows[0]);
}

export async function deleteUser(userId: string): Promise<void> {
  await getUserById(userId);

  // Check if user has any expense reports
  const reports = await query<{ count: string }>(
    'SELECT COUNT(*) as count FROM expense_reports WHERE user_id = $1',
    [userId]
  );

  if (parseInt(reports.rows[0].count, 10) > 0) {
    throw new ConflictError('Cannot delete user with existing expense reports. Deactivate the user instead.');
  }

  await query('DELETE FROM users WHERE id = $1', [userId]);
}

// Role management functions

export async function getUserRolesById(userId: string): Promise<UserRole[]> {
  const result = await query<UserRole>(
    `SELECT r.id, r.name, r.description, r.is_system, ur.assigned_at
     FROM roles r
     JOIN user_roles ur ON r.id = ur.role_id
     WHERE ur.user_id = $1 AND r.is_active = true
     ORDER BY r.name`,
    [userId]
  );
  return result.rows;
}

export async function getUserWithRoles(userId: string): Promise<SafeUserWithRoles> {
  const user = await getUserById(userId);
  const roles = await getUserRolesById(userId);
  return { ...user, roles };
}

export async function listUsersWithRoles(
  params: PaginationParams,
  filters?: ListUsersFilters
): Promise<{ users: SafeUserWithRoles[]; total: number }> {
  const { users, total } = await listUsers(params, filters);

  // Fetch roles for all users in parallel
  const usersWithRoles = await Promise.all(
    users.map(async (user) => {
      const roles = await getUserRolesById(user.id);
      return { ...user, roles };
    })
  );

  return { users: usersWithRoles, total };
}

export async function setUserRolesById(
  userId: string,
  roleIds: string[],
  assignedBy?: string
): Promise<UserRole[]> {
  await getUserById(userId);

  // Validate all role IDs exist
  for (const roleId of roleIds) {
    const role = await query<Role>(
      'SELECT id FROM roles WHERE id = $1 AND is_active = true',
      [roleId]
    );
    if (role.rows.length === 0) {
      throw new NotFoundError(`Role ${roleId}`);
    }
  }

  // Remove existing roles
  await query('DELETE FROM user_roles WHERE user_id = $1', [userId]);

  // Assign new roles
  for (const roleId of roleIds) {
    await query(
      `INSERT INTO user_roles (user_id, role_id, assigned_by)
       VALUES ($1, $2, $3)
       ON CONFLICT DO NOTHING`,
      [userId, roleId, assignedBy ?? null]
    );
  }

  // Increment roles_version to invalidate existing tokens
  await query(
    'UPDATE users SET roles_version = roles_version + 1 WHERE id = $1',
    [userId]
  );

  return getUserRolesById(userId);
}

export async function addUserRole(
  userId: string,
  roleId: string,
  assignedBy?: string
): Promise<UserRole[]> {
  await getUserById(userId);

  const role = await query<Role>(
    'SELECT id FROM roles WHERE id = $1 AND is_active = true',
    [roleId]
  );
  if (role.rows.length === 0) {
    throw new NotFoundError('Role');
  }

  // Check if already assigned
  const existing = await query(
    'SELECT 1 FROM user_roles WHERE user_id = $1 AND role_id = $2',
    [userId, roleId]
  );
  if (existing.rows.length > 0) {
    throw new ConflictError('Role already assigned to user');
  }

  await query(
    `INSERT INTO user_roles (user_id, role_id, assigned_by)
     VALUES ($1, $2, $3)`,
    [userId, roleId, assignedBy ?? null]
  );

  // Increment roles_version to invalidate existing tokens
  await query(
    'UPDATE users SET roles_version = roles_version + 1 WHERE id = $1',
    [userId]
  );

  return getUserRolesById(userId);
}

export async function removeUserRole(
  userId: string,
  roleId: string
): Promise<UserRole[]> {
  await getUserById(userId);

  const result = await query(
    'DELETE FROM user_roles WHERE user_id = $1 AND role_id = $2 RETURNING *',
    [userId, roleId]
  );

  if (result.rowCount === 0) {
    throw new NotFoundError('User role assignment');
  }

  // Increment roles_version to invalidate existing tokens
  await query(
    'UPDATE users SET roles_version = roles_version + 1 WHERE id = $1',
    [userId]
  );

  return getUserRolesById(userId);
}
