import { z } from '@hono/zod-openapi';

export const HealthStatusSchema = z.object({
  status: z.enum(['healthy', 'degraded', 'unhealthy']),
  timestamp: z.string().datetime(),
  services: z.object({
    database: z.boolean(),
    receiptParser: z.boolean(),
  }),
  version: z.string(),
}).openapi('HealthStatus');

export const LivenessSchema = z.object({
  status: z.literal('ok'),
}).openapi('Liveness');

export const ReadinessSchema = z.object({
  status: z.enum(['ready', 'not ready']),
  reason: z.string().optional(),
}).openapi('Readiness');
