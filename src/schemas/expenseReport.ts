import { z } from '@hono/zod-openapi';
import { PaginationMetaSchema } from './common.js';

export const ExpenseReportStatusSchema = z.enum(['draft', 'submitted', 'approved', 'rejected']);

export const ExpenseReportSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  title: z.string(),
  description: z.string().nullable(),
  status: ExpenseReportStatusSchema,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
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

// Allowed sortBy values for expense reports
export const ExpenseReportSortBySchema = z.enum(['title', 'status', 'totalAmount', 'createdAt', 'updatedAt', 'submittedAt']);

export const ExpenseReportListQuerySchema = z.object({
  page: z.string().regex(/^\d+$/).transform(Number).pipe(z.number().int().positive()).default('1'),
  limit: z.string().regex(/^\d+$/).transform(Number).pipe(z.number().int().positive().max(100)).default('20'),
  status: ExpenseReportStatusSchema.optional(),
  search: z.string().max(255).optional().openapi({ example: 'quarterly', description: 'Search in title and description' }),
  sortBy: ExpenseReportSortBySchema.optional().openapi({ example: 'createdAt', description: 'Field to sort by' }),
  sortOrder: z.enum(['asc', 'desc']).default('asc').openapi({ example: 'desc', description: 'Sort direction' }),
});

export const ExpenseReportListResponseSchema = z.object({
  data: z.array(ExpenseReportSchema),
  pagination: PaginationMetaSchema,
}).openapi('ExpenseReportList');
