import { z } from '@hono/zod-openapi';
import { ExpenseReportSchema } from './expenseReport.js';
import { ExpenseLineSchema } from './expenseLine.js';
import { PaginationMetaSchema } from './common.js';

export const ExpenseItemSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('report') }).merge(ExpenseReportSchema),
  z.object({ type: z.literal('expense_line') }).merge(ExpenseLineSchema),
]).openapi('ExpenseItem');

export const ExpensesQuerySchema = z.object({
  page: z.string().regex(/^\d+$/).transform(Number).pipe(z.number().int().positive()).default('1').openapi({ example: '1' }),
  limit: z.string().regex(/^\d+$/).transform(Number).pipe(z.number().int().positive().max(100)).default('20').openapi({ example: '20' }),
  search: z.string().max(255).optional().openapi({
    example: 'flight',
    description: 'Search in report titles, expense line descriptions, and merchant names',
  }),
  sortOrder: z.enum(['asc', 'desc']).default('desc').openapi({ example: 'desc', description: 'Sort direction (by createdAt)' }),
});

export const ExpensesListResponseSchema = z.object({
  data: z.array(ExpenseItemSchema),
  pagination: PaginationMetaSchema,
}).openapi('ExpensesList');
