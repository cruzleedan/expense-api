import { z } from '@hono/zod-openapi';

export const AnalyticsQuerySchema = z.object({
  days: z.string().regex(/^\d+$/).transform(Number).pipe(z.number().int().min(1).max(365)).default('30').openapi({
    example: '30',
    description: 'Number of days to look back',
  }),
});

export const TrendQuerySchema = z.object({
  months: z.string().regex(/^\d+$/).transform(Number).pipe(z.number().int().min(1).max(24)).default('12').openapi({
    example: '12',
    description: 'Number of months to look back',
  }),
});

export const ComparisonQuerySchema = z.object({
  period: z.enum(['month', 'quarter']).default('month').openapi({
    example: 'month',
    description: 'Period type for comparison',
  }),
});

export const CategorySpendingSchema = z.object({
  category: z.string(),
  total: z.number(),
  count: z.number().int(),
}).openapi('CategorySpending');

export const SpendingTrendPointSchema = z.object({
  period: z.string(),
  total: z.number(),
  count: z.number().int(),
}).openapi('SpendingTrendPoint');

export const PeriodSummarySchema = z.object({
  total: z.number(),
  count: z.number().int(),
  avgTransaction: z.number(),
}).openapi('PeriodSummary');

export const PeriodComparisonSchema = z.object({
  current: PeriodSummarySchema,
  previous: PeriodSummarySchema,
  change: z.object({
    amountPct: z.number().nullable(),
    countPct: z.number().nullable(),
  }),
}).openapi('PeriodComparison');

export const CategorySpendingResponseSchema = z.object({
  data: z.array(CategorySpendingSchema),
}).openapi('CategorySpendingResponse');

export const SpendingTrendResponseSchema = z.object({
  data: z.array(SpendingTrendPointSchema),
}).openapi('SpendingTrendResponse');

export const PeriodComparisonResponseSchema = z.object({
  data: PeriodComparisonSchema,
}).openapi('PeriodComparisonResponse');

// Dashboard Summary
export const DashboardSummarySchema = z.object({
  totalReports: z.number().int(),
  draftCount: z.number().int(),
  pendingCount: z.number().int(),
  approvedCount: z.number().int(),
  rejectedCount: z.number().int(),
  totalAmount: z.number(),
}).openapi('DashboardSummary');

export const DashboardSummaryResponseSchema = z.object({
  data: DashboardSummarySchema,
}).openapi('DashboardSummaryResponse');

// Top Merchants
export const TopMerchantQuerySchema = z.object({
  days: z.string().regex(/^\d+$/).transform(Number).pipe(z.number().int().min(1).max(365)).default('30').openapi({
    example: '30',
    description: 'Number of days to look back',
  }),
  limit: z.string().regex(/^\d+$/).transform(Number).pipe(z.number().int().min(1).max(50)).default('10').openapi({
    example: '10',
    description: 'Max merchants to return',
  }),
});

export const TopMerchantSchema = z.object({
  merchant: z.string(),
  total: z.number(),
  count: z.number().int(),
}).openapi('TopMerchant');

export const TopMerchantResponseSchema = z.object({
  data: z.array(TopMerchantSchema),
}).openapi('TopMerchantResponse');

// Category Trend
export const CategoryTrendQuerySchema = z.object({
  months: z.string().regex(/^\d+$/).transform(Number).pipe(z.number().int().min(1).max(24)).default('6').openapi({
    example: '6',
    description: 'Number of months to look back',
  }),
  limit: z.string().regex(/^\d+$/).transform(Number).pipe(z.number().int().min(1).max(20)).default('5').openapi({
    example: '5',
    description: 'Number of top categories to include',
  }),
});

export const CategoryTrendPointSchema = z.object({
  period: z.string(),
  category: z.string(),
  total: z.number(),
}).openapi('CategoryTrendPoint');

export const CategoryTrendResponseSchema = z.object({
  data: z.array(CategoryTrendPointSchema),
}).openapi('CategoryTrendResponse');
