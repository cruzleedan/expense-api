import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import { authMiddleware, getUserId } from '../middleware/auth.js';
import { requirePermission } from '../middleware/permission.js';
import {
  createExpensePolicy,
  getExpensePolicyById,
  listExpensePolicies,
  updateExpensePolicy,
  deleteExpensePolicy,
  checkPoliciesForExpense,
} from '../services/expensePolicy.service.js';
import { paginate } from '../utils/pagination.js';
import {
  ExpensePolicySchema,
  CreateExpensePolicySchema,
  UpdateExpensePolicySchema,
  ExpensePolicyListQuerySchema,
  ExpensePolicyListResponseSchema,
  PolicyCheckContextSchema,
  PolicyCheckResponseSchema,
} from '../schemas/expensePolicy.js';
import { ErrorSchema, MessageSchema, UuidParamSchema, AuthHeaderSchema } from '../schemas/common.js';

const expensePoliciesRouter = new OpenAPIHono();

// All routes require authentication
expensePoliciesRouter.use('*', authMiddleware);

// Security definition for all routes
const security = [{ Bearer: [] }];

// List expense policies
const listRoute = createRoute({
  method: 'get',
  path: '/',
  tags: ['Expense Policies'],
  summary: 'List expense policies',
  description: 'Get paginated list of expense policies with optional filters',
  security,
  request: {
    query: ExpensePolicyListQuerySchema,
    headers: AuthHeaderSchema,
  },
  responses: {
    200: {
      description: 'List of expense policies',
      content: { 'application/json': { schema: ExpensePolicyListResponseSchema } },
    },
    401: {
      description: 'Unauthorized',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
});

expensePoliciesRouter.openapi(listRoute, async (c) => {
  const query = c.req.valid('query');

  const paginationParams = {
    page: query.page,
    limit: query.limit,
    search: query.search,
    sortBy: query.sortBy,
    sortOrder: query.sortOrder,
  };

  const filters = {
    isActive: query.isActive,
    ruleType: query.ruleType,
    severity: query.severity,
  };

  const { policies, total } = await listExpensePolicies(paginationParams, filters);

  return c.json(paginate(policies, total, paginationParams), 200);
});

// Check policies for an expense
const checkRoute = createRoute({
  method: 'post',
  path: '/check',
  tags: ['Expense Policies'],
  summary: 'Check policies for expense',
  description: 'Check which policies would be violated by an expense with the given context',
  security,
  request: {
    headers: AuthHeaderSchema,
    body: {
      content: { 'application/json': { schema: PolicyCheckContextSchema } },
    },
  },
  responses: {
    200: {
      description: 'Policy check results',
      content: { 'application/json': { schema: PolicyCheckResponseSchema } },
    },
    401: {
      description: 'Unauthorized',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
});

expensePoliciesRouter.openapi(checkRoute, async (c) => {
  const context = c.req.valid('json');

  const violations = await checkPoliciesForExpense(context);
  const hasHardBlock = violations.some(v => v.severity === 'hard_block');

  return c.json({ violations, hasHardBlock }, 200);
});

// Create expense policy
const createRoute_ = createRoute({
  method: 'post',
  path: '/',
  tags: ['Expense Policies'],
  summary: 'Create expense policy',
  description: 'Create a new expense policy',
  security,
  middleware: [requirePermission('policy.create')] as const,
  request: {
    headers: AuthHeaderSchema,
    body: {
      content: { 'application/json': { schema: CreateExpensePolicySchema } },
    },
  },
  responses: {
    201: {
      description: 'Policy created',
      content: { 'application/json': { schema: ExpensePolicySchema } },
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

expensePoliciesRouter.openapi(createRoute_, async (c) => {
  const userId = getUserId(c);
  const input = c.req.valid('json');

  const policy = await createExpensePolicy(input, userId);

  return c.json(policy, 201);
});

// Get expense policy by ID
const getRoute = createRoute({
  method: 'get',
  path: '/{id}',
  tags: ['Expense Policies'],
  summary: 'Get expense policy',
  description: 'Get a specific expense policy by ID',
  security,
  request: {
    params: UuidParamSchema,
    headers: AuthHeaderSchema,
  },
  responses: {
    200: {
      description: 'Policy details',
      content: { 'application/json': { schema: ExpensePolicySchema } },
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

expensePoliciesRouter.openapi(getRoute, async (c) => {
  const { id } = c.req.valid('param');

  const policy = await getExpensePolicyById(id);

  return c.json(policy, 200);
});

// Update expense policy
const updateRoute = createRoute({
  method: 'put',
  path: '/{id}',
  tags: ['Expense Policies'],
  summary: 'Update expense policy',
  description: 'Update an existing expense policy',
  security,
  middleware: [requirePermission('policy.edit')] as const,
  request: {
    params: UuidParamSchema,
    headers: AuthHeaderSchema,
    body: {
      content: { 'application/json': { schema: UpdateExpensePolicySchema } },
    },
  },
  responses: {
    200: {
      description: 'Policy updated',
      content: { 'application/json': { schema: ExpensePolicySchema } },
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

expensePoliciesRouter.openapi(updateRoute, async (c) => {
  const { id } = c.req.valid('param');
  const input = c.req.valid('json');

  const policy = await updateExpensePolicy(id, input);

  return c.json(policy, 200);
});

// Delete expense policy
const deleteRoute = createRoute({
  method: 'delete',
  path: '/{id}',
  tags: ['Expense Policies'],
  summary: 'Delete expense policy',
  description: 'Delete an expense policy',
  security,
  middleware: [requirePermission('policy.delete')] as const,
  request: {
    params: UuidParamSchema,
    headers: AuthHeaderSchema,
  },
  responses: {
    200: {
      description: 'Policy deleted',
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
  },
});

expensePoliciesRouter.openapi(deleteRoute, async (c) => {
  const { id } = c.req.valid('param');

  await deleteExpensePolicy(id);

  return c.json({ message: 'Policy deleted' }, 200);
});

export { expensePoliciesRouter };
