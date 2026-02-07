import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import { authMiddleware } from '../middleware/auth.js';
import { requireAnyPermission } from '../middleware/permission.js';
import {
  getLlmUsageStats,
  getPopularQueries,
  getSpendingOverview,
  getAnomalyStats,
  getModelPerformance,
} from '../services/adminAnalytics.service.js';
import {
  DaysQuerySchema,
  LlmUsageStatsSchema,
  PopularQueryListSchema,
  SpendingOverviewSchema,
  AnomalyStatsSchema,
  ModelPerformanceListSchema,
} from '../schemas/adminAnalytics.js';
import { ErrorSchema, AuthHeaderSchema } from '../schemas/common.js';

const adminAnalyticsRouter = new OpenAPIHono();

// All routes require authentication + admin permissions
adminAnalyticsRouter.use('*', authMiddleware);

const security = [{ Bearer: [] }];

// ============================================================================
// GET /v1/admin/analytics/llm-usage — LLM usage stats
// ============================================================================

const llmUsageRoute = createRoute({
  method: 'get',
  path: '/llm-usage',
  tags: ['Admin Analytics'],
  summary: 'LLM usage statistics',
  description: 'Get daily LLM query stats including queries/day, avg response time, tokens used, and active users',
  security,
  request: {
    headers: AuthHeaderSchema,
    query: DaysQuerySchema,
  },
  responses: {
    200: {
      description: 'LLM usage statistics',
      content: { 'application/json': { schema: LlmUsageStatsSchema } },
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

adminAnalyticsRouter.openapi(llmUsageRoute, async (c) => {
  const { days } = c.req.valid('query');
  const stats = await getLlmUsageStats(days);
  return c.json(stats, 200);
});

// Apply permission middleware after the route is defined but wrap it
adminAnalyticsRouter.use('/llm-usage', requireAnyPermission('llm.history.view.all'));

// ============================================================================
// GET /v1/admin/analytics/llm-popular-queries — Popular query patterns
// ============================================================================

const popularQueriesRoute = createRoute({
  method: 'get',
  path: '/llm-popular-queries',
  tags: ['Admin Analytics'],
  summary: 'Popular query patterns',
  description: 'Get the most common query patterns/intents from LLM usage',
  security,
  request: {
    headers: AuthHeaderSchema,
    query: DaysQuerySchema,
  },
  responses: {
    200: {
      description: 'Popular query patterns',
      content: { 'application/json': { schema: PopularQueryListSchema } },
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

adminAnalyticsRouter.openapi(popularQueriesRoute, async (c) => {
  const { days } = c.req.valid('query');
  const queries = await getPopularQueries(days);
  return c.json({ data: queries }, 200);
});

adminAnalyticsRouter.use('/llm-popular-queries', requireAnyPermission('llm.history.view.all'));

// ============================================================================
// GET /v1/admin/analytics/spending-overview — Org-wide spending aggregates
// ============================================================================

const spendingOverviewRoute = createRoute({
  method: 'get',
  path: '/spending-overview',
  tags: ['Admin Analytics'],
  summary: 'Organization spending overview',
  description: 'Get org-wide spending aggregates including top departments and categories',
  security,
  request: {
    headers: AuthHeaderSchema,
    query: DaysQuerySchema,
  },
  responses: {
    200: {
      description: 'Spending overview',
      content: { 'application/json': { schema: SpendingOverviewSchema } },
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

adminAnalyticsRouter.openapi(spendingOverviewRoute, async (c) => {
  const { days } = c.req.valid('query');
  const overview = await getSpendingOverview(days);
  return c.json(overview, 200);
});

adminAnalyticsRouter.use('/spending-overview', requireAnyPermission('llm.trends.view.all'));

// ============================================================================
// GET /v1/admin/analytics/anomaly-stats — Anomaly detection stats
// ============================================================================

const anomalyStatsRoute = createRoute({
  method: 'get',
  path: '/anomaly-stats',
  tags: ['Admin Analytics'],
  summary: 'Anomaly detection statistics',
  description: 'Get anomaly detection stats by type, severity, and resolution rate',
  security,
  request: {
    headers: AuthHeaderSchema,
    query: DaysQuerySchema,
  },
  responses: {
    200: {
      description: 'Anomaly statistics',
      content: { 'application/json': { schema: AnomalyStatsSchema } },
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

adminAnalyticsRouter.openapi(anomalyStatsRoute, async (c) => {
  const { days } = c.req.valid('query');
  const stats = await getAnomalyStats(days);
  return c.json(stats, 200);
});

adminAnalyticsRouter.use('/anomaly-stats', requireAnyPermission('llm.anomaly.view'));

// ============================================================================
// GET /v1/admin/analytics/model-performance — Model performance metrics
// ============================================================================

const modelPerformanceRoute = createRoute({
  method: 'get',
  path: '/model-performance',
  tags: ['Admin Analytics'],
  summary: 'Model performance metrics',
  description: 'Get response quality metrics per model (avg time, helpfulness rate, error rate)',
  security,
  request: {
    headers: AuthHeaderSchema,
    query: DaysQuerySchema,
  },
  responses: {
    200: {
      description: 'Model performance metrics',
      content: { 'application/json': { schema: ModelPerformanceListSchema } },
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

adminAnalyticsRouter.openapi(modelPerformanceRoute, async (c) => {
  const { days } = c.req.valid('query');
  const performance = await getModelPerformance(days);
  return c.json({ data: performance }, 200);
});

adminAnalyticsRouter.use('/model-performance', requireAnyPermission('llm.history.view.all'));

export { adminAnalyticsRouter };
