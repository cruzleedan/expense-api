import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import type { RouteHandler } from '@hono/zod-openapi';
import { authMiddleware, getUserId } from '../middleware/auth.js';
import {
  getInsightsForUser,
  getUnreadInsightCount,
  pinInsight,
  dismissInsight,
} from '../services/insight.service.js';
import {
  InsightListSchema,
  UnreadCountSchema,
  InsightQuerySchema,
  InsightIdParamSchema,
} from '../schemas/insight.js';
import { ErrorSchema, MessageSchema, AuthHeaderSchema } from '../schemas/common.js';

const insightsRouter = new OpenAPIHono();

insightsRouter.use('*', authMiddleware);

const security = [{ Bearer: [] }];

// ============================================================================
// GET /v1/insights — List user's insights
// ============================================================================

const listInsightsRoute = createRoute({
  method: 'get',
  path: '/',
  tags: ['Insights'],
  summary: 'List insights',
  description: 'Get the authenticated user\'s proactive insights (paginated, filterable)',
  security,
  request: {
    headers: AuthHeaderSchema,
    query: InsightQuerySchema,
  },
  responses: {
    200: {
      description: 'List of insights',
      content: { 'application/json': { schema: InsightListSchema } },
    },
    401: {
      description: 'Unauthorized',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
});

const listInsightsHandler: RouteHandler<typeof listInsightsRoute> = async (c) => {
  const userId = getUserId(c);
  const { type, limit, offset, includeStale } = c.req.valid('query');
  const result = await getInsightsForUser(userId, { type, limit, offset, includeStale });
  return c.json({ data: result.insights, total: result.total } as any, 200);
};
insightsRouter.openapi(listInsightsRoute, listInsightsHandler);

// ============================================================================
// GET /v1/insights/unread-count — Count new insights
// ============================================================================

const unreadCountRoute = createRoute({
  method: 'get',
  path: '/unread-count',
  tags: ['Insights'],
  summary: 'Unread insight count',
  description: 'Get the count of new insights for the authenticated user (last 7 days)',
  security,
  request: {
    headers: AuthHeaderSchema,
  },
  responses: {
    200: {
      description: 'Unread count',
      content: { 'application/json': { schema: UnreadCountSchema } },
    },
    401: {
      description: 'Unauthorized',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
});

const unreadCountHandler: RouteHandler<typeof unreadCountRoute> = async (c) => {
  const userId = getUserId(c);
  const count = await getUnreadInsightCount(userId);
  return c.json({ count } as any, 200);
};
insightsRouter.openapi(unreadCountRoute, unreadCountHandler);

// ============================================================================
// POST /v1/insights/:insightId/pin — Pin an insight
// ============================================================================

const pinInsightRoute = createRoute({
  method: 'post',
  path: '/{insightId}/pin',
  tags: ['Insights'],
  summary: 'Pin insight',
  description: 'Pin an insight to keep it visible',
  security,
  request: {
    headers: AuthHeaderSchema,
    params: InsightIdParamSchema,
  },
  responses: {
    200: {
      description: 'Insight pinned',
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

const pinInsightHandler: RouteHandler<typeof pinInsightRoute> = async (c) => {
  const userId = getUserId(c);
  const { insightId } = c.req.valid('param');
  await pinInsight(userId, insightId);
  return c.json({ message: 'Insight pinned' }, 200);
};
insightsRouter.openapi(pinInsightRoute, pinInsightHandler);

// ============================================================================
// POST /v1/insights/:insightId/dismiss — Dismiss an insight
// ============================================================================

const dismissInsightRoute = createRoute({
  method: 'post',
  path: '/{insightId}/dismiss',
  tags: ['Insights'],
  summary: 'Dismiss insight',
  description: 'Dismiss an insight (mark as stale)',
  security,
  request: {
    headers: AuthHeaderSchema,
    params: InsightIdParamSchema,
  },
  responses: {
    200: {
      description: 'Insight dismissed',
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

const dismissInsightHandler: RouteHandler<typeof dismissInsightRoute> = async (c) => {
  const userId = getUserId(c);
  const { insightId } = c.req.valid('param');
  await dismissInsight(userId, insightId);
  return c.json({ message: 'Insight dismissed' }, 200);
};
insightsRouter.openapi(dismissInsightRoute, dismissInsightHandler);

export { insightsRouter };
