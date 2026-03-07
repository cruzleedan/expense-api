import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import { authMiddleware } from '../middleware/auth.js';
import {
  getSpendingByCategory,
  getSpendingTrend,
  getPeriodComparison,
  getDashboardSummary,
  getTopMerchants,
  getCategoryTrend,
} from '../services/analytics.service.js';
import {
  AnalyticsQuerySchema,
  TrendQuerySchema,
  ComparisonQuerySchema,
  CategorySpendingResponseSchema,
  SpendingTrendResponseSchema,
  PeriodComparisonResponseSchema,
  DashboardSummaryResponseSchema,
  TopMerchantQuerySchema,
  TopMerchantResponseSchema,
  CategoryTrendQuerySchema,
  CategoryTrendResponseSchema,
} from '../schemas/analytics.js';
import { ErrorSchema, AuthHeaderSchema } from '../schemas/common.js';

const analyticsRouter = new OpenAPIHono();

analyticsRouter.use('*', authMiddleware);

const security = [{ Bearer: [] }];

// ============================================================================
// GET /v1/analytics/spending-by-category
// ============================================================================

const spendingByCategoryRoute = createRoute({
  method: 'get',
  path: '/spending-by-category',
  tags: ['Analytics'],
  summary: 'Get spending breakdown by category',
  description: 'Returns spending totals grouped by expense category for a given time period',
  security,
  request: {
    headers: AuthHeaderSchema,
    query: AnalyticsQuerySchema,
  },
  responses: {
    200: {
      description: 'Category spending breakdown',
      content: { 'application/json': { schema: CategorySpendingResponseSchema } },
    },
    401: {
      description: 'Unauthorized',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
});

analyticsRouter.openapi(spendingByCategoryRoute, async (c) => {
  const userId = c.get('userId');
  const { days } = c.req.valid('query');
  const data = await getSpendingByCategory(userId, days);
  return c.json({ data }, 200);
});

// ============================================================================
// GET /v1/analytics/spending-trend
// ============================================================================

const spendingTrendRoute = createRoute({
  method: 'get',
  path: '/spending-trend',
  tags: ['Analytics'],
  summary: 'Get monthly spending trend',
  description: 'Returns monthly spending totals for a given number of months',
  security,
  request: {
    headers: AuthHeaderSchema,
    query: TrendQuerySchema,
  },
  responses: {
    200: {
      description: 'Monthly spending trend',
      content: { 'application/json': { schema: SpendingTrendResponseSchema } },
    },
    401: {
      description: 'Unauthorized',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
});

analyticsRouter.openapi(spendingTrendRoute, async (c) => {
  const userId = c.get('userId');
  const { months } = c.req.valid('query');
  const data = await getSpendingTrend(userId, months);
  return c.json({ data }, 200);
});

// ============================================================================
// GET /v1/analytics/period-comparison
// ============================================================================

const periodComparisonRoute = createRoute({
  method: 'get',
  path: '/period-comparison',
  tags: ['Analytics'],
  summary: 'Compare current vs previous period',
  description: 'Returns spending comparison between current and previous month or quarter',
  security,
  request: {
    headers: AuthHeaderSchema,
    query: ComparisonQuerySchema,
  },
  responses: {
    200: {
      description: 'Period comparison',
      content: { 'application/json': { schema: PeriodComparisonResponseSchema } },
    },
    401: {
      description: 'Unauthorized',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
});

analyticsRouter.openapi(periodComparisonRoute, async (c) => {
  const userId = c.get('userId');
  const { period } = c.req.valid('query');
  const data = await getPeriodComparison(userId, period);
  return c.json({ data }, 200);
});

// ============================================================================
// GET /v1/analytics/dashboard-summary
// ============================================================================

const dashboardSummaryRoute = createRoute({
  method: 'get',
  path: '/dashboard-summary',
  tags: ['Analytics'],
  summary: 'Get dashboard summary stats',
  description: 'Returns pre-computed counts and totals for the dashboard stat cards',
  security,
  request: {
    headers: AuthHeaderSchema,
  },
  responses: {
    200: {
      description: 'Dashboard summary',
      content: { 'application/json': { schema: DashboardSummaryResponseSchema } },
    },
    401: {
      description: 'Unauthorized',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
});

analyticsRouter.openapi(dashboardSummaryRoute, async (c) => {
  const userId = c.get('userId');
  const data = await getDashboardSummary(userId);
  return c.json({ data }, 200);
});

// ============================================================================
// GET /v1/analytics/top-merchants
// ============================================================================

const topMerchantsRoute = createRoute({
  method: 'get',
  path: '/top-merchants',
  tags: ['Analytics'],
  summary: 'Get top merchants by spending',
  description: 'Returns top merchants ranked by total spending for a given time period',
  security,
  request: {
    headers: AuthHeaderSchema,
    query: TopMerchantQuerySchema,
  },
  responses: {
    200: {
      description: 'Top merchants',
      content: { 'application/json': { schema: TopMerchantResponseSchema } },
    },
    401: {
      description: 'Unauthorized',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
});

analyticsRouter.openapi(topMerchantsRoute, async (c) => {
  const userId = c.get('userId');
  const { days, limit } = c.req.valid('query');
  const data = await getTopMerchants(userId, days, limit);
  return c.json({ data }, 200);
});

// ============================================================================
// GET /v1/analytics/category-trend
// ============================================================================

const categoryTrendRoute = createRoute({
  method: 'get',
  path: '/category-trend',
  tags: ['Analytics'],
  summary: 'Get monthly category spending trend',
  description: 'Returns monthly spending broken down by top N categories',
  security,
  request: {
    headers: AuthHeaderSchema,
    query: CategoryTrendQuerySchema,
  },
  responses: {
    200: {
      description: 'Category trend data',
      content: { 'application/json': { schema: CategoryTrendResponseSchema } },
    },
    401: {
      description: 'Unauthorized',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
});

analyticsRouter.openapi(categoryTrendRoute, async (c) => {
  const userId = c.get('userId');
  const { months, limit } = c.req.valid('query');
  const data = await getCategoryTrend(userId, months, limit);
  return c.json({ data }, 200);
});

export { analyticsRouter };
