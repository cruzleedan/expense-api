import { z } from '@hono/zod-openapi';
import { PaginationMetaSchema } from './common.js';

export const ExpenseLineSchema = z.object({
  id: z.string().uuid(),
  reportId: z.string().uuid(),
  description: z.string(),
  amount: z.string(), // DECIMAL comes as string from pg
  currency: z.string(),
  category: z.string().nullable(),
  categoryCode: z.string().nullable(),
  expenseDate: z.string(),
  // v5.0 fields
  merchantName: z.string().nullable(),
  locationCity: z.string().nullable(),
  locationCountry: z.string().nullable(),
  paymentMethod: z.string().nullable(),
  projectId: z.string().uuid().nullable(),
  projectName: z.string().nullable(),
  clientName: z.string().nullable(),
  tags: z.array(z.string()).nullable(),
  isRecurring: z.boolean(),
  recurrencePattern: z.string().nullable(),
  recurrenceMerchant: z.string().nullable(),
  isAnomaly: z.boolean(),
  anomalyScore: z.number().nullable(),
  anomalyReasons: z.array(z.string()).nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
}).openapi('ExpenseLine');

export const CreateExpenseLineSchema = z.object({
  description: z.string().min(1).max(255).openapi({ example: 'Flight to NYC' }),
  amount: z.number().optional().openapi({ example: 450.00 }),
  currency: z.string().length(3).default('USD').openapi({ example: 'USD' }),
  categoryCode: z.string().max(100).nullable().optional().openapi({ example: 'Travel' }),
  transactionDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).openapi({ example: '2024-01-15' }),
  // v5.0 fields
  merchantName: z.string().max(255).optional().openapi({ example: 'Delta Airlines' }),
  locationCity: z.string().max(100).optional().openapi({ example: 'New York' }),
  locationCountry: z.string().max(100).optional().openapi({ example: 'USA' }),
  paymentMethod: z.enum(['corporate_card', 'personal_card', 'cash', 'bank_transfer', 'mobile_pay', 'other']).optional().openapi({ example: 'corporate_card' }),
  projectId: z.string().uuid().optional().openapi({ example: '00000000-0000-4000-d001-000000000001' }),
  projectName: z.string().max(255).optional().openapi({ example: 'Project Alpha' }),
  clientName: z.string().max(255).optional().openapi({ example: 'Acme Corporation' }),
  tags: z.array(z.string().max(50)).max(20).optional().openapi({ example: ['travel', 'billable'] }),
  isRecurring: z.boolean().optional().openapi({ example: false }),
  recurrencePattern: z.string().max(50).optional().openapi({ example: 'monthly' }),
  recurrenceMerchant: z.string().max(255).optional().openapi({ example: 'Netflix' }),
}).openapi('CreateExpenseLine');

export const UpdateExpenseLineSchema = z.object({
  description: z.string().min(1).max(255).optional(),
  amount: z.number().optional(),
  currency: z.string().length(3).optional(),
  categoryCode: z.string().max(100).optional(),
  transactionDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  // v5.0 fields
  merchantName: z.string().max(255).nullable().optional(),
  locationCity: z.string().max(100).nullable().optional(),
  locationCountry: z.string().max(100).nullable().optional(),
  paymentMethod: z.enum(['corporate_card', 'personal_card', 'cash', 'bank_transfer', 'mobile_pay', 'other']).nullable().optional(),
  projectId: z.string().uuid().nullable().optional(),
  projectName: z.string().max(255).nullable().optional(),
  clientName: z.string().max(255).nullable().optional(),
  tags: z.array(z.string().max(50)).max(20).nullable().optional(),
  isRecurring: z.boolean().optional(),
  recurrencePattern: z.string().max(50).nullable().optional(),
  recurrenceMerchant: z.string().max(255).nullable().optional(),
}).openapi('UpdateExpenseLine');

// Allowed sortBy values for expense lines
export const ExpenseLineSortBySchema = z.enum(['description', 'amount', 'expenseDate', 'category', 'createdAt']);

export const ExpenseLineListQuerySchema = z.object({
  page: z.string().regex(/^\d+$/).transform(Number).pipe(z.number().int().positive()).default('1').openapi({ example: '1' }),
  limit: z.string().regex(/^\d+$/).transform(Number).pipe(z.number().int().positive().max(100)).default('20').openapi({ example: '20' }),
  search: z.string().max(255).optional().openapi({ example: 'flight', description: 'Search in description and category' }),
  sortBy: ExpenseLineSortBySchema.optional().openapi({ example: 'expenseDate', description: 'Field to sort by' }),
  sortOrder: z.enum(['asc', 'desc']).default('asc').openapi({ example: 'desc', description: 'Sort direction' }),
});

export const ExpenseLineListResponseSchema = z.object({
  data: z.array(ExpenseLineSchema),
  pagination: PaginationMetaSchema,
}).openapi('ExpenseLineList');

// Bulk create schemas
export const BulkCreateExpenseLineItemSchema = z.object({
  description: z.string().min(1).max(200).openapi({ example: 'Office Supplies - Staples' }),
  transactionDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).openapi({ example: '2026-02-01' }),
  amount: z.number().positive().openapi({ example: 45.67 }),
  currency: z.string().length(3).optional().openapi({ example: 'USD' }),
  categoryCode: z.string().max(100).nullable().optional().openapi({ example: 'OFFICE' }),
  receiptId: z.string().uuid().optional().openapi({
    example: 'rcpt_xyz789',
    description: 'Optional receipt ID for automatic association'
  }),
  // v5.0 fields
  merchantName: z.string().max(255).optional().openapi({ example: 'Staples' }),
  locationCity: z.string().max(100).optional().openapi({ example: 'San Francisco' }),
  locationCountry: z.string().max(100).optional().openapi({ example: 'USA' }),
  paymentMethod: z.enum(['corporate_card', 'personal_card', 'cash', 'bank_transfer', 'mobile_pay', 'other']).optional().openapi({ example: 'corporate_card' }),
  projectId: z.string().uuid().optional(),
  projectName: z.string().max(255).optional(),
  clientName: z.string().max(255).optional(),
  tags: z.array(z.string().max(50)).max(20).optional(),
  isRecurring: z.boolean().optional(),
  recurrencePattern: z.string().max(50).optional(),
  recurrenceMerchant: z.string().max(255).optional(),
}).openapi('BulkCreateExpenseLineItem');

export const BulkCreateExpenseLineSchema = z.object({
  lines: z.array(BulkCreateExpenseLineItemSchema).min(1).max(100).openapi({
    description: 'Array of expense lines to create (max 100)'
  }),
}).openapi('BulkCreateExpenseLine');

export const BulkCreateFailedItemSchema = z.object({
  index: z.number().int().openapi({ example: 0, description: 'Index of the failed line in the request' }),
  error: z.string().openapi({ example: 'Invalid amount', description: 'Error message' }),
}).openapi('BulkCreateFailedItem');

export const BulkCreateExpenseLineResponseSchema = z.object({
  created: z.array(ExpenseLineSchema).openapi({ description: 'Successfully created expense lines' }),
  failed: z.array(BulkCreateFailedItemSchema).openapi({ description: 'Failed expense lines' }),
}).openapi('BulkCreateExpenseLineResponse');
