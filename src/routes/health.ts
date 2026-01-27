import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import { healthCheck } from '../db/client.js';
import { isParserAvailable } from '../services/receiptParser.service.js';
import { HealthStatusSchema, LivenessSchema, ReadinessSchema } from '../schemas/health.js';

const healthRouter = new OpenAPIHono();

// Health check route
const healthRoute = createRoute({
  method: 'get',
  path: '/',
  tags: ['Health'],
  summary: 'Full health status',
  description: 'Returns health status of the API and its dependencies',
  responses: {
    200: {
      description: 'Service is healthy or degraded',
      content: { 'application/json': { schema: HealthStatusSchema } },
    },
    503: {
      description: 'Service is unhealthy',
      content: { 'application/json': { schema: HealthStatusSchema } },
    },
  },
});

healthRouter.openapi(healthRoute, async (c) => {
  const [dbHealthy, parserAvailable] = await Promise.all([
    healthCheck(),
    isParserAvailable(),
  ]);

  const status = {
    status: dbHealthy ? (parserAvailable ? 'healthy' : 'degraded') : 'unhealthy',
    timestamp: new Date().toISOString(),
    services: {
      database: dbHealthy,
      receiptParser: parserAvailable,
    },
    version: process.env.npm_package_version ?? '1.0.0',
  } as const;

  return c.json(status, dbHealthy ? 200 : 503);
});

// Liveness probe route
const livenessRoute = createRoute({
  method: 'get',
  path: '/live',
  tags: ['Health'],
  summary: 'Liveness probe',
  description: 'Kubernetes liveness probe - checks if the app is running',
  responses: {
    200: {
      description: 'App is alive',
      content: { 'application/json': { schema: LivenessSchema } },
    },
  },
});

healthRouter.openapi(livenessRoute, (c) => {
  return c.json({ status: 'ok' as const }, 200);
});

// Readiness probe route
const readinessRoute = createRoute({
  method: 'get',
  path: '/ready',
  tags: ['Health'],
  summary: 'Readiness probe',
  description: 'Kubernetes readiness probe - checks if the app can serve traffic',
  responses: {
    200: {
      description: 'App is ready',
      content: { 'application/json': { schema: ReadinessSchema } },
    },
    503: {
      description: 'App is not ready',
      content: { 'application/json': { schema: ReadinessSchema } },
    },
  },
});

healthRouter.openapi(readinessRoute, async (c) => {
  const dbHealthy = await healthCheck();

  if (!dbHealthy) {
    return c.json({ status: 'not ready' as const, reason: 'database unavailable' }, 503);
  }

  return c.json({ status: 'ready' as const }, 200);
});

export { healthRouter };
