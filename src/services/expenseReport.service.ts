import { db } from '../db/drizzle.js';
import { expenseReports, expenseLines, users, userRoles, rolePermissions, permissions } from '../db/schema.js';
import type { ExpenseReport } from '../db/schema.js';
import { NotFoundError, ForbiddenError } from '../types/index.js';
import {
  eq, and, or, ilike, asc, desc, count, gt, isNull, sql, sum, type SQL,
} from 'drizzle-orm';
import { getOffset, type PaginationParams } from '../utils/pagination.js';
import { canAccessReport } from './approval.service.js';

export type { ExpenseReport };

/**
 * Coerce all numeric/decimal fields that pg returns as strings to JS numbers,
 * and replace totalAmount/netAmount with the live sum from expense_lines.
 */
function toResponse(report: ExpenseReport, computedTotal: number): ExpenseReport {
  return {
    ...report,
    totalAmount: computedTotal,
    netAmount: computedTotal,
    exchangeRate: report.exchangeRate != null ? Number(report.exchangeRate) : null,
    baseCurrencyTotal: report.baseCurrencyTotal != null ? Number(report.baseCurrencyTotal) : null,
  };
}

/**
 * Fetch the live SUM(amount) of non-deleted expense lines for a report.
 */
async function computeTotal(reportId: string): Promise<number> {
  const [row] = await db
    .select({ total: sum(expenseLines.amount) })
    .from(expenseLines)
    .where(and(eq(expenseLines.reportId, reportId), isNull(expenseLines.deletedAt)));
  return Number(row?.total ?? 0);
}

export interface CreateExpenseReportInput {
  clientId?: string;
  title: string;
  description?: string;
  reportDate?: string;
  totalAmount?: number;
  netAmount?: number;
  currency?: string;
  projectId?: string;
  projectName?: string;
  clientName?: string;
  tags?: string[];
  submissionComment?: string;
  exchangeRate?: number;
  baseCurrencyTotal?: number;
}

export interface UpdateExpenseReportInput {
  title?: string;
  description?: string;
  status?: string;
  reportDate?: string;
  totalAmount?: number;
  netAmount?: number;
  currency?: string;
  projectId?: string | null;
  projectName?: string | null;
  clientName?: string | null;
  tags?: string[] | null;
  submissionComment?: string | null;
  rejectionReason?: string | null;
  paidAt?: string | null;
  paidBy?: string | null;
  exchangeRate?: number | null;
  baseCurrencyTotal?: number | null;
}

export async function createExpenseReport(
  userId: string,
  input: CreateExpenseReportInput
): Promise<ExpenseReport> {
  // Idempotent create
  if (input.clientId) {
    const [existing] = await db
      .select()
      .from(expenseReports)
      .where(eq(expenseReports.clientId, input.clientId))
      .limit(1);
    if (existing) return existing;
  }

  const today = new Date().toISOString().slice(0, 10);
  const [result] = await db
    .insert(expenseReports)
    .values({
      userId,
      clientId: input.clientId ?? null,
      title: input.title,
      description: input.description ?? null,
      reportDate: input.reportDate ?? today,
      totalAmount: 0,
      netAmount: 0,
      currency: input.currency ?? 'USD',
      projectId: input.projectId ?? null,
      projectName: input.projectName ?? null,
      clientName: input.clientName ?? null,
      tags: input.tags ?? null,
      submissionComment: input.submissionComment ?? null,
      exchangeRate: input.exchangeRate ?? 1.0,
      baseCurrencyTotal: input.baseCurrencyTotal ?? null,
    })
    .returning();

  return toResponse(result, 0);
}

export async function getExpenseReportById(
  reportId: string,
  userId: string,
  permissions_: string[] = []
): Promise<ExpenseReport> {
  const [report] = await db
    .select()
    .from(expenseReports)
    .where(eq(expenseReports.id, reportId))
    .limit(1);

  if (!report) {
    throw new NotFoundError('Expense report');
  }

  if (permissions_.length > 0) {
    const accessCheck = await canAccessReport(userId, reportId, permissions_);
    if (!accessCheck.allowed) {
      throw new ForbiddenError(accessCheck.reason ?? 'Access denied to this expense report');
    }
  } else {
    if (report.userId !== userId) {
      throw new ForbiddenError('Access denied to this expense report');
    }
  }

  const computedTotal = await computeTotal(reportId);
  return toResponse(report, computedTotal);
}

