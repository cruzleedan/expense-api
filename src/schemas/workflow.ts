import { z } from '@hono/zod-openapi';

// Workflow step schema
export const WorkflowStepSchema = z.object({
  stepNumber: z.number().int().positive(),
  name: z.string(),
  targetType: z.enum(['role', 'relationship', 'hybrid', 'system']),
  targetValue: z.union([z.string(), z.object({ role: z.string(), relationship: z.string() })]),
  slaHours: z.number().int().positive(),
  required: z.boolean().optional(),
  requiredIf: z.object({
    field: z.string(),
    condition: z.enum(['greater_than', 'less_than', 'equals', 'not_equals', 'in', 'not_in']),
    value: z.unknown(),
  }).optional(),
  skipIf: z.object({
    field: z.string(),
    condition: z.enum(['greater_than', 'less_than', 'equals', 'not_equals', 'in', 'not_in']),
    value: z.unknown(),
  }).optional(),
  escalation: z.object({
    enabled: z.boolean(),
    targetType: z.string(),
    targetValue: z.string(),
    notifyAtHours: z.array(z.number()),
    autoApproveAfterHours: z.number().nullable().optional(),
  }).optional(),
}).strict().openapi('WorkflowStep').superRefine((step, ctx) => {
  if (step.targetType === 'hybrid' && typeof step.targetValue === 'string') {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['targetValue'],
      message: 'Hybrid targets require both role and relationship values',
    });
  }
  if (step.targetType !== 'hybrid' && typeof step.targetValue !== 'string') {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['targetValue'],
      message: `${step.targetType} targets require a string value`,
    });
  }
  if (
    step.targetType === 'relationship'
    && typeof step.targetValue === 'string'
    && !['direct_manager', 'manager', 'manager_chain', 'department_head'].includes(step.targetValue)
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['targetValue'],
      message: 'Unsupported relationship target',
    });
  }
});

const WorkflowStepsInputSchema = z.array(WorkflowStepSchema).min(1).superRefine((steps, ctx) => {
  const seen = new Set<number>();
  for (const [index, step] of steps.entries()) {
    if (seen.has(step.stepNumber)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [index, 'stepNumber'],
        message: 'Workflow step numbers must be unique',
      });
    }
    seen.add(step.stepNumber);
  }
});

// Workflow conditions schema
export const WorkflowConditionsSchema = z.object({
  amountMin: z.number().optional(),
  amountMax: z.number().optional(),
  expenseCategories: z.array(z.string()).optional(),
  departments: z.array(z.string()).optional(),
}).openapi('WorkflowConditions');

// Full workflow schema
export const WorkflowSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  description: z.string().nullable(),
  version: z.number().int(),
  isActive: z.boolean(),
  conditions: WorkflowConditionsSchema.nullable(),
  steps: z.array(WorkflowStepSchema),
  onReturnPolicy: z.enum(['hard_restart', 'soft_restart']),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  createdBy: z.string().uuid().nullable(),
}).openapi('Workflow');

// Request schemas
export const CreateWorkflowRequestSchema = z.object({
  name: z.string().min(2).max(255),
  description: z.string().max(1000).optional(),
  conditions: WorkflowConditionsSchema.optional(),
  steps: WorkflowStepsInputSchema,
  onReturnPolicy: z.enum(['hard_restart', 'soft_restart']).default('hard_restart'),
}).strict().openapi('CreateWorkflowRequest');

export const UpdateWorkflowRequestSchema = z.object({
  description: z.string().max(1000).optional(),
  conditions: WorkflowConditionsSchema.optional(),
  steps: WorkflowStepsInputSchema.optional(),
  onReturnPolicy: z.enum(['hard_restart', 'soft_restart']).optional(),
}).strict().openapi('UpdateWorkflowRequest');

// Approval action schemas
export const ApproveRequestSchema = z.object({
  expectedVersion: z.number().int().positive(),
  comment: z.string().max(1000).optional(),
}).openapi('ApproveRequest');

export const RejectRequestSchema = z.object({
  expectedVersion: z.number().int().positive(),
  comment: z.string().min(10).max(1000),
  rejectionCategory: z.enum([
    'missing_receipt',
    'policy_violation',
    'duplicate_expense',
    'insufficient_detail',
    'budget_unavailable',
    'other',
  ]).optional(),
}).openapi('RejectRequest');

export const ReturnRequestSchema = z.object({
  expectedVersion: z.number().int().positive(),
  comment: z.string().min(10).max(1000),
}).openapi('ReturnRequest');

export const VersionedCommandRequestSchema = z.object({
  expectedVersion: z.number().int().positive(),
}).strict().openapi('VersionedCommandRequest');

export const PostReportRequestSchema = VersionedCommandRequestSchema.extend({
  postingReference: z.string().trim().min(1).max(255),
}).strict().openapi('PostReportRequest');

export const PayReportRequestSchema = VersionedCommandRequestSchema.extend({
  paymentReference: z.string().trim().min(1).max(255),
}).strict().openapi('PayReportRequest');

export const CorrectApprovedReportRequestSchema = VersionedCommandRequestSchema.extend({
  reason: z.string().trim().min(10).max(1000),
}).strict().openapi('CorrectApprovedReportRequest');

// Approval history schema
export const ApprovalHistorySchema = z.object({
  id: z.string().uuid(),
  reportId: z.string().uuid(),
  stepNumber: z.number().int(),
  stepName: z.string().nullable(),
  actorId: z.string().uuid().nullable(),
  actorEmail: z.string().nullable(),
  action: z.enum(['approve', 'reject', 'return', 'escalate', 'auto_approve']),
  comment: z.string().nullable(),
  rejectionCategory: z.string().nullable(),
  createdAt: z.string().datetime(),
  slaDeadline: z.string().datetime().nullable(),
  wasEscalated: z.boolean(),
}).openapi('ApprovalHistory');

// Response schemas
export const WorkflowListResponseSchema = z.object({
  workflows: z.array(WorkflowSchema),
  total: z.number(),
}).openapi('WorkflowListResponse');

export const WorkflowStatusResponseSchema = z.object({
  status: z.string(),
  currentStep: z.number().int().nullable(),
  totalSteps: z.number().int(),
  workflow: WorkflowSchema.nullable(),
  history: z.array(ApprovalHistorySchema),
}).openapi('WorkflowStatusResponse');

export const SubmitResponseSchema = z.object({
  success: z.boolean(),
  currentStep: z.number().int(),
  workflow: WorkflowSchema,
}).openapi('SubmitResponse');

export const ApproveResponseSchema = z.object({
  success: z.boolean(),
  isFullyApproved: z.boolean(),
  nextStep: z.number().int().optional(),
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

// Pending approvals schemas
export const PendingApprovalItemSchema = z.object({
  report_id: z.string().uuid(),
  title: z.string(),
  description: z.string().nullable(),
  status: z.string(),
  submitter_email: z.string(),
  amount: z.string(),
  currency: z.string(),
  report_date: z.string().nullable(),
  submitted_at: z.string().datetime(),
  project_name: z.string().nullable(),
  current_step: z.number().int().nullable(),
  total_steps: z.number().int(),
}).openapi('PendingApprovalItem');

export const PendingApprovalsResponseSchema = z.object({
  approvals: z.array(PendingApprovalItemSchema),
  total: z.number().int(),
}).openapi('PendingApprovalsResponse');
