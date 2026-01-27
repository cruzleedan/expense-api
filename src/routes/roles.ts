import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import { authMiddleware } from '../middleware/auth.js';
import { requirePermission, requireRole } from '../middleware/permission.js';
import {
  getAllRoles,
  getRoleById,
  getRolePermissions,
  getAllPermissions,
  getPermissionsByCategory,
  getUserRoles,
  createRole,
  updateRolePermissions,
  deleteRole,
  setUserRoles,
  assignRoleToUser,
  removeRoleFromUser,
  validateRoleAssignmentSod,
  validateUserSod,
} from '../services/permission.service.js';
import { getUserId } from '../middleware/auth.js';
import { ForbiddenError, NotFoundError, ValidationError } from '../types/index.js';
import {
  RoleSchema,
  RoleWithPermissionsSchema,
  PermissionSchema,
  RoleListResponseSchema,
  PermissionListResponseSchema,
  UserRolesResponseSchema,
  SodValidationResultSchema,
  CreateRoleRequestSchema,
  UpdateRoleRequestSchema,
  AssignRolesRequestSchema,
  AssignRoleRequestSchema,
  RoleIdParamSchema,
  UserIdParamSchema,
  PermissionCategoryParamSchema,
} from '../schemas/role.js';
import { ErrorSchema, MessageSchema } from '../schemas/common.js';

const rolesRouter = new OpenAPIHono();

// All routes require authentication
rolesRouter.use('*', authMiddleware);

// ============================================================================
// ROLE ROUTES
// ============================================================================

