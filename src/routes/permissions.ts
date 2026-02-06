import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import { authMiddleware } from '../middleware/auth.js';
import { requirePermission } from '../middleware/permission.js';
import {
  listPermissions,
  getPermissionById,
  createPermission,
  updatePermission,
  deletePermission,
} from '../services/permission.service.js';
import { NotFoundError } from '../types/index.js';
import {
  PermissionSchema,
  PermissionListResponseSchema,
  PermissionListQuerySchema,
  PermissionIdParamSchema,
  CreatePermissionSchema,
  UpdatePermissionSchema,
} from '../schemas/permission.js';
import { ErrorSchema, MessageSchema } from '../schemas/common.js';

const permissionsRouter = new OpenAPIHono();

// All routes require authentication
permissionsRouter.use('*', authMiddleware);

// ============================================================================
// LIST PERMISSIONS
// ============================================================================

const listPermissionsRoute = createRoute({
  method: 'get',
  path: '/',
  tags: ['Permissions'],
  summary: 'List all permissions',
  description: 'Get a paginated list of all permissions with optional filtering by category and risk level',
  security: [{ bearerAuth: [] }],
  request: {
    query: PermissionListQuerySchema,
  },
  responses: {
    200: {
      description: 'List of permissions',
      content: { 'application/json': { schema: PermissionListResponseSchema } },
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

permissionsRouter.openapi(listPermissionsRoute, requirePermission('permission.view'), async (c) => {
  const query = c.req.valid('query');

  const { permissions, total } = await listPermissions({
    page: query.page,
    limit: query.limit,
    search: query.search,
    sortBy: query.sortBy,
    sortOrder: query.sortOrder,
    category: query.category,
    riskLevel: query.riskLevel,
  });

  const totalPages = Math.ceil(total / query.limit);

  return c.json({
    data: permissions.map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description,
      category: p.category,
      riskLevel: p.risk_level,
      requiresMfa: p.requires_mfa,
      createdAt: p.created_at.toISOString(),
    })),
    pagination: {
      page: query.page,
      limit: query.limit,
      total,
      totalPages,
      hasNext: query.page < totalPages,
      hasPrev: query.page > 1,
    },
  }, 200);
});

// ============================================================================
// GET PERMISSION BY ID
// ============================================================================

const getPermissionRoute = createRoute({
  method: 'get',
  path: '/{permissionId}',
  tags: ['Permissions'],
  summary: 'Get permission by ID',
  description: 'Get a single permission by its ID',
  security: [{ bearerAuth: [] }],
  request: {
    params: PermissionIdParamSchema,
  },
  responses: {
    200: {
      description: 'Permission details',
      content: { 'application/json': { schema: PermissionSchema } },
    },
    404: {
      description: 'Permission not found',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
});

permissionsRouter.openapi(getPermissionRoute, requirePermission('permission.view'), async (c) => {
  const { permissionId } = c.req.valid('param');
  const permission = await getPermissionById(permissionId);

  if (!permission) {
    throw new NotFoundError('Permission');
  }

  return c.json({
    id: permission.id,
    name: permission.name,
    description: permission.description,
    category: permission.category,
    riskLevel: permission.risk_level,
    requiresMfa: permission.requires_mfa,
    createdAt: permission.created_at.toISOString(),
  }, 200);
});

// ============================================================================
// CREATE PERMISSION
// ============================================================================

const createPermissionRoute = createRoute({
  method: 'post',
  path: '/',
  tags: ['Permissions'],
  summary: 'Create a new permission',
  description: 'Create a new permission in the permission registry',
  security: [{ bearerAuth: [] }],
  request: {
    body: {
      content: { 'application/json': { schema: CreatePermissionSchema } },
    },
  },
  responses: {
    201: {
      description: 'Permission created',
      content: { 'application/json': { schema: PermissionSchema } },
    },
    400: {
      description: 'Validation error',
      content: { 'application/json': { schema: ErrorSchema } },
    },
    409: {
      description: 'Permission name already exists',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
});

permissionsRouter.openapi(createPermissionRoute, requirePermission('permission.create'), async (c) => {
  const input = c.req.valid('json');

  const permission = await createPermission({
    name: input.name,
    description: input.description,
    category: input.category,
    riskLevel: input.riskLevel,
    requiresMfa: input.requiresMfa,
  });

  return c.json({
    id: permission.id,
    name: permission.name,
    description: permission.description,
    category: permission.category,
    riskLevel: permission.risk_level,
    requiresMfa: permission.requires_mfa,
    createdAt: permission.created_at.toISOString(),
  }, 201);
});

// ============================================================================
// UPDATE PERMISSION
// ============================================================================

const updatePermissionRoute = createRoute({
  method: 'put',
  path: '/{permissionId}',
  tags: ['Permissions'],
  summary: 'Update a permission',
  description: 'Update an existing permission. Note: permission name cannot be changed.',
  security: [{ bearerAuth: [] }],
  request: {
    params: PermissionIdParamSchema,
    body: {
      content: { 'application/json': { schema: UpdatePermissionSchema } },
    },
  },
  responses: {
    200: {
      description: 'Permission updated',
      content: { 'application/json': { schema: PermissionSchema } },
    },
    404: {
      description: 'Permission not found',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
});

permissionsRouter.openapi(updatePermissionRoute, requirePermission('permission.edit'), async (c) => {
  const { permissionId } = c.req.valid('param');
  const input = c.req.valid('json');

  const permission = await updatePermission(permissionId, {
    description: input.description,
    category: input.category,
    riskLevel: input.riskLevel,
    requiresMfa: input.requiresMfa,
  });

  return c.json({
    id: permission.id,
    name: permission.name,
    description: permission.description,
    category: permission.category,
    riskLevel: permission.risk_level,
    requiresMfa: permission.requires_mfa,
    createdAt: permission.created_at.toISOString(),
  }, 200);
});

// ============================================================================
// DELETE PERMISSION
// ============================================================================

const deletePermissionRoute = createRoute({
  method: 'delete',
  path: '/{permissionId}',
  tags: ['Permissions'],
  summary: 'Delete a permission',
  description: 'Delete a permission. Cannot delete permissions that are assigned to roles.',
  security: [{ bearerAuth: [] }],
  request: {
    params: PermissionIdParamSchema,
  },
  responses: {
    200: {
      description: 'Permission deleted',
      content: { 'application/json': { schema: MessageSchema } },
    },
    404: {
      description: 'Permission not found',
      content: { 'application/json': { schema: ErrorSchema } },
    },
    409: {
      description: 'Permission is assigned to roles',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
});

permissionsRouter.openapi(deletePermissionRoute, requirePermission('permission.delete'), async (c) => {
  const { permissionId } = c.req.valid('param');

  await deletePermission(permissionId);

  return c.json({ message: 'Permission deleted successfully' }, 200);
});

export { permissionsRouter };
