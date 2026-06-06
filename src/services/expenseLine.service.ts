import { db } from '../db/drizzle.js';
import { expenseLines, expenseReports, receipts, receiptLineAssociations } from '../db/schema.js';
import type { ExpenseLine } from '../db/schema.js';
import { NotFoundError, ForbiddenError } from '../types/index.js';
import { verifyReportOwnership } from './expenseReport.service.js';
import { logger } from '../utils/logger.js';
import {
  eq, and, or, ilike, asc, desc, count, gt, isNull, sql, type SQL,
} from 'drizzle-orm';
import { getOffset, type PaginationParams } from '../utils/pagination.js';

export type { ExpenseLine };

export interface CreateExpenseLineInput {
  clientId?: string;
  description: string;
  amount: number;
  currency?: string;
  categoryCode?: string;
  transactionDate?: string;
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
  projectId?: string | null;
  projectName?: string;
  clientName?: string;
  tags?: string[] | null;
  isRecurring?: boolean;
  recurrencePattern?: string;
  recurrenceMerchant?: string;
}

export async function createExpenseLine(
  userId: string,
  input: CreateExpenseLineInput,
  reportId?: string
): Promise<ExpenseLine> {
  if (reportId) {
    await verifyReportOwnership(reportId, userId);
  }

  // Idempotent create
  if (input.clientId) {
    const [existing] = await db
      .select()
      .from(expenseLines)
      .where(eq(expenseLines.clientId, input.clientId))
      .limit(1);
    if (existing) return existing;
  }

  const today = new Date().toISOString().slice(0, 10);
  const [result] = await db
    .insert(expenseLines)
    .values({
      reportId: reportId ?? null,
      userId,
      clientId: input.clientId ?? null,
      description: input.description,
      amount: input.amount,
      currency: input.currency ?? 'USD',
      categoryCode: input.categoryCode ?? null,
      expenseDate: input.transactionDate ?? today,
      merchantName: input.merchantName ?? null,
      locationCity: input.locationCity ?? null,
      locationCountry: input.locationCountry ?? null,
      paymentMethod: input.paymentMethod ?? null,
      originalAmount: input.originalAmount ?? null,
      originalCurrency: input.originalCurrency ?? null,
      isBusinessExpense: input.isBusinessExpense ?? false,
      isReimbursable: input.isReimbursable ?? false,
      reimbursementStatus: input.reimbursementStatus ?? 'not_applicable',
      taxAmount: input.taxAmount ?? 0,
      taxRate: input.taxRate ?? 0,
      notes: input.notes ?? null,
      latitude: input.latitude ?? null,
      longitude: input.longitude ?? null,
      projectId: input.projectId ?? null,
      projectName: input.projectName ?? null,
      clientName: input.clientName ?? null,
      tags: input.tags ?? null,
      isRecurring: input.isRecurring ?? false,
      recurrencePattern: input.recurrencePattern ?? null,
      recurrenceMerchant: input.recurrenceMerchant ?? null,
    })
    .returning();

  return result;
}

export async function getExpenseLineById(
  lineId: string,
  userId: string
): Promise<ExpenseLine> {
  const [result] = await db
    .select()
    .from(expenseLines)
    .where(eq(expenseLines.id, lineId))
    .limit(1);

  if (!result) {
    throw new NotFoundError('Expense line');
  }

  // Ownership: either directly via userId, or via the parent report
  if (result.userId !== userId) {
    if (result.reportId) {
      const [report] = await db
        .select({ userId: expenseReports.userId })
        .from(expenseReports)
        .where(eq(expenseReports.id, result.reportId))
        .limit(1);
      if (report?.userId !== userId) {
        throw new ForbiddenError('Access denied to this expense line');
      }
    } else {
      throw new ForbiddenError('Access denied to this expense line');
    }
  }

  return result;
}

export async function listExpenseLines(
  reportId: string,
  userId: string,
  params: PaginationParams,
  skipOwnershipCheck = false
): Promise<{ lines: ExpenseLine[]; total: number }> {
  if (!skipOwnershipCheck) {
    await verifyReportOwnership(reportId, userId);
  }

  const searchCond: SQL | undefined = params.search
    ? or(
        ilike(expenseLines.description, `%${params.search}%`),
        ilike(expenseLines.category, `%${params.search}%`)
      )
    : undefined;

  const where = and(
    eq(expenseLines.reportId, reportId),
    isNull(expenseLines.deletedAt),
    searchCond
  );

  const sortColMap = {
    description: expenseLines.description,
    amount: expenseLines.amount,
    expenseDate: expenseLines.expenseDate,
    transactionDate: expenseLines.expenseDate,
    category: expenseLines.category,
    createdAt: expenseLines.createdAt,
  };
  const sortCol =
    params.sortBy && params.sortBy in sortColMap
      ? sortColMap[params.sortBy as keyof typeof sortColMap]
      : expenseLines.expenseDate;
  const orderExpr = params.sortOrder === 'desc' ? desc(sortCol) : asc(sortCol);

  const [rows, [{ total }]] = await Promise.all([
    db
      .select()
      .from(expenseLines)
      .where(where)
      .orderBy(orderExpr, desc(expenseLines.createdAt))
      .limit(params.limit)
      .offset(getOffset(params)),
    db.select({ total: count() }).from(expenseLines).where(where),
  ]);

  return { lines: rows, total };
}

