import { query } from '../db/client.js';
import type { ExpenseReport } from '../types/index.js';
import { NotFoundError, ForbiddenError } from '../types/index.js';
import {
  getOffset,
  buildOrderByClause,
  buildSearchCondition,
  EXPENSE_REPORT_SORTABLE_FIELDS,
  EXPENSE_REPORT_SEARCHABLE_FIELDS,
  type PaginationParams,
} from '../utils/pagination.js';
import { buildUpdateFields } from '../utils/caseTransform.js';

export interface CreateExpenseReportInput {
  title: string;
  description?: string;
  reportDate?: string;
  totalAmount?: number;
  netAmount?: number;
  currency?: string;
  // v5.0 fields
  projectId?: string;
  projectName?: string;
  clientName?: string;
  tags?: string[];
}

export interface UpdateExpenseReportInput {
  title?: string;
  description?: string;
  reportDate?: string;
  status?: 'draft' | 'submitted' | 'approved' | 'rejected';
  totalAmount?: number;
  netAmount?: number;
  currency?: string;
  // v5.0 fields
  projectId?: string;
  projectName?: string;
  clientName?: string;
  tags?: string[];
}

export async function createExpenseReport(
  userId: string,
  input: CreateExpenseReportInput
): Promise<ExpenseReport> {
  const result = await query<ExpenseReport>(
    `INSERT INTO expense_reports (
      user_id,
      title,
      description,
      report_date,
      total_amount,
      net_amount,
      currency,
      project_id,
      project_name,
      client_name,
      tags
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
    RETURNING *`,
    [
      userId,
      input.title,
      input.description ?? null,
      input.reportDate ?? null,
      input.totalAmount ?? 0,
      input.netAmount ?? 0,
      input.currency ?? null,
      input.projectId ?? null,
      input.projectName ?? null,
      input.clientName ?? null,
      input.tags ?? null
    ]
  );

  return result.rows[0];
}

export async function getExpenseReportById(
  reportId: string,
  userId: string
): Promise<ExpenseReport> {
  const result = await query<ExpenseReport>(
    `SELECT
      id,
      user_id,
      title,
      description,
      status,
      department_id,
      cost_center,
      project_id,
      project_name,
      client_name,
      tags,
      total_amount,
      currency,
      workflow_id,
      workflow_snapshot,
      current_step,
      TO_CHAR(report_date, 'YYYY-MM-DD') AS report_date,
      submitted_at,
      approved_at,
      posted_at,
      version,
      created_at,
      updated_at
    FROM expense_reports
    WHERE id = $1`,
    [reportId]
  );

  if (result.rows.length === 0) {
    throw new NotFoundError('Expense report');
  }

  const report = result.rows[0];

  if (report.user_id !== userId) {
    throw new ForbiddenError('Access denied to this expense report');
  }

  return report;
}

export async function listExpenseReports(
  userId: string,
  params: PaginationParams,
  status?: string
): Promise<{ reports: ExpenseReport[]; total: number }> {
  const offset = getOffset(params);
  const conditions = ['user_id = $1'];
  const values: unknown[] = [userId];
  let paramIndex = 2;

  if (status) {
    conditions.push(`status = $${paramIndex}`);
    values.push(status);
    paramIndex++;
  }

  // Add search condition if provided
  const searchCondition = buildSearchCondition(
    params.search,
    EXPENSE_REPORT_SEARCHABLE_FIELDS,
    paramIndex
  );
  if (searchCondition) {
    conditions.push(searchCondition.condition);
    values.push(searchCondition.value);
    paramIndex = searchCondition.nextParamIndex;
  }

  const whereClause = conditions.join(' AND ');

  // Build ORDER BY clause with allowed fields, default to created_at DESC
  const orderBy = buildOrderByClause(
    params,
    EXPENSE_REPORT_SORTABLE_FIELDS,
    'created_at DESC'
  );

  const [dataResult, countResult] = await Promise.all([
    query<ExpenseReport>(
      `SELECT * FROM expense_reports WHERE ${whereClause}
       ORDER BY ${orderBy}
       LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
      [...values, params.limit, offset]
    ),
    query<{ count: string }>(
      `SELECT COUNT(*) as count FROM expense_reports WHERE ${whereClause}`,
      values
    ),
  ]);

  return {
    reports: dataResult.rows,
    total: parseInt(countResult.rows[0].count, 10),
  };
}

export async function updateExpenseReport(
  reportId: string,
  userId: string,
  input: UpdateExpenseReportInput
): Promise<ExpenseReport> {
  // First check ownership
  await getExpenseReportById(reportId, userId);

  const fieldMap = {
    title: 'title',
    description: 'description',
    status: 'status',
    reportDate: 'report_date',
    totalAmount: 'total_amount',
    netAmount: 'net_amount',
    currency: 'currency',
    projectId: 'project_id',
    projectName: 'project_name',
    clientName: 'client_name',
    tags: 'tags',
  } as const;

  const { updates, values, nextIndex } = buildUpdateFields(input, fieldMap);

  if (updates.length === 0) {
    return getExpenseReportById(reportId, userId);
  }

  values.push(reportId);

  const result = await query<ExpenseReport>(
    `UPDATE expense_reports SET ${updates.join(', ')}
     WHERE id = $${nextIndex}
     RETURNING *`,
    values
  );

  return result.rows[0];
}

export async function deleteExpenseReport(
  reportId: string,
  userId: string
): Promise<void> {
  // Check ownership
  await getExpenseReportById(reportId, userId);

  await query('DELETE FROM expense_reports WHERE id = $1', [reportId]);
}

// Helper to verify report ownership (used by other services)
export async function verifyReportOwnership(
  reportId: string,
  userId: string
): Promise<ExpenseReport> {
  return getExpenseReportById(reportId, userId);
}
