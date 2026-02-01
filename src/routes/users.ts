import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { authMiddleware, getUserId } from '../middleware/auth.js';
import {
  createUser,
  getUserWithRoles,
  listUsersWithRoles,
  updateUser,
  deleteUser,
  getUserRolesById,
  setUserRolesById,
  addUserRole,
  removeUserRole,
} from '../services/user.service.js';
import { paginate } from '../utils/pagination.js';
import {
  UserWithRolesSchema,
  CreateUserSchema,
  UpdateUserSchema,
  UserListQuerySchema,
  UserListResponseSchema,
  UserRolesListSchema,
  AssignUserRolesSchema,
  AddUserRoleSchema,
} from '../schemas/user.js';
import { ErrorSchema, MessageSchema, UuidParamSchema, AuthHeaderSchema } from '../schemas/common.js';

const usersRouter = new OpenAPIHono();

usersRouter.use('*', authMiddleware);

const security = [{ Bearer: [] }];

// User ID + Role ID param schema
const UserRoleParamSchema = z.object({
  id: z.string().uuid(),
  roleId: z.string().uuid(),
});

// Helper to format user roles for response
function formatUserRoles(roles: Array<{ id: string; name: string; description: string | null; is_system: boolean; assigned_at: Date }>) {
  return roles.map(r => ({
    id: r.id,
    name: r.name,
    description: r.description,
    isSystem: r.is_system,
    assignedAt: r.assigned_at.toISOString(),
  }));
}

