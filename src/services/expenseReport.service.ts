import { query } from '../db/client.js';
import type { ExpenseReport } from '../types/index.js';
import { NotFoundError, ForbiddenError } from '../types/index.js';
import { getOffset, type PaginationParams } from '../utils/pagination.js';

export interface CreateExpenseReportInput {
  title: string;
  description?: string;
}

export interface UpdateExpenseReportInput {
  title?: string;
  description?: string;
  status?: 'draft' | 'submitted' | 'approved' | 'rejected';
}

export async function createExpenseReport(
  userId: string,
  input: CreateExpenseReportInput
): Promise<ExpenseReport> {
  const result = await query<ExpenseReport>(
    `INSERT INTO expense_reports (user_id, title, description)
     VALUES ($1, $2, $3)
     RETURNING *`,
    [userId, input.title, input.description ?? null]
  );

  return result.rows[0];
}

export async function getExpenseReportById(
  reportId: string,
  userId: string
): Promise<ExpenseReport> {
  const result = await query<ExpenseReport>(
    'SELECT * FROM expense_reports WHERE id = $1',
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

  const whereClause = conditions.join(' AND ');

  const [dataResult, countResult] = await Promise.all([
    query<ExpenseReport>(
      `SELECT * FROM expense_reports WHERE ${whereClause}
       ORDER BY created_at DESC
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

  const updates: string[] = [];
  const values: unknown[] = [];
  let paramIndex = 1;

  if (input.title !== undefined) {
    updates.push(`title = $${paramIndex}`);
    values.push(input.title);
    paramIndex++;
  }

  if (input.description !== undefined) {
    updates.push(`description = $${paramIndex}`);
    values.push(input.description);
    paramIndex++;
  }

  if (input.status !== undefined) {
    updates.push(`status = $${paramIndex}`);
    values.push(input.status);
    paramIndex++;
  }

  if (updates.length === 0) {
    return getExpenseReportById(reportId, userId);
  }

  values.push(reportId);

  const result = await query<ExpenseReport>(
    `UPDATE expense_reports SET ${updates.join(', ')}
     WHERE id = $${paramIndex}
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
