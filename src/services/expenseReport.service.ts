import { db } from '../db/drizzle.js';
import { expenseReports, expenseLines, users, userRoles, rolePermissions, permissions, expenseReportFieldValues } from '../db/schema.js';
import type { ExpenseReport } from '../db/schema.js';
import { NotFoundError, ForbiddenError, ValidationError } from '../types/index.js';
import { query } from '../db/client.js';
import {
  eq, and, or, ilike, asc, desc, count, gt, isNull, inArray, sql, sum, type SQL,
} from 'drizzle-orm';
import { getOffset, type PaginationParams } from '../utils/pagination.js';
import { canAccessReport } from './approval.service.js';

export type { ExpenseReport };
export type ExpenseReportWithCustomFields = ExpenseReport & { customFields: Record<string, string | number | boolean> };

// WORK-0015: same pattern as expenseLine.service.ts's custom-field helpers —
// see the comment there for the raw-SQL-for-form-designer-tables rationale.
interface ReportCustomFieldDef {
  id: string;
  field_type: string;
}

async function getReportCustomFieldDefsByKey(): Promise<Map<string, ReportCustomFieldDef>> {
  const result = await query<ReportCustomFieldDef & { field_key: string }>(
    `SELECT fd.id, fd.field_key, fd.field_type
     FROM field_definitions fd
     JOIN form_definitions f ON f.id = fd.form_id
     WHERE f.screen_id = 'expense_report' AND f.status = 'published' AND fd.is_system_defined = false`
  );
  return new Map(result.rows.map((r) => [r.field_key, { id: r.id, field_type: r.field_type }]));
}

function coerceReportCustomFieldValue(fieldType: string, raw: string): string | number | boolean {
  if (fieldType === 'decimal') return Number(raw);
  if (fieldType === 'toggle') return raw === 'true';
  return raw;
}

async function setExpenseReportCustomFields(
  reportId: string,
  customFields: Record<string, string | number | boolean>
): Promise<void> {
  const defsByKey = await getReportCustomFieldDefsByKey();
  const unknown = Object.keys(customFields).filter((k) => !defsByKey.has(k));
  if (unknown.length > 0) {
    throw new ValidationError(`Unknown or non-custom field(s) on expense_report: ${unknown.join(', ')}`);
  }

  await db.delete(expenseReportFieldValues).where(eq(expenseReportFieldValues.expenseReportId, reportId));
  const entries = Object.entries(customFields);
  if (entries.length === 0) return;

  await db.insert(expenseReportFieldValues).values(
    entries.map(([key, value]) => ({
      expenseReportId: reportId,
      fieldId: defsByKey.get(key)!.id,
      value: String(value),
    }))
  );
}

async function getCustomFieldsForReports(
  reportIds: string[]
): Promise<Map<string, Record<string, string | number | boolean>>> {
  const result = new Map<string, Record<string, string | number | boolean>>();
  if (reportIds.length === 0) return result;

  const rows = await db
    .select({ expenseReportId: expenseReportFieldValues.expenseReportId, value: expenseReportFieldValues.value, fieldId: expenseReportFieldValues.fieldId })
    .from(expenseReportFieldValues)
    .where(inArray(expenseReportFieldValues.expenseReportId, reportIds));
  if (rows.length === 0) return result;

  const fieldIds = [...new Set(rows.map((r) => r.fieldId))];
  const defsResult = await query<{ id: string; field_key: string; field_type: string }>(
    `SELECT id, field_key, field_type FROM field_definitions WHERE id = ANY($1)`,
    [fieldIds]
  );
  const defsById = new Map(defsResult.rows.map((d) => [d.id, d]));

  for (const row of rows) {
    const def = defsById.get(row.fieldId);
    if (!def || row.value === null) continue;
    const existing = result.get(row.expenseReportId) ?? {};
    existing[def.field_key] = coerceReportCustomFieldValue(def.field_type, row.value);
    result.set(row.expenseReportId, existing);
  }
  return result;
}

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
  description?: string | null;
  reportDate?: string;
  totalAmount?: number;
  netAmount?: number;
  currency?: string;
  projectId?: string | null;
  projectName?: string | null;
  clientName?: string | null;
  tags?: string[] | null;
  submissionComment?: string | null;
  exchangeRate?: number | null;
  baseCurrencyTotal?: number | null;
  customFields?: Record<string, string | number | boolean>;
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
  customFields?: Record<string, string | number | boolean>;
}

