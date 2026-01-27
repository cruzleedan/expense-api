import { db } from '../db/client.js';
import { logger } from '../utils/logger.js';
import type {
  WorkflowDefinition,
  WorkflowStep,
  WorkflowAssignment,
  ExpenseReport,
  ApprovalHistory,
} from '../types/index.js';
import { canApproveReport, recordApprovalAction } from './approval.service.js';
import { logAuditEvent } from './audit.service.js';
import { ForbiddenError, ValidationError, NotFoundError } from '../types/index.js';

/**
 * Workflow Service
 * Handles workflow assignment, execution, and state management
 */

// ============================================================================
// WORKFLOW DEFINITION OPERATIONS
// ============================================================================

/**
 * Get all active workflows
 */
export async function getAllWorkflows(): Promise<WorkflowDefinition[]> {
  const result = await db.query<WorkflowDefinition>(
    `SELECT id, name, description, version, is_active, conditions, steps, on_return_policy, created_at, updated_at, created_by
     FROM workflows
     WHERE is_active = true
     ORDER BY name`
  );
  return result.rows.map(parseWorkflowRow);
}

/**
 * Get a workflow by ID
 */
export async function getWorkflowById(workflowId: string): Promise<WorkflowDefinition | null> {
  const result = await db.query<WorkflowDefinition>(
    `SELECT id, name, description, version, is_active, conditions, steps, on_return_policy, created_at, updated_at, created_by
     FROM workflows
     WHERE id = $1`,
    [workflowId]
  );
  if (result.rows.length === 0) return null;
  return parseWorkflowRow(result.rows[0]);
}

/**
 * Parse workflow row from database (JSON fields)
 */
function parseWorkflowRow(row: Record<string, unknown>): WorkflowDefinition {
  return {
    ...row,
    conditions: typeof row.conditions === 'string' ? JSON.parse(row.conditions) : row.conditions,
    steps: typeof row.steps === 'string' ? JSON.parse(row.steps) : row.steps,
  } as WorkflowDefinition;
}

/**
 * Create a new workflow
 */
