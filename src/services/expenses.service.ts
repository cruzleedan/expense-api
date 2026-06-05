import { db } from '../db/drizzle.js';
import { expenseLines, expenseReports } from '../db/schema.js';
import type { ExpenseLine, ExpenseReport } from '../db/schema.js';
import { sql } from 'drizzle-orm';
import { getOffset, type PaginationParams } from '../utils/pagination.js';

export type ExpenseItem =
  | ({ type: 'report' } & ExpenseReport)
  | ({ type: 'expense_line' } & ExpenseLine);

// Column lists must match the shape of ExpenseReport / ExpenseLine from the DB.
// We select a common set of discriminator + sortable columns, then fetch the full
// rows for each matching id in a second pass to avoid a giant SELECT *.
export async function listExpenses(
  userId: string,
  params: PaginationParams
): Promise<{ items: ExpenseItem[]; total: number }> {
  const search = params.search?.trim() ?? null;
  const likePattern = search ? `%${search.replace(/[%_\\]/g, '\\$&')}%` : null;
  const sortDir = params.sortOrder === 'asc' ? sql`ASC` : sql`DESC`;
  const limit = params.limit;
  const offset = getOffset(params);

  // UNION ALL: reports (not soft-deleted) + orphaned lines (line not deleted, report IS deleted)
  // Each branch emits: type, id, created_at (for sorting)
  const unionQuery = sql`
    SELECT 'report'       AS type,
           er.id,
           er.created_at
    FROM   ${expenseReports} er
    WHERE  er.user_id    = ${userId}
      AND  er.deleted_at IS NULL
      ${likePattern ? sql`AND er.title ILIKE ${likePattern}` : sql``}

    UNION ALL

    SELECT 'expense_line' AS type,
           el.id,
           el.created_at
    FROM   ${expenseLines} el
    JOIN   ${expenseReports} er ON er.id = el.report_id
    WHERE  er.user_id     = ${userId}
      AND  el.deleted_at  IS NULL
      AND  er.deleted_at  IS NOT NULL
      ${likePattern ? sql`AND (el.description ILIKE ${likePattern} OR el.merchant_name ILIKE ${likePattern})` : sql``}
  `;

  const [countResult, rowResult] = await Promise.all([
    db.execute<{ total: number }>(sql`SELECT COUNT(*) AS total FROM (${unionQuery}) sub`),
    db.execute<{ type: 'report' | 'expense_line'; id: string }>(
      sql`SELECT type, id FROM (${unionQuery}) sub ORDER BY created_at ${sortDir} LIMIT ${limit} OFFSET ${offset}`
    ),
  ]);

  const total = Number((countResult.rows[0] as any).total);
  const rows = rowResult.rows as Array<{ type: 'report' | 'expense_line'; id: string }>;

  if (rows.length === 0) return { items: [], total };

  // Fetch full rows for each type
  const reportIds = rows.filter((r) => r.type === 'report').map((r) => r.id);
  const lineIds = rows.filter((r) => r.type === 'expense_line').map((r) => r.id);

  const [reportRows, lineRows] = await Promise.all([
    reportIds.length > 0
      ? db.execute<ExpenseReport>(sql`SELECT * FROM ${expenseReports} WHERE id = ANY(ARRAY[${sql.join(reportIds.map((id) => sql`${id}::uuid`), sql`, `)}])`)
      : Promise.resolve({ rows: [] as ExpenseReport[] }),
    lineIds.length > 0
      ? db.execute<ExpenseLine>(sql`SELECT * FROM ${expenseLines} WHERE id = ANY(ARRAY[${sql.join(lineIds.map((id) => sql`${id}::uuid`), sql`, `)}])`)
      : Promise.resolve({ rows: [] as ExpenseLine[] }),
  ]);

  const reportMap = new Map(
    (reportRows.rows as ExpenseReport[]).map((r) => [r.id, r])
  );
  const lineMap = new Map(
    (lineRows.rows as ExpenseLine[]).map((l) => [l.id, l])
  );

  // Reorder to match the sorted union result
  const items: ExpenseItem[] = [];
  for (const r of rows) {
    if (r.type === 'report') {
      const report = reportMap.get(r.id);
      if (report) items.push({ type: 'report', ...report });
    } else {
      const line = lineMap.get(r.id);
      if (line) items.push({ type: 'expense_line', ...line });
    }
  }

  return { items, total };
}