export async function updateExpenseLine(
  lineId: string,
  userId: string,
  input: UpdateExpenseLineInput
): Promise<ExpenseLine> {
  await getExpenseLineById(lineId, userId);

  const updates: Partial<typeof expenseLines.$inferInsert> = {};
  if (input.description !== undefined) updates.description = input.description;
  if (input.amount !== undefined) updates.amount = input.amount ?? 0;
  if (input.currency !== undefined) updates.currency = input.currency;
  if (input.categoryCode !== undefined) updates.categoryCode = input.categoryCode;
  if (input.transactionDate !== undefined) updates.expenseDate = input.transactionDate;
  if (input.merchantName !== undefined) updates.merchantName = input.merchantName;
  if (input.locationCity !== undefined) updates.locationCity = input.locationCity;
  if (input.locationCountry !== undefined) updates.locationCountry = input.locationCountry;
  if (input.paymentMethod !== undefined) updates.paymentMethod = input.paymentMethod;
  if (input.originalAmount !== undefined) updates.originalAmount = input.originalAmount;
  if (input.originalCurrency !== undefined) updates.originalCurrency = input.originalCurrency;
  if (input.isBusinessExpense !== undefined) updates.isBusinessExpense = input.isBusinessExpense;
  if (input.isReimbursable !== undefined) updates.isReimbursable = input.isReimbursable;
  if (input.reimbursementStatus !== undefined) updates.reimbursementStatus = input.reimbursementStatus;
  if (input.taxAmount !== undefined) updates.taxAmount = input.taxAmount;
  if (input.taxRate !== undefined) updates.taxRate = input.taxRate;
  if (input.notes !== undefined) updates.notes = input.notes;
  if (input.latitude !== undefined) updates.latitude = input.latitude;
  if (input.longitude !== undefined) updates.longitude = input.longitude;
  if (input.projectId !== undefined) updates.projectId = input.projectId;
  if (input.projectName !== undefined) updates.projectName = input.projectName;
  if (input.clientName !== undefined) updates.clientName = input.clientName;
  if (input.tags !== undefined) updates.tags = input.tags;
  if (input.isRecurring !== undefined) updates.isRecurring = input.isRecurring;
  if (input.recurrencePattern !== undefined) updates.recurrencePattern = input.recurrencePattern;
  if (input.recurrenceMerchant !== undefined) updates.recurrenceMerchant = input.recurrenceMerchant;

  if (Object.keys(updates).length === 0) {
    return getExpenseLineById(lineId, userId);
  }

  const [result] = await db
    .update(expenseLines)
    .set({ ...updates, version: sql`version + 1`, updatedAt: sql`NOW()` })
    .where(eq(expenseLines.id, lineId))
    .returning();

  return result;
}

export async function deleteExpenseLine(lineId: string, userId: string): Promise<void> {
  await getExpenseLineById(lineId, userId);

  await db
    .update(expenseLines)
    .set({
      deletedAt: sql`NOW()`,
      updatedAt: sql`NOW()`,
      version: sql`version + 1`,
    })
    .where(eq(expenseLines.id, lineId));
}

export async function verifyLineOwnership(
  lineId: string,
  reportId: string,
  userId: string
): Promise<ExpenseLine> {
  const line = await getExpenseLineById(lineId, userId);

  if (line.reportId !== reportId) {
    throw new ForbiddenError('Expense line does not belong to this report');
  }

  return line;
}

export async function listOrphanedExpenseLines(
  userId: string,
  params: PaginationParams
): Promise<{ lines: ExpenseLine[]; total: number }> {
  const where = and(
    eq(expenseLines.userId, userId),
    isNull(expenseLines.deletedAt),
    isNull(expenseLines.reportId)
  );

  const [rows, [{ total }]] = await Promise.all([
    db
      .select()
      .from(expenseLines)
      .where(where)
      .orderBy(desc(expenseLines.createdAt))
      .limit(params.limit)
      .offset(getOffset(params)),
    db.select({ total: count() }).from(expenseLines).where(where),
  ]);

  return { lines: rows, total };
}

