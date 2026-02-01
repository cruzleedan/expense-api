import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import { authMiddleware } from '../middleware/auth.js';
import {
  createExpenseCategory,
  getExpenseCategoryById,
  listExpenseCategories,
  updateExpenseCategory,
  deleteExpenseCategory,
} from '../services/expenseCategory.service.js';
import { paginate } from '../utils/pagination.js';
import {
  ExpenseCategorySchema,
  CreateExpenseCategorySchema,
  UpdateExpenseCategorySchema,
  ExpenseCategoryListQuerySchema,
  ExpenseCategoryListResponseSchema,
} from '../schemas/expenseCategory.js';
import { ErrorSchema, MessageSchema, UuidParamSchema, AuthHeaderSchema } from '../schemas/common.js';

const expenseCategoriesRouter = new OpenAPIHono();

expenseCategoriesRouter.use('*', authMiddleware);

const security = [{ Bearer: [] }];

// List expense categories
const listRoute = createRoute({
  method: 'get',
  path: '/',
  tags: ['Expense Categories'],
  summary: 'List expense categories',
  description: 'Get paginated list of expense categories',
  security,
  request: {
    query: ExpenseCategoryListQuerySchema,
    headers: AuthHeaderSchema,
  },
  responses: {
    200: {
      description: 'List of expense categories',
      content: { 'application/json': { schema: ExpenseCategoryListResponseSchema } },
    },
    401: {
      description: 'Unauthorized',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
});

expenseCategoriesRouter.openapi(listRoute, async (c) => {
  const query = c.req.valid('query');

  const paginationParams = {
    page: query.page,
    limit: query.limit,
    search: query.search,
    sortBy: query.sortBy,
    sortOrder: query.sortOrder,
  };

  const { categories, total } = await listExpenseCategories(
    paginationParams,
    query.isActive
  );

  return c.json(paginate(categories, total, paginationParams), 200);
});

// Create expense category
const createRoute_ = createRoute({
  method: 'post',
  path: '/',
  tags: ['Expense Categories'],
  summary: 'Create expense category',
  description: 'Create a new expense category',
  security,
  request: {
    headers: AuthHeaderSchema,
    body: {
      content: { 'application/json': { schema: CreateExpenseCategorySchema } },
    },
  },
  responses: {
    201: {
      description: 'Expense category created',
      content: { 'application/json': { schema: ExpenseCategorySchema } },
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

expenseCategoriesRouter.openapi(createRoute_, async (c) => {
  const input = c.req.valid('json');

  const category = await createExpenseCategory(input);

  return c.json(category, 201);
});

// Get expense category by ID
const getRoute = createRoute({
  method: 'get',
  path: '/{id}',
  tags: ['Expense Categories'],
  summary: 'Get expense category',
  description: 'Get a specific expense category by ID',
  security,
  request: {
    params: UuidParamSchema,
    headers: AuthHeaderSchema,
  },
  responses: {
    200: {
      description: 'Expense category details',
      content: { 'application/json': { schema: ExpenseCategorySchema } },
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

expenseCategoriesRouter.openapi(getRoute, async (c) => {
  const { id } = c.req.valid('param');

  const category = await getExpenseCategoryById(id);

  return c.json(category, 200);
});

// Update expense category
const updateRoute = createRoute({
  method: 'put',
  path: '/{id}',
  tags: ['Expense Categories'],
  summary: 'Update expense category',
  description: 'Update an existing expense category',
  security,
  request: {
    params: UuidParamSchema,
    headers: AuthHeaderSchema,
    body: {
      content: { 'application/json': { schema: UpdateExpenseCategorySchema } },
    },
  },
  responses: {
    200: {
      description: 'Expense category updated',
      content: { 'application/json': { schema: ExpenseCategorySchema } },
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

expenseCategoriesRouter.openapi(updateRoute, async (c) => {
  const { id } = c.req.valid('param');
  const input = c.req.valid('json');

  const category = await updateExpenseCategory(id, input);

  return c.json(category, 200);
});

// Delete expense category
const deleteRoute = createRoute({
  method: 'delete',
  path: '/{id}',
  tags: ['Expense Categories'],
  summary: 'Delete expense category',
  description: 'Delete an expense category',
  security,
  request: {
    params: UuidParamSchema,
    headers: AuthHeaderSchema,
  },
  responses: {
    200: {
      description: 'Expense category deleted',
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
      description: 'Conflict - category has children',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
});

expenseCategoriesRouter.openapi(deleteRoute, async (c) => {
  const { id } = c.req.valid('param');

  await deleteExpenseCategory(id);

  return c.json({ message: 'Expense category deleted' }, 200);
});

export { expenseCategoriesRouter };
