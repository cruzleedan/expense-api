import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import { authMiddleware, getUserId } from '../middleware/auth.js';
import { requirePermission } from '../middleware/permission.js';
import {
  createProject,
  getProjectById,
  listProjects,
  updateProject,
  deleteProject,
  getProjectBudgetSummary,
} from '../services/project.service.js';
import { paginate } from '../utils/pagination.js';
import {
  ProjectSchema,
  CreateProjectSchema,
  UpdateProjectSchema,
  ProjectListQuerySchema,
  ProjectListResponseSchema,
  ProjectBudgetSummarySchema,
} from '../schemas/project.js';
import { ErrorSchema, MessageSchema, UuidParamSchema, AuthHeaderSchema } from '../schemas/common.js';

const projectsRouter = new OpenAPIHono();

// All routes require authentication
projectsRouter.use('*', authMiddleware);

// Security definition for all routes
const security = [{ Bearer: [] }];

// List projects
const listRoute = createRoute({
  method: 'get',
  path: '/',
  tags: ['Projects'],
  summary: 'List projects',
  description: 'Get paginated list of projects with optional filters',
  security,
  request: {
    query: ProjectListQuerySchema,
    headers: AuthHeaderSchema,
  },
  responses: {
    200: {
      description: 'List of projects',
      content: { 'application/json': { schema: ProjectListResponseSchema } },
    },
    401: {
      description: 'Unauthorized',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
});

projectsRouter.openapi(listRoute, async (c) => {
  const query = c.req.valid('query');

  const paginationParams = {
    page: query.page,
    limit: query.limit,
    search: query.search,
    sortBy: query.sortBy,
    sortOrder: query.sortOrder,
  };

  const filters = {
    status: query.status,
    departmentId: query.departmentId,
    ownerUserId: query.ownerUserId,
    clientName: query.clientName,
  };

  const { projects, total } = await listProjects(paginationParams, filters);

  return c.json(paginate(projects, total, paginationParams), 200);
});

// Create project
const createRoute_ = createRoute({
  method: 'post',
  path: '/',
  tags: ['Projects'],
  summary: 'Create project',
  description: 'Create a new project',
  security,
  middleware: [requirePermission('project.create')] as const,
  request: {
    headers: AuthHeaderSchema,
    body: {
      content: { 'application/json': { schema: CreateProjectSchema } },
    },
  },
  responses: {
    201: {
      description: 'Project created',
      content: { 'application/json': { schema: ProjectSchema } },
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
      description: 'Conflict - code already exists',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
});

projectsRouter.openapi(createRoute_, async (c) => {
  const input = c.req.valid('json');

  const project = await createProject(input);

  return c.json(project, 201);
});

// Get project by ID
const getRoute = createRoute({
  method: 'get',
  path: '/{id}',
  tags: ['Projects'],
  summary: 'Get project',
  description: 'Get a specific project by ID',
  security,
  request: {
    params: UuidParamSchema,
    headers: AuthHeaderSchema,
  },
  responses: {
    200: {
      description: 'Project details',
      content: { 'application/json': { schema: ProjectSchema } },
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

projectsRouter.openapi(getRoute, async (c) => {
  const { id } = c.req.valid('param');

  const project = await getProjectById(id);

  return c.json(project, 200);
});

// Get project budget summary
const budgetSummaryRoute = createRoute({
  method: 'get',
  path: '/{id}/budget-summary',
  tags: ['Projects'],
  summary: 'Get project budget summary',
  description: 'Get project with expense counts and category breakdown',
  security,
  request: {
    params: UuidParamSchema,
    headers: AuthHeaderSchema,
  },
  responses: {
    200: {
      description: 'Project budget summary',
      content: { 'application/json': { schema: ProjectBudgetSummarySchema } },
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

projectsRouter.openapi(budgetSummaryRoute, async (c) => {
  const { id } = c.req.valid('param');

  const summary = await getProjectBudgetSummary(id);

  return c.json(summary, 200);
});

// Update project
const updateRoute = createRoute({
  method: 'put',
  path: '/{id}',
  tags: ['Projects'],
  summary: 'Update project',
  description: 'Update an existing project',
  security,
  middleware: [requirePermission('project.edit')] as const,
  request: {
    params: UuidParamSchema,
    headers: AuthHeaderSchema,
    body: {
      content: { 'application/json': { schema: UpdateProjectSchema } },
    },
  },
  responses: {
    200: {
      description: 'Project updated',
      content: { 'application/json': { schema: ProjectSchema } },
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
      description: 'Conflict - code already exists',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
});

projectsRouter.openapi(updateRoute, async (c) => {
  const { id } = c.req.valid('param');
  const input = c.req.valid('json');

  const project = await updateProject(id, input);

  return c.json(project, 200);
});

// Delete project
const deleteRoute = createRoute({
  method: 'delete',
  path: '/{id}',
  tags: ['Projects'],
  summary: 'Delete project',
  description: 'Delete a project (only if no expense reports or lines reference it)',
  security,
  middleware: [requirePermission('project.delete')] as const,
  request: {
    params: UuidParamSchema,
    headers: AuthHeaderSchema,
  },
  responses: {
    200: {
      description: 'Project deleted',
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
      description: 'Conflict - project has expense reports',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
});

projectsRouter.openapi(deleteRoute, async (c) => {
  const { id } = c.req.valid('param');

  await deleteProject(id);

  return c.json({ message: 'Project deleted' }, 200);
});

export { projectsRouter };
