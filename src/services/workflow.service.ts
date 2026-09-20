import { db, query } from '../db/client.js';
import { logger } from '../utils/logger.js';
import type {
  WorkflowDefinition,
  WorkflowStep,
  ExpenseReport,
  ApprovalHistory,
} from '../types/index.js';
import { canAccessReport, canApproveReport, recordApprovalAction } from './approval.service.js';
import { logAuditEvent } from './audit.service.js';
import { ConflictError, ForbiddenError, ValidationError, NotFoundError } from '../types/index.js';
import {
  assertAccountingSeparationOfDuties,
  assertExpectedVersion,
  assertReportTransition,
} from '../policies/reportLifecycle.js';
import {
  assertActorEligibleForStep,
  combineEligiblePrincipals,
  findNextRequiredStep,
  shouldSkipWorkflowStep,
  type FrozenWorkflowStep,
} from '../policies/workflowExecution.js';

type QueryClient = { query: typeof query };

export async function calculateActiveExpenseLineTotal(
  reportId: string,
  client: QueryClient
): Promise<number> {
  const result = await client.query<{ line_count: string; total: string }>(
    `SELECT COUNT(*) AS line_count, COALESCE(SUM(amount), 0) AS total
     FROM expense_lines
     WHERE report_id = $1 AND deleted_at IS NULL`,
    [reportId]
  );
  if (parseInt(result.rows[0].line_count, 10) === 0) {
    throw new ValidationError('Report must have at least one active expense line');
  }
  return parseFloat(result.rows[0].total);
}

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
export async function getWorkflowById(
  workflowId: string,
  client?: QueryClient
): Promise<WorkflowDefinition | null> {
  const queryFn: typeof query = client ? client.query.bind(client) : db.query.bind(db);
  const result = await queryFn<WorkflowDefinition>(
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
function parseWorkflowRow(row: WorkflowDefinition): WorkflowDefinition {
  return {
    ...row,
    conditions: typeof row.conditions === 'string' ? JSON.parse(row.conditions as unknown as string) : row.conditions,
    steps: typeof row.steps === 'string' ? JSON.parse(row.steps as unknown as string) : row.steps,
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
  expenseCategory?: string,
  client?: QueryClient
): Promise<WorkflowDefinition | null> {
  const amount = report.total_amount ?? 0;
  const queryFn: typeof query = client ? client.query.bind(client) : db.query.bind(db);

  // Find matching workflow assignment by priority
  const assignmentResult = await queryFn<{ workflow_id: string }>(
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
    const defaultResult = await queryFn<WorkflowDefinition>(
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

  return getWorkflowById(assignmentResult.rows[0].workflow_id, client);
}

async function resolveRolePrincipals(roleName: string, client: QueryClient): Promise<string[]> {
  const result = await client.query<{ id: string }>(
    `SELECT DISTINCT u.id
     FROM users u
     JOIN user_roles ur ON ur.user_id = u.id
     JOIN roles r ON r.id = ur.role_id
     WHERE r.name = $1
       AND r.is_active = true
       AND u.is_active = true
       AND u.is_verified = true`,
    [roleName]
  );
  return result.rows.map((row) => row.id);
}

async function resolveRelationshipPrincipals(
  relationship: string,
  submitterId: string,
  client: QueryClient
): Promise<string[]> {
  if (relationship === 'direct_manager' || relationship === 'manager') {
    const result = await client.query<{ id: string }>(
      `SELECT manager.id
       FROM users submitter
       JOIN users manager ON manager.id = submitter.manager_id
       WHERE submitter.id = $1
         AND manager.is_active = true
         AND manager.is_verified = true`,
      [submitterId]
    );
    return result.rows.map((row) => row.id);
  }

  if (relationship === 'manager_chain') {
    const result = await client.query<{ id: string }>(
      `WITH RECURSIVE manager_chain AS (
         SELECT manager.id, manager.manager_id, 1 AS depth
         FROM users submitter
         JOIN users manager ON manager.id = submitter.manager_id
         WHERE submitter.id = $1
         UNION ALL
         SELECT manager.id, manager.manager_id, chain.depth + 1
         FROM users manager
         JOIN manager_chain chain ON manager.id = chain.manager_id
         WHERE chain.depth < 10
       )
       SELECT DISTINCT manager.id
       FROM manager_chain chain
       JOIN users manager ON manager.id = chain.id
       WHERE manager.is_active = true AND manager.is_verified = true`,
      [submitterId]
    );
    return result.rows.map((row) => row.id);
  }

  if (relationship === 'department_head') {
    const result = await client.query<{ id: string }>(
      `SELECT head.id
       FROM users submitter
       JOIN departments department ON department.id = submitter.department_id
       JOIN users head ON head.id = department.head_user_id
       WHERE submitter.id = $1
         AND head.is_active = true
         AND head.is_verified = true`,
      [submitterId]
    );
    return result.rows.map((row) => row.id);
  }

  throw new ValidationError(`Unsupported workflow relationship target: ${relationship}`);
}

async function freezeWorkflowStep(
  step: WorkflowStep,
  submitterId: string,
  client: QueryClient
): Promise<FrozenWorkflowStep> {
  let rolePrincipals: string[] = [];
  let relationshipPrincipals: string[] = [];

  if (step.target_type === 'role') {
    if (typeof step.target_value !== 'string') {
      throw new ValidationError(`Workflow step ${step.step_number} must specify a role name`);
    }
    rolePrincipals = await resolveRolePrincipals(step.target_value, client);
  } else if (step.target_type === 'relationship') {
    if (typeof step.target_value !== 'string') {
      throw new ValidationError(`Workflow step ${step.step_number} must specify a relationship`);
    }
    relationshipPrincipals = await resolveRelationshipPrincipals(step.target_value, submitterId, client);
  } else if (step.target_type === 'hybrid') {
    if (typeof step.target_value === 'string') {
      throw new ValidationError(`Workflow step ${step.step_number} must specify role and relationship targets`);
    }
    rolePrincipals = await resolveRolePrincipals(step.target_value.role, client);
    relationshipPrincipals = await resolveRelationshipPrincipals(
      step.target_value.relationship,
      submitterId,
      client
    );
  }

  return {
    ...step,
    eligible_user_ids: combineEligiblePrincipals(
      step.target_type,
      rolePrincipals,
      relationshipPrincipals
    ).filter((id) => id !== submitterId),
  };
}

function parseWorkflowSnapshot(report: ExpenseReport): WorkflowDefinition {
  const snapshot = typeof report.workflow_snapshot === 'string'
    ? JSON.parse(report.workflow_snapshot)
    : report.workflow_snapshot;
  if (!snapshot || !Array.isArray(snapshot.steps)) {
    throw new ValidationError('Report has no valid workflow snapshot; resubmit the report');
  }
  return snapshot;
}

function currentWorkflowStep(report: ExpenseReport, workflow: WorkflowDefinition): WorkflowStep {
  if (report.current_step === null) {
    throw new ValidationError('Report has no current workflow step');
  }
  const step = workflow.steps.find((candidate) => candidate.step_number === report.current_step);
  if (!step) {
    throw new ValidationError('Invalid current workflow step');
  }
  return step;
}

async function authorizeWorkflowActor(
  report: ExpenseReport,
  actorId: string,
  client: QueryClient
): Promise<{ workflow: WorkflowDefinition; step: WorkflowStep }> {
  const workflow = parseWorkflowSnapshot(report);
  const step = currentWorkflowStep(report, workflow);
  assertActorEligibleForStep(step, actorId);
  const approval = await canApproveReport(actorId, report.id, client);
  if (!approval.allowed) {
    throw new ForbiddenError(approval.reason || 'Cannot act on this report');
  }
  return { workflow, step };
}

// ============================================================================
// WORKFLOW EXECUTION
// ============================================================================

/**
 * Submit a report for approval
 */
export async function submitReport(
  reportId: string,
  userId: string,
  expectedVersion: number
): Promise<{ success: boolean; currentStep: number; workflow: WorkflowDefinition }> {
  const client = await db.getClient();

  try {
    await client.query('BEGIN');

    // Get report
    const reportResult = await client.query<ExpenseReport>(
      `SELECT * FROM expense_reports WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`,
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

    assertExpectedVersion(report.version, expectedVersion);
    assertReportTransition('submit', report.status);

    // Calculate total amount from expense lines
    const totalAmount = await calculateActiveExpenseLineTotal(reportId, client);
    const reportAtSubmission = { ...report, total_amount: totalAmount };

    // Find appropriate workflow
    const workflow = await findWorkflowForReport({
      department_id: report.department_id,
      total_amount: totalAmount,
    }, undefined, client);

    if (!workflow) {
      throw new ValidationError('No workflow configured for this report type');
    }

    const frozenSteps: FrozenWorkflowStep[] = [];
    for (const step of workflow.steps) {
      frozenSteps.push(await freezeWorkflowStep(step, report.user_id, client));
    }

    const activeSteps = frozenSteps.filter(
      (step) => !shouldSkipWorkflowStep(step, reportAtSubmission as unknown as Record<string, unknown>)
    );
    if (activeSteps.length === 0) {
      throw new ValidationError('Workflow has no required step for this report');
    }
    for (const step of activeSteps) {
      if (step.target_type === 'system') {
        throw new ValidationError(
          `Workflow step ${step.step_number} is a system step, but no system executor is configured`
        );
      }
      if (step.eligible_user_ids.length === 0) {
        throw new ValidationError(`Workflow step ${step.step_number} has no eligible approver`);
      }
    }

    const firstStep = findNextRequiredStep(
      frozenSteps,
      reportAtSubmission as unknown as Record<string, unknown>
    );
    if (!firstStep) {
      throw new ValidationError('Workflow has no executable step for this report');
    }

    // Freeze the workflow definition and point-in-time eligible principals.
    const workflowSnapshot: WorkflowDefinition = { ...workflow, steps: frozenSteps };

    // Update report
    await client.query(
      `UPDATE expense_reports
       SET status = 'submitted',
           workflow_id = $2,
           workflow_snapshot = $3,
           current_step = $4,
           total_amount = $5,
           net_amount = $5,
           base_currency_total = $5 * COALESCE(exchange_rate, 1),
           submitted_at = NOW(),
           approved_at = NULL,
           posted_at = NULL,
           posted_by = NULL,
           posting_reference = NULL,
           paid_at = NULL,
           paid_by = NULL,
           payment_reference = NULL,
           rejection_reason = NULL,
           version = version + 1,
           updated_at = NOW()
       WHERE id = $1 AND version = $6`,
      [reportId, workflow.id, JSON.stringify(workflowSnapshot), firstStep.step_number, totalAmount, expectedVersion]
    );

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
      resourceVersion: expectedVersion + 1,
      client,
    });

    await client.query('COMMIT');

    logger.info('Report submitted for approval', {
      reportId,
      userId,
      workflowId: workflow.id,
      totalAmount,
    });

    return { success: true, currentStep: firstStep.step_number, workflow: workflowSnapshot };
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
  expectedVersion: number,
  comment?: string
): Promise<{ success: boolean; isFullyApproved: boolean; nextStep?: number }> {
  const client = await db.getClient();

  try {
    await client.query('BEGIN');

    // Get report with lock
    const reportResult = await client.query<ExpenseReport & { workflow_snapshot: string }>(
      `SELECT * FROM expense_reports WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`,
      [reportId]
    );

    if (reportResult.rows.length === 0) {
      throw new NotFoundError('Expense report');
    }

    const report = reportResult.rows[0];

    assertExpectedVersion(report.version, expectedVersion);
    assertReportTransition('approve', report.status);

    const { workflow, step: stepConfig } = await authorizeWorkflowActor(report, approverId, client);
    const currentStep = stepConfig.step_number;

    // Record approval action
    await recordApprovalAction(
      reportId,
      currentStep,
      stepConfig.name,
      approverId,
      approverEmail,
      'approve',
      comment,
      undefined, // rejectionCategory
      undefined, // slaDeadline
      undefined, // wasEscalated
      client // transaction client
    );

    const nextStep = findNextRequiredStep(
      workflow.steps,
      report as unknown as Record<string, unknown>,
      currentStep
    );
    const isFullyApproved = !nextStep;

    if (isFullyApproved) {
      // All steps complete - mark as approved
      await client.query(
        `UPDATE expense_reports
         SET status = 'approved',
             approved_at = NOW(),
             version = version + 1,
             updated_at = NOW()
         WHERE id = $1 AND version = $2`,
        [reportId, expectedVersion]
      );
    } else {
      // Move to next step
      await client.query(
        `UPDATE expense_reports
         SET status = 'pending',
             current_step = $2,
             version = version + 1,
             updated_at = NOW()
         WHERE id = $1 AND version = $3`,
        [reportId, nextStep.step_number, expectedVersion]
      );
    }

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
      resourceVersion: expectedVersion + 1,
      client,
    });

    await client.query('COMMIT');

    logger.info('Report approved', {
      reportId,
      approverId,
      step: currentStep,
      isFullyApproved,
    });

    return {
      success: true,
      isFullyApproved,
      nextStep: nextStep?.step_number,
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
  expectedVersion: number,
  comment: string,
  rejectionCategory?: string
): Promise<{ success: boolean }> {
  const client = await db.getClient();

  try {
    await client.query('BEGIN');

    // Get report with lock
    const reportResult = await client.query<ExpenseReport & { workflow_snapshot: string }>(
      `SELECT * FROM expense_reports WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`,
      [reportId]
    );

    if (reportResult.rows.length === 0) {
      throw new NotFoundError('Expense report');
    }

    const report = reportResult.rows[0];

    assertExpectedVersion(report.version, expectedVersion);
    assertReportTransition('reject', report.status);

    const { step: stepConfig } = await authorizeWorkflowActor(report, approverId, client);
    const currentStep = stepConfig.step_number;

    // Record rejection action
    await recordApprovalAction(
      reportId,
      currentStep,
      stepConfig.name,
      approverId,
      approverEmail,
      'reject',
      comment,
      rejectionCategory,
      undefined, // slaDeadline
      undefined, // wasEscalated
      client // transaction client
    );

    // Mark report as rejected
    await client.query(
      `UPDATE expense_reports
       SET status = 'rejected',
           rejection_reason = $2,
           version = version + 1,
           updated_at = NOW()
       WHERE id = $1 AND version = $3`,
      [reportId, comment, expectedVersion]
    );

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
      resourceVersion: expectedVersion + 1,
      client,
    });

    await client.query('COMMIT');

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
  expectedVersion: number,
  comment: string
): Promise<{ success: boolean }> {
  const client = await db.getClient();

  try {
    await client.query('BEGIN');

    // Get report with lock
    const reportResult = await client.query<ExpenseReport & { workflow_snapshot: string }>(
      `SELECT * FROM expense_reports WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`,
      [reportId]
    );

    if (reportResult.rows.length === 0) {
      throw new NotFoundError('Expense report');
    }

    const report = reportResult.rows[0];

    assertExpectedVersion(report.version, expectedVersion);
    assertReportTransition('return', report.status);

    const { workflow, step: stepConfig } = await authorizeWorkflowActor(report, approverId, client);
    const currentStep = stepConfig.step_number;

    // Record return action
    await recordApprovalAction(
      reportId,
      currentStep,
      stepConfig.name,
      approverId,
      approverEmail,
      'return',
      comment,
      undefined, // rejectionCategory
      undefined, // slaDeadline
      undefined, // wasEscalated
      client // transaction client
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
             rejection_reason = $2,
             version = version + 1,
             updated_at = NOW()
         WHERE id = $1 AND version = $3`,
        [reportId, comment, expectedVersion]
      );
    } else {
      // Soft restart - keep workflow, restart at step 1
      await client.query(
        `UPDATE expense_reports
         SET status = 'returned',
             current_step = 1,
             rejection_reason = $2,
             version = version + 1,
             updated_at = NOW()
         WHERE id = $1 AND version = $3`,
        [reportId, comment, expectedVersion]
      );
    }

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
      resourceVersion: expectedVersion + 1,
      client,
    });

    await client.query('COMMIT');

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
  userId: string,
  expectedVersion: number
): Promise<{ success: boolean }> {
  const client = await db.getClient();

  try {
    await client.query('BEGIN');

    // Get report with lock
    const reportResult = await client.query<ExpenseReport>(
      `SELECT * FROM expense_reports WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`,
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

    assertExpectedVersion(report.version, expectedVersion);
    assertReportTransition('withdraw', report.status);

    // Withdraw the report
    await client.query(
      `UPDATE expense_reports
       SET status = 'draft',
           current_step = NULL,
           workflow_id = NULL,
           workflow_snapshot = NULL,
           submitted_at = NULL,
           approved_at = NULL,
           posted_at = NULL,
           posted_by = NULL,
           posting_reference = NULL,
           paid_at = NULL,
           paid_by = NULL,
           payment_reference = NULL,
           rejection_reason = NULL,
           version = version + 1,
           updated_at = NOW()
       WHERE id = $1 AND version = $2`,
      [reportId, expectedVersion]
    );

    await logAuditEvent({
      actorId: userId,
      action: 'report.withdraw',
      actionCategory: 'workflow',
      resourceType: 'expense_report',
      resourceId: reportId,
      resourceVersion: expectedVersion + 1,
      client,
    });

    await client.query('COMMIT');

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
 * Revise a rejected report (by the submitter)
 * Transitions rejected → draft so the employee can edit and resubmit
 */
export async function reviseReport(
  reportId: string,
  userId: string,
  userEmail: string,
  expectedVersion: number
): Promise<{ success: boolean }> {
  const client = await db.getClient();

  try {
    await client.query('BEGIN');

    // Get report with lock
    const reportResult = await client.query<ExpenseReport>(
      `SELECT * FROM expense_reports WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`,
      [reportId]
    );

    if (reportResult.rows.length === 0) {
      throw new NotFoundError('Expense report');
    }

    const report = reportResult.rows[0];

    // Must be owner
    if (report.user_id !== userId) {
      throw new ForbiddenError('Can only revise your own reports');
    }

    assertExpectedVersion(report.version, expectedVersion);
    assertReportTransition('revise', report.status);

    // Record the revise action in approval history
    const currentStep = report.current_step || 0;
    await recordApprovalAction(
      reportId,
      currentStep,
      'Revision',
      userId,
      userEmail,
      'revise',
      'Report reopened for revision after rejection',
      undefined, // rejectionCategory
      undefined, // slaDeadline
      undefined, // wasEscalated
      client     // transaction client
    );

    // Transition to draft, clear workflow state for fresh re-approval
    await client.query(
      `UPDATE expense_reports
       SET status = 'draft',
           current_step = NULL,
           workflow_id = NULL,
           workflow_snapshot = NULL,
           submitted_at = NULL,
           approved_at = NULL,
           posted_at = NULL,
           posted_by = NULL,
           posting_reference = NULL,
           paid_at = NULL,
           paid_by = NULL,
           payment_reference = NULL,
           rejection_reason = NULL,
           version = version + 1,
           updated_at = NOW()
       WHERE id = $1 AND version = $2`,
      [reportId, expectedVersion]
    );

    await logAuditEvent({
      actorId: userId,
      action: 'report.revise',
      actionCategory: 'workflow',
      resourceType: 'expense_report',
      resourceId: reportId,
      resourceVersion: expectedVersion + 1,
      client,
    });

    await client.query('COMMIT');

    logger.info('Rejected report reopened for revision', { reportId, userId });

    return { success: true };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/** Reopen an approved, unposted report through an explicit correction trail. */
export async function correctApprovedReport(
  reportId: string,
  actorId: string,
  actorEmail: string,
  expectedVersion: number,
  reason: string
): Promise<{ success: boolean }> {
  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    const result = await client.query<ExpenseReport>(
      `SELECT * FROM expense_reports
       WHERE id = $1 AND deleted_at IS NULL
       FOR UPDATE`,
      [reportId]
    );
    if (result.rows.length === 0) throw new NotFoundError('Expense report');
    const report = result.rows[0];

    assertExpectedVersion(report.version, expectedVersion);
    assertReportTransition('correct', report.status);
    if (report.user_id === actorId) {
      throw new ForbiddenError('The report submitter cannot reopen their own approved report');
    }

    await recordApprovalAction(
      reportId,
      report.current_step ?? 0,
      'Approved report correction',
      actorId,
      actorEmail,
      'return',
      reason,
      'approved_report_correction',
      undefined,
      undefined,
      client
    );

    await client.query(
      `UPDATE expense_reports
       SET status = 'returned',
           current_step = NULL,
           workflow_id = NULL,
           workflow_snapshot = NULL,
           approved_at = NULL,
           rejection_reason = $2,
           version = version + 1,
           updated_at = NOW()
       WHERE id = $1 AND version = $3`,
      [reportId, reason, expectedVersion]
    );

    await logAuditEvent({
      actorId,
      actorEmail,
      action: 'report.correct',
      actionCategory: 'workflow',
      resourceType: 'expense_report',
      resourceId: reportId,
      resourceVersion: expectedVersion + 1,
      changes: { status: { from: report.status, to: 'returned' } },
      metadata: { reason },
      client,
    });
    await client.query('COMMIT');
    logger.info('Approved report reopened for correction', { reportId, actorId });
    return { success: true };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/** Post an approved report to the accounting ledger. */
export async function postReport(
  reportId: string,
  actorId: string,
  expectedVersion: number,
  postingReference: string
): Promise<{ success: boolean }> {
  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    const result = await client.query<ExpenseReport>(
      `SELECT * FROM expense_reports
       WHERE id = $1 AND deleted_at IS NULL
       FOR UPDATE`,
      [reportId]
    );
    if (result.rows.length === 0) throw new NotFoundError('Expense report');
    const report = result.rows[0];

    assertExpectedVersion(report.version, expectedVersion);
    assertReportTransition('post', report.status);
    assertAccountingSeparationOfDuties({
      actorId,
      submitterId: report.user_id,
      action: 'post',
    });

    await client.query(
      `UPDATE expense_reports
       SET status = 'posted',
           posted_at = NOW(),
           posted_by = $2,
           posting_reference = $3,
           version = version + 1,
           updated_at = NOW()
       WHERE id = $1 AND version = $4`,
      [reportId, actorId, postingReference, expectedVersion]
    );

    await logAuditEvent({
      actorId,
      action: 'report.post',
      actionCategory: 'workflow',
      resourceType: 'expense_report',
      resourceId: reportId,
      resourceVersion: expectedVersion + 1,
      changes: { status: { from: report.status, to: 'posted' } },
      metadata: { posting_reference: postingReference },
      client,
    });
    await client.query('COMMIT');
    logger.info('Report posted', { reportId, actorId, postingReference });
    return { success: true };
  } catch (error) {
    await client.query('ROLLBACK');
    if ((error as { code?: string }).code === '23505') {
      throw new ConflictError('Posting reference has already been used');
    }
    throw error;
  } finally {
    client.release();
  }
}

/** Record settlement of a posted report. Posting and payment require different actors. */
export async function payReport(
  reportId: string,
  actorId: string,
  expectedVersion: number,
  paymentReference: string
): Promise<{ success: boolean }> {
  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    const result = await client.query<ExpenseReport>(
      `SELECT * FROM expense_reports
       WHERE id = $1 AND deleted_at IS NULL
       FOR UPDATE`,
      [reportId]
    );
    if (result.rows.length === 0) throw new NotFoundError('Expense report');
    const report = result.rows[0];

    assertExpectedVersion(report.version, expectedVersion);
    assertReportTransition('pay', report.status);
    assertAccountingSeparationOfDuties({
      actorId,
      submitterId: report.user_id,
      postedBy: report.posted_by,
      action: 'pay',
    });

    await client.query(
      `UPDATE expense_reports
       SET status = 'paid',
           paid_at = NOW(),
           paid_by = $2,
           payment_reference = $3,
           version = version + 1,
           updated_at = NOW()
       WHERE id = $1 AND version = $4`,
      [reportId, actorId, paymentReference, expectedVersion]
    );

    await logAuditEvent({
      actorId,
      action: 'report.pay',
      actionCategory: 'workflow',
      resourceType: 'expense_report',
      resourceId: reportId,
      resourceVersion: expectedVersion + 1,
      changes: { status: { from: report.status, to: 'paid' } },
      metadata: {
        posting_reference: report.posting_reference,
        payment_reference: paymentReference,
      },
      client,
    });
    await client.query('COMMIT');
    logger.info('Report payment recorded', { reportId, actorId, paymentReference });
    return { success: true };
  } catch (error) {
    await client.query('ROLLBACK');
    if ((error as { code?: string }).code === '23505') {
      throw new ConflictError('Payment reference has already been used');
    }
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Get current workflow status for a report
 */
export async function getReportWorkflowStatus(
  reportId: string,
  userId: string,
  permissions: string[]
): Promise<{
  status: string;
  currentStep: number | null;
  totalSteps: number;
  workflow: WorkflowDefinition | null;
  history: ApprovalHistory[];
} | null> {
  const reportResult = await db.query<ExpenseReport & { workflow_snapshot: string }>(
    `SELECT * FROM expense_reports WHERE id = $1 AND deleted_at IS NULL`,
    [reportId]
  );

  if (reportResult.rows.length === 0) {
    return null;
  }

  const report = reportResult.rows[0];
  const access = await canAccessReport(userId, reportId, permissions);
  if (!access.allowed) {
    throw new ForbiddenError(access.reason || 'Insufficient permissions to access this report');
  }

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
