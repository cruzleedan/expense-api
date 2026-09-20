import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import type { RouteHandler } from '@hono/zod-openapi';
import { authMiddleware, getUserId } from '../middleware/auth.js';
import { requireAnyPermission, requirePermission, getAuthUser } from '../middleware/permission.js';
import {
  getAllWorkflows,
  getWorkflowById,
  createWorkflow,
  updateWorkflow,
  submitReport,
  approveReport,
  rejectReport,
  returnReport,
  withdrawReport,
  reviseReport,
  correctApprovedReport,
  postReport,
  payReport,
  getReportWorkflowStatus,
} from '../services/workflow.service.js';
import { getPendingApprovalsForUser } from '../services/approval.service.js';
import { NotFoundError } from '../types/index.js';
import type { WorkflowDefinition, WorkflowStep, ApprovalHistory } from '../types/index.js';
import {
  WorkflowSchema,
  WorkflowListResponseSchema,
  WorkflowStatusResponseSchema,
  CreateWorkflowRequestSchema,
  UpdateWorkflowRequestSchema,
  ApproveRequestSchema,
  RejectRequestSchema,
  ReturnRequestSchema,
  SubmitResponseSchema,
  ApproveResponseSchema,
  ActionResponseSchema,
  WorkflowIdParamSchema,
  ReportIdParamSchema,
  PendingApprovalsResponseSchema,
  VersionedCommandRequestSchema,
  PostReportRequestSchema,
  PayReportRequestSchema,
  CorrectApprovedReportRequestSchema,
} from '../schemas/workflow.js';
import { ErrorSchema } from '../schemas/common.js';

const workflowRouter = new OpenAPIHono();

// All routes require authentication
workflowRouter.use('*', authMiddleware);

// Map snake_case DB WorkflowStep to camelCase schema shape
function mapStep(s: WorkflowStep) {
  return {
    stepNumber: s.step_number,
    name: s.name,
    targetType: s.target_type,
    targetValue: s.target_value,
    slaHours: s.sla_hours,
    required: s.required,
    requiredIf: s.required_if,
    skipIf: s.skip_if,
    escalation: s.escalation ? {
      enabled: s.escalation.enabled,
      targetType: s.escalation.target_type,
      targetValue: s.escalation.target_value,
      notifyAtHours: s.escalation.notify_at_hours,
      autoApproveAfterHours: s.escalation.auto_approve_after_hours,
    } : undefined,
  };
}

// Map snake_case DB WorkflowConditions to camelCase
function mapConditions(c: WorkflowDefinition['conditions']) {
  if (!c) return null;
  return {
    amountMin: c.amount_min,
    amountMax: c.amount_max,
    expenseCategories: c.expense_categories,
    departments: c.departments,
  };
}

// Map DB WorkflowDefinition to camelCase response shape
function mapWorkflow(w: WorkflowDefinition) {
  const isoDate = (value: Date | string | undefined): string =>
    new Date(value ?? 0).toISOString();
  return {
    id: w.id,
    name: w.name,
    description: w.description ?? null,
    version: w.version,
    isActive: w.is_active ?? true,
    conditions: mapConditions(w.conditions ?? null),
    steps: w.steps.map(mapStep),
    onReturnPolicy: w.on_return_policy,
    createdAt: isoDate(w.created_at),
    updatedAt: isoDate(w.updated_at),
    createdBy: w.created_by ?? null,
  };
}

// Map DB ApprovalHistory to camelCase response shape
function mapHistory(h: ApprovalHistory) {
  return {
    id: h.id,
    reportId: h.report_id,
    stepNumber: h.step_number,
    stepName: h.step_name,
    actorId: h.actor_id,
    actorEmail: h.actor_email,
    action: h.action,
    comment: h.comment,
    rejectionCategory: h.rejection_category,
    createdAt: h.created_at.toISOString(),
    slaDeadline: h.sla_deadline?.toISOString() ?? null,
    wasEscalated: h.was_escalated,
  };
}

// ============================================================================
// WORKFLOW DEFINITION ROUTES (Admin)
// ============================================================================

