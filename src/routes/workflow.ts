import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import { authMiddleware, getUserId } from '../middleware/auth.js';
import { requirePermission, getAuthUser } from '../middleware/permission.js';
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
  getReportWorkflowStatus,
} from '../services/workflow.service.js';
import { NotFoundError } from '../types/index.js';
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
} from '../schemas/workflow.js';
import { ErrorSchema, MessageSchema } from '../schemas/common.js';

const workflowRouter = new OpenAPIHono();

// All routes require authentication
workflowRouter.use('*', authMiddleware);

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

workflowRouter.openapi(listWorkflowsRoute, async (c) => {
  const workflows = await getAllWorkflows();
  return c.json({
    workflows: workflows.map(w => ({
      ...w,
      created_at: w.created_at.toISOString(),
      updated_at: w.updated_at.toISOString(),
    })),
    total: workflows.length,
  }, 200);
});

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

workflowRouter.openapi(getWorkflowRoute, async (c) => {
  const { workflowId } = c.req.valid('param');
  const workflow = await getWorkflowById(workflowId);

  if (!workflow) {
    throw new NotFoundError('Workflow');
  }

  return c.json({
    ...workflow,
    created_at: workflow.created_at.toISOString(),
    updated_at: workflow.updated_at.toISOString(),
  }, 200);
});

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

workflowRouter.openapi(createWorkflowRoute, async (c) => {
  const body = c.req.valid('json');
  const userId = getUserId(c);

  const workflow = await createWorkflow(
    body.name,
    body.description || null,
    body.conditions || null,
    body.steps,
    body.on_return_policy,
    userId
  );

  return c.json({
    ...workflow,
    created_at: workflow.created_at.toISOString(),
    updated_at: workflow.updated_at.toISOString(),
  }, 201);
});

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

workflowRouter.openapi(updateWorkflowRoute, async (c) => {
  const { workflowId } = c.req.valid('param');
  const body = c.req.valid('json');
  const userId = getUserId(c);

  const workflow = await updateWorkflow(workflowId, {
    description: body.description,
    conditions: body.conditions,
    steps: body.steps,
    onReturnPolicy: body.on_return_policy,
  }, userId);

  return c.json({
    ...workflow,
    created_at: workflow.created_at.toISOString(),
    updated_at: workflow.updated_at.toISOString(),
  }, 200);
});

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

workflowRouter.openapi(submitReportRoute, async (c) => {
  const { reportId } = c.req.valid('param');
  const userId = getUserId(c);

  const result = await submitReport(reportId, userId);

  return c.json({
    success: result.success,
    current_step: result.currentStep,
    workflow: {
      ...result.workflow,
      created_at: result.workflow.created_at.toISOString(),
      updated_at: result.workflow.updated_at.toISOString(),
    },
  }, 200);
});

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

workflowRouter.openapi(approveReportRoute, async (c) => {
  const { reportId } = c.req.valid('param');
  const { comment } = c.req.valid('json');
  const authUser = getAuthUser(c);

  const result = await approveReport(reportId, authUser.id, authUser.email, comment);

  return c.json({
    success: result.success,
    is_fully_approved: result.isFullyApproved,
    next_step: result.nextStep,
  }, 200);
});

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

workflowRouter.openapi(rejectReportRoute, async (c) => {
  const { reportId } = c.req.valid('param');
  const { comment, rejection_category } = c.req.valid('json');
  const authUser = getAuthUser(c);

  const result = await rejectReport(reportId, authUser.id, authUser.email, comment, rejection_category);

  return c.json({ success: result.success }, 200);
});

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

workflowRouter.openapi(returnReportRoute, async (c) => {
  const { reportId } = c.req.valid('param');
  const { comment } = c.req.valid('json');
  const authUser = getAuthUser(c);

  const result = await returnReport(reportId, authUser.id, authUser.email, comment);

  return c.json({ success: result.success }, 200);
});

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

workflowRouter.openapi(withdrawReportRoute, async (c) => {
  const { reportId } = c.req.valid('param');
  const userId = getUserId(c);

  const result = await withdrawReport(reportId, userId);

  return c.json({ success: result.success }, 200);
});

// Get workflow status for a report
const getReportStatusRoute = createRoute({
  method: 'get',
  path: '/reports/{reportId}/status',
  tags: ['Report Workflow'],
  summary: 'Get report workflow status',
  description: 'Get the current workflow status and approval history for a report',
  security: [{ bearerAuth: [] }],
  request: {
    params: ReportIdParamSchema,
  },
  responses: {
    200: {
      description: 'Workflow status',
      content: { 'application/json': { schema: WorkflowStatusResponseSchema } },
    },
    404: {
      description: 'Report not found',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
});

workflowRouter.openapi(getReportStatusRoute, async (c) => {
  const { reportId } = c.req.valid('param');

  const status = await getReportWorkflowStatus(reportId);

  if (!status) {
    throw new NotFoundError('Expense report');
  }

  return c.json({
    status: status.status,
    current_step: status.currentStep,
    total_steps: status.totalSteps,
    workflow: status.workflow ? {
      ...status.workflow,
      created_at: status.workflow.created_at?.toISOString() || new Date().toISOString(),
      updated_at: status.workflow.updated_at?.toISOString() || new Date().toISOString(),
    } : null,
    history: status.history.map(h => ({
      ...h,
      created_at: h.created_at.toISOString(),
      sla_deadline: h.sla_deadline?.toISOString() || null,
    })),
  }, 200);
});

export { workflowRouter };
