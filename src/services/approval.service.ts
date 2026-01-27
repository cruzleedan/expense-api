import { db } from '../db/client.js';
import { logger } from '../utils/logger.js';
import type { SelfApprovalCheckResult, ExpenseReport, ApprovalHistory } from '../types/index.js';

/**
 * Approval Service
 * Handles self-approval prevention, circular approval detection, and temporal separation
 */

// Circular approval detection window (30 days)
const CIRCULAR_APPROVAL_WINDOW_DAYS = 30;

// Same-department threshold for additional approval scrutiny
const SAME_DEPARTMENT_THRESHOLD = 1000;

/**
 * Comprehensive check if a user can approve a specific report
 * Implements all self-transaction prevention rules from SRS v3.0
 */
export async function canApproveReport(
  approverId: string,
  reportId: string
): Promise<SelfApprovalCheckResult> {
  // Get report details with submitter info
  const reportResult = await db.query<{
    user_id: string;
    submitter_email: string;
    department_id: string | null;
    total_amount: string | null;
    created_at: Date;
  }>(
    `SELECT er.user_id, u.email as submitter_email, er.department_id, er.total_amount, er.created_at
     FROM expense_reports er
     JOIN users u ON er.user_id = u.id
     WHERE er.id = $1`,
    [reportId]
  );

  if (reportResult.rows.length === 0) {
    return { allowed: false, reason: 'Report not found' };
  }

  const report = reportResult.rows[0];

  // Check 1: Direct self-approval
  if (report.user_id === approverId) {
    logger.warn('Self-approval attempt blocked', {
      approverId,
      reportId,
      check: 'direct_self',
    });
    return {
      allowed: false,
      reason: 'Cannot approve your own expense report',
      check_type: 'direct_self',
    };
  }

  // Check 2: Previous interaction in workflow (temporal separation)
  const previousActionResult = await db.query<{ action: string; created_at: Date }>(
    `SELECT action, created_at FROM approval_history
     WHERE report_id = $1 AND actor_id = $2
     ORDER BY created_at DESC
     LIMIT 1`,
    [reportId, approverId]
  );

  if (previousActionResult.rows.length > 0) {
    const previousAction = previousActionResult.rows[0];
    logger.warn('Temporal separation violation blocked', {
      approverId,
      reportId,
      previousAction: previousAction.action,
      check: 'temporal',
    });
    return {
      allowed: false,
      reason: `Cannot approve a report you have already acted on (previous action: ${previousAction.action})`,
      check_type: 'temporal',
    };
  }

  // Check 3: Same department/cost center rules for high-value reports
  const amount = report.total_amount ? parseFloat(report.total_amount) : 0;
  if (amount > SAME_DEPARTMENT_THRESHOLD && report.department_id) {
    const approverResult = await db.query<{ department_id: string | null }>(
      `SELECT department_id FROM users WHERE id = $1`,
      [approverId]
    );

    if (approverResult.rows.length > 0) {
      const approverDept = approverResult.rows[0].department_id;
      if (approverDept && approverDept === report.department_id) {
        logger.warn('Same-department approval blocked for high-value report', {
          approverId,
          reportId,
          amount,
          departmentId: report.department_id,
          check: 'same_entity',
        });
        return {
          allowed: false,
          reason: `Cannot approve same-department reports over $${SAME_DEPARTMENT_THRESHOLD}. Requires cross-department approval.`,
          check_type: 'same_entity',
        };
      }
    }
  }

  // Check 4: Circular approval detection (A approved B's report recently, B can't approve A's)
  const circularResult = await db.query<{ approver_report_count: string }>(
    `SELECT COUNT(*) as approver_report_count
     FROM approval_history ah
     JOIN expense_reports er ON ah.report_id = er.id
     WHERE ah.actor_id = $1
       AND er.user_id = $2
       AND ah.action = 'approve'
       AND ah.created_at > NOW() - INTERVAL '${CIRCULAR_APPROVAL_WINDOW_DAYS} days'`,
    [report.user_id, approverId]  // Check if submitter has approved approver's reports
  );

  if (circularResult.rows.length > 0 && parseInt(circularResult.rows[0].approver_report_count) > 0) {
    logger.warn('Circular approval pattern detected', {
      approverId,
      reportId,
      submitterId: report.user_id,
      check: 'circular',
    });
    return {
      allowed: false,
      reason: `Circular approval detected: the report submitter has approved your reports within the last ${CIRCULAR_APPROVAL_WINDOW_DAYS} days`,
      check_type: 'circular',
    };
  }

  // Check 5: Manager-subordinate relationship (approver should be in submitter's reporting chain)
  // This is a soft check - we log it but don't block
  const managerCheckResult = await db.query<{ is_manager: boolean }>(
    `WITH RECURSIVE manager_chain AS (
       SELECT id, manager_id, 1 as depth
       FROM users
       WHERE id = $1
       UNION ALL
       SELECT u.id, u.manager_id, mc.depth + 1
       FROM users u
       JOIN manager_chain mc ON u.id = mc.manager_id
       WHERE mc.depth < 10
     )
     SELECT EXISTS(SELECT 1 FROM manager_chain WHERE id = $2) as is_manager`,
    [report.user_id, approverId]
  );

  const isInReportingChain = managerCheckResult.rows[0]?.is_manager || false;
  if (!isInReportingChain) {
    logger.info('Approver not in submitter reporting chain (allowed but logged)', {
      approverId,
      reportId,
      submitterId: report.user_id,
    });
  }

  return { allowed: true };
}

