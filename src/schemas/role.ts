import { z } from 'zod';

// Role schemas
export const RoleSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  description: z.string().nullable(),
  is_system: z.boolean(),
  is_active: z.boolean(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
}).openapi('Role');

export const PermissionSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  description: z.string().nullable(),
  category: z.string().nullable(),
  risk_level: z.enum(['low', 'medium', 'high', 'critical']).nullable(),
  requires_mfa: z.boolean(),
  created_at: z.string().datetime(),
}).openapi('Permission');

export const RoleWithPermissionsSchema = RoleSchema.extend({
  permissions: z.array(PermissionSchema),
}).openapi('RoleWithPermissions');

// Request schemas
export const CreateRoleRequestSchema = z.object({
  name: z.string().min(2).max(100).regex(/^[a-z_]+$/, 'Role name must be lowercase with underscores only'),
  description: z.string().max(500).optional(),
  permission_ids: z.array(z.string().uuid()).min(1, 'At least one permission is required'),
}).openapi('CreateRoleRequest');

export const UpdateRoleRequestSchema = z.object({
  description: z.string().max(500).optional(),
  permission_ids: z.array(z.string().uuid()).min(1, 'At least one permission is required'),
}).openapi('UpdateRoleRequest');

export const AssignRolesRequestSchema = z.object({
  role_ids: z.array(z.string().uuid()).min(1, 'At least one role is required'),
}).openapi('AssignRolesRequest');

export const AssignRoleRequestSchema = z.object({
  role_id: z.string().uuid(),
}).openapi('AssignRoleRequest');

// Response schemas
export const RoleListResponseSchema = z.object({
  roles: z.array(RoleSchema),
  total: z.number(),
}).openapi('RoleListResponse');

export const PermissionListResponseSchema = z.object({
  permissions: z.array(PermissionSchema),
  total: z.number(),
}).openapi('PermissionListResponse');

export const UserRolesResponseSchema = z.object({
  user_id: z.string().uuid(),
  roles: z.array(RoleSchema),
}).openapi('UserRolesResponse');

export const SodValidationResultSchema = z.object({
  valid: z.boolean(),
  violations: z.array(z.object({
    rule_name: z.string(),
    description: z.string(),
    conflicting_permissions: z.array(z.string()),
  })),
}).openapi('SodValidationResult');

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
