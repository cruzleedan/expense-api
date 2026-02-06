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
  thumbnailUrl: z.string().url().optional().openapi({ description: 'Thumbnail URL for image receipts' }),
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

// Presigned URL schemas for S3 upload/download
export const RequestUploadUrlSchema = z.object({
  fileName: z.string().min(1).max(255).openapi({ example: 'receipt.pdf', description: 'Original file name' }),
  mimeType: z.string().openapi({ example: 'application/pdf', description: 'MIME type of the file' }),
  fileSize: z.number().int().positive().openapi({ example: 1024000, description: 'File size in bytes' }),
}).openapi('RequestUploadUrl');

export const UploadUrlResponseSchema = z.object({
  uploadUrl: z.string().url().openapi({ description: 'Presigned URL for uploading the file via PUT request' }),
  key: z.string().openapi({ description: 'Storage key to use when confirming the upload' }),
  expiresAt: z.string().datetime().openapi({ description: 'When the presigned URL expires' }),
}).openapi('UploadUrlResponse');

export const ConfirmUploadSchema = z.object({
  key: z.string().openapi({ description: 'Storage key returned from upload URL request' }),
  fileName: z.string().min(1).max(255).openapi({ example: 'receipt.pdf', description: 'Original file name' }),
  mimeType: z.string().openapi({ example: 'application/pdf', description: 'MIME type of the file' }),
  fileSize: z.number().int().positive().openapi({ example: 1024000, description: 'File size in bytes' }),
  fileHash: z.string().length(64).openapi({ description: 'SHA-256 hash of the file for deduplication' }),
  icr: z.boolean().optional().openapi({ description: 'Enable receipt parsing (ICR)' }),
}).openapi('ConfirmUpload');

export const DownloadUrlResponseSchema = z.object({
  downloadUrl: z.string().url().openapi({ description: 'Presigned URL for downloading the file' }),
  fileName: z.string().openapi({ description: 'Original file name' }),
  mimeType: z.string().openapi({ description: 'MIME type of the file' }),
  expiresAt: z.string().datetime().openapi({ description: 'When the presigned URL expires' }),
}).openapi('DownloadUrlResponse');

// Re-parse receipt schemas
export const ReparseErrorSchema = z.object({
  code: z.string().openapi({
    example: 'PARSE_TIMEOUT',
    description: 'Error code: PARSE_FAILED, PARSE_TIMEOUT, SERVICE_UNAVAILABLE, LOW_QUALITY, etc.'
  }),
  message: z.string().openapi({ example: 'Receipt parsing timed out' }),
}).openapi('ReparseError');

export const ReparseReceiptResponseSchema = z.object({
  success: z.boolean().openapi({ description: 'Whether parsing was successful' }),
  data: ParsedReceiptDataSchema.optional().openapi({ description: 'Parsed receipt data (if successful)' }),
  error: ReparseErrorSchema.optional().openapi({ description: 'Error details (if failed)' }),
  processingTimeMs: z.number().openapi({ description: 'Processing time in milliseconds', example: 1234 }),
}).openapi('ReparseReceiptResponse');
