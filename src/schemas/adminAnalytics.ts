import { z } from '@hono/zod-openapi';

export const DaysQuerySchema = z.object({
  days: z.string().regex(/^\d+$/).transform(Number).pipe(z.number().int().positive().max(365)).default('30').openapi({
    example: '30',
    description: 'Number of days to look back',
  }),
});

export const LlmUsageDaySchema = z.object({
  day: z.string(),
  queryCount: z.number(),
  uniqueUsers: z.number(),
  avgResponseMs: z.number(),
  totalTokens: z.number(),
  helpfulnessRate: z.number().nullable(),
}).openapi('LlmUsageDay');

export const LlmUsageStatsSchema = z.object({
  daily: z.array(LlmUsageDaySchema),
  totals: z.object({
    totalQueries: z.number(),
    totalUniqueUsers: z.number(),
    avgResponseMs: z.number(),
    totalTokens: z.number(),
    helpfulnessRate: z.number().nullable(),
  }),
}).openapi('LlmUsageStats');

export const PopularQuerySchema = z.object({
  queryPattern: z.string(),
  count: z.number(),
  avgResponseMs: z.number(),
  helpfulnessRate: z.number().nullable(),
}).openapi('PopularQuery');

export const PopularQueryListSchema = z.object({
  data: z.array(PopularQuerySchema),
}).openapi('PopularQueryList');

export const SpendingOverviewSchema = z.object({
  totalSpending: z.number(),
  totalTransactions: z.number(),
  avgTransaction: z.number(),
  topDepartments: z.array(z.object({
    department: z.string(),
    total: z.number(),
    count: z.number(),
  })),
  topCategories: z.array(z.object({
    category: z.string(),
    total: z.number(),
    count: z.number(),
  })),
}).openapi('SpendingOverview');

export const AnomalyStatsSchema = z.object({
  total: z.number(),
  byType: z.array(z.object({ anomalyType: z.string(), count: z.number() })),
  bySeverity: z.array(z.object({ severity: z.string(), count: z.number() })),
  byStatus: z.array(z.object({ status: z.string(), count: z.number() })),
  resolutionRate: z.number(),
}).openapi('AnomalyStats');

export const ModelPerformanceSchema = z.object({
  model: z.string(),
  queryCount: z.number(),
  avgResponseMs: z.number(),
  avgTokens: z.number(),
  helpfulnessRate: z.number().nullable(),
  errorRate: z.number(),
}).openapi('ModelPerformance');

export const ModelPerformanceListSchema = z.object({
  data: z.array(ModelPerformanceSchema),
}).openapi('ModelPerformanceList');