// List users
const listRoute = createRoute({
  method: 'get',
  path: '/',
  tags: ['Users'],
  summary: 'List users',
  description: 'Get paginated list of users with their roles',
  security,
  request: {
    query: UserListQuerySchema,
    headers: AuthHeaderSchema,
  },
  responses: {
    200: {
      description: 'List of users',
      content: { 'application/json': { schema: UserListResponseSchema } },
    },
    401: {
      description: 'Unauthorized',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
});

usersRouter.openapi(listRoute, async (c) => {
  const query = c.req.valid('query');

  const paginationParams = {
    page: query.page,
    limit: query.limit,
    search: query.search,
    sortBy: query.sortBy,
    sortOrder: query.sortOrder,
  };

  const { users, total } = await listUsersWithRoles(
    paginationParams,
    { isActive: query.isActive, departmentId: query.departmentId }
  );

  const formattedUsers = users.map(u => ({
    ...u,
    roles: formatUserRoles(u.roles),
  }));

  return c.json(paginate(formattedUsers, total, paginationParams), 200);
});

// Create user
const createRoute_ = createRoute({
  method: 'post',
  path: '/',
  tags: ['Users'],
  summary: 'Create user',
  description: 'Create a new user with default employee role',
  security,
  request: {
    headers: AuthHeaderSchema,
    body: {
      content: { 'application/json': { schema: CreateUserSchema } },
    },
  },
  responses: {
    201: {
      description: 'User created',
      content: { 'application/json': { schema: UserWithRolesSchema } },
    },
    400: {
      description: 'Validation error',
      content: { 'application/json': { schema: ErrorSchema } },
    },
    401: {
      description: 'Unauthorized',
      content: { 'application/json': { schema: ErrorSchema } },
    },
    409: {
      description: 'Conflict',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
});

usersRouter.openapi(createRoute_, async (c) => {
  const input = c.req.valid('json');

  const user = await createUser(input);
  const roles = await getUserRolesById(user.id);

  return c.json({ ...user, roles: formatUserRoles(roles) }, 201);
});

// Get user by ID
const getRoute = createRoute({
  method: 'get',
  path: '/{id}',
  tags: ['Users'],
  summary: 'Get user',
  description: 'Get a specific user by ID with their roles',
  security,
  request: {
    params: UuidParamSchema,
    headers: AuthHeaderSchema,
  },
  responses: {
    200: {
      description: 'User details',
      content: { 'application/json': { schema: UserWithRolesSchema } },
    },
    401: {
      description: 'Unauthorized',
      content: { 'application/json': { schema: ErrorSchema } },
    },
    404: {
      description: 'Not found',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
});

usersRouter.openapi(getRoute, async (c) => {
  const { id } = c.req.valid('param');

  const user = await getUserWithRoles(id);

  return c.json({ ...user, roles: formatUserRoles(user.roles) }, 200);
});

// Update user
const updateRoute = createRoute({
  method: 'put',
  path: '/{id}',
  tags: ['Users'],
  summary: 'Update user',
  description: 'Update an existing user',
  security,
  request: {
    params: UuidParamSchema,
    headers: AuthHeaderSchema,
    body: {
      content: { 'application/json': { schema: UpdateUserSchema } },
    },
  },
  responses: {
    200: {
      description: 'User updated',
      content: { 'application/json': { schema: UserWithRolesSchema } },
    },
    400: {
      description: 'Validation error',
      content: { 'application/json': { schema: ErrorSchema } },
    },
    401: {
      description: 'Unauthorized',
      content: { 'application/json': { schema: ErrorSchema } },
    },
    404: {
      description: 'Not found',
      content: { 'application/json': { schema: ErrorSchema } },
    },
    409: {
      description: 'Conflict',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
});

usersRouter.openapi(updateRoute, async (c) => {
  const { id } = c.req.valid('param');
  const input = c.req.valid('json');

  const user = await updateUser(id, input);
  const roles = await getUserRolesById(id);

  return c.json({ ...user, roles: formatUserRoles(roles) }, 200);
});

// Delete user
const deleteRoute = createRoute({
  method: 'delete',
  path: '/{id}',
  tags: ['Users'],
  summary: 'Delete user',
  description: 'Delete a user',
  security,
  request: {
    params: UuidParamSchema,
    headers: AuthHeaderSchema,
  },
  responses: {
    200: {
      description: 'User deleted',
      content: { 'application/json': { schema: MessageSchema } },
    },
    401: {
      description: 'Unauthorized',
      content: { 'application/json': { schema: ErrorSchema } },
    },
    404: {
      description: 'Not found',
      content: { 'application/json': { schema: ErrorSchema } },
    },
    409: {
      description: 'Conflict - user has expense reports',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
});

usersRouter.openapi(deleteRoute, async (c) => {
  const { id } = c.req.valid('param');

  await deleteUser(id);

  return c.json({ message: 'User deleted' }, 200);
});

// ============================================================================
// USER ROLES ENDPOINTS
// ============================================================================

// Get user's roles
const getUserRolesRoute = createRoute({
  method: 'get',
  path: '/{id}/roles',
  tags: ['Users'],
  summary: 'Get user roles',
  description: 'Get all roles assigned to a user',
  security,
  request: {
    params: UuidParamSchema,
    headers: AuthHeaderSchema,
  },
  responses: {
    200: {
      description: 'User roles',
      content: { 'application/json': { schema: UserRolesListSchema } },
    },
    401: {
      description: 'Unauthorized',
      content: { 'application/json': { schema: ErrorSchema } },
    },
    404: {
      description: 'Not found',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
});

usersRouter.openapi(getUserRolesRoute, async (c) => {
  const { id } = c.req.valid('param');

  const roles = await getUserRolesById(id);

  return c.json({ roles: formatUserRoles(roles) }, 200);
});

// Set user's roles (replace all)
const setUserRolesRoute = createRoute({
  method: 'put',
  path: '/{id}/roles',
  tags: ['Users'],
  summary: 'Set user roles',
  description: 'Replace all roles for a user',
  security,
  request: {
    params: UuidParamSchema,
    headers: AuthHeaderSchema,
    body: {
      content: { 'application/json': { schema: AssignUserRolesSchema } },
    },
  },
  responses: {
    200: {
      description: 'Roles updated',
      content: { 'application/json': { schema: UserRolesListSchema } },
    },
    400: {
      description: 'Validation error',
      content: { 'application/json': { schema: ErrorSchema } },
    },
    401: {
      description: 'Unauthorized',
      content: { 'application/json': { schema: ErrorSchema } },
    },
    404: {
      description: 'Not found',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
});

usersRouter.openapi(setUserRolesRoute, async (c) => {
  const { id } = c.req.valid('param');
  const { roleIds } = c.req.valid('json');
  const assignedBy = getUserId(c);

  const roles = await setUserRolesById(id, roleIds, assignedBy);

  return c.json({ roles: formatUserRoles(roles) }, 200);
});

// Add a role to user
const addUserRoleRoute = createRoute({
  method: 'post',
  path: '/{id}/roles',
  tags: ['Users'],
  summary: 'Add role to user',
  description: 'Add a single role to a user',
  security,
  request: {
    params: UuidParamSchema,
    headers: AuthHeaderSchema,
    body: {
      content: { 'application/json': { schema: AddUserRoleSchema } },
    },
  },
  responses: {
    200: {
      description: 'Role added',
      content: { 'application/json': { schema: UserRolesListSchema } },
    },
    400: {
      description: 'Validation error',
      content: { 'application/json': { schema: ErrorSchema } },
    },
    401: {
      description: 'Unauthorized',
      content: { 'application/json': { schema: ErrorSchema } },
    },
    404: {
      description: 'Not found',
      content: { 'application/json': { schema: ErrorSchema } },
    },
    409: {
      description: 'Role already assigned',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
});

usersRouter.openapi(addUserRoleRoute, async (c) => {
  const { id } = c.req.valid('param');
  const { roleId } = c.req.valid('json');
  const assignedBy = getUserId(c);

  const roles = await addUserRole(id, roleId, assignedBy);

  return c.json({ roles: formatUserRoles(roles) }, 200);
});

// Remove a role from user
const removeUserRoleRoute = createRoute({
  method: 'delete',
  path: '/{id}/roles/{roleId}',
  tags: ['Users'],
  summary: 'Remove role from user',
  description: 'Remove a role from a user',
  security,
  request: {
    params: UserRoleParamSchema,
    headers: AuthHeaderSchema,
  },
  responses: {
    200: {
      description: 'Role removed',
      content: { 'application/json': { schema: UserRolesListSchema } },
    },
    401: {
      description: 'Unauthorized',
      content: { 'application/json': { schema: ErrorSchema } },
    },
    404: {
      description: 'Not found',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
});

usersRouter.openapi(removeUserRoleRoute, async (c) => {
  const { id, roleId } = c.req.valid('param');

  const roles = await removeUserRole(id, roleId);

  return c.json({ roles: formatUserRoles(roles) }, 200);
});

export { usersRouter };
