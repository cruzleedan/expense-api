import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import type { RouteHandler } from '@hono/zod-openapi';
import { authMiddleware, getUserId } from '../middleware/auth.js';
import { listExpenses } from '../services/expenses.service.js';
import { paginate } from '../utils/pagination.js';
import { ExpensesQuerySchema, ExpensesListResponseSchema } from '../schemas/expenses.js';
import { ErrorSchema, AuthHeaderSchema } from '../schemas/common.js';

const expensesRouter = new OpenAPIHono();

expensesRouter.use('*', authMiddleware);

const security = [{ Bearer: [] }];

const listExpensesRoute = createRoute({
  method: 'get',
  path: '/',
  tags: ['Expenses'],
  summary: 'List expenses',
  description: 'Returns a paginated, unified list of expense reports and orphaned expense lines (lines whose parent report has been deleted). Items are tagged with a `type` discriminator (`report` or `expense_line`).',
  security,
  request: {
    query: ExpensesQuerySchema,
    headers: AuthHeaderSchema,
  },
  responses: {
    200: {
      description: 'Unified list of expense reports and orphaned lines',
      content: { 'application/json': { schema: ExpensesListResponseSchema } },
    },
    401: {
      description: 'Unauthorized',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
});

const listExpensesHandler: RouteHandler<typeof listExpensesRoute> = async (c) => {
  const userId = getUserId(c);
  const query = c.req.valid('query');

  const params = {
    page: query.page,
    limit: query.limit,
    search: query.search,
    sortOrder: query.sortOrder,
  };

  const { items, total } = await listExpenses(userId, params);

  return c.json(paginate(items, total, params) as any, 200);
};

expensesRouter.openapi(listExpensesRoute, listExpensesHandler);

export { expensesRouter };
