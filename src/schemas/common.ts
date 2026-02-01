import { z } from '@hono/zod-openapi';

// Common response schemas
export const ErrorSchema = z.object({
  error: z.object({
    message: z.string(),
    code: z.string().optional(),
    details: z.unknown().optional(),
  }),
}).openapi('Error');

export const MessageSchema = z.object({
  message: z.string(),
}).openapi('Message');

// Pagination
export const PaginationQuerySchema = z.object({
  page: z.string().regex(/^\d+$/).transform(Number).pipe(z.number().int().positive()).default('1').openapi({ example: '1' }),
  limit: z.string().regex(/^\d+$/).transform(Number).pipe(z.number().int().positive().max(100)).default('20').openapi({ example: '20' }),
  search: z.string().max(255).optional().openapi({ example: 'quarterly report', description: 'Search term to filter results' }),
  sortBy: z.string().optional().openapi({ description: 'Field to sort by (resource-specific allowed values)' }),
  sortOrder: z.enum(['asc', 'desc']).default('asc').openapi({ example: 'asc', description: 'Sort direction' }),
});

export const PaginationMetaSchema = z.object({
  page: z.number(),
  limit: z.number(),
  total: z.number(),
  totalPages: z.number(),
  hasNext: z.boolean(),
  hasPrev: z.boolean(),
}).openapi('PaginationMeta');

// UUID param
export const UuidParamSchema = z.object({
  id: z.string().uuid().openapi({ example: '550e8400-e29b-41d4-a716-446655440000' }),
});

export const ReportIdParamSchema = z.object({
  reportId: z.string().uuid().openapi({ example: '550e8400-e29b-41d4-a716-446655440000' }),
});

// Auth header
export const AuthHeaderSchema = z.object({
  authorization: z.string().regex(/^Bearer .+/).openapi({ example: 'Bearer eyJhbGciOiJIUzI1NiIs...' }),
});

// Timestamps
export const TimestampFields = {
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
};
