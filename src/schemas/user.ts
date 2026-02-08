import { z } from '@hono/zod-openapi';
import { PaginationMetaSchema } from './common.js';

export const UserRoleSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  description: z.string().nullable(),
  isSystem: z.boolean(),
  assignedAt: z.string().datetime(),
}).openapi('UserRole');

export const UserStatusSchema = z.enum(['active', 'inactive', 'locked', 'pending_verification']).openapi('UserStatus');

export const UserSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  username: z.string().nullable(),
  firstName: z.string().nullable(),
  lastName: z.string().nullable(),
  status: UserStatusSchema,
  isActive: z.boolean(),
  departmentId: z.string().uuid().nullable(),
  managerId: z.string().uuid().nullable(),
  costCenter: z.string().nullable(),
  // v5.0 fields
  spendingProfile: z.record(z.unknown()).nullable(),
  llmPreferences: z.record(z.unknown()).nullable(),
  lastLoginAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
}).openapi('User');

export const UserWithRolesSchema = UserSchema.extend({
  roles: z.array(UserRoleSchema),
}).openapi('UserWithRoles');

export const CreateUserSchema = z.object({
  email: z.string().email().openapi({ example: 'user@example.com' }),
  username: z.string().min(1).max(255).optional().openapi({ example: 'johndoe' }),
  firstName: z.string().max(100).optional().openapi({ example: 'John' }),
  lastName: z.string().max(100).optional().openapi({ example: 'Doe' }),
  password: z.string().min(8).max(128).openapi({ example: 'SecureP@ss123' }),
  departmentId: z.string().uuid().optional(),
  managerId: z.string().uuid().optional(),
  costCenter: z.string().max(50).optional(),
  // v5.0 fields
  spendingProfile: z.record(z.unknown()).optional().openapi({ example: { avg_monthly: 1500, top_categories: ['Travel', 'Meals'] } }),
  llmPreferences: z.record(z.unknown()).optional().openapi({ example: { default_currency: 'USD', dashboard_widgets: ['spending_trend'] } }),
}).openapi('CreateUser');

export const UpdateUserSchema = z.object({
  email: z.string().email().optional(),
  username: z.string().min(1).max(255).optional(),
  firstName: z.string().max(100).nullable().optional(),
  lastName: z.string().max(100).nullable().optional(),
  isActive: z.boolean().optional(),
  departmentId: z.string().uuid().nullable().optional(),
  managerId: z.string().uuid().nullable().optional(),
  costCenter: z.string().max(50).nullable().optional(),
  // v5.0 fields
  spendingProfile: z.record(z.unknown()).nullable().optional(),
  llmPreferences: z.record(z.unknown()).nullable().optional(),
}).openapi('UpdateUser');

// Allowed sortBy values for users
export const UserSortBySchema = z.enum(['email', 'username', 'firstName', 'lastName', 'createdAt', 'updatedAt', 'lastLoginAt']);

export const UserListQuerySchema = z.object({
  page: z.string().regex(/^\d+$/).transform(Number).pipe(z.number().int().positive()).default('1'),
  limit: z.string().regex(/^\d+$/).transform(Number).pipe(z.number().int().positive().max(100)).default('20'),
  isActive: z.string().transform((v) => v === 'true').optional(),
  departmentId: z.string().uuid().optional(),
  search: z.string().max(255).optional().openapi({ example: 'john', description: 'Search in email, username, first name, last name' }),
  sortBy: UserSortBySchema.optional().openapi({ example: 'email', description: 'Field to sort by' }),
  sortOrder: z.enum(['asc', 'desc']).default('asc').openapi({ example: 'asc', description: 'Sort direction' }),
});

export const UserListResponseSchema = z.object({
  data: z.array(UserWithRolesSchema),
  pagination: PaginationMetaSchema,
}).openapi('UserList');

export const UserRolesListSchema = z.object({
  roles: z.array(UserRoleSchema),
}).openapi('UserRolesList');

export const AssignUserRolesSchema = z.object({
  roleIds: z.array(z.string().uuid()).min(1, 'At least one role is required'),
}).openapi('AssignUserRoles');

export const AddUserRoleSchema = z.object({
  roleId: z.string().uuid(),
}).openapi('AddUserRole');
