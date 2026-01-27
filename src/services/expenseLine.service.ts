import { query } from '../db/client.js';
import type { ExpenseLine } from '../types/index.js';
import { NotFoundError, ForbiddenError } from '../types/index.js';
import { verifyReportOwnership } from './expenseReport.service.js';
import { getOffset, type PaginationParams } from '../utils/pagination.js';

export interface CreateExpenseLineInput {
  description: string;
  amount: number;
  currency?: string;
  category?: string;
  expense_date: string; // ISO date string
}

export interface UpdateExpenseLineInput {
  description?: string;
  amount?: number;
  currency?: string;
  category?: string;
  expense_date?: string;
}

export async function createExpenseLine(
  reportId: string,
  userId: string,
  input: CreateExpenseLineInput
): Promise<ExpenseLine> {
  // Verify user owns the report
  await verifyReportOwnership(reportId, userId);

  const result = await query<ExpenseLine>(
    `INSERT INTO expense_lines (report_id, description, amount, currency, category, expense_date)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [
      reportId,
      input.description,
      input.amount,
      input.currency ?? 'USD',
      input.category ?? null,
      input.expense_date,
    ]
  );

  return result.rows[0];
}

export async function getExpenseLineById(
  lineId: string,
  userId: string
): Promise<ExpenseLine> {
  const result = await query<ExpenseLine & { user_id: string }>(
    `SELECT el.*, er.user_id
     FROM expense_lines el
     JOIN expense_reports er ON el.report_id = er.id
     WHERE el.id = $1`,
    [lineId]
  );

  if (result.rows.length === 0) {
    throw new NotFoundError('Expense line');
  }

  const line = result.rows[0];

  if (line.user_id !== userId) {
    throw new ForbiddenError('Access denied to this expense line');
  }

  // Remove user_id from response
  const { user_id: _, ...expenseLine } = line;
  return expenseLine as ExpenseLine;
}

export async function listExpenseLines(
  reportId: string,
  userId: string,
  params: PaginationParams
): Promise<{ lines: ExpenseLine[]; total: number }> {
  // Verify user owns the report
  await verifyReportOwnership(reportId, userId);

  const offset = getOffset(params);

  const [dataResult, countResult] = await Promise.all([
    query<ExpenseLine>(
      `SELECT * FROM expense_lines WHERE report_id = $1
       ORDER BY expense_date DESC, created_at DESC
       LIMIT $2 OFFSET $3`,
      [reportId, params.limit, offset]
    ),
    query<{ count: string }>(
      'SELECT COUNT(*) as count FROM expense_lines WHERE report_id = $1',
      [reportId]
    ),
  ]);

  return {
    lines: dataResult.rows,
    total: parseInt(countResult.rows[0].count, 10),
  };
}

export async function updateExpenseLine(
  lineId: string,
  userId: string,
  input: UpdateExpenseLineInput
): Promise<ExpenseLine> {
  // First verify ownership
  await getExpenseLineById(lineId, userId);

  const updates: string[] = [];
  const values: unknown[] = [];
  let paramIndex = 1;

  if (input.description !== undefined) {
    updates.push(`description = $${paramIndex}`);
    values.push(input.description);
    paramIndex++;
  }

  if (input.amount !== undefined) {
    updates.push(`amount = $${paramIndex}`);
    values.push(input.amount);
    paramIndex++;
  }

  if (input.currency !== undefined) {
    updates.push(`currency = $${paramIndex}`);
    values.push(input.currency);
    paramIndex++;
  }

  if (input.category !== undefined) {
    updates.push(`category = $${paramIndex}`);
    values.push(input.category);
    paramIndex++;
  }

  if (input.expense_date !== undefined) {
    updates.push(`expense_date = $${paramIndex}`);
    values.push(input.expense_date);
    paramIndex++;
  }

  if (updates.length === 0) {
    return getExpenseLineById(lineId, userId);
  }

  values.push(lineId);

  const result = await query<ExpenseLine>(
    `UPDATE expense_lines SET ${updates.join(', ')}
     WHERE id = $${paramIndex}
     RETURNING *`,
    values
  );

  return result.rows[0];
}

export async function deleteExpenseLine(
  lineId: string,
  userId: string
): Promise<void> {
  // Verify ownership
  await getExpenseLineById(lineId, userId);

  await query('DELETE FROM expense_lines WHERE id = $1', [lineId]);
}

// Helper to verify line belongs to a specific report and user
export async function verifyLineOwnership(
  lineId: string,
  reportId: string,
  userId: string
): Promise<ExpenseLine> {
  const line = await getExpenseLineById(lineId, userId);

  if (line.report_id !== reportId) {
    throw new ForbiddenError('Expense line does not belong to this report');
  }

  return line;
}
