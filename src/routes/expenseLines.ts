import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { authMiddleware, getUserId } from '../middleware/auth.js';
import {
  createExpenseLine,
  getExpenseLineById,
  listExpenseLines,
  updateExpenseLine,
  deleteExpenseLine,
} from '../services/expenseLine.service.js';
import { paginate } from '../utils/pagination.js';
import {
  ExpenseLineSchema,
  CreateExpenseLineSchema,
  UpdateExpenseLineSchema,
  ExpenseLineListResponseSchema,
} from '../schemas/expenseLine.js';
import { ErrorSchema, MessageSchema, UuidParamSchema, ReportIdParamSchema, PaginationQuerySchema, AuthHeaderSchema } from '../schemas/common.js';

// Router for lines under reports: /expense-reports/:reportId/lines
const expenseLinesRouter = new OpenAPIHono();

// Router for direct line access: /expense-lines/:id
const expenseLineDirectRouter = new OpenAPIHono();

// All routes require authentication
expenseLinesRouter.use('*', authMiddleware);
expenseLineDirectRouter.use('*', authMiddleware);

const security = [{ Bearer: [] }];

// List expense lines for a report
const listRoute = createRoute({
  method: 'get',
  path: '/',
  tags: ['Expense Lines'],
  summary: 'List expense lines',
  description: 'Get paginated list of expense lines for a report',
  security,
  request: {
    query: PaginationQuerySchema,
    headers: AuthHeaderSchema,
  },
  responses: {
    200: {
      description: 'List of expense lines',
      content: { 'application/json': { schema: ExpenseLineListResponseSchema } },
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
      description: 'Report not found',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
});

expenseLinesRouter.openapi(listRoute, async (c) => {
  const userId = getUserId(c);
  const reportId = c.req.param('reportId');
  const query = c.req.valid('query');

  const { lines, total } = await listExpenseLines(reportId, userId, query);

  return c.json(paginate(lines, total, query), 200);
});

// Create expense line
const createLineRoute = createRoute({
  method: 'post',
  path: '/',
  tags: ['Expense Lines'],
  summary: 'Create expense line',
  description: 'Create a new expense line in a report',
  security,
  request: {
    headers: AuthHeaderSchema,
    body: {
      content: { 'application/json': { schema: CreateExpenseLineSchema } },
    },
  },
  responses: {
    201: {
      description: 'Expense line created',
      content: { 'application/json': { schema: ExpenseLineSchema } },
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
      description: 'Report not found',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
});

expenseLinesRouter.openapi(createLineRoute, async (c) => {
  const userId = getUserId(c);
  const reportId = c.req.param('reportId');
  const input = c.req.valid('json');

  const line = await createExpenseLine(reportId, userId, input);

  return c.json(line, 201);
});

// Get expense line by ID (direct access)
const getLineRoute = createRoute({
  method: 'get',
  path: '/{id}',
  tags: ['Expense Lines'],
  summary: 'Get expense line',
  description: 'Get a specific expense line by ID',
  security,
  request: {
    params: UuidParamSchema,
    headers: AuthHeaderSchema,
  },
  responses: {
    200: {
      description: 'Expense line details',
      content: { 'application/json': { schema: ExpenseLineSchema } },
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

expenseLineDirectRouter.openapi(getLineRoute, async (c) => {
  const userId = getUserId(c);
  const { id } = c.req.valid('param');

  const line = await getExpenseLineById(id, userId);

  return c.json(line, 200);
});

// Update expense line (direct access)
const updateLineRoute = createRoute({
  method: 'put',
  path: '/{id}',
  tags: ['Expense Lines'],
  summary: 'Update expense line',
  description: 'Update an existing expense line',
  security,
  request: {
    params: UuidParamSchema,
    headers: AuthHeaderSchema,
    body: {
      content: { 'application/json': { schema: UpdateExpenseLineSchema } },
    },
  },
  responses: {
    200: {
      description: 'Expense line updated',
      content: { 'application/json': { schema: ExpenseLineSchema } },
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

expenseLineDirectRouter.openapi(updateLineRoute, async (c) => {
  const userId = getUserId(c);
  const { id } = c.req.valid('param');
  const input = c.req.valid('json');

  const line = await updateExpenseLine(id, userId, input);

  return c.json(line, 200);
});

// Delete expense line (direct access)
const deleteLineRoute = createRoute({
  method: 'delete',
  path: '/{id}',
  tags: ['Expense Lines'],
  summary: 'Delete expense line',
  description: 'Delete an expense line',
  security,
  request: {
    params: UuidParamSchema,
    headers: AuthHeaderSchema,
  },
  responses: {
    200: {
      description: 'Expense line deleted',
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

expenseLineDirectRouter.openapi(deleteLineRoute, async (c) => {
  const userId = getUserId(c);
  const { id } = c.req.valid('param');

  await deleteExpenseLine(id, userId);

  return c.json({ message: 'Expense line deleted' }, 200);
});

export { expenseLinesRouter, expenseLineDirectRouter };
