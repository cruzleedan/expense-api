import type { MiddlewareHandler, Context } from 'hono';
import { ForbiddenError, UnauthorizedError } from '../types/index.js';
import type { AuthUser, JwtPayloadV3 } from '../types/index.js';
import { checkPermissionsFromContext } from '../services/permission.service.js';

// Extend Hono's context to include v3 auth types
declare module 'hono' {
  interface ContextVariableMap {
    authUser: AuthUser;
  }
}

/**
 * Middleware factory that requires specific permissions
 * Use after authMiddleware to check if the authenticated user has the required permissions
 *
 * @param permissions - Array of permission names required (ALL must be present)
 *
 * @example
 * // Require single permission
 * app.get('/reports', authMiddleware, requirePermission('report.view.own'), handler)
 *
 * @example
 * // Require multiple permissions (AND logic)
 * app.post('/roles', authMiddleware, requirePermission('role.create', 'role.edit'), handler)
 */
export function requirePermission(...permissions: string[]): MiddlewareHandler {
  return async (c, next) => {
    const user = c.get('user') as JwtPayloadV3 | undefined;

    if (!user) {
      throw new UnauthorizedError('Authentication required');
    }

    // Check if JWT has v3 structure with permissions
    if (!user.permissions || !Array.isArray(user.permissions)) {
      throw new ForbiddenError('Token does not contain permission claims. Please re-authenticate.');
    }

    // Build AuthUser from JWT payload for permission check
    const authUser: AuthUser = {
      id: user.sub,
      email: user.email,
      username: user.username || null,
      roles: user.roles || [],
      roles_version: user.roles_version,
      permissions: user.permissions,
      department_id: null, // Not in JWT, would need to be fetched if needed
      manager_id: null,
    };

    // Store authUser in context for use in handlers
    c.set('authUser', authUser);

    // Check permissions
    const result = checkPermissionsFromContext(authUser, permissions);

    if (!result.allowed) {
      throw new ForbiddenError(result.reason || 'Insufficient permissions');
    }

    await next();
  };
}

/**
 * Middleware factory that requires ANY of the specified permissions
 *
 * @param permissions - Array of permission names (ANY one is sufficient)
 *
 * @example
 * // User needs either view.own OR view.all
 * app.get('/reports', authMiddleware, requireAnyPermission('report.view.own', 'report.view.all'), handler)
 */
export function requireAnyPermission(...permissions: string[]): MiddlewareHandler {
  return async (c, next) => {
    const user = c.get('user') as JwtPayloadV3 | undefined;

    if (!user) {
      throw new UnauthorizedError('Authentication required');
    }

    if (!user.permissions || !Array.isArray(user.permissions)) {
      throw new ForbiddenError('Token does not contain permission claims. Please re-authenticate.');
    }

    const authUser: AuthUser = {
      id: user.sub,
      email: user.email,
      username: user.username || null,
      roles: user.roles || [],
      roles_version: user.roles_version,
      permissions: user.permissions,
      department_id: null,
      manager_id: null,
    };

    c.set('authUser', authUser);

    // Check if user has any of the permissions
    const userPermSet = new Set(user.permissions);
    const hasAny = permissions.some(p => userPermSet.has(p));

    if (!hasAny) {
      throw new ForbiddenError(
        `Requires one of: ${permissions.join(', ')}`
      );
    }

    await next();
  };
}

/**
 * Middleware factory that requires specific roles
 *
 * @param roles - Array of role names (ANY one is sufficient)
 *
 * @example
 * app.delete('/users/:id', authMiddleware, requireRole('admin', 'super_admin'), handler)
 */
export function requireRole(...roles: string[]): MiddlewareHandler {
  return async (c, next) => {
    const user = c.get('user') as JwtPayloadV3 | undefined;

    if (!user) {
      throw new UnauthorizedError('Authentication required');
    }

    if (!user.roles || !Array.isArray(user.roles)) {
      throw new ForbiddenError('Token does not contain role claims. Please re-authenticate.');
    }

    const authUser: AuthUser = {
      id: user.sub,
      email: user.email,
      username: user.username || null,
      roles: user.roles,
      roles_version: user.roles_version,
      permissions: user.permissions || [],
      department_id: null,
      manager_id: null,
    };

    c.set('authUser', authUser);

    // Check if user has any of the required roles
    const userRoleSet = new Set(user.roles);
    const hasRole = roles.some(r => userRoleSet.has(r));

    if (!hasRole) {
      throw new ForbiddenError(
        `Requires one of roles: ${roles.join(', ')}`
      );
    }

    await next();
  };
}

/**
 * Get the authenticated user's AuthUser object from context
 * Use after authMiddleware and requirePermission/requireRole
 */
export function getAuthUser(c: Context): AuthUser {
  const authUser = c.get('authUser');
  if (!authUser) {
    throw new UnauthorizedError('User context not available');
  }
  return authUser;
}

/**
 * Check if the current user has a specific permission
 * Use within handlers after permission middleware has run
 */
export function userHasPermission(c: Context, permission: string): boolean {
  const authUser = c.get('authUser') as AuthUser | undefined;
  if (!authUser) {
    return false;
  }
  return authUser.permissions.includes(permission);
}

/**
 * Check if the current user has a specific role
 * Use within handlers after permission middleware has run
 */
export function userHasRole(c: Context, role: string): boolean {
  const authUser = c.get('authUser') as AuthUser | undefined;
  if (!authUser) {
    return false;
  }
  return authUser.roles.includes(role);
}

/**
 * Get the permission scope for viewing reports based on user's permissions
 * Returns the highest scope available to the user
 */
export function getReportViewScope(c: Context): 'own' | 'team' | 'department' | 'all' {
  const authUser = c.get('authUser') as AuthUser | undefined;
  if (!authUser) {
    return 'own';
  }

  const perms = new Set(authUser.permissions);

  if (perms.has('report.view.all')) {
    return 'all';
  }
  if (perms.has('report.view.department')) {
    return 'department';
  }
  if (perms.has('report.view.team')) {
    return 'team';
  }
  return 'own';
}