/**
 * Check if user can take any action on a report (view, edit, etc.)
 */
export async function canAccessReport(
  userId: string,
  reportId: string,
  permissions: string[]
): Promise<{ allowed: boolean; reason?: string }> {
  const permSet = new Set(permissions);

  // If user has view.all, they can access any report
  if (permSet.has('report.view.all')) {
    return { allowed: true };
  }

  // Get report details
  const reportResult = await db.query<{
    user_id: string;
    department_id: string | null;
  }>(
    `SELECT user_id, department_id FROM expense_reports WHERE id = $1`,
    [reportId]
  );

  if (reportResult.rows.length === 0) {
    return { allowed: false, reason: 'Report not found' };
  }

  const report = reportResult.rows[0];

  // Check ownership
  if (report.user_id === userId && permSet.has('report.view.own')) {
    return { allowed: true };
  }

  // Check team access (user is manager of submitter)
  if (permSet.has('report.view.team')) {
    const isManagerResult = await db.query<{ is_manager: boolean }>(
      `SELECT EXISTS(
         SELECT 1 FROM users WHERE id = $1 AND manager_id = $2
       ) as is_manager`,
      [report.user_id, userId]
    );

    if (isManagerResult.rows[0]?.is_manager) {
      return { allowed: true };
    }
  }

  // Check department access
  if (permSet.has('report.view.department') && report.department_id) {
    const userDeptResult = await db.query<{ department_id: string | null }>(
      `SELECT department_id FROM users WHERE id = $1`,
      [userId]
    );

    if (userDeptResult.rows[0]?.department_id === report.department_id) {
      return { allowed: true };
    }
  }

  return { allowed: false, reason: 'Insufficient permissions to access this report' };
}

/**
 * Record an approval action in the history
 */
