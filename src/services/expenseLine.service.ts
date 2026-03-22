import { query } from '../db/client.js';
import type { ExpenseLine } from '../types/index.js';
import { NotFoundError, ForbiddenError } from '../types/index.js';
import { verifyReportOwnership } from './expenseReport.service.js';
import { transaction } from '../db/client.js';
import { logger } from '../utils/logger.js';
import {
  getOffset,
  buildOrderByClause,
  buildSearchCondition,
  EXPENSE_LINE_SORTABLE_FIELDS,
  EXPENSE_LINE_SEARCHABLE_FIELDS,
  type PaginationParams,
} from '../utils/pagination.js';

export interface CreateExpenseLineInput {
  clientId?: string;
  description: string;
  amount: number;
  currency?: string;
  categoryCode?: string;
  transactionDate?: string;
  // v5.0 fields
  merchantName?: string;
  locationCity?: string;
  locationCountry?: string;
  paymentMethod?: string;
  originalAmount?: number;
  originalCurrency?: string;
  isBusinessExpense?: boolean;
  isReimbursable?: boolean;
  reimbursementStatus?: string;
  taxAmount?: number;
  taxRate?: number;
  notes?: string;
  latitude?: number;
  longitude?: number;
  projectId?: string;
  projectName?: string;
  clientName?: string;
  tags?: string[];
  isRecurring?: boolean;
  recurrencePattern?: string;
  recurrenceMerchant?: string;
}

export interface UpdateExpenseLineInput {
  description?: string;
  amount?: number;
  currency?: string;
  categoryCode?: string;
  transactionDate?: string;
  // v5.0 fields
  merchantName?: string;
  locationCity?: string;
  locationCountry?: string;
  paymentMethod?: string;
  originalAmount?: number;
  originalCurrency?: string;
  isBusinessExpense?: boolean;
  isReimbursable?: boolean;
  reimbursementStatus?: string;
  taxAmount?: number;
  taxRate?: number;
  notes?: string;
  latitude?: number;
  longitude?: number;
  projectId?: string;
  projectName?: string;
  clientName?: string;
  tags?: string[];
  isRecurring?: boolean;
  recurrencePattern?: string;
  recurrenceMerchant?: string;
}

export async function createExpenseLine(
  reportId: string,
  userId: string,
  input: CreateExpenseLineInput
): Promise<ExpenseLine> {
  // Verify user owns the report
  await verifyReportOwnership(reportId, userId);

  // Idempotent create: if a row with the same client_id already exists, return it.
  if (input.clientId) {
    const existing = await query<ExpenseLine>(
      `SELECT el.*, er.user_id, el.deleted_at
       FROM expense_lines el
       JOIN expense_reports er ON el.report_id = er.id
       WHERE el.client_id = $1
       LIMIT 1`,
      [input.clientId]
    );
    if (existing.rows.length > 0) {
      const { user_id: _, ...line } = existing.rows[0] as ExpenseLine & { user_id: string };
      return line as ExpenseLine;
    }
  }

  const result = await query<ExpenseLine>(
    `INSERT INTO expense_lines (
      report_id, client_id, description, amount, currency, category_code, transaction_date,
      merchant_name, location_city, location_country, payment_method,
      original_amount, original_currency,
      is_business_expense, is_reimbursable, reimbursement_status,
      tax_amount, tax_rate, notes, latitude, longitude,
      project_id, project_name, client_name, tags,
      is_recurring, recurrence_pattern, recurrence_merchant
    )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28)
     RETURNING *, deleted_at`,
    [
      reportId,
      input.clientId ?? null,
      input.description,
      input.amount,
      input.currency ?? 'USD',
      input.categoryCode ?? null,
      input.transactionDate,
      input.merchantName ?? null,
      input.locationCity ?? null,
      input.locationCountry ?? null,
      input.paymentMethod ?? null,
      input.originalAmount ?? null,
      input.originalCurrency ?? null,
      input.isBusinessExpense ?? false,
      input.isReimbursable ?? false,
      input.reimbursementStatus ?? 'not_applicable',
      input.taxAmount ?? 0,
      input.taxRate ?? 0,
      input.notes ?? null,
      input.latitude ?? null,
      input.longitude ?? null,
      input.projectId ?? null,
      input.projectName ?? null,
      input.clientName ?? null,
      input.tags ?? null,
      input.isRecurring ?? false,
      input.recurrencePattern ?? null,
      input.recurrenceMerchant ?? null,
    ]
  );

  return result.rows[0];
}

