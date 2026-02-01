import { z } from '@hono/zod-openapi';
import { PaginationMetaSchema } from './common.js';

export const ExpenseLineSchema = z.object({
  id: z.string().uuid(),
  reportId: z.string().uuid(),
  description: z.string(),
  amount: z.string(), // DECIMAL comes as string from pg
  currency: z.string(),
  category: z.string().nullable(),
  expenseDate: z.string(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
}).openapi('ExpenseLine');

export const CreateExpenseLineSchema = z.object({
  description: z.string().min(1).max(255).openapi({ example: 'Flight to NYC' }),
  amount: z.number().positive().openapi({ example: 450.00 }),
  currency: z.string().length(3).default('USD').openapi({ example: 'USD' }),
  category: z.string().max(100).optional().openapi({ example: 'Travel' }),
  expenseDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).openapi({ example: '2024-01-15' }),
}).openapi('CreateExpenseLine');

export const UpdateExpenseLineSchema = z.object({
  description: z.string().min(1).max(255).optional(),
  amount: z.number().positive().optional(),
  currency: z.string().length(3).optional(),
  category: z.string().max(100).optional(),
  expenseDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
}).openapi('UpdateExpenseLine');

// Allowed sortBy values for expense lines
export const ExpenseLineSortBySchema = z.enum(['description', 'amount', 'expenseDate', 'category', 'createdAt']);

export const ExpenseLineListQuerySchema = z.object({
  page: z.string().regex(/^\d+$/).transform(Number).pipe(z.number().int().positive()).default('1').openapi({ example: '1' }),
  limit: z.string().regex(/^\d+$/).transform(Number).pipe(z.number().int().positive().max(100)).default('20').openapi({ example: '20' }),
  search: z.string().max(255).optional().openapi({ example: 'flight', description: 'Search in description and category' }),
  sortBy: ExpenseLineSortBySchema.optional().openapi({ example: 'expenseDate', description: 'Field to sort by' }),
  sortOrder: z.enum(['asc', 'desc']).default('asc').openapi({ example: 'desc', description: 'Sort direction' }),
});

export const ExpenseLineListResponseSchema = z.object({
  data: z.array(ExpenseLineSchema),
  pagination: PaginationMetaSchema,
}).openapi('ExpenseLineList');