export async function recordApprovalAction(
  reportId: string,
  stepNumber: number,
  stepName: string,
  actorId: string,
  actorEmail: string,
  action: 'approve' | 'reject' | 'return' | 'escalate' | 'auto_approve',
  comment?: string,
  rejectionCategory?: string,
  slaDeadline?: Date,
  wasEscalated?: boolean
): Promise<ApprovalHistory> {
  // Generate hash of report state at time of action
  const reportHashResult = await db.query<{ report_hash: string }>(
    `SELECT encode(sha256(
       (SELECT row_to_json(r)::text FROM expense_reports r WHERE id = $1)::bytea
     ), 'hex') as report_hash`,
    [reportId]
  );
  const reportHash = reportHashResult.rows[0]?.report_hash;

  const result = await db.query<ApprovalHistory>(
    `INSERT INTO approval_history
     (report_id, step_number, step_name, actor_id, actor_email, action, comment, rejection_category, report_hash, sla_deadline, was_escalated)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     RETURNING *`,
    [reportId, stepNumber, stepName, actorId, actorEmail, action, comment || null, rejectionCategory || null, reportHash, slaDeadline || null, wasEscalated || false]
  );

  logger.info('Approval action recorded', {
    reportId,
    stepNumber,
    actorId,
    action,
  });

  return result.rows[0];
}

/**
 * Get approval history for a report
 */
export async function getApprovalHistory(reportId: string): Promise<ApprovalHistory[]> {
  const result = await db.query<ApprovalHistory>(
    `SELECT * FROM approval_history
     WHERE report_id = $1
     ORDER BY created_at ASC`,
    [reportId]
  );
  return result.rows;
}

/**
 * Get pending approvals for a user (reports waiting for their approval)
 */
export async function getPendingApprovalsForUser(
  userId: string,
  userRoles: string[],
  managerId?: string
): Promise<Array<{ report_id: string; title: string; submitter_email: string; amount: string; submitted_at: Date }>> {
  // This is a simplified implementation - in production, this would need to
  // consider the actual workflow step assignments

  // Get reports where:
  // 1. Status is 'submitted' or 'pending'
  // 2. User is either the assigned approver OR has the required role for current step
  // 3. User hasn't already acted on the report

  const result = await db.query<{
    report_id: string;
    title: string;
    submitter_email: string;
    amount: string;
    submitted_at: Date;
  }>(
    `SELECT er.id as report_id, er.title, u.email as submitter_email,
            COALESCE(er.total_amount, 0) as amount, er.submitted_at
     FROM expense_reports er
     JOIN users u ON er.user_id = u.id
     WHERE er.status IN ('submitted', 'pending')
       AND er.user_id != $1  -- Not own reports
       AND NOT EXISTS (
         SELECT 1 FROM approval_history ah
         WHERE ah.report_id = er.id AND ah.actor_id = $1
       )
       AND (
         -- User is direct manager of submitter
         u.manager_id = $1
         -- OR user has approver role and is in the same department
         OR (
           $2 = true AND u.department_id IN (
             SELECT department_id FROM users WHERE id = $1
           )
         )
       )
     ORDER BY er.submitted_at ASC`,
    [userId, userRoles.includes('approver')]
  );

  return result.rows;
}

/**
 * Validate that a report can be submitted (basic checks)
 */
export async function canSubmitReport(
  userId: string,
  reportId: string
): Promise<{ allowed: boolean; reason?: string }> {
  const reportResult = await db.query<{
    user_id: string;
    status: string;
    total_amount: string | null;
  }>(
    `SELECT user_id, status,
            (SELECT COALESCE(SUM(amount), 0) FROM expense_lines WHERE report_id = er.id) as total_amount
     FROM expense_reports er
     WHERE id = $1`,
    [reportId]
  );

  if (reportResult.rows.length === 0) {
    return { allowed: false, reason: 'Report not found' };
  }

  const report = reportResult.rows[0];

  // Must be owner
  if (report.user_id !== userId) {
    return { allowed: false, reason: 'Can only submit your own reports' };
  }

  // Must be in draft or returned status
  if (report.status !== 'draft' && report.status !== 'returned') {
    return { allowed: false, reason: `Cannot submit report in ${report.status} status` };
  }

  // Must have at least one expense line
  const lineCountResult = await db.query<{ count: string }>(
    `SELECT COUNT(*) as count FROM expense_lines WHERE report_id = $1`,
    [reportId]
  );

  if (parseInt(lineCountResult.rows[0].count) === 0) {
    return { allowed: false, reason: 'Report must have at least one expense line' };
  }

  return { allowed: true };
}
