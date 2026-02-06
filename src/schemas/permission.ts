import { z } from '@hono/zod-openapi';
import { PaginationMetaSchema } from './common.js';

// Permission risk levels
export const PermissionRiskLevelSchema = z.enum(['low', 'medium', 'high', 'critical']);

// Permission schema (response)
export const PermissionSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  description: z.string().nullable(),
  category: z.string().nullable(),
  riskLevel: PermissionRiskLevelSchema.nullable(),
  requiresMfa: z.boolean(),
  createdAt: z.string().datetime(),
}).openapi('Permission');

// Create permission request
export const CreatePermissionSchema = z.object({
  name: z.string()
    .min(3)
    .max(255)
    .regex(/^[a-z][a-z0-9_.]*$/, 'Permission name must start with lowercase letter and contain only lowercase letters, numbers, dots, and underscores')
    .openapi({ example: 'report.view.custom' }),
  description: z.string().max(1000).optional().openapi({ example: 'View custom reports' }),
  category: z.string().max(100).optional().openapi({ example: 'report' }),
  riskLevel: PermissionRiskLevelSchema.optional().openapi({ example: 'low' }),
  requiresMfa: z.boolean().optional().default(false).openapi({ example: false }),
}).openapi('CreatePermission');

// Update permission request
export const UpdatePermissionSchema = z.object({
  description: z.string().max(1000).optional(),
  category: z.string().max(100).optional(),
  riskLevel: PermissionRiskLevelSchema.nullable().optional(),
  requiresMfa: z.boolean().optional(),
}).openapi('UpdatePermission');

// Permission list query schema
export const PermissionSortBySchema = z.enum(['name', 'category', 'riskLevel', 'createdAt']);

export const PermissionListQuerySchema = z.object({
  page: z.string().regex(/^\d+$/).transform(Number).pipe(z.number().int().positive()).default('1').openapi({ example: '1' }),
  limit: z.string().regex(/^\d+$/).transform(Number).pipe(z.number().int().positive().max(100)).default('20').openapi({ example: '20' }),
  search: z.string().max(255).optional().openapi({ example: 'report', description: 'Search in name and description' }),
  category: z.string().max(100).optional().openapi({ example: 'report', description: 'Filter by category' }),
  riskLevel: PermissionRiskLevelSchema.optional().openapi({ example: 'high', description: 'Filter by risk level' }),
  sortBy: PermissionSortBySchema.optional().openapi({ example: 'name', description: 'Field to sort by' }),
  sortOrder: z.enum(['asc', 'desc']).default('asc').openapi({ example: 'asc', description: 'Sort direction' }),
});

// Permission list response
export const PermissionListResponseSchema = z.object({
  data: z.array(PermissionSchema),
  pagination: PaginationMetaSchema,
}).openapi('PermissionList');

// Permission ID param
export const PermissionIdParamSchema = z.object({
  permissionId: z.string().uuid(),
}).openapi('PermissionIdParam');
