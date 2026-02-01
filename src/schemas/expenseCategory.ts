import { z } from '@hono/zod-openapi';
import { PaginationMetaSchema } from './common.js';

export const ExpenseCategorySchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  code: z.string().nullable(),
  description: z.string().nullable(),
  parentId: z.string().uuid().nullable(),
  isActive: z.boolean(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
}).openapi('ExpenseCategory');

export const CreateExpenseCategorySchema = z.object({
  name: z.string().min(1).max(100).openapi({ example: 'Travel' }),
  code: z.string().min(1).max(50).optional().openapi({ example: 'TRAVEL' }),
  description: z.string().max(1000).optional().openapi({ example: 'Travel and transportation expenses' }),
  parentId: z.string().uuid().optional().openapi({ example: '550e8400-e29b-41d4-a716-446655440000' }),
}).openapi('CreateExpenseCategory');

export const UpdateExpenseCategorySchema = z.object({
  name: z.string().min(1).max(100).optional(),
  code: z.string().min(1).max(50).optional(),
  description: z.string().max(1000).optional(),
  parentId: z.string().uuid().nullable().optional(),
  isActive: z.boolean().optional(),
}).openapi('UpdateExpenseCategory');

// Allowed sortBy values for expense categories
export const ExpenseCategorySortBySchema = z.enum(['name', 'code', 'createdAt', 'updatedAt']);

export const ExpenseCategoryListQuerySchema = z.object({
  page: z.string().regex(/^\d+$/).transform(Number).pipe(z.number().int().positive()).default('1').openapi({ example: '1' }),
  limit: z.string().regex(/^\d+$/).transform(Number).pipe(z.number().int().positive().max(100)).default('20').openapi({ example: '20' }),
  isActive: z.string().transform((v) => v === 'true').optional(),
  search: z.string().max(255).optional().openapi({ example: 'travel', description: 'Search in name, code, description' }),
  sortBy: ExpenseCategorySortBySchema.optional().openapi({ example: 'name', description: 'Field to sort by' }),
  sortOrder: z.enum(['asc', 'desc']).default('asc').openapi({ example: 'asc', description: 'Sort direction' }),
});

export const ExpenseCategoryListResponseSchema = z.object({
  data: z.array(ExpenseCategorySchema),
  pagination: PaginationMetaSchema,
}).openapi('ExpenseCategoryList');
