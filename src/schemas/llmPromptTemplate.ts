import { z } from '@hono/zod-openapi';
import { PaginationMetaSchema } from './common.js';

export const OutputFormatSchema = z.enum(['text', 'json', 'markdown', 'chart_config']);

export const LlmPromptTemplateSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  description: z.string().nullable(),
  systemPrompt: z.string().nullable(),
  userPromptTemplate: z.string(),
  requiredContext: z.array(z.string()).nullable(),
  outputFormat: OutputFormatSchema,
  preferredModel: z.string().nullable(),
  maxTokens: z.number(),
  temperature: z.string(), // DECIMAL as string
  version: z.number(),
  isActive: z.boolean(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
}).openapi('LlmPromptTemplate');

export const CreateLlmPromptTemplateSchema = z.object({
  name: z.string().min(1).max(100).openapi({ example: 'expense_anomaly_explanation' }),
  description: z.string().max(1000).optional().openapi({ example: 'Explains why an expense was flagged as anomalous' }),
  systemPrompt: z.string().max(10000).optional().openapi({ example: 'You are a helpful financial assistant.' }),
  userPromptTemplate: z.string().min(1).max(50000).openapi({
    example: 'Explain why this expense might be unusual: {{expense_description}} for ${{amount}} at {{merchant_name}}.'
  }),
  requiredContext: z.array(z.string()).optional().openapi({ example: ['expense_description', 'amount', 'merchant_name'] }),
  outputFormat: OutputFormatSchema.optional().openapi({ example: 'text' }),
  preferredModel: z.string().max(100).optional().openapi({ example: 'gpt-4' }),
  maxTokens: z.number().int().positive().max(100000).optional().openapi({ example: 1000 }),
  temperature: z.number().min(0).max(2).optional().openapi({ example: 0.3 }),
  isActive: z.boolean().optional().openapi({ example: true }),
}).openapi('CreateLlmPromptTemplate');

export const UpdateLlmPromptTemplateSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(1000).nullable().optional(),
  systemPrompt: z.string().max(10000).nullable().optional(),
  userPromptTemplate: z.string().min(1).max(50000).optional(),
  requiredContext: z.array(z.string()).nullable().optional(),
  outputFormat: OutputFormatSchema.optional(),
  preferredModel: z.string().max(100).nullable().optional(),
  maxTokens: z.number().int().positive().max(100000).optional(),
  temperature: z.number().min(0).max(2).optional(),
  isActive: z.boolean().optional(),
}).openapi('UpdateLlmPromptTemplate');

// Allowed sortBy values
export const LlmPromptTemplateSortBySchema = z.enum(['name', 'outputFormat', 'version', 'createdAt', 'updatedAt']);

export const LlmPromptTemplateListQuerySchema = z.object({
  page: z.string().regex(/^\d+$/).transform(Number).pipe(z.number().int().positive()).default('1'),
  limit: z.string().regex(/^\d+$/).transform(Number).pipe(z.number().int().positive().max(100)).default('20'),
  isActive: z.string().transform((v) => v === 'true').optional(),
  outputFormat: OutputFormatSchema.optional(),
  search: z.string().max(255).optional().openapi({ example: 'anomaly', description: 'Search in name, description' }),
  sortBy: LlmPromptTemplateSortBySchema.optional().openapi({ example: 'name', description: 'Field to sort by' }),
  sortOrder: z.enum(['asc', 'desc']).default('asc').openapi({ example: 'asc', description: 'Sort direction' }),
});

export const LlmPromptTemplateListResponseSchema = z.object({
  data: z.array(LlmPromptTemplateSchema),
  pagination: PaginationMetaSchema,
}).openapi('LlmPromptTemplateList');

// Template rendering schemas
export const RenderTemplateRequestSchema = z.object({
  context: z.record(z.unknown()).openapi({
    example: {
      expense_description: 'Dinner at expensive restaurant',
      amount: 450,
      merchant_name: 'The Capital Grille'
    }
  }),
}).openapi('RenderTemplateRequest');

export const RenderedTemplateSchema = z.object({
  template: LlmPromptTemplateSchema,
  rendered: z.object({
    systemPrompt: z.string().nullable(),
    userPrompt: z.string(),
  }),
}).openapi('RenderedTemplate');
