import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { authMiddleware, getUserId } from '../middleware/auth.js';
import {
  createExpenseReport,
  getExpenseReportById,
  listExpenseReports,
  updateExpenseReport,
  deleteExpenseReport,
} from '../services/expenseReport.service.js';
import { paginate } from '../utils/pagination.js';
import {
  ExpenseReportSchema,
  CreateExpenseReportSchema,
  UpdateExpenseReportSchema,
  ExpenseReportListQuerySchema,
  ExpenseReportListResponseSchema,
} from '../schemas/expenseReport.js';
import { ErrorSchema, MessageSchema, UuidParamSchema, AuthHeaderSchema } from '../schemas/common.js';

const expenseReportsRouter = new OpenAPIHono();

// All routes require authentication
expenseReportsRouter.use('*', authMiddleware);

// Security definition for all routes
const security = [{ Bearer: [] }];

// List expense reports
const listRoute = createRoute({
  method: 'get',
  path: '/',
  tags: ['Expense Reports'],
  summary: 'List expense reports',
  description: 'Get paginated list of expense reports for the authenticated user',
  security,
  request: {
    query: ExpenseReportListQuerySchema,
    headers: AuthHeaderSchema,
  },
  responses: {
    200: {
      description: 'List of expense reports',
      content: { 'application/json': { schema: ExpenseReportListResponseSchema } },
    },
    401: {
      description: 'Unauthorized',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
});

expenseReportsRouter.openapi(listRoute, async (c) => {
  const userId = getUserId(c);
  const query = c.req.valid('query');

  const paginationParams = {
    page: query.page,
    limit: query.limit,
    search: query.search,
    sortBy: query.sortBy,
    sortOrder: query.sortOrder,
  };

  const { reports, total } = await listExpenseReports(
    userId,
    paginationParams,
    query.status
  );

  return c.json(paginate(reports, total, paginationParams), 200);
});

// Create expense report
const createRoute_ = createRoute({
  method: 'post',
  path: '/',
  tags: ['Expense Reports'],
  summary: 'Create expense report',
  description: 'Create a new expense report',
  security,
  request: {
    headers: AuthHeaderSchema,
    body: {
      content: { 'application/json': { schema: CreateExpenseReportSchema } },
    },
  },
  responses: {
    201: {
      description: 'Expense report created',
      content: { 'application/json': { schema: ExpenseReportSchema } },
    },
    400: {
      description: 'Validation error',
      content: { 'application/json': { schema: ErrorSchema } },
    },
    401: {
      description: 'Unauthorized',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
});

expenseReportsRouter.openapi(createRoute_, async (c) => {
  const userId = getUserId(c);
  const input = c.req.valid('json');

  const report = await createExpenseReport(userId, input);

  return c.json(report, 201);
});

// Get expense report by ID
const getRoute = createRoute({
  method: 'get',
  path: '/{id}',
  tags: ['Expense Reports'],
  summary: 'Get expense report',
  description: 'Get a specific expense report by ID',
  security,
  request: {
    params: UuidParamSchema,
    headers: AuthHeaderSchema,
  },
  responses: {
    200: {
      description: 'Expense report details',
      content: { 'application/json': { schema: ExpenseReportSchema } },
    },
    401: {
      description: 'Unauthorized',
      content: { 'application/json': { schema: ErrorSchema } },
    },
    403: {
      description: 'Forbidden',
      content: { 'application/json': { schema: ErrorSchema } },
    },
    404: {
      description: 'Not found',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
});

expenseReportsRouter.openapi(getRoute, async (c) => {
  const userId = getUserId(c);
  const { id } = c.req.valid('param');

  const report = await getExpenseReportById(id, userId);

  return c.json(report, 200);
});

// Update expense report
const updateRoute = createRoute({
  method: 'put',
  path: '/{id}',
  tags: ['Expense Reports'],
  summary: 'Update expense report',
  description: 'Update an existing expense report',
  security,
  request: {
    params: UuidParamSchema,
    headers: AuthHeaderSchema,
    body: {
      content: { 'application/json': { schema: UpdateExpenseReportSchema } },
    },
  },
  responses: {
    200: {
      description: 'Expense report updated',
      content: { 'application/json': { schema: ExpenseReportSchema } },
    },
    400: {
      description: 'Validation error',
      content: { 'application/json': { schema: ErrorSchema } },
    },
    401: {
      description: 'Unauthorized',
      content: { 'application/json': { schema: ErrorSchema } },
    },
    403: {
      description: 'Forbidden',
      content: { 'application/json': { schema: ErrorSchema } },
    },
    404: {
      description: 'Not found',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
});

expenseReportsRouter.openapi(updateRoute, async (c) => {
  const userId = getUserId(c);
  const { id } = c.req.valid('param');
  const input = c.req.valid('json');

  const report = await updateExpenseReport(id, userId, input);

  return c.json(report, 200);
});

// Delete expense report
const deleteRoute = createRoute({
  method: 'delete',
  path: '/{id}',
  tags: ['Expense Reports'],
  summary: 'Delete expense report',
  description: 'Delete an expense report and all associated data',
  security,
  request: {
    params: UuidParamSchema,
    headers: AuthHeaderSchema,
  },
  responses: {
    200: {
      description: 'Expense report deleted',
      content: { 'application/json': { schema: MessageSchema } },
    },
    401: {
      description: 'Unauthorized',
      content: { 'application/json': { schema: ErrorSchema } },
    },
    403: {
      description: 'Forbidden',
      content: { 'application/json': { schema: ErrorSchema } },
    },
    404: {
      description: 'Not found',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
});

expenseReportsRouter.openapi(deleteRoute, async (c) => {
  const userId = getUserId(c);
  const { id } = c.req.valid('param');

  await deleteExpenseReport(id, userId);

  return c.json({ message: 'Expense report deleted' }, 200);
});

export { expenseReportsRouter };
