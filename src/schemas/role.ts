import { z } from 'zod';
import { PaginationMetaSchema } from './common.js';

// Role schemas
export const RoleSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  description: z.string().nullable(),
  isSystem: z.boolean(),
  isActive: z.boolean(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
}).openapi('Role');

export const RoleWithCountSchema = RoleSchema.extend({
  permissionCount: z.number(),
}).openapi('RoleWithCount');

export const PermissionSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  description: z.string().nullable(),
  category: z.string().nullable(),
  riskLevel: z.enum(['low', 'medium', 'high', 'critical']).nullable(),
  requiresMfa: z.boolean(),
  createdAt: z.string().datetime(),
}).openapi('Permission');

export const RoleWithPermissionsSchema = RoleSchema.extend({
  permissions: z.array(PermissionSchema),
}).openapi('RoleWithPermissions');

// Request schemas
export const CreateRoleRequestSchema = z.object({
  name: z.string().min(2).max(100).regex(/^[a-z_]+$/, 'Role name must be lowercase with underscores only'),
  description: z.string().max(500).optional(),
  permissionIds: z.array(z.string().uuid()).min(1, 'At least one permission is required'),
}).openapi('CreateRoleRequest');

export const UpdateRoleRequestSchema = z.object({
  description: z.string().max(500).optional(),
  permissionIds: z.array(z.string().uuid()).min(1, 'At least one permission is required'),
}).openapi('UpdateRoleRequest');

export const AssignRolesRequestSchema = z.object({
  roleIds: z.array(z.string().uuid()).min(1, 'At least one role is required'),
}).openapi('AssignRolesRequest');

export const AssignRoleRequestSchema = z.object({
  roleId: z.string().uuid(),
}).openapi('AssignRoleRequest');

// Response schemas
export const RoleListResponseSchema = z.object({
  roles: z.array(RoleWithCountSchema),
  pagination: PaginationMetaSchema,
}).openapi('RoleListResponse');

export const PermissionListResponseSchema = z.object({
  permissions: z.array(PermissionSchema),
  total: z.number(),
}).openapi('PermissionListResponse');

export const UserRolesResponseSchema = z.object({
  userId: z.string().uuid(),
  roles: z.array(RoleSchema),
}).openapi('UserRolesResponse');

export const SodValidationResultSchema = z.object({
  valid: z.boolean(),
  violations: z.array(z.object({
    ruleName: z.string(),
    description: z.string(),
    conflictingPermissions: z.array(z.string()),
  })),
}).openapi('SodValidationResult');

// Allowed sortBy values for roles
export const RoleSortBySchema = z.enum(['name', 'createdAt', 'updatedAt', 'permissionCount']);

// Role list query schema
export const RoleListQuerySchema = z.object({
  page: z.string().regex(/^\d+$/).transform(Number).pipe(z.number().int().positive()).default('1').openapi({ example: '1' }),
  limit: z.string().regex(/^\d+$/).transform(Number).pipe(z.number().int().positive().max(100)).default('20').openapi({ example: '20' }),
  search: z.string().max(255).optional().openapi({ example: 'admin', description: 'Search in name and description' }),
  sortBy: RoleSortBySchema.optional().openapi({ example: 'name', description: 'Field to sort by' }),
  sortOrder: z.enum(['asc', 'desc']).default('asc').openapi({ example: 'asc', description: 'Sort direction' }),
});

// Path parameter schemas
export const RoleIdParamSchema = z.object({
  roleId: z.string().uuid(),
}).openapi('RoleIdParam');

export const UserIdParamSchema = z.object({
  userId: z.string().uuid(),
}).openapi('UserIdParam');

export const PermissionCategoryParamSchema = z.object({
  category: z.string(),
}).openapi('PermissionCategoryParam');
