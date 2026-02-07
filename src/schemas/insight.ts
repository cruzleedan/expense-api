import { z } from '@hono/zod-openapi';

// ============================================================================
// Insight schemas
// ============================================================================

export const InsightSchema = z.object({
  id: z.string().uuid(),
  scopeType: z.string(),
  scopeId: z.string().uuid().nullable(),
  periodStart: z.string().nullable(),
  periodEnd: z.string().nullable(),
  insightType: z.string(),
  title: z.string(),
  content: z.string(),
  supportingData: z.record(z.unknown()).nullable(),
  confidence: z.number().nullable(),
  isPinned: z.boolean(),
  isStale: z.boolean(),
  generatedAt: z.string(),
  generatedBy: z.string(),
}).openapi('Insight');

export const InsightListSchema = z.object({
  data: z.array(InsightSchema),
  total: z.number(),
}).openapi('InsightList');

export const UnreadCountSchema = z.object({
  count: z.number(),
}).openapi('UnreadCount');

export const InsightQuerySchema = z.object({
  type: z.string().optional().openapi({ description: 'Filter by insight type (trend, anomaly, recommendation, comparison, forecast, summary)' }),
  limit: z.string().regex(/^\d+$/).transform(Number).pipe(z.number().int().positive().max(100)).default('20').openapi({ example: '20' }),
  offset: z.string().regex(/^\d+$/).transform(Number).pipe(z.number().int().min(0)).default('0').openapi({ example: '0' }),
  includeStale: z.enum(['true', 'false']).default('false').transform(v => v === 'true').openapi({ description: 'Include dismissed insights' }),
});

export const InsightIdParamSchema = z.object({
  insightId: z.string().uuid().openapi({ example: '550e8400-e29b-41d4-a716-446655440000' }),
});

// ============================================================================
// Anomaly schemas
// ============================================================================

export const AnomalySchema = z.object({
  id: z.string().uuid(),
  expenseLineId: z.string().uuid().nullable(),
  reportId: z.string().uuid().nullable(),
  userId: z.string().uuid().nullable(),
  anomalyType: z.string(),
  severity: z.string(),
  confidence: z.number(),
  context: z.record(z.unknown()),
  explanation: z.string(),
  status: z.string(),
  reviewedBy: z.string().uuid().nullable(),
  reviewedAt: z.string().nullable(),
  reviewNotes: z.string().nullable(),
  detectedAt: z.string(),
}).openapi('Anomaly');

export const AnomalyListSchema = z.object({
  data: z.array(AnomalySchema),
  total: z.number(),
}).openapi('AnomalyList');

export const AnomalyQuerySchema = z.object({
  status: z.string().optional().openapi({ description: 'Filter by status (open, reviewed, dismissed, confirmed, escalated)' }),
  severity: z.string().optional().openapi({ description: 'Filter by severity (info, low, medium, high, critical)' }),
  limit: z.string().regex(/^\d+$/).transform(Number).pipe(z.number().int().positive().max(100)).default('20').openapi({ example: '20' }),
  offset: z.string().regex(/^\d+$/).transform(Number).pipe(z.number().int().min(0)).default('0').openapi({ example: '0' }),
});

export const AnomalyIdParamSchema = z.object({
  anomalyId: z.string().uuid().openapi({ example: '550e8400-e29b-41d4-a716-446655440000' }),
});

export const ReviewAnomalySchema = z.object({
  notes: z.string().max(1000).optional().openapi({ description: 'Review notes' }),
}).openapi('ReviewAnomaly');