export async function listExpenseReports(
  userId: string,
  params: PaginationParams,
  status?: string,
  updatedSince?: string
): Promise<{ reports: ExpenseReport[]; total: number }> {
  const isIncrementalSync = !!updatedSince;

  const conditions: (SQL | undefined)[] = [eq(expenseReports.userId, userId)];

  if (isIncrementalSync) {
    conditions.push(gt(expenseReports.updatedAt, updatedSince!));
  } else {
    conditions.push(isNull(expenseReports.deletedAt));
    if (status) conditions.push(eq(expenseReports.status, status));
    if (params.search) {
      conditions.push(
        or(
          ilike(expenseReports.title, `%${params.search}%`),
          ilike(expenseReports.description, `%${params.search}%`)
        )
      );
    }
  }

  const where = and(...(conditions.filter(Boolean) as SQL[]));

  const sortColMap = {
    title: expenseReports.title,
    status: expenseReports.status,
    totalAmount: expenseReports.totalAmount,
    reportDate: expenseReports.reportDate,
    createdAt: expenseReports.createdAt,
    updatedAt: expenseReports.updatedAt,
    submittedAt: expenseReports.submittedAt,
  };
  const sortCol =
    params.sortBy && params.sortBy in sortColMap
      ? sortColMap[params.sortBy as keyof typeof sortColMap]
      : expenseReports.createdAt;
  const orderExpr = params.sortOrder === 'desc' ? desc(sortCol) : asc(sortCol);

  const [rows, [{ total }]] = await Promise.all([
    db
      .select()
      .from(expenseReports)
      .where(where)
      .orderBy(orderExpr)
      .limit(params.limit)
      .offset(getOffset(params)),
    db.select({ total: count() }).from(expenseReports).where(where),
  ]);

  // Compute live totals for all reports in one query
  const reportIds = rows.map((r) => r.id);
  const totalsByReport = reportIds.length > 0
    ? await db
        .select({ reportId: expenseLines.reportId, total: sum(expenseLines.amount) })
        .from(expenseLines)
        .where(and(
          sql`${expenseLines.reportId} = ANY(ARRAY[${sql.join(reportIds.map(id => sql`${id}::uuid`), sql`, `)}])`,
          isNull(expenseLines.deletedAt)
        ))
        .groupBy(expenseLines.reportId)
    : [];

  const totalsMap = new Map(totalsByReport.map((r) => [r.reportId, Number(r.total ?? 0)]));
  const reports = rows.map((r) => toResponse(r, totalsMap.get(r.id) ?? 0));

  return { reports, total };
}

export async function updateExpenseReport(
  reportId: string,
  userId: string,
  input: UpdateExpenseReportInput,
  permissions_: string[] = []
): Promise<ExpenseReport> {
  await getExpenseReportById(reportId, userId, permissions_);

  const updates: Partial<typeof expenseReports.$inferInsert> = {};
  if (input.title !== undefined) updates.title = input.title;
  if (input.description !== undefined) updates.description = input.description;
  if (input.status !== undefined) updates.status = input.status;
  if (input.reportDate !== undefined) updates.reportDate = input.reportDate;
  if (input.totalAmount !== undefined) updates.totalAmount = input.totalAmount;
  if (input.netAmount !== undefined) updates.netAmount = input.netAmount;
  if (input.currency !== undefined) updates.currency = input.currency;
  if (input.projectId !== undefined) updates.projectId = input.projectId;
  if (input.projectName !== undefined) updates.projectName = input.projectName;
  if (input.clientName !== undefined) updates.clientName = input.clientName;
  if (input.tags !== undefined) updates.tags = input.tags;
  if (input.submissionComment !== undefined) updates.submissionComment = input.submissionComment;
  if (input.rejectionReason !== undefined) updates.rejectionReason = input.rejectionReason;
  if (input.paidAt !== undefined) updates.paidAt = input.paidAt;
  if (input.paidBy !== undefined) updates.paidBy = input.paidBy;
  if (input.exchangeRate !== undefined) updates.exchangeRate = input.exchangeRate;
  if (input.baseCurrencyTotal !== undefined) updates.baseCurrencyTotal = input.baseCurrencyTotal;

  if (Object.keys(updates).length === 0) {
    return getExpenseReportById(reportId, userId, permissions_);
  }

  const [[result], computedTotal] = await Promise.all([
    db
      .update(expenseReports)
      .set({ ...updates, version: sql`version + 1` })
      .where(eq(expenseReports.id, reportId))
      .returning(),
    computeTotal(reportId),
  ]);

  return toResponse(result, computedTotal);
}

export async function deleteExpenseReport(
  reportId: string,
  userId: string,
  permissions_: string[] = []
): Promise<void> {
  await getExpenseReportById(reportId, userId, permissions_);

  await db
    .update(expenseReports)
    .set({
      deletedAt: sql`NOW()`,
      updatedAt: sql`NOW()`,
      version: sql`version + 1`,
    })
    .where(eq(expenseReports.id, reportId));
}

export async function verifyReportOwnership(
  reportId: string,
  userId: string,
  userPermissions?: string[]
): Promise<ExpenseReport> {
  let perms = userPermissions;
  if (!perms || perms.length === 0) {
    const rows = await db
      .selectDistinct({ name: permissions.name })
      .from(users)
      .innerJoin(userRoles, eq(users.id, userRoles.userId))
      .innerJoin(rolePermissions, eq(userRoles.roleId, rolePermissions.roleId))
      .innerJoin(permissions, eq(rolePermissions.permissionId, permissions.id))
      .where(eq(users.id, userId));
    perms = rows.map((r) => r.name);
  }

  return getExpenseReportById(reportId, userId, perms);
}
