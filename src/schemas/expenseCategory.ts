import { z } from '@hono/zod-openapi';
import { PaginationMetaSchema } from './common.js';

export const ExpenseCategorySchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  code: z.string().nullable(),
  description: z.string().nullable(),
  isActive: z.boolean(),
  // v5.0 fields
  parentId: z.string().uuid().nullable(),
  keywords: z.array(z.string()).nullable(),
  synonyms: z.array(z.string()).nullable(),
  typicalAmountRange: z.record(z.unknown()).nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
}).openapi('ExpenseCategory');

export const CreateExpenseCategorySchema = z.object({
  name: z.string().min(1).max(100).openapi({ example: 'Travel' }),
  code: z.string().min(1).max(50).optional().openapi({ example: 'TRAVEL' }),
  description: z.string().max(1000).optional().openapi({ example: 'Travel and transportation expenses' }),
  // v5.0 fields
  parentId: z.string().uuid().optional().openapi({ example: '00000000-0000-4000-b001-000000000001' }),
  keywords: z.array(z.string().max(50)).max(50).optional().openapi({ example: ['flight', 'hotel', 'car rental'] }),
  synonyms: z.array(z.string().max(100)).max(20).optional().openapi({ example: ['business travel', 'trip'] }),
  typicalAmountRange: z.record(z.unknown()).optional().openapi({ example: { min: 50, max: 2000, median: 500 } }),
}).openapi('CreateExpenseCategory');

export const UpdateExpenseCategorySchema = z.object({
  name: z.string().min(1).max(100).optional(),
  code: z.string().min(1).max(50).optional(),
  description: z.string().max(1000).optional(),
  isActive: z.boolean().optional(),
  // v5.0 fields
  parentId: z.string().uuid().nullable().optional(),
  keywords: z.array(z.string().max(50)).max(50).nullable().optional(),
  synonyms: z.array(z.string().max(100)).max(20).nullable().optional(),
  typicalAmountRange: z.record(z.unknown()).nullable().optional(),
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
