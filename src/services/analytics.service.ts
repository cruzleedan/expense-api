import { query } from '../db/client.js';

// ============================================================================
// Types
// ============================================================================

export interface CategorySpending {
  category: string;
  total: number;
  count: number;
}

export interface SpendingTrendPoint {
  period: string;
  total: number;
  count: number;
}

export interface DashboardSummary {
  totalReports: number;
  draftCount: number;
  pendingCount: number;
  approvedCount: number;
  rejectedCount: number;
  totalAmount: number;
}

export interface TopMerchant {
  merchant: string;
  total: number;
  count: number;
}

export interface CategoryTrendPoint {
  period: string;
  category: string;
  total: number;
}

export interface PeriodComparison {
  current: { total: number; count: number; avgTransaction: number };
  previous: { total: number; count: number; avgTransaction: number };
  change: { amountPct: number | null; countPct: number | null };
}

// ============================================================================
// Spending by Category
// ============================================================================

export async function getSpendingByCategory(
  userId: string,
  days: number = 30
): Promise<CategorySpending[]> {
  const result = await query<CategorySpending>(
    `SELECT category, SUM(amount)::numeric AS total, COUNT(*)::int AS count
     FROM mv_expense_analytics
     WHERE user_id = $1
       AND transaction_date >= CURRENT_DATE - ($2 || ' days')::interval
     GROUP BY category
     ORDER BY total DESC`,
    [userId, days]
  );
  return result.rows;
}

// ============================================================================
// Monthly Spending Trend
// ============================================================================

export async function getSpendingTrend(
  userId: string,
  months: number = 12
): Promise<SpendingTrendPoint[]> {
  const result = await query<SpendingTrendPoint>(
    `SELECT
       TO_CHAR(DATE_TRUNC('month', transaction_date), 'YYYY-MM') AS period,
       SUM(amount)::numeric AS total,
       COUNT(*)::int AS count
     FROM mv_expense_analytics
     WHERE user_id = $1
       AND transaction_date >= DATE_TRUNC('month', CURRENT_DATE) - ($2 || ' months')::interval
     GROUP BY DATE_TRUNC('month', transaction_date)
     ORDER BY period ASC`,
    [userId, months]
  );
  return result.rows;
}

// ============================================================================
// Period Comparison
// ============================================================================

export async function getPeriodComparison(
  userId: string,
  periodType: 'month' | 'quarter' = 'month'
): Promise<PeriodComparison> {
  const interval = periodType === 'month' ? '1 month' : '3 months';

  const result = await query<{
    period_label: string;
    total: number;
    count: number;
    avg_transaction: number;
  }>(
    `SELECT
       CASE
         WHEN transaction_date >= DATE_TRUNC($2, CURRENT_DATE) THEN 'current'
         ELSE 'previous'
       END AS period_label,
       SUM(amount)::numeric AS total,
       COUNT(*)::int AS count,
       COALESCE(AVG(amount), 0)::numeric AS avg_transaction
     FROM mv_expense_analytics
     WHERE user_id = $1
       AND transaction_date >= DATE_TRUNC($2, CURRENT_DATE) - $3::interval
     GROUP BY period_label`,
    [userId, periodType, interval]
  );

  const current = result.rows.find(r => r.period_label === 'current');
  const previous = result.rows.find(r => r.period_label === 'previous');

  const cur = {
    total: Number(current?.total ?? 0),
    count: current?.count ?? 0,
    avgTransaction: Number(current?.avg_transaction ?? 0),
  };
  const prev = {
    total: Number(previous?.total ?? 0),
    count: previous?.count ?? 0,
    avgTransaction: Number(previous?.avg_transaction ?? 0),
  };

  return {
    current: cur,
    previous: prev,
    change: {
      amountPct: prev.total > 0 ? ((cur.total - prev.total) / prev.total) * 100 : null,
      countPct: prev.count > 0 ? ((cur.count - prev.count) / prev.count) * 100 : null,
    },
  };
}

// ============================================================================
// Dashboard Summary
// ============================================================================

export async function getDashboardSummary(
  userId: string
): Promise<DashboardSummary> {
  const result = await query<{
    total_reports: number;
    draft_count: number;
    pending_count: number;
    approved_count: number;
    rejected_count: number;
    total_amount: number;
  }>(
    `SELECT
       COUNT(*)::int AS total_reports,
       COUNT(*) FILTER (WHERE status = 'draft')::int AS draft_count,
       COUNT(*) FILTER (WHERE status IN ('submitted', 'pending'))::int AS pending_count,
       COUNT(*) FILTER (WHERE status IN ('approved', 'posted'))::int AS approved_count,
       COUNT(*) FILTER (WHERE status IN ('rejected', 'returned'))::int AS rejected_count,
       COALESCE(SUM(total_amount), 0)::numeric AS total_amount
     FROM expense_reports
     WHERE user_id = $1`,
    [userId]
  );
  const row = result.rows[0];
  return {
    totalReports: row.total_reports,
    draftCount: row.draft_count,
    pendingCount: row.pending_count,
    approvedCount: row.approved_count,
    rejectedCount: row.rejected_count,
    totalAmount: Number(row.total_amount),
  };
}

// ============================================================================
// Top Merchants
// ============================================================================

export async function getTopMerchants(
  userId: string,
  days: number = 30,
  limit: number = 10
): Promise<TopMerchant[]> {
  const result = await query<TopMerchant>(
    `SELECT
       merchant_name AS merchant,
       SUM(amount)::numeric AS total,
       COUNT(*)::int AS count
     FROM mv_expense_analytics
     WHERE user_id = $1
       AND transaction_date >= CURRENT_DATE - ($2 || ' days')::interval
       AND merchant_name IS NOT NULL
     GROUP BY merchant_name
     ORDER BY total DESC
     LIMIT $3`,
    [userId, days, limit]
  );
  return result.rows;
}

// ============================================================================
// Category Trend (Monthly by Category)
// ============================================================================

export async function getCategoryTrend(
  userId: string,
  months: number = 6,
  categoryLimit: number = 5
): Promise<CategoryTrendPoint[]> {
  const result = await query<CategoryTrendPoint>(
    `WITH top_cats AS (
       SELECT category
       FROM mv_expense_analytics
       WHERE user_id = $1
         AND transaction_date >= DATE_TRUNC('month', CURRENT_DATE) - ($2 || ' months')::interval
         AND category IS NOT NULL
       GROUP BY category
       ORDER BY SUM(amount) DESC
       LIMIT $3
     )
     SELECT
       TO_CHAR(DATE_TRUNC('month', a.transaction_date), 'YYYY-MM') AS period,
       a.category,
       SUM(a.amount)::numeric AS total
     FROM mv_expense_analytics a
     INNER JOIN top_cats tc ON a.category = tc.category
     WHERE a.user_id = $1
       AND a.transaction_date >= DATE_TRUNC('month', CURRENT_DATE) - ($2 || ' months')::interval
     GROUP BY period, a.category
     ORDER BY period ASC, a.category ASC`,
    [userId, months, categoryLimit]
  );
  return result.rows;
}
