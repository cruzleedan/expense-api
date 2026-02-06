import { z } from '@hono/zod-openapi';
import { PaginationMetaSchema } from './common.js';

export const ProjectStatusSchema = z.enum(['active', 'on_hold', 'completed', 'cancelled']);

export const ProjectSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  code: z.string().nullable(),
  description: z.string().nullable(),
  clientName: z.string().nullable(),
  clientCode: z.string().nullable(),
  clientIndustry: z.string().nullable(),
  clientContactEmail: z.string().email().nullable(),
  departmentId: z.string().uuid().nullable(),
  ownerUserId: z.string().uuid().nullable(),
  status: ProjectStatusSchema,
  budgetAmount: z.string().nullable(), // DECIMAL comes as string from pg
  budgetCurrency: z.string(),
  spentAmount: z.string(),
  remainingAmount: z.string().nullable(),
  utilizationPct: z.string().nullable(),
  startDate: z.string().nullable(),
  endDate: z.string().nullable(),
  tags: z.array(z.string()).nullable(),
  fullPath: z.string().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
}).openapi('Project');

export const CreateProjectSchema = z.object({
  name: z.string().min(1).max(255).openapi({ example: 'Project Alpha' }),
  code: z.string().max(50).optional().openapi({ example: 'PROJ-001' }),
  description: z.string().max(5000).optional().openapi({ example: 'Enterprise deployment project' }),
  clientName: z.string().max(255).optional().openapi({ example: 'Acme Corporation' }),
  clientCode: z.string().max(50).optional().openapi({ example: 'ACME' }),
  clientIndustry: z.string().max(100).optional().openapi({ example: 'Technology' }),
  clientContactEmail: z.string().email().optional().openapi({ example: 'contact@acme.com' }),
  departmentId: z.string().uuid().optional(),
  ownerUserId: z.string().uuid().optional(),
  status: ProjectStatusSchema.optional().openapi({ example: 'active' }),
  budgetAmount: z.number().positive().optional().openapi({ example: 50000 }),
  budgetCurrency: z.string().length(3).optional().openapi({ example: 'USD' }),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().openapi({ example: '2026-01-01' }),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().openapi({ example: '2026-12-31' }),
  tags: z.array(z.string().max(50)).max(20).optional().openapi({ example: ['billable', 'high-priority'] }),
}).openapi('CreateProject');

export const UpdateProjectSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  code: z.string().max(50).nullable().optional(),
  description: z.string().max(5000).nullable().optional(),
  clientName: z.string().max(255).nullable().optional(),
  clientCode: z.string().max(50).nullable().optional(),
  clientIndustry: z.string().max(100).nullable().optional(),
  clientContactEmail: z.string().email().nullable().optional(),
  departmentId: z.string().uuid().nullable().optional(),
  ownerUserId: z.string().uuid().nullable().optional(),
  status: ProjectStatusSchema.optional(),
  budgetAmount: z.number().positive().nullable().optional(),
  budgetCurrency: z.string().length(3).optional(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  tags: z.array(z.string().max(50)).max(20).nullable().optional(),
}).openapi('UpdateProject');

// Allowed sortBy values for projects
export const ProjectSortBySchema = z.enum(['name', 'code', 'status', 'budgetAmount', 'spentAmount', 'startDate', 'endDate', 'createdAt', 'updatedAt']);

export const ProjectListQuerySchema = z.object({
  page: z.string().regex(/^\d+$/).transform(Number).pipe(z.number().int().positive()).default('1'),
  limit: z.string().regex(/^\d+$/).transform(Number).pipe(z.number().int().positive().max(100)).default('20'),
  status: ProjectStatusSchema.optional(),
  departmentId: z.string().uuid().optional(),
  ownerUserId: z.string().uuid().optional(),
  clientName: z.string().max(255).optional().openapi({ description: 'Filter by client name (partial match)' }),
  search: z.string().max(255).optional().openapi({ example: 'alpha', description: 'Search in name, code, description, client name' }),
  sortBy: ProjectSortBySchema.optional().openapi({ example: 'name', description: 'Field to sort by' }),
  sortOrder: z.enum(['asc', 'desc']).default('asc').openapi({ example: 'asc', description: 'Sort direction' }),
});

export const ProjectListResponseSchema = z.object({
  data: z.array(ProjectSchema),
  pagination: PaginationMetaSchema,
}).openapi('ProjectList');

export const ProjectBudgetSummarySchema = z.object({
  project: ProjectSchema,
  expenseCount: z.number(),
  reportCount: z.number(),
  categoryBreakdown: z.record(z.string(), z.number()),
}).openapi('ProjectBudgetSummary');
