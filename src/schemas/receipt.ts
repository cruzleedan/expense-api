import { z } from '@hono/zod-openapi';
import { PaginationMetaSchema } from './common.js';
import { ExpenseLineSchema } from './expenseLine.js';

export const ReceiptSchema = z.object({
  id: z.string().uuid(),
  report_id: z.string().uuid(),
  file_path: z.string(),
  file_name: z.string(),
  file_hash: z.string(),
  mime_type: z.string(),
  file_size: z.number(),
  parsed_data: z.record(z.unknown()).nullable(),
  created_at: z.string().datetime(),
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
  raw_text: z.string().optional(),
}).openapi('ParsedReceiptData');

export const ReceiptUploadResponseSchema = z.object({
  receipt: ReceiptSchema,
  parsedData: ParsedReceiptDataSchema.optional(),
}).openapi('ReceiptUploadResponse');

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
