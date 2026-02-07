import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import { authMiddleware } from '../middleware/auth.js';
import {
  getAnomaliesForUser,
  reviewAnomaly,
  dismissAnomaly,
} from '../services/insight.service.js';
import {
  AnomalyListSchema,
  AnomalyQuerySchema,
  AnomalyIdParamSchema,
  ReviewAnomalySchema,
} from '../schemas/insight.js';
import { ErrorSchema, MessageSchema, AuthHeaderSchema } from '../schemas/common.js';

const anomaliesRouter = new OpenAPIHono();

anomaliesRouter.use('*', authMiddleware);

const security = [{ Bearer: [] }];

// ============================================================================
// GET /v1/anomalies — List user's anomalies
// ============================================================================

const listAnomaliesRoute = createRoute({
  method: 'get',
  path: '/',
  tags: ['Anomalies'],
  summary: 'List anomalies',
  description: 'Get the authenticated user\'s expense anomalies (paginated, filterable)',
  security,
  request: {
    headers: AuthHeaderSchema,
    query: AnomalyQuerySchema,
  },
  responses: {
    200: {
      description: 'List of anomalies',
      content: { 'application/json': { schema: AnomalyListSchema } },
    },
    401: {
      description: 'Unauthorized',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
});

anomaliesRouter.openapi(listAnomaliesRoute, async (c) => {
  const userId = c.get('userId');
  const { status, severity, limit, offset } = c.req.valid('query');
  const result = await getAnomaliesForUser(userId, { status, severity, limit, offset });
  return c.json({ data: result.anomalies, total: result.total }, 200);
});

// ============================================================================
// POST /v1/anomalies/:anomalyId/review — Mark as reviewed
// ============================================================================

const reviewAnomalyRoute = createRoute({
  method: 'post',
  path: '/{anomalyId}/review',
  tags: ['Anomalies'],
  summary: 'Review anomaly',
  description: 'Mark an anomaly as reviewed with optional notes',
  security,
  request: {
    headers: AuthHeaderSchema,
    params: AnomalyIdParamSchema,
    body: {
      content: { 'application/json': { schema: ReviewAnomalySchema } },
    },
  },
  responses: {
    200: {
      description: 'Anomaly reviewed',
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

anomaliesRouter.openapi(reviewAnomalyRoute, async (c) => {
  const userId = c.get('userId');
  const { anomalyId } = c.req.valid('param');
  const { notes } = c.req.valid('json');
  await reviewAnomaly(userId, anomalyId, notes);
  return c.json({ message: 'Anomaly reviewed' }, 200);
});

// ============================================================================
// POST /v1/anomalies/:anomalyId/dismiss — Dismiss anomaly
// ============================================================================

const dismissAnomalyRoute = createRoute({
  method: 'post',
  path: '/{anomalyId}/dismiss',
  tags: ['Anomalies'],
  summary: 'Dismiss anomaly',
  description: 'Dismiss an anomaly as false positive',
  security,
  request: {
    headers: AuthHeaderSchema,
    params: AnomalyIdParamSchema,
  },
  responses: {
    200: {
      description: 'Anomaly dismissed',
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

anomaliesRouter.openapi(dismissAnomalyRoute, async (c) => {
  const userId = c.get('userId');
  const { anomalyId } = c.req.valid('param');
  await dismissAnomaly(userId, anomalyId);
  return c.json({ message: 'Anomaly dismissed' }, 200);
});

export { anomaliesRouter };
