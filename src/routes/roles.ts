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
  RoleListQuerySchema,
} from '../schemas/role.js';
import { ErrorSchema, MessageSchema } from '../schemas/common.js';

const rolesRouter = new OpenAPIHono();

// All routes require authentication
rolesRouter.use('*', authMiddleware);

// IMPORTANT: Register static routes before parameterized routes using standard Hono methods
// This ensures correct route matching priority
rolesRouter.get('/permissions', requirePermission('permission.view'), async (c) => {
  const permissions = await getAllPermissions();
  return c.json({
    permissions: permissions.map((p: any) => ({
      id: p.id,
      name: p.name,
      description: p.description,
      category: p.category,
      riskLevel: p.risk_level,
      requiresMfa: p.requires_mfa,
      createdAt: p.created_at.toISOString(),
    })),
    total: permissions.length,
  }, 200);
});

rolesRouter.get('/permissions/category/:category', requirePermission('permission.view'), async (c) => {
  const category = c.req.param('category');
  const permissions = await getPermissionsByCategory(category);
  return c.json({
    permissions: permissions.map((p: any) => ({
      id: p.id,
      name: p.name,
      description: p.description,
      category: p.category,
      riskLevel: p.risk_level,
      requiresMfa: p.requires_mfa,
      createdAt: p.created_at.toISOString(),
    })),
    total: permissions.length,
  }, 200);
});

// ============================================================================
// ROLE ROUTES
// ============================================================================

// List all roles
const listRolesRoute = createRoute({
  method: 'get',
  path: '/',
  tags: ['Roles'],
  summary: 'List all roles',
  description: 'Get a list of all active roles in the system with pagination',
  security: [{ bearerAuth: [] }],
  middleware: [requirePermission('role.view')] as const,
  request: {
    query: RoleListQuerySchema,
  },
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

rolesRouter.openapi(listRolesRoute, async (c) => {
  const query = c.req.valid('query');
  const paginationParams = {
    page: query.page,
    limit: query.limit,
    search: query.search,
    sortBy: query.sortBy,
    sortOrder: query.sortOrder,
  };

  const { roles, total } = await getAllRoles(paginationParams);

  const totalPages = Math.ceil(total / paginationParams.limit);

  return c.json({
    roles: roles.map(r => ({
      id: r.id,
      name: r.name,
      description: r.description,
      isSystem: r.is_system,
      isActive: r.is_active,
      permissionCount: parseInt(String((r as any).permission_count || 0)),
      createdAt: r.created_at.toISOString(),
      updatedAt: r.updated_at.toISOString(),
    })),
    pagination: {
      page: paginationParams.page,
      limit: paginationParams.limit,
      total,
      totalPages,
      hasNext: paginationParams.page < totalPages,
      hasPrev: paginationParams.page > 1,
    },
  }, 200);
});

// ============================================================================
// ROLE DETAIL ROUTES
// ============================================================================

// Get role by ID with permissions
// Note: Using regex pattern to ensure roleId must be a valid UUID format
// This prevents the route from matching static paths like '/permissions'
const getRoleRoute = createRoute({
  method: 'get',
  path: '/{roleId}',
  tags: ['Roles'],
  summary: 'Get role details',
  description: 'Get a role by ID including its assigned permissions',
  security: [{ bearerAuth: [] }],
  middleware: [requirePermission('role.view')] as const,
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

rolesRouter.openapi(getRoleRoute, async (c) => {
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
  middleware: [requirePermission('role.create')] as const,
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

rolesRouter.openapi(createRoleRoute, async (c) => {
  const { name, description, permissionIds } = c.req.valid('json');
  const userId = getUserId(c);

  try {
    const role = await createRole(name, description || null, permissionIds, userId);
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
  middleware: [requirePermission('role.edit')] as const,
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

rolesRouter.openapi(updateRoleRoute, async (c) => {
  const { roleId } = c.req.valid('param');
  const { permissionIds } = c.req.valid('json');
  const userId = getUserId(c);

  const role = await getRoleById(roleId);
  if (!role) {
    throw new NotFoundError('Role');
  }

  if (role.is_system) {
    throw new ForbiddenError('Cannot modify system roles');
  }

  await updateRolePermissions(roleId, permissionIds, userId);

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
  middleware: [requirePermission('role.delete')] as const,
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

rolesRouter.openapi(deleteRoleRoute, async (c) => {
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
  middleware: [requirePermission('role.view')] as const,
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

rolesRouter.openapi(getUserRolesRoute, async (c) => {
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
  middleware: [requirePermission('role.assign')] as const,
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

rolesRouter.openapi(setUserRolesRoute, async (c) => {
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
  middleware: [requirePermission('role.assign')] as const,
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

rolesRouter.openapi(addUserRoleRoute, async (c) => {
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
  middleware: [requirePermission('role.assign')] as const,
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

rolesRouter.openapi(removeUserRoleRoute, async (c) => {
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
  middleware: [requirePermission('role.view')] as const,
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

rolesRouter.openapi(validateUserSodRoute, async (c) => {
  const { userId } = c.req.valid('param');
  const result = await validateUserSod(userId);
  return c.json(result, 200);
});

export { rolesRouter };