export async function createWorkflow(
  name: string,
  description: string | null,
  conditions: WorkflowDefinition['conditions'],
  steps: WorkflowStep[],
  onReturnPolicy: 'hard_restart' | 'soft_restart',
  createdBy: string
): Promise<WorkflowDefinition> {
  const result = await db.query<WorkflowDefinition>(
    `INSERT INTO workflows (name, description, conditions, steps, on_return_policy, created_by)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [name, description, JSON.stringify(conditions), JSON.stringify(steps), onReturnPolicy, createdBy]
  );
  return parseWorkflowRow(result.rows[0]);
}

/**
 * Update a workflow (creates new version)
 */
export async function updateWorkflow(
  workflowId: string,
  updates: {
    description?: string;
    conditions?: WorkflowDefinition['conditions'];
    steps?: WorkflowStep[];
    onReturnPolicy?: 'hard_restart' | 'soft_restart';
  },
  updatedBy: string
): Promise<WorkflowDefinition> {
  const current = await getWorkflowById(workflowId);
  if (!current) {
    throw new NotFoundError('Workflow');
  }

  const result = await db.query<WorkflowDefinition>(
    `UPDATE workflows
     SET description = COALESCE($2, description),
         conditions = COALESCE($3, conditions),
         steps = COALESCE($4, steps),
         on_return_policy = COALESCE($5, on_return_policy),
         version = version + 1,
         updated_at = NOW()
     WHERE id = $1
     RETURNING *`,
    [
      workflowId,
      updates.description,
      updates.conditions ? JSON.stringify(updates.conditions) : null,
      updates.steps ? JSON.stringify(updates.steps) : null,
      updates.onReturnPolicy,
    ]
  );

  await logAuditEvent({
    actorId: updatedBy,
    action: 'workflow.update',
    actionCategory: 'workflow',
    resourceType: 'workflow',
    resourceId: workflowId,
    changes: { version: { from: current.version, to: current.version + 1 } },
  });

  return parseWorkflowRow(result.rows[0]);
}

// ============================================================================
// WORKFLOW ASSIGNMENT
// ============================================================================

/**
 * Find the appropriate workflow for a report based on conditions
 */
export async function findWorkflowForReport(
  report: Pick<ExpenseReport, 'department_id' | 'total_amount'>,
  expenseCategory?: string
): Promise<WorkflowDefinition | null> {
  const amount = report.total_amount ? parseFloat(report.total_amount) : 0;

  // Find matching workflow assignment by priority
  const assignmentResult = await db.query<{ workflow_id: string }>(
    `SELECT wa.workflow_id
     FROM workflow_assignments wa
     JOIN workflows w ON wa.workflow_id = w.id
     WHERE wa.is_active = true AND w.is_active = true
       AND (wa.department_id IS NULL OR wa.department_id = $1)
       AND (wa.expense_category IS NULL OR wa.expense_category = $2)
       AND (wa.amount_min IS NULL OR wa.amount_min <= $3)
       AND (wa.amount_max IS NULL OR wa.amount_max >= $3)
     ORDER BY wa.priority DESC, wa.amount_min DESC NULLS LAST
     LIMIT 1`,
    [report.department_id, expenseCategory || null, amount]
  );

  if (assignmentResult.rows.length === 0) {
    // Fall back to default workflow (one without specific conditions)
    const defaultResult = await db.query<WorkflowDefinition>(
      `SELECT * FROM workflows
       WHERE is_active = true
         AND (conditions IS NULL OR conditions = '{}' OR conditions->>'amount_min' = '0')
       ORDER BY created_at ASC
       LIMIT 1`
    );
    if (defaultResult.rows.length > 0) {
      return parseWorkflowRow(defaultResult.rows[0]);
    }
    return null;
  }

  return getWorkflowById(assignmentResult.rows[0].workflow_id);
}

// ============================================================================
// WORKFLOW EXECUTION
// ============================================================================

/**
 * Submit a report for approval
 */
export async function submitReport(
  reportId: string,
  userId: string
): Promise<{ success: boolean; currentStep: number; workflow: WorkflowDefinition }> {
  const client = await db.getClient();

  try {
    await client.query('BEGIN');

    // Get report
    const reportResult = await client.query<ExpenseReport>(
      `SELECT * FROM expense_reports WHERE id = $1 FOR UPDATE`,
      [reportId]
    );

    if (reportResult.rows.length === 0) {
      throw new NotFoundError('Expense report');
    }

    const report = reportResult.rows[0];

    // Verify ownership
    if (report.user_id !== userId) {
      throw new ForbiddenError('Can only submit your own reports');
    }

    // Verify status
    if (report.status !== 'draft' && report.status !== 'returned') {
      throw new ValidationError(`Cannot submit report in ${report.status} status`);
    }

    // Calculate total amount from expense lines
    const totalResult = await client.query<{ total: string }>(
      `SELECT COALESCE(SUM(amount), 0) as total FROM expense_lines WHERE report_id = $1`,
      [reportId]
    );
    const totalAmount = totalResult.rows[0].total;

    // Find appropriate workflow
    const workflow = await findWorkflowForReport({
      department_id: report.department_id,
      total_amount: totalAmount,
    });

    if (!workflow) {
      throw new ValidationError('No workflow configured for this report type');
    }

    // Snapshot the workflow at time of submission
    const workflowSnapshot = {
      id: workflow.id,
      name: workflow.name,
      version: workflow.version,
      steps: workflow.steps,
      on_return_policy: workflow.on_return_policy,
    };

    // Update report
    await client.query(
      `UPDATE expense_reports
       SET status = 'submitted',
           workflow_id = $2,
           workflow_snapshot = $3,
           current_step = 1,
           total_amount = $4,
           submitted_at = NOW(),
           version = version + 1
       WHERE id = $1`,
      [reportId, workflow.id, JSON.stringify(workflowSnapshot), totalAmount]
    );

    await client.query('COMMIT');

    // Log audit event
    await logAuditEvent({
      actorId: userId,
      action: 'report.submit',
      actionCategory: 'workflow',
      resourceType: 'expense_report',
      resourceId: reportId,
      metadata: {
        workflow_id: workflow.id,
        workflow_name: workflow.name,
        total_amount: totalAmount,
      },
    });

    logger.info('Report submitted for approval', {
      reportId,
      userId,
      workflowId: workflow.id,
      totalAmount,
    });

    return { success: true, currentStep: 1, workflow };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Approve a report at the current workflow step
 */
export async function approveReport(
  reportId: string,
  approverId: string,
  approverEmail: string,
  comment?: string
): Promise<{ success: boolean; isFullyApproved: boolean; nextStep?: number }> {
  // Check self-approval rules
  const canApprove = await canApproveReport(approverId, reportId);
  if (!canApprove.allowed) {
    throw new ForbiddenError(canApprove.reason || 'Cannot approve this report');
  }

  const client = await db.getClient();

  try {
    await client.query('BEGIN');

    // Get report with lock
    const reportResult = await client.query<ExpenseReport & { workflow_snapshot: string }>(
      `SELECT * FROM expense_reports WHERE id = $1 FOR UPDATE`,
      [reportId]
    );

    if (reportResult.rows.length === 0) {
      throw new NotFoundError('Expense report');
    }

    const report = reportResult.rows[0];

    if (report.status !== 'submitted' && report.status !== 'pending') {
      throw new ValidationError(`Cannot approve report in ${report.status} status`);
    }

    const workflow = typeof report.workflow_snapshot === 'string'
      ? JSON.parse(report.workflow_snapshot)
      : report.workflow_snapshot;

    const currentStep = report.current_step || 1;
    const stepConfig = workflow.steps.find((s: WorkflowStep) => s.step_number === currentStep);

    if (!stepConfig) {
      throw new ValidationError('Invalid workflow step');
    }

    // Record approval action
    await recordApprovalAction(
      reportId,
      currentStep,
      stepConfig.name,
      approverId,
      approverEmail,
      'approve',
      comment
    );

    // Determine if there's a next step
    const nextStep = workflow.steps.find((s: WorkflowStep) => s.step_number === currentStep + 1);
    const isFullyApproved = !nextStep || shouldSkipStep(nextStep, report);

    if (isFullyApproved) {
      // All steps complete - mark as approved
      await client.query(
        `UPDATE expense_reports
         SET status = 'approved',
             approved_at = NOW(),
             version = version + 1
         WHERE id = $1`,
        [reportId]
      );
    } else {
      // Move to next step
      await client.query(
        `UPDATE expense_reports
         SET status = 'pending',
             current_step = $2,
             version = version + 1
         WHERE id = $1`,
        [reportId, currentStep + 1]
      );
    }

    await client.query('COMMIT');

    // Log audit event
    await logAuditEvent({
      actorId: approverId,
      action: 'report.approve',
      actionCategory: 'workflow',
      resourceType: 'expense_report',
      resourceId: reportId,
      metadata: {
        step_number: currentStep,
        step_name: stepConfig.name,
        is_fully_approved: isFullyApproved,
        comment,
      },
    });

    logger.info('Report approved', {
      reportId,
      approverId,
      step: currentStep,
      isFullyApproved,
    });

    return {
      success: true,
      isFullyApproved,
      nextStep: isFullyApproved ? undefined : currentStep + 1,
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Reject a report
 */
export async function rejectReport(
  reportId: string,
  approverId: string,
  approverEmail: string,
  comment: string,
  rejectionCategory?: string
): Promise<{ success: boolean }> {
  // Check self-approval rules (same rules apply for rejection)
  const canApprove = await canApproveReport(approverId, reportId);
  if (!canApprove.allowed) {
    throw new ForbiddenError(canApprove.reason || 'Cannot reject this report');
  }

  const client = await db.getClient();

  try {
    await client.query('BEGIN');

    // Get report with lock
    const reportResult = await client.query<ExpenseReport & { workflow_snapshot: string }>(
      `SELECT * FROM expense_reports WHERE id = $1 FOR UPDATE`,
      [reportId]
    );

    if (reportResult.rows.length === 0) {
      throw new NotFoundError('Expense report');
    }

    const report = reportResult.rows[0];

    if (report.status !== 'submitted' && report.status !== 'pending') {
      throw new ValidationError(`Cannot reject report in ${report.status} status`);
    }

    const workflow = typeof report.workflow_snapshot === 'string'
      ? JSON.parse(report.workflow_snapshot)
      : report.workflow_snapshot;

    const currentStep = report.current_step || 1;
    const stepConfig = workflow.steps.find((s: WorkflowStep) => s.step_number === currentStep);

    // Record rejection action
    await recordApprovalAction(
      reportId,
      currentStep,
      stepConfig?.name || `Step ${currentStep}`,
      approverId,
      approverEmail,
      'reject',
      comment,
      rejectionCategory
    );

    // Mark report as rejected
    await client.query(
      `UPDATE expense_reports
       SET status = 'rejected',
           version = version + 1
       WHERE id = $1`,
      [reportId]
    );

    await client.query('COMMIT');

    // Log audit event
    await logAuditEvent({
      actorId: approverId,
      action: 'report.reject',
      actionCategory: 'workflow',
      resourceType: 'expense_report',
      resourceId: reportId,
      metadata: {
        step_number: currentStep,
        comment,
        rejection_category: rejectionCategory,
      },
    });

    logger.info('Report rejected', { reportId, approverId, step: currentStep });

    return { success: true };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Return a report for corrections
 */
export async function returnReport(
  reportId: string,
  approverId: string,
  approverEmail: string,
  comment: string
): Promise<{ success: boolean }> {
  const client = await db.getClient();

  try {
    await client.query('BEGIN');

    // Get report with lock
    const reportResult = await client.query<ExpenseReport & { workflow_snapshot: string }>(
      `SELECT * FROM expense_reports WHERE id = $1 FOR UPDATE`,
      [reportId]
    );

    if (reportResult.rows.length === 0) {
      throw new NotFoundError('Expense report');
    }

    const report = reportResult.rows[0];

    if (report.status !== 'submitted' && report.status !== 'pending') {
      throw new ValidationError(`Cannot return report in ${report.status} status`);
    }

    const workflow = typeof report.workflow_snapshot === 'string'
      ? JSON.parse(report.workflow_snapshot)
      : report.workflow_snapshot;

    const currentStep = report.current_step || 1;
    const stepConfig = workflow.steps.find((s: WorkflowStep) => s.step_number === currentStep);

    // Record return action
    await recordApprovalAction(
      reportId,
      currentStep,
      stepConfig?.name || `Step ${currentStep}`,
      approverId,
      approverEmail,
      'return',
      comment
    );

    // Determine restart policy
    const onReturnPolicy = workflow.on_return_policy || 'hard_restart';

    if (onReturnPolicy === 'hard_restart') {
      // Clear all progress, start over when resubmitted
      await client.query(
        `UPDATE expense_reports
         SET status = 'returned',
             current_step = NULL,
             workflow_snapshot = NULL,
             version = version + 1
         WHERE id = $1`,
        [reportId]
      );
    } else {
      // Soft restart - keep workflow, restart at step 1
      await client.query(
        `UPDATE expense_reports
         SET status = 'returned',
             current_step = 1,
             version = version + 1
         WHERE id = $1`,
        [reportId]
      );
    }

    await client.query('COMMIT');

    // Log audit event
    await logAuditEvent({
      actorId: approverId,
      action: 'report.return',
      actionCategory: 'workflow',
      resourceType: 'expense_report',
      resourceId: reportId,
      metadata: {
        step_number: currentStep,
        comment,
        return_policy: onReturnPolicy,
      },
    });

    logger.info('Report returned for corrections', { reportId, approverId, step: currentStep });

    return { success: true };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Withdraw a submitted report (by the submitter)
 */
export async function withdrawReport(
  reportId: string,
  userId: string
): Promise<{ success: boolean }> {
  const client = await db.getClient();

  try {
    await client.query('BEGIN');

    // Get report with lock
    const reportResult = await client.query<ExpenseReport>(
      `SELECT * FROM expense_reports WHERE id = $1 FOR UPDATE`,
      [reportId]
    );

    if (reportResult.rows.length === 0) {
      throw new NotFoundError('Expense report');
    }

    const report = reportResult.rows[0];

    // Must be owner
    if (report.user_id !== userId) {
      throw new ForbiddenError('Can only withdraw your own reports');
    }

    // Can only withdraw submitted/pending reports
    if (report.status !== 'submitted' && report.status !== 'pending') {
      throw new ValidationError(`Cannot withdraw report in ${report.status} status`);
    }

    // Withdraw the report
    await client.query(
      `UPDATE expense_reports
       SET status = 'draft',
           current_step = NULL,
           workflow_id = NULL,
           workflow_snapshot = NULL,
           submitted_at = NULL,
           version = version + 1
       WHERE id = $1`,
      [reportId]
    );

    await client.query('COMMIT');

    // Log audit event
    await logAuditEvent({
      actorId: userId,
      action: 'report.withdraw',
      actionCategory: 'workflow',
      resourceType: 'expense_report',
      resourceId: reportId,
    });

    logger.info('Report withdrawn', { reportId, userId });

    return { success: true };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Check if a workflow step should be skipped based on conditions
 */
function shouldSkipStep(step: WorkflowStep, report: ExpenseReport): boolean {
  if (step.skip_if) {
    return evaluateCondition(step.skip_if, report);
  }
  if (step.required_if) {
    return !evaluateCondition(step.required_if, report);
  }
  return false;
}

/**
 * Evaluate a workflow condition
 */
function evaluateCondition(
  condition: { field: string; condition: string; value: unknown },
  report: ExpenseReport
): boolean {
  const fieldValue = (report as Record<string, unknown>)[condition.field];

  switch (condition.condition) {
    case 'greater_than':
      return Number(fieldValue) > Number(condition.value);
    case 'less_than':
      return Number(fieldValue) < Number(condition.value);
    case 'equals':
      return fieldValue === condition.value;
    case 'not_equals':
      return fieldValue !== condition.value;
    case 'in':
      return Array.isArray(condition.value) && condition.value.includes(fieldValue);
    case 'not_in':
      return Array.isArray(condition.value) && !condition.value.includes(fieldValue);
    default:
      return false;
  }
}

/**
 * Get current workflow status for a report
 */
export async function getReportWorkflowStatus(reportId: string): Promise<{
  status: string;
  currentStep: number | null;
  totalSteps: number;
  workflow: WorkflowDefinition | null;
  history: ApprovalHistory[];
} | null> {
  const reportResult = await db.query<ExpenseReport & { workflow_snapshot: string }>(
    `SELECT * FROM expense_reports WHERE id = $1`,
    [reportId]
  );

  if (reportResult.rows.length === 0) {
    return null;
  }

  const report = reportResult.rows[0];

  let workflow: WorkflowDefinition | null = null;
  let totalSteps = 0;

  if (report.workflow_snapshot) {
    workflow = typeof report.workflow_snapshot === 'string'
      ? JSON.parse(report.workflow_snapshot)
      : report.workflow_snapshot;
    totalSteps = workflow?.steps?.length || 0;
  }

  // Get approval history
  const historyResult = await db.query<ApprovalHistory>(
    `SELECT * FROM approval_history WHERE report_id = $1 ORDER BY created_at ASC`,
    [reportId]
  );

  return {
    status: report.status,
    currentStep: report.current_step,
    totalSteps,
    workflow,
    history: historyResult.rows,
  };
}
