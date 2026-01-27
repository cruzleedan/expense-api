import { z } from 'zod';

// Workflow step schema
export const WorkflowStepSchema = z.object({
  step_number: z.number().int().positive(),
  name: z.string(),
  target_type: z.enum(['role', 'relationship', 'hybrid', 'system']),
  target_value: z.union([z.string(), z.object({ role: z.string(), relationship: z.string() })]),
  sla_hours: z.number().int().positive(),
  required: z.boolean().optional(),
  required_if: z.object({
    field: z.string(),
    condition: z.enum(['greater_than', 'less_than', 'equals', 'not_equals', 'in', 'not_in']),
    value: z.unknown(),
  }).optional(),
  skip_if: z.object({
    field: z.string(),
    condition: z.enum(['greater_than', 'less_than', 'equals', 'not_equals', 'in', 'not_in']),
    value: z.unknown(),
  }).optional(),
  escalation: z.object({
    enabled: z.boolean(),
    target_type: z.string(),
    target_value: z.string(),
    notify_at_hours: z.array(z.number()),
    auto_approve_after_hours: z.number().nullable().optional(),
  }).optional(),
}).openapi('WorkflowStep');

// Workflow conditions schema
export const WorkflowConditionsSchema = z.object({
  amount_min: z.number().optional(),
  amount_max: z.number().optional(),
  expense_categories: z.array(z.string()).optional(),
  departments: z.array(z.string()).optional(),
}).openapi('WorkflowConditions');

// Full workflow schema
export const WorkflowSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  description: z.string().nullable(),
  version: z.number().int(),
  is_active: z.boolean(),
  conditions: WorkflowConditionsSchema.nullable(),
  steps: z.array(WorkflowStepSchema),
  on_return_policy: z.enum(['hard_restart', 'soft_restart']),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
  created_by: z.string().uuid().nullable(),
}).openapi('Workflow');

// Request schemas
export const CreateWorkflowRequestSchema = z.object({
  name: z.string().min(2).max(255),
  description: z.string().max(1000).optional(),
  conditions: WorkflowConditionsSchema.optional(),
  steps: z.array(WorkflowStepSchema).min(1),
  on_return_policy: z.enum(['hard_restart', 'soft_restart']).default('hard_restart'),
}).openapi('CreateWorkflowRequest');

export const UpdateWorkflowRequestSchema = z.object({
  description: z.string().max(1000).optional(),
  conditions: WorkflowConditionsSchema.optional(),
  steps: z.array(WorkflowStepSchema).optional(),
  on_return_policy: z.enum(['hard_restart', 'soft_restart']).optional(),
}).openapi('UpdateWorkflowRequest');

// Approval action schemas
export const ApproveRequestSchema = z.object({
  comment: z.string().max(1000).optional(),
}).openapi('ApproveRequest');

export const RejectRequestSchema = z.object({
  comment: z.string().min(10).max(1000),
  rejection_category: z.enum([
    'missing_receipt',
    'policy_violation',
    'duplicate_expense',
    'insufficient_detail',
    'budget_unavailable',
    'other',
  ]).optional(),
}).openapi('RejectRequest');

export const ReturnRequestSchema = z.object({
  comment: z.string().min(10).max(1000),
}).openapi('ReturnRequest');

// Approval history schema
export const ApprovalHistorySchema = z.object({
  id: z.string().uuid(),
  report_id: z.string().uuid(),
  step_number: z.number().int(),
  step_name: z.string().nullable(),
  actor_id: z.string().uuid().nullable(),
  actor_email: z.string().nullable(),
  action: z.enum(['approve', 'reject', 'return', 'escalate', 'auto_approve']),
  comment: z.string().nullable(),
  rejection_category: z.string().nullable(),
  created_at: z.string().datetime(),
  sla_deadline: z.string().datetime().nullable(),
  was_escalated: z.boolean(),
}).openapi('ApprovalHistory');

// Response schemas
export const WorkflowListResponseSchema = z.object({
  workflows: z.array(WorkflowSchema),
  total: z.number(),
}).openapi('WorkflowListResponse');

export const WorkflowStatusResponseSchema = z.object({
  status: z.string(),
  current_step: z.number().int().nullable(),
  total_steps: z.number().int(),
  workflow: WorkflowSchema.nullable(),
  history: z.array(ApprovalHistorySchema),
}).openapi('WorkflowStatusResponse');

export const SubmitResponseSchema = z.object({
  success: z.boolean(),
  current_step: z.number().int(),
  workflow: WorkflowSchema,
}).openapi('SubmitResponse');

export const ApproveResponseSchema = z.object({
  success: z.boolean(),
  is_fully_approved: z.boolean(),
  next_step: z.number().int().optional(),
}).openapi('ApproveResponse');

export const ActionResponseSchema = z.object({
  success: z.boolean(),
}).openapi('ActionResponse');

// Path parameter schemas
export const WorkflowIdParamSchema = z.object({
  workflowId: z.string().uuid(),
}).openapi('WorkflowIdParam');

export const ReportIdParamSchema = z.object({
  reportId: z.string().uuid(),
}).openapi('ReportIdParam');