export async function getExpenseLineById(
  lineId: string,
  userId: string
): Promise<ExpenseLine> {
  const result = await query<ExpenseLine & { user_id: string }>(
    `SELECT
      el.id,
      el.report_id,
      el.client_id,
      el.description,
      el.amount,
      el.currency,
      el.category,
      el.category_code,
      el.category_path,
      TO_CHAR(el.transaction_date, 'YYYY-MM-DD') AS transaction_date,
      el.merchant_name,
      el.merchant_category,
      el.location_city,
      el.location_country,
      el.payment_method,
      el.project_id,
      el.project_name,
      el.client_name,
      el.tags,
      el.is_recurring,
      el.recurrence_pattern,
      el.recurrence_merchant,
      el.is_anomaly,
      el.anomaly_score,
      el.anomaly_reasons,
      el.version,
      el.created_at,
      el.updated_at,
      el.deleted_at,
      er.user_id
    FROM expense_lines el
    JOIN expense_reports er ON el.report_id = er.id
    WHERE el.id = $1
    `,
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
  params: PaginationParams,
  skipOwnershipCheck = false
): Promise<{ lines: ExpenseLine[]; total: number }> {
  // Verify user owns the report (skip for approvers)
  if (!skipOwnershipCheck) {
    await verifyReportOwnership(reportId, userId);
  }

  const offset = getOffset(params);
  const conditions = ['report_id = $1'];
  const values: unknown[] = [reportId];
  let paramIndex = 2;

  // Add search condition if provided
  const searchCondition = buildSearchCondition(
    params.search,
    EXPENSE_LINE_SEARCHABLE_FIELDS,
    paramIndex
  );
  if (searchCondition) {
    conditions.push(searchCondition.condition);
    values.push(searchCondition.value);
    paramIndex = searchCondition.nextParamIndex;
  }

  const whereClause = conditions.join(' AND ');

  // Only return non-deleted lines in normal list queries
  const baseWhere = `${whereClause} AND el.deleted_at IS NULL`;

  // Build ORDER BY clause with allowed fields, default to transaction_date DESC, created_at DESC
  const orderBy = buildOrderByClause(
    params,
    EXPENSE_LINE_SORTABLE_FIELDS,
    'transaction_date DESC, created_at DESC'
  );

  const [dataResult, countResult] = await Promise.all([
    query<ExpenseLine & { category_code: string | null }>(
      `SELECT el.*, ec.code AS category_code, el.deleted_at
       FROM expense_lines el
       LEFT JOIN expense_categories ec ON el.category_code = ec.code
       WHERE ${baseWhere.replace(/\b(?<!el\.)report_id\b/, 'el.report_id')}
       ORDER BY ${orderBy.replace(/\b(transaction_date|created_at)\b/g, 'el.$1')}
       LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
      [...values, params.limit, offset]
    ),
    query<{ count: string }>(
      `SELECT COUNT(*) as count FROM expense_lines WHERE ${baseWhere}`,
      values
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
    values.push(input.amount ?? 0);
    paramIndex++;
  }

  if (input.currency !== undefined) {
    updates.push(`currency = $${paramIndex}`);
    values.push(input.currency);
    paramIndex++;
  }

  if (input.categoryCode !== undefined) {
    updates.push(`category_code = $${paramIndex}`);
    values.push(input.categoryCode);
    paramIndex++;
  }

  if (input.transactionDate !== undefined) {
    updates.push(`transaction_date = $${paramIndex}`);
    values.push(input.transactionDate);
    paramIndex++;
  }

  if (input.merchantName !== undefined) {
    updates.push(`merchant_name = $${paramIndex}`);
    values.push(input.merchantName);
    paramIndex++;
  }

  if (input.locationCity !== undefined) {
    updates.push(`location_city = $${paramIndex}`);
    values.push(input.locationCity);
    paramIndex++;
  }

  if (input.locationCountry !== undefined) {
    updates.push(`location_country = $${paramIndex}`);
    values.push(input.locationCountry);
    paramIndex++;
  }

  if (input.paymentMethod !== undefined) {
    updates.push(`payment_method = $${paramIndex}`);
    values.push(input.paymentMethod);
    paramIndex++;
  }

  if (input.originalAmount !== undefined) {
    updates.push(`original_amount = $${paramIndex}`);
    values.push(input.originalAmount);
    paramIndex++;
  }

  if (input.originalCurrency !== undefined) {
    updates.push(`original_currency = $${paramIndex}`);
    values.push(input.originalCurrency);
    paramIndex++;
  }

  if (input.isBusinessExpense !== undefined) {
    updates.push(`is_business_expense = $${paramIndex}`);
    values.push(input.isBusinessExpense);
    paramIndex++;
  }

  if (input.isReimbursable !== undefined) {
    updates.push(`is_reimbursable = $${paramIndex}`);
    values.push(input.isReimbursable);
    paramIndex++;
  }

  if (input.reimbursementStatus !== undefined) {
    updates.push(`reimbursement_status = $${paramIndex}`);
    values.push(input.reimbursementStatus);
    paramIndex++;
  }

  if (input.taxAmount !== undefined) {
    updates.push(`tax_amount = $${paramIndex}`);
    values.push(input.taxAmount);
    paramIndex++;
  }

  if (input.taxRate !== undefined) {
    updates.push(`tax_rate = $${paramIndex}`);
    values.push(input.taxRate);
    paramIndex++;
  }

  if (input.notes !== undefined) {
    updates.push(`notes = $${paramIndex}`);
    values.push(input.notes);
    paramIndex++;
  }

  if (input.latitude !== undefined) {
    updates.push(`latitude = $${paramIndex}`);
    values.push(input.latitude);
    paramIndex++;
  }

  if (input.longitude !== undefined) {
    updates.push(`longitude = $${paramIndex}`);
    values.push(input.longitude);
    paramIndex++;
  }

  if (input.projectId !== undefined) {
    updates.push(`project_id = $${paramIndex}`);
    values.push(input.projectId);
    paramIndex++;
  }

  if (input.projectName !== undefined) {
    updates.push(`project_name = $${paramIndex}`);
    values.push(input.projectName);
    paramIndex++;
  }

  if (input.clientName !== undefined) {
    updates.push(`client_name = $${paramIndex}`);
    values.push(input.clientName);
    paramIndex++;
  }

  if (input.tags !== undefined) {
    updates.push(`tags = $${paramIndex}`);
    values.push(input.tags);
    paramIndex++;
  }

  if (input.isRecurring !== undefined) {
    updates.push(`is_recurring = $${paramIndex}`);
    values.push(input.isRecurring);
    paramIndex++;
  }

  if (input.recurrencePattern !== undefined) {
    updates.push(`recurrence_pattern = $${paramIndex}`);
    values.push(input.recurrencePattern);
    paramIndex++;
  }

  if (input.recurrenceMerchant !== undefined) {
    updates.push(`recurrence_merchant = $${paramIndex}`);
    values.push(input.recurrenceMerchant);
    paramIndex++;
  }

  if (updates.length === 0) {
    return getExpenseLineById(lineId, userId);
  }

  updates.push(`version = version + 1`);
  updates.push(`updated_at = NOW()`);
  values.push(lineId);

  const result = await query<ExpenseLine>(
    `UPDATE expense_lines SET ${updates.join(', ')}
     WHERE id = $${paramIndex}
     RETURNING *, deleted_at`,
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

  await query(
    `UPDATE expense_lines
     SET deleted_at = NOW(), updated_at = NOW(), version = version + 1
     WHERE id = $1`,
    [lineId]
  );
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

// Cross-report sync endpoint: returns all lines (including tombstones) for a user,
// optionally filtered to records updated after 'updatedSince'.
export async function listExpenseLinesForSync(
  userId: string,
  params: PaginationParams,
  updatedSince?: string
): Promise<{ lines: ExpenseLine[]; total: number }> {
  const values: unknown[] = [userId];
  let paramIndex = 2;
  const conditions: string[] = ['er.user_id = $1'];

  if (updatedSince) {
    conditions.push(`el.updated_at > $${paramIndex}`);
    values.push(updatedSince);
    paramIndex++;
  }

  const whereClause = conditions.join(' AND ');
  const offset = getOffset(params);

  const [dataResult, countResult] = await Promise.all([
    query<ExpenseLine>(
      `SELECT el.*, el.deleted_at
       FROM expense_lines el
       JOIN expense_reports er ON el.report_id = er.id
       WHERE ${whereClause}
       ORDER BY el.updated_at DESC
       LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
      [...values, params.limit, offset]
    ),
    query<{ count: string }>(
      `SELECT COUNT(*) as count
       FROM expense_lines el
       JOIN expense_reports er ON el.report_id = er.id
       WHERE ${whereClause}`,
      values
    ),
  ]);

  return {
    lines: dataResult.rows,
    total: parseInt(countResult.rows[0].count, 10),
  };
}


// Bulk create expense lines with optional receipt associations
export interface BulkCreateExpenseLineInput {
  description: string;
  transactionDate: string;
  amount: number;
  currency?: string;
  categoryCode?: string | null;
  receiptId?: string;
  // v5.0 fields
  merchantName?: string;
  locationCity?: string;
  locationCountry?: string;
  paymentMethod?: string;
  originalAmount?: number;
  originalCurrency?: string;
  isBusinessExpense?: boolean;
  isReimbursable?: boolean;
  reimbursementStatus?: string;
  taxAmount?: number;
  taxRate?: number;
  notes?: string;
  latitude?: number;
  longitude?: number;
  projectId?: string;
  projectName?: string;
  clientName?: string;
  tags?: string[];
  isRecurring?: boolean;
  recurrencePattern?: string;
  recurrenceMerchant?: string;
}

export interface BulkCreateExpenseLineResult {
  created: ExpenseLine[];
  failed: Array<{
    index: number;
    error: string;
  }>;
}

export async function bulkCreateExpenseLines(
  reportId: string,
  userId: string,
  lines: BulkCreateExpenseLineInput[]
): Promise<BulkCreateExpenseLineResult> {
  // Verify user owns the report
  await verifyReportOwnership(reportId, userId);

  // Get report currency for default
  const reportResult = await query<{ currency: string }>(
    'SELECT currency FROM expense_reports WHERE id = $1',
    [reportId]
  );
  const reportCurrency = reportResult.rows[0]?.currency || 'USD';

  const created: ExpenseLine[] = [];
  const failed: Array<{ index: number; error: string }> = [];

  // Use transaction for atomicity
  await transaction(async (client) => {
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      try {
        // Validate amount is positive
        if (line.amount <= 0) {
          failed.push({ index: i, error: 'Amount must be greater than 0' });
          continue;
        }

        // Validate description length
        if (line.description.length > 200) {
          failed.push({ index: i, error: 'Description exceeds 200 characters' });
          continue;
        }

        // Create the expense line
        const result = await client.query<ExpenseLine>(
          `INSERT INTO expense_lines (
            report_id, description, amount, currency, category_code, transaction_date,
            merchant_name, location_city, location_country, payment_method,
            original_amount, original_currency,
            is_business_expense, is_reimbursable, reimbursement_status,
            tax_amount, tax_rate, notes, latitude, longitude,
            project_id, project_name, client_name, tags,
            is_recurring, recurrence_pattern, recurrence_merchant
          )
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27)
           RETURNING *`,
          [
            reportId,
            line.description,
            line.amount,
            line.currency ?? reportCurrency,
            line.categoryCode ?? null,
            line.transactionDate,
            line.merchantName ?? null,
            line.locationCity ?? null,
            line.locationCountry ?? null,
            line.paymentMethod ?? null,
            line.originalAmount ?? null,
            line.originalCurrency ?? null,
            line.isBusinessExpense ?? false,
            line.isReimbursable ?? false,
            line.reimbursementStatus ?? 'not_applicable',
            line.taxAmount ?? 0,
            line.taxRate ?? 0,
            line.notes ?? null,
            line.latitude ?? null,
            line.longitude ?? null,
            line.projectId ?? null,
            line.projectName ?? null,
            line.clientName ?? null,
            line.tags ?? null,
            line.isRecurring ?? false,
            line.recurrencePattern ?? null,
            line.recurrenceMerchant ?? null,
          ]
        );

        const createdLine = result.rows[0];

        // If receiptId is provided, create the association
        if (line.receiptId) {
          try {
            // Verify receipt exists and belongs to the same report
            const receiptCheck = await client.query(
              'SELECT report_id FROM receipts WHERE id = $1',
              [line.receiptId]
            );

            if (receiptCheck.rows.length === 0) {
              failed.push({ index: i, error: `Receipt ${line.receiptId} not found` });
              continue;
            }

            if (receiptCheck.rows[0].report_id !== reportId) {
              failed.push({
                index: i,
                error: 'Receipt must belong to the same report'
              });
              continue;
            }

            // Create the association
            await client.query(
              `INSERT INTO receipt_line_associations (receipt_id, line_id)
               VALUES ($1, $2)
               ON CONFLICT (receipt_id, line_id) DO NOTHING`,
              [line.receiptId, createdLine.id]
            );

            logger.debug('Receipt-line association created', {
              receiptId: line.receiptId,
              lineId: createdLine.id,
            });
          } catch (assocError) {
            // Log the association error but don't fail the line creation
            logger.warn('Failed to create receipt association', {
              receiptId: line.receiptId,
              lineId: createdLine.id,
              error: assocError instanceof Error ? assocError.message : 'Unknown error',
            });
          }
        }

        created.push(createdLine);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        failed.push({ index: i, error: errorMessage });
        logger.warn('Failed to create expense line in bulk', {
          index: i,
          error: errorMessage,
        });
      }
    }
  });

  logger.info('Bulk expense lines created', {
    reportId,
    total: lines.length,
    created: created.length,
    failed: failed.length,
  });

  return { created, failed };
}