// List all roles
const listRolesRoute = createRoute({
  method: 'get',
  path: '/',
  tags: ['Roles'],
  summary: 'List all roles',
  description: 'Get a list of all active roles in the system',
  security: [{ bearerAuth: [] }],
  responses: {
    200: {
      description: 'List of roles',
      content: { 'application/json': { schema: RoleListResponseSchema } },
    },
    401: {
      description: 'Unauthorized',
      content: { 'application/json': { schema: ErrorSchema } },
    },
    403: {
      description: 'Forbidden',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
});

rolesRouter.openapi(listRolesRoute, requirePermission('role.view'), async (c) => {
  const roles = await getAllRoles();
  return c.json({
    roles: roles.map(r => ({
      ...r,
      created_at: r.created_at.toISOString(),
      updated_at: r.updated_at.toISOString(),
    })),
    total: roles.length,
  }, 200);
});

// Get role by ID with permissions
const getRoleRoute = createRoute({
  method: 'get',
  path: '/{roleId}',
  tags: ['Roles'],
  summary: 'Get role details',
  description: 'Get a role by ID including its assigned permissions',
  security: [{ bearerAuth: [] }],
  request: {
    params: RoleIdParamSchema,
  },
  responses: {
    200: {
      description: 'Role details',
      content: { 'application/json': { schema: RoleWithPermissionsSchema } },
    },
    404: {
      description: 'Role not found',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
});

rolesRouter.openapi(getRoleRoute, requirePermission('role.view'), async (c) => {
  const { roleId } = c.req.valid('param');
  const role = await getRoleById(roleId);

  if (!role) {
    throw new NotFoundError('Role');
  }

  const permissions = await getRolePermissions(roleId);

  return c.json({
    ...role,
    created_at: role.created_at.toISOString(),
    updated_at: role.updated_at.toISOString(),
    permissions: permissions.map(p => ({
      ...p,
      created_at: p.created_at.toISOString(),
    })),
  }, 200);
});

// Create a new role
const createRoleRoute = createRoute({
  method: 'post',
  path: '/',
  tags: ['Roles'],
  summary: 'Create a new role',
  description: 'Create a new custom role with specified permissions',
  security: [{ bearerAuth: [] }],
  request: {
    body: {
      content: { 'application/json': { schema: CreateRoleRequestSchema } },
    },
  },
  responses: {
    201: {
      description: 'Role created',
      content: { 'application/json': { schema: RoleSchema } },
    },
    400: {
      description: 'Validation error or SoD violation',
      content: { 'application/json': { schema: ErrorSchema } },
    },
    409: {
      description: 'Role name already exists',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
});

rolesRouter.openapi(createRoleRoute, requirePermission('role.create'), async (c) => {
  const { name, description, permission_ids } = c.req.valid('json');
  const userId = getUserId(c);

  try {
    const role = await createRole(name, description || null, permission_ids, userId);

    return c.json({
      ...role,
      created_at: role.created_at.toISOString(),
      updated_at: role.updated_at.toISOString(),
    }, 201);
  } catch (error) {
    if (error instanceof Error && error.message.includes('duplicate key')) {
      throw new ValidationError('Role name already exists');
    }
    throw error;
  }
});

// Update role permissions
const updateRoleRoute = createRoute({
  method: 'put',
  path: '/{roleId}',
  tags: ['Roles'],
  summary: 'Update role permissions',
  description: 'Update the permissions assigned to a role. System roles cannot be modified.',
  security: [{ bearerAuth: [] }],
  request: {
    params: RoleIdParamSchema,
    body: {
      content: { 'application/json': { schema: UpdateRoleRequestSchema } },
    },
  },
  responses: {
    200: {
      description: 'Role updated',
      content: { 'application/json': { schema: MessageSchema } },
    },
    400: {
      description: 'SoD violation',
      content: { 'application/json': { schema: SodValidationResultSchema } },
    },
    403: {
      description: 'Cannot modify system role',
      content: { 'application/json': { schema: ErrorSchema } },
    },
    404: {
      description: 'Role not found',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
});

rolesRouter.openapi(updateRoleRoute, requirePermission('role.edit'), async (c) => {
  const { roleId } = c.req.valid('param');
  const { permission_ids } = c.req.valid('json');
  const userId = getUserId(c);

  const role = await getRoleById(roleId);
  if (!role) {
    throw new NotFoundError('Role');
  }

  if (role.is_system) {
    throw new ForbiddenError('Cannot modify system roles');
  }

  await updateRolePermissions(roleId, permission_ids, userId);

  return c.json({ message: 'Role updated successfully' }, 200);
});

// Delete a role
const deleteRoleRoute = createRoute({
  method: 'delete',
  path: '/{roleId}',
  tags: ['Roles'],
  summary: 'Delete a role',
  description: 'Delete a custom role. System roles cannot be deleted.',
  security: [{ bearerAuth: [] }],
  request: {
    params: RoleIdParamSchema,
  },
  responses: {
    200: {
      description: 'Role deleted',
      content: { 'application/json': { schema: MessageSchema } },
    },
    403: {
      description: 'Cannot delete system role',
      content: { 'application/json': { schema: ErrorSchema } },
    },
    404: {
      description: 'Role not found',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
});

rolesRouter.openapi(deleteRoleRoute, requirePermission('role.delete'), async (c) => {
  const { roleId } = c.req.valid('param');

  const role = await getRoleById(roleId);
  if (!role) {
    throw new NotFoundError('Role');
  }

  if (role.is_system) {
    throw new ForbiddenError('Cannot delete system roles');
  }

  const deleted = await deleteRole(roleId);
  if (!deleted) {
    throw new ForbiddenError('Cannot delete system roles');
  }

  return c.json({ message: 'Role deleted successfully' }, 200);
});

// ============================================================================
// PERMISSION ROUTES
// ============================================================================

// List all permissions
const listPermissionsRoute = createRoute({
  method: 'get',
  path: '/permissions',
  tags: ['Permissions'],
  summary: 'List all permissions',
  description: 'Get a list of all permissions in the permission registry',
  security: [{ bearerAuth: [] }],
  responses: {
    200: {
      description: 'List of permissions',
      content: { 'application/json': { schema: PermissionListResponseSchema } },
    },
  },
});

rolesRouter.openapi(listPermissionsRoute, requirePermission('permission.view'), async (c) => {
  const permissions = await getAllPermissions();
  return c.json({
    permissions: permissions.map(p => ({
      ...p,
      created_at: p.created_at.toISOString(),
    })),
    total: permissions.length,
  }, 200);
});

// List permissions by category
const listPermissionsByCategoryRoute = createRoute({
  method: 'get',
  path: '/permissions/category/{category}',
  tags: ['Permissions'],
  summary: 'List permissions by category',
  description: 'Get permissions filtered by category (e.g., report, role, user, workflow)',
  security: [{ bearerAuth: [] }],
  request: {
    params: PermissionCategoryParamSchema,
  },
  responses: {
    200: {
      description: 'List of permissions',
      content: { 'application/json': { schema: PermissionListResponseSchema } },
    },
  },
});

rolesRouter.openapi(listPermissionsByCategoryRoute, requirePermission('permission.view'), async (c) => {
  const { category } = c.req.valid('param');
  const permissions = await getPermissionsByCategory(category);
  return c.json({
    permissions: permissions.map(p => ({
      ...p,
      created_at: p.created_at.toISOString(),
    })),
    total: permissions.length,
  }, 200);
});

// ============================================================================
// USER ROLE ASSIGNMENT ROUTES
// ============================================================================

// Get user's roles
const getUserRolesRoute = createRoute({
  method: 'get',
  path: '/users/{userId}/roles',
  tags: ['User Roles'],
  summary: 'Get user roles',
  description: 'Get all roles assigned to a user',
  security: [{ bearerAuth: [] }],
  request: {
    params: UserIdParamSchema,
  },
  responses: {
    200: {
      description: 'User roles',
      content: { 'application/json': { schema: UserRolesResponseSchema } },
    },
    404: {
      description: 'User not found',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
});

rolesRouter.openapi(getUserRolesRoute, requirePermission('role.view'), async (c) => {
  const { userId } = c.req.valid('param');
  const roles = await getUserRoles(userId);

  return c.json({
    user_id: userId,
    roles: roles.map(r => ({
      ...r,
      created_at: r.created_at.toISOString(),
      updated_at: r.updated_at.toISOString(),
    })),
  }, 200);
});

// Set user's roles (replace all)
const setUserRolesRoute = createRoute({
  method: 'put',
  path: '/users/{userId}/roles',
  tags: ['User Roles'],
  summary: 'Set user roles',
  description: 'Replace all roles for a user. Validates SoD rules before assignment.',
  security: [{ bearerAuth: [] }],
  request: {
    params: UserIdParamSchema,
    body: {
      content: { 'application/json': { schema: AssignRolesRequestSchema } },
    },
  },
  responses: {
    200: {
      description: 'Roles assigned',
      content: { 'application/json': { schema: MessageSchema } },
    },
    400: {
      description: 'SoD violation',
      content: { 'application/json': { schema: SodValidationResultSchema } },
    },
    403: {
      description: 'Cannot assign admin/finance roles without special permission',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
});

rolesRouter.openapi(setUserRolesRoute, requirePermission('role.assign'), async (c) => {
  const { userId } = c.req.valid('param');
  const { role_ids } = c.req.valid('json');
  const adminId = getUserId(c);

  // Check for admin/finance role assignment permissions
  const targetRoles = await Promise.all(role_ids.map(id => getRoleById(id)));
  const adminRole = targetRoles.find(r => r?.name === 'admin' || r?.name === 'super_admin');
  const financeRole = targetRoles.find(r => r?.name === 'finance');

  const authUser = c.get('authUser');
  if (adminRole && !authUser?.permissions.includes('role.assign.admin')) {
    throw new ForbiddenError('role.assign.admin permission required to assign admin roles');
  }
  if (financeRole && !authUser?.permissions.includes('role.assign.finance')) {
    throw new ForbiddenError('role.assign.finance permission required to assign finance role');
  }

  // Validate SoD before assignment
  const sodResult = await validateRoleAssignmentSod(userId, role_ids);
  if (!sodResult.valid) {
    return c.json(sodResult, 400);
  }

  await setUserRoles(userId, role_ids, adminId);

  return c.json({ message: 'User roles updated successfully' }, 200);
});

// Add a role to user
const addUserRoleRoute = createRoute({
  method: 'post',
  path: '/users/{userId}/roles',
  tags: ['User Roles'],
  summary: 'Add role to user',
  description: 'Add a single role to a user. Validates SoD rules before assignment.',
  security: [{ bearerAuth: [] }],
  request: {
    params: UserIdParamSchema,
    body: {
      content: { 'application/json': { schema: AssignRoleRequestSchema } },
    },
  },
  responses: {
    200: {
      description: 'Role added',
      content: { 'application/json': { schema: MessageSchema } },
    },
    400: {
      description: 'SoD violation',
      content: { 'application/json': { schema: SodValidationResultSchema } },
    },
  },
});

rolesRouter.openapi(addUserRoleRoute, requirePermission('role.assign'), async (c) => {
  const { userId } = c.req.valid('param');
  const { role_id } = c.req.valid('json');
  const adminId = getUserId(c);

  // Check permissions for special roles
  const role = await getRoleById(role_id);
  if (!role) {
    throw new NotFoundError('Role');
  }

  const authUser = c.get('authUser');
  if ((role.name === 'admin' || role.name === 'super_admin') && !authUser?.permissions.includes('role.assign.admin')) {
    throw new ForbiddenError('role.assign.admin permission required');
  }
  if (role.name === 'finance' && !authUser?.permissions.includes('role.assign.finance')) {
    throw new ForbiddenError('role.assign.finance permission required');
  }

  // Validate SoD
  const sodResult = await validateRoleAssignmentSod(userId, [role_id]);
  if (!sodResult.valid) {
    return c.json(sodResult, 400);
  }

  await assignRoleToUser(userId, role_id, adminId);

  return c.json({ message: 'Role added successfully' }, 200);
});

// Remove a role from user
const removeUserRoleRoute = createRoute({
  method: 'delete',
  path: '/users/{userId}/roles/{roleId}',
  tags: ['User Roles'],
  summary: 'Remove role from user',
  description: 'Remove a role from a user',
  security: [{ bearerAuth: [] }],
  request: {
    params: UserIdParamSchema.merge(RoleIdParamSchema),
  },
  responses: {
    200: {
      description: 'Role removed',
      content: { 'application/json': { schema: MessageSchema } },
    },
  },
});

rolesRouter.openapi(removeUserRoleRoute, requirePermission('role.assign'), async (c) => {
  const { userId, roleId } = c.req.valid('param');

  await removeRoleFromUser(userId, roleId);

  return c.json({ message: 'Role removed successfully' }, 200);
});

// Validate user's SoD status
const validateUserSodRoute = createRoute({
  method: 'get',
  path: '/users/{userId}/sod-validation',
  tags: ['User Roles'],
  summary: 'Validate user SoD',
  description: 'Check if a user\'s current permissions violate any Separation of Duties rules',
  security: [{ bearerAuth: [] }],
  request: {
    params: UserIdParamSchema,
  },
  responses: {
    200: {
      description: 'SoD validation result',
      content: { 'application/json': { schema: SodValidationResultSchema } },
    },
  },
});

rolesRouter.openapi(validateUserSodRoute, requirePermission('role.view'), async (c) => {
  const { userId } = c.req.valid('param');
  const result = await validateUserSod(userId);
  return c.json(result, 200);
});

export { rolesRouter };
