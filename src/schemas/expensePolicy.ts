import { z } from '@hono/zod-openapi';
import { PaginationMetaSchema } from './common.js';

export const RuleTypeSchema = z.enum([
  'max_amount',
  'requires_receipt',
  'requires_approval',
  'time_limit',
  'category_restriction',
  'merchant_restriction',
  'frequency_limit',
  'custom'
]);

export const SeveritySchema = z.enum(['info', 'warning', 'hard_block']);

export const ExpensePolicySchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  code: z.string().nullable(),
  description: z.string(),
  appliesToCategories: z.array(z.string().uuid()).nullable(),
  appliesToDepartments: z.array(z.string().uuid()).nullable(),
  appliesToRoles: z.array(z.string()).nullable(),
  ruleType: RuleTypeSchema,
  ruleConfig: z.record(z.unknown()),
  violationMessage: z.string(),
  severity: SeveritySchema,
  isActive: z.boolean(),
  effectiveDate: z.string().nullable(),
  expiryDate: z.string().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  createdBy: z.string().uuid().nullable(),
}).openapi('ExpensePolicy');

export const CreateExpensePolicySchema = z.object({
  name: z.string().min(1).max(255).openapi({ example: 'Meal Expense Limit' }),
  code: z.string().max(50).optional().openapi({ example: 'MEAL-LIMIT' }),
  description: z.string().min(1).max(5000).openapi({ example: 'Limits individual meal expenses to $75' }),
  appliesToCategories: z.array(z.string().uuid()).optional().openapi({ description: 'Category IDs this policy applies to (null = all)' }),
  appliesToDepartments: z.array(z.string().uuid()).optional().openapi({ description: 'Department IDs this policy applies to (null = all)' }),
  appliesToRoles: z.array(z.string()).optional().openapi({ example: ['employee'], description: 'Role names this policy applies to (null = all)' }),
  ruleType: RuleTypeSchema.openapi({ example: 'max_amount' }),
  ruleConfig: z.record(z.unknown()).openapi({ example: { max_amount: 75, currency: 'USD' } }),
  violationMessage: z.string().min(1).max(1000).openapi({ example: 'Individual meals cannot exceed $75 per company policy' }),
  severity: SeveritySchema.optional().openapi({ example: 'warning' }),
  isActive: z.boolean().optional().openapi({ example: true }),
  effectiveDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().openapi({ example: '2026-01-01' }),
  expiryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().openapi({ example: '2026-12-31' }),
}).openapi('CreateExpensePolicy');

export const UpdateExpensePolicySchema = z.object({
  name: z.string().min(1).max(255).optional(),
  code: z.string().max(50).nullable().optional(),
  description: z.string().min(1).max(5000).optional(),
  appliesToCategories: z.array(z.string().uuid()).nullable().optional(),
  appliesToDepartments: z.array(z.string().uuid()).nullable().optional(),
  appliesToRoles: z.array(z.string()).nullable().optional(),
  ruleType: RuleTypeSchema.optional(),
  ruleConfig: z.record(z.unknown()).optional(),
  violationMessage: z.string().min(1).max(1000).optional(),
  severity: SeveritySchema.optional(),
  isActive: z.boolean().optional(),
  effectiveDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  expiryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
}).openapi('UpdateExpensePolicy');

// Allowed sortBy values for policies
export const ExpensePolicySortBySchema = z.enum(['name', 'code', 'ruleType', 'severity', 'effectiveDate', 'createdAt', 'updatedAt']);

export const ExpensePolicyListQuerySchema = z.object({
  page: z.string().regex(/^\d+$/).transform(Number).pipe(z.number().int().positive()).default('1'),
  limit: z.string().regex(/^\d+$/).transform(Number).pipe(z.number().int().positive().max(100)).default('20'),
  isActive: z.string().transform((v) => v === 'true').optional(),
  ruleType: RuleTypeSchema.optional(),
  severity: SeveritySchema.optional(),
  search: z.string().max(255).optional().openapi({ example: 'meal', description: 'Search in name, code, description' }),
  sortBy: ExpensePolicySortBySchema.optional().openapi({ example: 'name', description: 'Field to sort by' }),
  sortOrder: z.enum(['asc', 'desc']).default('asc').openapi({ example: 'asc', description: 'Sort direction' }),
});

export const ExpensePolicyListResponseSchema = z.object({
  data: z.array(ExpensePolicySchema),
  pagination: PaginationMetaSchema,
}).openapi('ExpensePolicyList');

// Policy check schemas
export const PolicyCheckContextSchema = z.object({
  categoryId: z.string().uuid().optional(),
  departmentId: z.string().uuid().optional(),
  userRoles: z.array(z.string()).optional(),
  amount: z.number().optional(),
  transactionDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  merchantName: z.string().optional(),
}).openapi('PolicyCheckContext');

export const PolicyViolationSchema = z.object({
  policyId: z.string().uuid(),
  policyName: z.string(),
  ruleType: RuleTypeSchema,
  severity: SeveritySchema,
  violationMessage: z.string(),
}).openapi('PolicyViolation');

export const PolicyCheckResponseSchema = z.object({
  violations: z.array(PolicyViolationSchema),
  hasHardBlock: z.boolean(),
}).openapi('PolicyCheckResponse');
