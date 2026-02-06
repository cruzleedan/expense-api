import { z } from '@hono/zod-openapi';
import { PaginationMetaSchema } from './common.js';

export const ExpenseReportStatusSchema = z.enum(['draft', 'submitted', 'approved', 'rejected']);

export const ExpenseReportSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  title: z.string(),
  reportDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  totalAmount: z.number(),
  netAmount: z.number(),
  currency: z.string().length(3),
  description: z.string().nullable(),
  status: ExpenseReportStatusSchema,
  // v5.0 fields
  projectId: z.string().uuid().nullable(),
  projectName: z.string().nullable(),
  clientName: z.string().nullable(),
  tags: z.array(z.string()).nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
}).openapi('ExpenseReport');

export const CreateExpenseReportSchema = z.object({
  title: z.string().min(1).max(255).openapi({ example: 'Business Trip Q1' }),
  description: z.string().max(5000).optional().openapi({ example: 'Travel expenses for client meetings' }),
  reportDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).openapi({ example: '2024-03-31' }),
  totalAmount: z.number().optional().openapi({ example: 1234.56 }),
  netAmount: z.number().optional().openapi({ example: 1000.00 }),
  currency: z.string().length(3).optional().openapi({ example: 'USD' }),
  // v5.0 fields
  projectId: z.string().uuid().optional().openapi({ example: '00000000-0000-4000-d001-000000000001' }),
  projectName: z.string().max(255).optional().openapi({ example: 'Project Alpha' }),
  clientName: z.string().max(255).optional().openapi({ example: 'Acme Corporation' }),
  tags: z.array(z.string().max(50)).max(20).optional().openapi({ example: ['q1-2024', 'travel', 'billable'] }),
}).openapi('CreateExpenseReport');

export const UpdateExpenseReportSchema = z.object({
  title: z.string().min(1).max(255).optional(),
  description: z.string().max(5000).optional(),
  status: ExpenseReportStatusSchema.optional(),
  reportDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().openapi({ example: '2024-03-31' }),
  totalAmount: z.number().optional().openapi({ example: 1234.56 }),
  netAmount: z.number().optional().openapi({ example: 1000.00 }),
  currency: z.string().length(3).optional().openapi({ example: 'USD' }),
  // v5.0 fields
  projectId: z.string().uuid().nullable().optional(),
  projectName: z.string().max(255).nullable().optional(),
  clientName: z.string().max(255).nullable().optional(),
  tags: z.array(z.string().max(50)).max(20).nullable().optional(),
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