export async function attachLinesToReport(
  reportId: string,
  userId: string,
  lineIds: string[]
): Promise<void> {
  const [report] = await db
    .select({ userId: expenseReports.userId })
    .from(expenseReports)
    .where(and(eq(expenseReports.id, reportId), isNull(expenseReports.deletedAt)))
    .limit(1);
  if (!report) throw new NotFoundError('Expense report');
  if (report.userId !== userId) throw new ForbiddenError('Access denied to this expense report');

  // Verify all lines belong to this user and are currently unattached
  const owned = await db
    .select({ id: expenseLines.id })
    .from(expenseLines)
    .where(
      and(
        eq(expenseLines.userId, userId),
        isNull(expenseLines.reportId),
        isNull(expenseLines.deletedAt),
        sql`${expenseLines.id} = ANY(ARRAY[${sql.join(lineIds.map((id) => sql`${id}::uuid`), sql`, `)}])`
      )
    );

  const foundIds = new Set(owned.map((r) => r.id));
  const missing = lineIds.filter((id) => !foundIds.has(id));
  if (missing.length > 0) {
    throw new ForbiddenError(`Lines not found or already attached: ${missing.join(', ')}`);
  }

  await db
    .update(expenseLines)
    .set({ reportId, updatedAt: sql`NOW()`, version: sql`version + 1` })
    .where(
      sql`id = ANY(ARRAY[${sql.join(lineIds.map((id) => sql`${id}::uuid`), sql`, `)}])`
    );

}

export async function listExpenseLinesForSync(
  userId: string,
  params: PaginationParams,
  updatedSince?: string
): Promise<{ lines: ExpenseLine[]; total: number }> {
  const conditions: (SQL | undefined)[] = [
    eq(expenseLines.userId, userId),
    updatedSince ? gt(expenseLines.updatedAt, updatedSince) : undefined,
  ];
  const where = and(...(conditions.filter(Boolean) as SQL[]));

  const [rows, [{ total }]] = await Promise.all([
    db
      .select()
      .from(expenseLines)
      .where(where)
      .orderBy(desc(expenseLines.updatedAt))
      .limit(params.limit)
      .offset(getOffset(params)),
    db.select({ total: count() }).from(expenseLines).where(where),
  ]);

  return { lines: rows, total };
}

export interface BulkCreateExpenseLineInput {
  description: string;
  transactionDate: string;
  amount: number;
  currency?: string;
  categoryCode?: string | null;
  receiptId?: string;
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
  failed: Array<{ index: number; error: string }>;
}

export async function bulkCreateExpenseLines(
  reportId: string,
  userId: string,
  lines: BulkCreateExpenseLineInput[]
): Promise<BulkCreateExpenseLineResult> {
  await verifyReportOwnership(reportId, userId);

  const [reportRow] = await db
    .select({ currency: expenseReports.currency })
    .from(expenseReports)
    .where(eq(expenseReports.id, reportId))
    .limit(1);
  const reportCurrency = reportRow?.currency ?? 'USD';

  const created: ExpenseLine[] = [];
  const failed: Array<{ index: number; error: string }> = [];

  await db.transaction(async (tx) => {
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      try {
        if (line.amount <= 0) {
          failed.push({ index: i, error: 'Amount must be greater than 0' });
          continue;
        }
        if (line.description.length > 200) {
          failed.push({ index: i, error: 'Description exceeds 200 characters' });
          continue;
        }

        const [createdLine] = await tx
          .insert(expenseLines)
          .values({
            reportId,
            description: line.description,
            amount: line.amount,
            currency: line.currency ?? reportCurrency,
            categoryCode: line.categoryCode ?? null,
            expenseDate: line.transactionDate,
            merchantName: line.merchantName ?? null,
            locationCity: line.locationCity ?? null,
            locationCountry: line.locationCountry ?? null,
            paymentMethod: line.paymentMethod ?? null,
            originalAmount: line.originalAmount ?? null,
            originalCurrency: line.originalCurrency ?? null,
            isBusinessExpense: line.isBusinessExpense ?? false,
            isReimbursable: line.isReimbursable ?? false,
            reimbursementStatus: line.reimbursementStatus ?? 'not_applicable',
            taxAmount: line.taxAmount ?? 0,
            taxRate: line.taxRate ?? 0,
            notes: line.notes ?? null,
            latitude: line.latitude ?? null,
            longitude: line.longitude ?? null,
            projectId: line.projectId ?? null,
            projectName: line.projectName ?? null,
            clientName: line.clientName ?? null,
            tags: line.tags ?? null,
            isRecurring: line.isRecurring ?? false,
            recurrencePattern: line.recurrencePattern ?? null,
            recurrenceMerchant: line.recurrenceMerchant ?? null,
          })
          .returning();

        if (line.receiptId) {
          try {
            const [receipt] = await tx
              .select({ userId: receipts.userId })
              .from(receipts)
              .where(eq(receipts.id, line.receiptId))
              .limit(1);

            if (!receipt) {
              failed.push({ index: i, error: `Receipt ${line.receiptId} not found` });
              continue;
            }
            if (receipt.userId !== userId) {
              failed.push({ index: i, error: 'Access denied to this receipt' });
              continue;
            }

            await tx
              .insert(receiptLineAssociations)
              .values({ receiptId: line.receiptId, lineId: createdLine.id })
              .onConflictDoNothing();

            logger.debug('Receipt-line association created', {
              receiptId: line.receiptId,
              lineId: createdLine.id,
            });
          } catch (assocError) {
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
        logger.warn('Failed to create expense line in bulk', { index: i, error: errorMessage });
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