// List all workflows
const listWorkflowsRoute = createRoute({
  method: 'get',
  path: '/definitions',
  tags: ['Workflows'],
  summary: 'List all workflows',
  description: 'Get all active workflow definitions',
  security: [{ bearerAuth: [] }],
  middleware: [requirePermission('workflow.view')] as const,
  responses: {
    200: {
      description: 'List of workflows',
      content: { 'application/json': { schema: WorkflowListResponseSchema } },
    },
  },
});

const listWorkflowsHandler: RouteHandler<typeof listWorkflowsRoute> = async (c) => {
  const workflows = await getAllWorkflows();
  return c.json({
    workflows: workflows.map(mapWorkflow),
    total: workflows.length,
  } as any, 200);
};
workflowRouter.openapi(listWorkflowsRoute, listWorkflowsHandler);

// Get workflow by ID
const getWorkflowRoute = createRoute({
  method: 'get',
  path: '/definitions/{workflowId}',
  tags: ['Workflows'],
  summary: 'Get workflow details',
  description: 'Get a workflow definition by ID',
  security: [{ bearerAuth: [] }],
  middleware: [requirePermission('workflow.view')] as const,
  request: {
    params: WorkflowIdParamSchema,
  },
  responses: {
    200: {
      description: 'Workflow details',
      content: { 'application/json': { schema: WorkflowSchema } },
    },
    404: {
      description: 'Workflow not found',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
});

const getWorkflowHandler: RouteHandler<typeof getWorkflowRoute> = async (c) => {
  const { workflowId } = c.req.valid('param');
  const workflow = await getWorkflowById(workflowId);

  if (!workflow) {
    throw new NotFoundError('Workflow');
  }

  return c.json(mapWorkflow(workflow) as any, 200);
};
workflowRouter.openapi(getWorkflowRoute, getWorkflowHandler);

// Create workflow
const createWorkflowRoute = createRoute({
  method: 'post',
  path: '/definitions',
  tags: ['Workflows'],
  summary: 'Create a new workflow',
  description: 'Create a new approval workflow definition',
  security: [{ bearerAuth: [] }],
  middleware: [requirePermission('workflow.create')] as const,
  request: {
    body: {
      content: { 'application/json': { schema: CreateWorkflowRequestSchema } },
    },
  },
  responses: {
    201: {
      description: 'Workflow created',
      content: { 'application/json': { schema: WorkflowSchema } },
    },
    400: {
      description: 'Validation error',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
});

const createWorkflowHandler: RouteHandler<typeof createWorkflowRoute> = async (c) => {
  const body = c.req.valid('json') as z.infer<typeof CreateWorkflowRequestSchema>;
  const userId = getUserId(c);

  // Map camelCase steps from request to snake_case WorkflowStep for service
  const steps = body.steps.map(s => ({
    step_number: s.stepNumber,
    name: s.name,
    target_type: s.targetType,
    target_value: s.targetValue,
    sla_hours: s.slaHours,
    required: s.required,
    required_if: s.requiredIf,
    skip_if: s.skipIf,
    escalation: s.escalation ? {
      enabled: s.escalation.enabled,
      target_type: s.escalation.targetType,
      target_value: s.escalation.targetValue,
      notify_at_hours: s.escalation.notifyAtHours,
      auto_approve_after_hours: s.escalation.autoApproveAfterHours,
    } : undefined,
  })) as WorkflowStep[];

  const workflow = await createWorkflow(
    body.name,
    body.description || null,
    body.conditions ? {
      amount_min: body.conditions.amountMin,
      amount_max: body.conditions.amountMax,
      expense_categories: body.conditions.expenseCategories,
      departments: body.conditions.departments,
    } : null,
    steps,
    body.onReturnPolicy,
    userId
  );

  return c.json(mapWorkflow(workflow) as any, 201);
};
workflowRouter.openapi(createWorkflowRoute, createWorkflowHandler);

// Update workflow
const updateWorkflowRoute = createRoute({
  method: 'put',
  path: '/definitions/{workflowId}',
  tags: ['Workflows'],
  summary: 'Update a workflow',
  description: 'Update an existing workflow definition (creates new version)',
  security: [{ bearerAuth: [] }],
  middleware: [requirePermission('workflow.edit')] as const,
  request: {
    params: WorkflowIdParamSchema,
    body: {
      content: { 'application/json': { schema: UpdateWorkflowRequestSchema } },
    },
  },
  responses: {
    200: {
      description: 'Workflow updated',
      content: { 'application/json': { schema: WorkflowSchema } },
    },
    404: {
      description: 'Workflow not found',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
});

const updateWorkflowHandler: RouteHandler<typeof updateWorkflowRoute> = async (c) => {
  const { workflowId } = c.req.valid('param');
  const body = c.req.valid('json') as z.infer<typeof UpdateWorkflowRequestSchema>;
  const userId = getUserId(c);

  const steps = body.steps?.map(s => ({
    step_number: s.stepNumber,
    name: s.name,
    target_type: s.targetType,
    target_value: s.targetValue,
    sla_hours: s.slaHours,
    required: s.required,
    required_if: s.requiredIf,
    skip_if: s.skipIf,
    escalation: s.escalation ? {
      enabled: s.escalation.enabled,
      target_type: s.escalation.targetType,
      target_value: s.escalation.targetValue,
      notify_at_hours: s.escalation.notifyAtHours,
      auto_approve_after_hours: s.escalation.autoApproveAfterHours,
    } : undefined,
  })) as WorkflowStep[] | undefined;

  const workflow = await updateWorkflow(workflowId, {
    description: body.description,
    conditions: body.conditions ? {
      amount_min: body.conditions.amountMin,
      amount_max: body.conditions.amountMax,
      expense_categories: body.conditions.expenseCategories,
      departments: body.conditions.departments,
    } : undefined,
    steps,
    onReturnPolicy: body.onReturnPolicy,
  }, userId);

  return c.json(mapWorkflow(workflow) as any, 200);
};
workflowRouter.openapi(updateWorkflowRoute, updateWorkflowHandler);

// ============================================================================
// REPORT WORKFLOW ACTION ROUTES
// ============================================================================

// Submit report for approval
const submitReportRoute = createRoute({
  method: 'post',
  path: '/reports/{reportId}/submit',
  tags: ['Report Workflow'],
  summary: 'Submit report for approval',
  description: 'Submit an expense report for workflow approval',
  security: [{ bearerAuth: [] }],
  middleware: [requirePermission('report.submit')] as const,
  request: {
    params: ReportIdParamSchema,
    body: {
      content: { 'application/json': { schema: VersionedCommandRequestSchema } },
    },
  },
  responses: {
    200: {
      description: 'Report submitted',
      content: { 'application/json': { schema: SubmitResponseSchema } },
    },
    400: {
      description: 'Validation error',
      content: { 'application/json': { schema: ErrorSchema } },
    },
    403: {
      description: 'Forbidden',
      content: { 'application/json': { schema: ErrorSchema } },
    },
    404: {
      description: 'Report not found',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
});

const submitReportHandler: RouteHandler<typeof submitReportRoute> = async (c) => {
  const { reportId } = c.req.valid('param');
  const { expectedVersion } = c.req.valid('json');
  const userId = getUserId(c);

  const result = await submitReport(reportId, userId, expectedVersion);

  return c.json({
    success: result.success,
    currentStep: result.currentStep,
    workflow: mapWorkflow(result.workflow),
  } as any, 200);
};
workflowRouter.openapi(submitReportRoute, submitReportHandler);

// Approve report
const approveReportRoute = createRoute({
  method: 'post',
  path: '/reports/{reportId}/approve',
  tags: ['Report Workflow'],
  summary: 'Approve report',
  description: 'Approve an expense report at the current workflow step',
  security: [{ bearerAuth: [] }],
  middleware: [requirePermission('report.approve')] as const,
  request: {
    params: ReportIdParamSchema,
    body: {
      content: { 'application/json': { schema: ApproveRequestSchema } },
    },
  },
  responses: {
    200: {
      description: 'Report approved',
      content: { 'application/json': { schema: ApproveResponseSchema } },
    },
    403: {
      description: 'Forbidden (self-approval, SoD violation, etc.)',
      content: { 'application/json': { schema: ErrorSchema } },
    },
    404: {
      description: 'Report not found',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
});

const approveReportHandler: RouteHandler<typeof approveReportRoute> = async (c) => {
  const { reportId } = c.req.valid('param');
  const { comment, expectedVersion } = c.req.valid('json');
  const authUser = getAuthUser(c);

  const result = await approveReport(reportId, authUser.id, authUser.email, expectedVersion, comment);

  return c.json({
    success: result.success,
    isFullyApproved: result.isFullyApproved,
    nextStep: result.nextStep,
  } as any, 200);
};
workflowRouter.openapi(approveReportRoute, approveReportHandler);

// Reject report
const rejectReportRoute = createRoute({
  method: 'post',
  path: '/reports/{reportId}/reject',
  tags: ['Report Workflow'],
  summary: 'Reject report',
  description: 'Reject an expense report permanently',
  security: [{ bearerAuth: [] }],
  middleware: [requirePermission('report.reject')] as const,
  request: {
    params: ReportIdParamSchema,
    body: {
      content: { 'application/json': { schema: RejectRequestSchema } },
    },
  },
  responses: {
    200: {
      description: 'Report rejected',
      content: { 'application/json': { schema: ActionResponseSchema } },
    },
    403: {
      description: 'Forbidden',
      content: { 'application/json': { schema: ErrorSchema } },
    },
    404: {
      description: 'Report not found',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
});

const rejectReportHandler: RouteHandler<typeof rejectReportRoute> = async (c) => {
  const { reportId } = c.req.valid('param');
  const { comment, rejectionCategory, expectedVersion } = c.req.valid('json');
  const authUser = getAuthUser(c);

  const result = await rejectReport(reportId, authUser.id, authUser.email, expectedVersion, comment, rejectionCategory);

  return c.json({ success: result.success } as any, 200);
};
workflowRouter.openapi(rejectReportRoute, rejectReportHandler);

// Return report for corrections
const returnReportRoute = createRoute({
  method: 'post',
  path: '/reports/{reportId}/return',
  tags: ['Report Workflow'],
  summary: 'Return report for corrections',
  description: 'Return an expense report to the submitter for corrections',
  security: [{ bearerAuth: [] }],
  middleware: [requirePermission('report.return')] as const,
  request: {
    params: ReportIdParamSchema,
    body: {
      content: { 'application/json': { schema: ReturnRequestSchema } },
    },
  },
  responses: {
    200: {
      description: 'Report returned',
      content: { 'application/json': { schema: ActionResponseSchema } },
    },
    403: {
      description: 'Forbidden',
      content: { 'application/json': { schema: ErrorSchema } },
    },
    404: {
      description: 'Report not found',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
});

const returnReportHandler: RouteHandler<typeof returnReportRoute> = async (c) => {
  const { reportId } = c.req.valid('param');
  const { comment, expectedVersion } = c.req.valid('json');
  const authUser = getAuthUser(c);

  const result = await returnReport(reportId, authUser.id, authUser.email, expectedVersion, comment);

  return c.json({ success: result.success } as any, 200);
};
workflowRouter.openapi(returnReportRoute, returnReportHandler);

// Withdraw report
const withdrawReportRoute = createRoute({
  method: 'post',
  path: '/reports/{reportId}/withdraw',
  tags: ['Report Workflow'],
  summary: 'Withdraw report',
  description: 'Withdraw a submitted expense report back to draft status',
  security: [{ bearerAuth: [] }],
  middleware: [requirePermission('report.withdraw')] as const,
  request: {
    params: ReportIdParamSchema,
    body: {
      content: { 'application/json': { schema: VersionedCommandRequestSchema } },
    },
  },
  responses: {
    200: {
      description: 'Report withdrawn',
      content: { 'application/json': { schema: ActionResponseSchema } },
    },
    403: {
      description: 'Forbidden (not owner)',
      content: { 'application/json': { schema: ErrorSchema } },
    },
    404: {
      description: 'Report not found',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
});

const withdrawReportHandler: RouteHandler<typeof withdrawReportRoute> = async (c) => {
  const { reportId } = c.req.valid('param');
  const { expectedVersion } = c.req.valid('json');
  const userId = getUserId(c);

  const result = await withdrawReport(reportId, userId, expectedVersion);

  return c.json({ success: result.success } as any, 200);
};
workflowRouter.openapi(withdrawReportRoute, withdrawReportHandler);

// Revise rejected report
const reviseReportRoute = createRoute({
  method: 'post',
  path: '/reports/{reportId}/revise',
  tags: ['Report Workflow'],
  summary: 'Revise a rejected report',
  description: 'Reopen a rejected expense report for revision, transitioning it back to draft status',
  security: [{ bearerAuth: [] }],
  middleware: [requirePermission('report.submit')] as const,
  request: {
    params: ReportIdParamSchema,
    body: {
      content: { 'application/json': { schema: VersionedCommandRequestSchema } },
    },
  },
  responses: {
    200: {
      description: 'Report reopened for revision',
      content: { 'application/json': { schema: ActionResponseSchema } },
    },
    400: {
      description: 'Validation error (report not in rejected status)',
      content: { 'application/json': { schema: ErrorSchema } },
    },
    403: {
      description: 'Forbidden (not owner)',
      content: { 'application/json': { schema: ErrorSchema } },
    },
    404: {
      description: 'Report not found',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
});

const reviseReportHandler: RouteHandler<typeof reviseReportRoute> = async (c) => {
  const { reportId } = c.req.valid('param');
  const { expectedVersion } = c.req.valid('json');
  const authUser = getAuthUser(c);

  const result = await reviseReport(reportId, authUser.id, authUser.email, expectedVersion);

  return c.json({ success: result.success } as any, 200);
};
workflowRouter.openapi(reviseReportRoute, reviseReportHandler);

const correctApprovedReportRoute = createRoute({
  method: 'post',
  path: '/reports/{reportId}/correct',
  tags: ['Report Workflow'],
  summary: 'Reopen an approved report for correction',
  description: 'Return an approved but unposted report to its owner with an immutable reason',
  security: [{ bearerAuth: [] }],
  middleware: [requirePermission('report.correct')] as const,
  request: {
    params: ReportIdParamSchema,
    body: { content: { 'application/json': { schema: CorrectApprovedReportRequestSchema } } },
  },
  responses: {
    200: { description: 'Report reopened', content: { 'application/json': { schema: ActionResponseSchema } } },
    403: { description: 'Forbidden by permission or separation of duties', content: { 'application/json': { schema: ErrorSchema } } },
    404: { description: 'Report not found', content: { 'application/json': { schema: ErrorSchema } } },
    409: { description: 'Invalid state or stale version', content: { 'application/json': { schema: ErrorSchema } } },
  },
});

const correctApprovedReportHandler: RouteHandler<typeof correctApprovedReportRoute> = async (c) => {
  const { reportId } = c.req.valid('param');
  const { expectedVersion, reason } = c.req.valid('json');
  const actor = getAuthUser(c);
  const result = await correctApprovedReport(reportId, actor.id, actor.email, expectedVersion, reason);
  return c.json({ success: result.success } as any, 200);
};
workflowRouter.openapi(correctApprovedReportRoute, correctApprovedReportHandler);

const postReportRoute = createRoute({
  method: 'post',
  path: '/reports/{reportId}/post',
  tags: ['Report Workflow'],
  summary: 'Post an approved report',
  description: 'Post an approved report to accounting using a unique batch reference',
  security: [{ bearerAuth: [] }],
  middleware: [requirePermission('report.post')] as const,
  request: {
    params: ReportIdParamSchema,
    body: { content: { 'application/json': { schema: PostReportRequestSchema } } },
  },
  responses: {
    200: { description: 'Report posted', content: { 'application/json': { schema: ActionResponseSchema } } },
    403: { description: 'Forbidden by permission or separation of duties', content: { 'application/json': { schema: ErrorSchema } } },
    404: { description: 'Report not found', content: { 'application/json': { schema: ErrorSchema } } },
    409: { description: 'Invalid state, stale version, or duplicate reference', content: { 'application/json': { schema: ErrorSchema } } },
  },
});

const postReportHandler: RouteHandler<typeof postReportRoute> = async (c) => {
  const { reportId } = c.req.valid('param');
  const { expectedVersion, postingReference } = c.req.valid('json');
  const actor = getAuthUser(c);
  const result = await postReport(reportId, actor.id, expectedVersion, postingReference);
  return c.json({ success: result.success } as any, 200);
};
workflowRouter.openapi(postReportRoute, postReportHandler);

const payReportRoute = createRoute({
  method: 'post',
  path: '/reports/{reportId}/pay',
  tags: ['Report Workflow'],
  summary: 'Record payment of a posted report',
  description: 'Settle a posted report using a unique payment reference; the poster cannot also pay it',
  security: [{ bearerAuth: [] }],
  middleware: [requirePermission('report.pay')] as const,
  request: {
    params: ReportIdParamSchema,
    body: { content: { 'application/json': { schema: PayReportRequestSchema } } },
  },
  responses: {
    200: { description: 'Report paid', content: { 'application/json': { schema: ActionResponseSchema } } },
    403: { description: 'Forbidden by permission or separation of duties', content: { 'application/json': { schema: ErrorSchema } } },
    404: { description: 'Report not found', content: { 'application/json': { schema: ErrorSchema } } },
    409: { description: 'Invalid state, stale version, or duplicate reference', content: { 'application/json': { schema: ErrorSchema } } },
  },
});

const payReportHandler: RouteHandler<typeof payReportRoute> = async (c) => {
  const { reportId } = c.req.valid('param');
  const { expectedVersion, paymentReference } = c.req.valid('json');
  const actor = getAuthUser(c);
  const result = await payReport(reportId, actor.id, expectedVersion, paymentReference);
  return c.json({ success: result.success } as any, 200);
};
workflowRouter.openapi(payReportRoute, payReportHandler);

// Get workflow status for a report
const getReportStatusRoute = createRoute({
  method: 'get',
  path: '/reports/{reportId}/status',
  tags: ['Report Workflow'],
  summary: 'Get report workflow status',
  description: 'Get the current workflow status and approval history for a report',
  security: [{ bearerAuth: [] }],
  middleware: [requireAnyPermission(
    'report.view.own',
    'report.view.team',
    'report.view.department',
    'report.view.all'
  )] as const,
  request: {
    params: ReportIdParamSchema,
  },
  responses: {
    200: {
      description: 'Workflow status',
      content: { 'application/json': { schema: WorkflowStatusResponseSchema } },
    },
    403: {
      description: 'Forbidden by report view scope',
      content: { 'application/json': { schema: ErrorSchema } },
    },
    404: {
      description: 'Report not found',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
});

const getReportStatusHandler: RouteHandler<typeof getReportStatusRoute> = async (c) => {
  const { reportId } = c.req.valid('param');
  const authUser = getAuthUser(c);

  const status = await getReportWorkflowStatus(reportId, authUser.id, authUser.permissions);

  if (!status) {
    throw new NotFoundError('Expense report');
  }

  return c.json({
    status: status.status,
    currentStep: status.currentStep,
    totalSteps: status.totalSteps,
    workflow: status.workflow ? mapWorkflow(status.workflow) : null,
    history: status.history.map(mapHistory),
  } as any, 200);
};
workflowRouter.openapi(getReportStatusRoute, getReportStatusHandler);

// ============================================================================
// PENDING APPROVALS
// ============================================================================

const getPendingApprovalsRoute = createRoute({
  method: 'get',
  path: '/approvals/pending',
  tags: ['Report Workflow'],
  summary: 'Get pending approvals for current user',
  description: 'Get all reports pending the current user\'s approval action',
  security: [{ bearerAuth: [] }],
  middleware: [requirePermission('report.approve')] as const,
  responses: {
    200: {
      description: 'List of pending approvals',
      content: { 'application/json': { schema: PendingApprovalsResponseSchema } },
    },
  },
});

const getPendingApprovalsHandler: RouteHandler<typeof getPendingApprovalsRoute> = async (c) => {
  const authUser = getAuthUser(c);
  const approvals = await getPendingApprovalsForUser(authUser.id);

  return c.json({
    approvals: approvals.map(a => ({
      ...a,
      submitted_at: a.submitted_at.toISOString(),
    })),
    total: approvals.length,
  } as any, 200);
};
workflowRouter.openapi(getPendingApprovalsRoute, getPendingApprovalsHandler);

export { workflowRouter };
