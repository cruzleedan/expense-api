import { z } from '@hono/zod-openapi';
import { PaginationMetaSchema } from './common.js';

export const ExpenseReportStatusSchema = z.enum(['draft', 'submitted', 'approved', 'rejected']);

export const ExpenseReportSchema = z.object({
  id: z.string().uuid(),
  user_id: z.string().uuid(),
  title: z.string(),
  description: z.string().nullable(),
  status: ExpenseReportStatusSchema,
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
}).openapi('ExpenseReport');

export const CreateExpenseReportSchema = z.object({
  title: z.string().min(1).max(255).openapi({ example: 'Business Trip Q1' }),
  description: z.string().max(5000).optional().openapi({ example: 'Travel expenses for client meetings' }),
}).openapi('CreateExpenseReport');

export const UpdateExpenseReportSchema = z.object({
  title: z.string().min(1).max(255).optional(),
  description: z.string().max(5000).optional(),
  status: ExpenseReportStatusSchema.optional(),
}).openapi('UpdateExpenseReport');

export const ExpenseReportListQuerySchema = z.object({
  page: z.string().regex(/^\d+$/).transform(Number).pipe(z.number().int().positive()).default('1'),
  limit: z.string().regex(/^\d+$/).transform(Number).pipe(z.number().int().positive().max(100)).default('20'),
  status: ExpenseReportStatusSchema.optional(),
});

export const ExpenseReportListResponseSchema = z.object({
  data: z.array(ExpenseReportSchema),
  pagination: PaginationMetaSchema,
}).openapi('ExpenseReportList');
