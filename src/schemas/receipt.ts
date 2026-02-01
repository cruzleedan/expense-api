import { z } from '@hono/zod-openapi';
import { PaginationMetaSchema } from './common.js';
import { ExpenseLineSchema } from './expenseLine.js';

export const ReceiptSchema = z.object({
  id: z.string().uuid(),
  reportId: z.string().uuid(),
  filePath: z.string(),
  fileName: z.string(),
  fileHash: z.string(),
  mimeType: z.string(),
  fileSize: z.number(),
  parsedData: z.record(z.unknown()).nullable(),
  createdAt: z.string().datetime(),
}).openapi('Receipt');

export const ParsedReceiptDataSchema = z.object({
  vendor: z.string().optional(),
  date: z.string().optional(),
  total: z.number().optional(),
  currency: z.string().optional(),
  items: z.array(z.object({
    description: z.string(),
    amount: z.number(),
  })).optional(),
  rawText: z.string().optional(),
}).openapi('ParsedReceiptData');

export const ReceiptUploadResponseSchema = z.object({
  receipt: ReceiptSchema,
  parsedData: ParsedReceiptDataSchema.optional(),
}).openapi('ReceiptUploadResponse');

// Allowed sortBy values for receipts
export const ReceiptSortBySchema = z.enum(['fileName', 'fileSize', 'createdAt']);

export const ReceiptListQuerySchema = z.object({
  page: z.string().regex(/^\d+$/).transform(Number).pipe(z.number().int().positive()).default('1').openapi({ example: '1' }),
  limit: z.string().regex(/^\d+$/).transform(Number).pipe(z.number().int().positive().max(100)).default('20').openapi({ example: '20' }),
  search: z.string().max(255).optional().openapi({ example: 'invoice', description: 'Search in file name' }),
  sortBy: ReceiptSortBySchema.optional().openapi({ example: 'createdAt', description: 'Field to sort by' }),
  sortOrder: z.enum(['asc', 'desc']).default('asc').openapi({ example: 'desc', description: 'Sort direction' }),
});

export const ReceiptListResponseSchema = z.object({
  data: z.array(ReceiptSchema),
  pagination: PaginationMetaSchema,
}).openapi('ReceiptList');

export const AssociateReceiptSchema = z.object({
  lineIds: z.array(z.string().uuid()).min(1).openapi({ example: ['550e8400-e29b-41d4-a716-446655440000'] }),
}).openapi('AssociateReceipt');

export const ReceiptAssociationsResponseSchema = z.object({
  lines: z.array(ExpenseLineSchema),
}).openapi('ReceiptAssociations');