export async function createExpenseReport(
  userId: string,
  input: CreateExpenseReportInput
): Promise<ExpenseReportWithCustomFields> {
  // Idempotent create
  if (input.clientId) {
    const [existing] = await db
      .select()
      .from(expenseReports)
      .where(eq(expenseReports.clientId, input.clientId))
      .limit(1);
    if (existing) {
      const customFieldsByReport = await getCustomFieldsForReports([existing.id]);
      return { ...existing, customFields: customFieldsByReport.get(existing.id) ?? {} };
    }
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

  if (input.customFields) {
    await setExpenseReportCustomFields(result.id, input.customFields);
  }
  return { ...toResponse(result, 0), customFields: input.customFields ?? {} };
}

export async function getExpenseReportById(
  reportId: string,
  userId: string,
  permissions_: string[] = []
): Promise<ExpenseReportWithCustomFields> {
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
  const customFieldsByReport = await getCustomFieldsForReports([report.id]);
  return { ...toResponse(report, computedTotal), customFields: customFieldsByReport.get(report.id) ?? {} };
}

// WORK-0023: explicit scope filter for the report list endpoint, mirroring
// canAccessReport's own/team/department/all dimensions (approval.service.ts:177+).
// 'team' is resolved recursively (direct + indirect reports), not just direct.
export type ReportListScope = 'own' | 'team' | 'department' | 'all';

async function getSubordinateUserIds(managerId: string): Promise<string[]> {
  const result = await query<{ id: string }>(
    `WITH RECURSIVE subordinates AS (
       SELECT id, manager_id, 1 as depth FROM users WHERE manager_id = $1
       UNION ALL
       SELECT u.id, u.manager_id, s.depth + 1
       FROM users u
       JOIN subordinates s ON u.manager_id = s.id
       WHERE s.depth < 20
     )
     SELECT id FROM subordinates`,
    [managerId]
  );
  return result.rows.map((r) => r.id);
}

async function getUserDepartmentId(userId: string): Promise<string | null> {
  const result = await query<{ department_id: string | null }>(
    `SELECT department_id FROM users WHERE id = $1`,
    [userId]
  );
  return result.rows[0]?.department_id ?? null;
}

// Resolves the requested scope into a WHERE condition, rejecting with 403 if
// the caller lacks the matching report.view.{scope} permission. 'own' needs no
// permission check so the no-param default stays identical to pre-WORK-0023
// behavior for every caller.
async function buildScopeCondition(
  userId: string,
  scope: ReportListScope,
  permissions: string[]
): Promise<SQL | undefined> {
  if (scope === 'own') {
    return eq(expenseReports.userId, userId);
  }

  const requiredPermission = `report.view.${scope}`;
  if (!new Set(permissions).has(requiredPermission)) {
    throw new ForbiddenError(`Requires ${requiredPermission} permission to use scope=${scope}`);
  }

  if (scope === 'all') {
    return undefined;
  }

  if (scope === 'team') {
    const subordinateIds = await getSubordinateUserIds(userId);
    return subordinateIds.length > 0 ? inArray(expenseReports.userId, subordinateIds) : sql`false`;
  }

  // department
  const departmentId = await getUserDepartmentId(userId);
  return departmentId ? eq(expenseReports.departmentId, departmentId) : sql`false`;
}

export async function listExpenseReports(
  userId: string,
  params: PaginationParams,
  status?: string,
  updatedSince?: string,
  scope: ReportListScope = 'own',
  permissions: string[] = []
): Promise<{ reports: ExpenseReportWithCustomFields[]; total: number }> {
  const isIncrementalSync = !!updatedSince;

  const conditions: (SQL | undefined)[] = [await buildScopeCondition(userId, scope, permissions)];

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
  const customFieldsByReport = await getCustomFieldsForReports(reportIds);
  const reports = rows.map((r) => ({ ...toResponse(r, totalsMap.get(r.id) ?? 0), customFields: customFieldsByReport.get(r.id) ?? {} }));

  return { reports, total };
}

export async function listExpenseReportSyncManifest(
  userId: string,
  params: PaginationParams
): Promise<{ items: { id: string; deletedAt: string | null }[]; total: number }> {
  const where = eq(expenseReports.userId, userId);

  const [rows, [{ total }]] = await Promise.all([
    db
      .select({ id: expenseReports.id, deletedAt: expenseReports.deletedAt })
      .from(expenseReports)
      .where(where)
      .orderBy(asc(expenseReports.id))
      .limit(params.limit)
      .offset(getOffset(params)),
    db.select({ total: count() }).from(expenseReports).where(where),
  ]);

  return { items: rows, total };
}

export async function updateExpenseReport(
  reportId: string,
  userId: string,
  input: UpdateExpenseReportInput,
  permissions_: string[] = []
): Promise<ExpenseReportWithCustomFields> {
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

  if (input.customFields !== undefined) {
    await setExpenseReportCustomFields(reportId, input.customFields);
  }

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

  const customFieldsByReport = await getCustomFieldsForReports([result.id]);
  return { ...toResponse(result, computedTotal), customFields: customFieldsByReport.get(result.id) ?? {} };
}

export async function deleteExpenseReport(
  reportId: string,
  userId: string,
  permissions_: string[] = []
): Promise<void> {
  await getExpenseReportById(reportId, userId, permissions_);

  await db.transaction(async (tx) => {
    await tx
      .update(expenseReports)
      .set({
        deletedAt: sql`NOW()`,
        updatedAt: sql`NOW()`,
        version: sql`version + 1`,
      })
      .where(eq(expenseReports.id, reportId));

    // Cascade: a deleted report's lines would otherwise be orphaned —
    // still live and editable, but unreachable since they're only ever
    // listed/reached through their (now-hidden) parent report.
    await tx
      .update(expenseLines)
      .set({
        deletedAt: sql`NOW()`,
        updatedAt: sql`NOW()`,
        version: sql`version + 1`,
      })
      .where(and(eq(expenseLines.reportId, reportId), isNull(expenseLines.deletedAt)));
  });
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
