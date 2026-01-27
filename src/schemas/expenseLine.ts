import { z } from '@hono/zod-openapi';
import { PaginationMetaSchema } from './common.js';

export const ExpenseLineSchema = z.object({
  id: z.string().uuid(),
  report_id: z.string().uuid(),
  description: z.string(),
  amount: z.string(), // DECIMAL comes as string from pg
  currency: z.string(),
  category: z.string().nullable(),
  expense_date: z.string(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
}).openapi('ExpenseLine');

export const CreateExpenseLineSchema = z.object({
  description: z.string().min(1).max(255).openapi({ example: 'Flight to NYC' }),
  amount: z.number().positive().openapi({ example: 450.00 }),
  currency: z.string().length(3).default('USD').openapi({ example: 'USD' }),
  category: z.string().max(100).optional().openapi({ example: 'Travel' }),
  expense_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).openapi({ example: '2024-01-15' }),
}).openapi('CreateExpenseLine');

export const UpdateExpenseLineSchema = z.object({
  description: z.string().min(1).max(255).optional(),
  amount: z.number().positive().optional(),
  currency: z.string().length(3).optional(),
  category: z.string().max(100).optional(),
  expense_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
}).openapi('UpdateExpenseLine');

export const ExpenseLineListResponseSchema = z.object({
  data: z.array(ExpenseLineSchema),
  pagination: PaginationMetaSchema,
}).openapi('ExpenseLineList');
