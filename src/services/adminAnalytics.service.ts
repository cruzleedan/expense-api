import { query } from '../db/client.js';

// ============================================================================
// Types
// ============================================================================

export interface LlmUsageDay {
  day: string;
  queryCount: number;
  uniqueUsers: number;
  avgResponseMs: number;
  totalTokens: number;
  helpfulnessRate: number | null;
}

export interface LlmUsageStats {
  daily: LlmUsageDay[];
  totals: {
    totalQueries: number;
    totalUniqueUsers: number;
    avgResponseMs: number;
    totalTokens: number;
    helpfulnessRate: number | null;
  };
}

export interface PopularQuery {
  queryPattern: string;
  count: number;
  avgResponseMs: number;
  helpfulnessRate: number | null;
}

export interface SpendingOverview {
  totalSpending: number;
  totalTransactions: number;
  avgTransaction: number;
  topDepartments: Array<{ department: string; total: number; count: number }>;
  topCategories: Array<{ category: string; total: number; count: number }>;
}

export interface AnomalyStats {
  total: number;
  byType: Array<{ anomalyType: string; count: number }>;
  bySeverity: Array<{ severity: string; count: number }>;
  byStatus: Array<{ status: string; count: number }>;
  resolutionRate: number;
}

export interface ModelPerformance {
  model: string;
  queryCount: number;
  avgResponseMs: number;
  avgTokens: number;
  helpfulnessRate: number | null;
  errorRate: number;
}

// ============================================================================
// LLM Usage Stats
// ============================================================================

export async function getLlmUsageStats(days: number = 30): Promise<LlmUsageStats> {
  const dailyResult = await query<{
    day: string;
    query_count: number;
    unique_users: number;
    avg_response_ms: number;
    total_tokens: number;
    helpfulness_rate: number | null;
  }>(
    `SELECT
       DATE_TRUNC('day', created_at)::date AS day,
       COUNT(*)::int AS query_count,
       COUNT(DISTINCT user_id)::int AS unique_users,
       COALESCE(AVG(execution_time_ms), 0)::int AS avg_response_ms,
       COALESCE(SUM(tokens_used), 0)::int AS total_tokens,
       AVG(CASE WHEN was_helpful = true THEN 1.0 WHEN was_helpful = false THEN 0.0 ELSE NULL END) AS helpfulness_rate
     FROM llm_queries
     WHERE created_at >= NOW() - ($1 || ' days')::interval
     GROUP BY DATE_TRUNC('day', created_at)
     ORDER BY day DESC`,
    [days]
  );

  const totalsResult = await query<{
    total_queries: number;
    total_unique_users: number;
    avg_response_ms: number;
    total_tokens: number;
    helpfulness_rate: number | null;
  }>(
    `SELECT
       COUNT(*)::int AS total_queries,
       COUNT(DISTINCT user_id)::int AS total_unique_users,
       COALESCE(AVG(execution_time_ms), 0)::int AS avg_response_ms,
       COALESCE(SUM(tokens_used), 0)::int AS total_tokens,
       AVG(CASE WHEN was_helpful = true THEN 1.0 WHEN was_helpful = false THEN 0.0 ELSE NULL END) AS helpfulness_rate
     FROM llm_queries
     WHERE created_at >= NOW() - ($1 || ' days')::interval`,
    [days]
  );

  const totals = totalsResult.rows[0];

  return {
    daily: dailyResult.rows.map((r) => ({
      day: r.day,
      queryCount: r.query_count,
      uniqueUsers: r.unique_users,
      avgResponseMs: r.avg_response_ms,
      totalTokens: r.total_tokens,
      helpfulnessRate: r.helpfulness_rate != null ? Number(r.helpfulness_rate) : null,
    })),
    totals: {
      totalQueries: totals.total_queries,
      totalUniqueUsers: totals.total_unique_users,
      avgResponseMs: totals.avg_response_ms,
      totalTokens: totals.total_tokens,
      helpfulnessRate: totals.helpfulness_rate != null ? Number(totals.helpfulness_rate) : null,
    },
  };
}

// ============================================================================
// Popular Queries
// ============================================================================

export async function getPopularQueries(days: number = 30, limit: number = 10): Promise<PopularQuery[]> {
  // Group by first 5 words as a rough "pattern" to find common query types
  const result = await query<{
    query_pattern: string;
    count: number;
    avg_response_ms: number;
    helpfulness_rate: number | null;
  }>(
    `SELECT
       ARRAY_TO_STRING((STRING_TO_ARRAY(LOWER(TRIM(query_text)), ' '))[1:5], ' ') AS query_pattern,
       COUNT(*)::int AS count,
       COALESCE(AVG(execution_time_ms), 0)::int AS avg_response_ms,
       AVG(CASE WHEN was_helpful = true THEN 1.0 WHEN was_helpful = false THEN 0.0 ELSE NULL END) AS helpfulness_rate
     FROM llm_queries
     WHERE created_at >= NOW() - ($1 || ' days')::interval
       AND query_text IS NOT NULL
     GROUP BY query_pattern
     ORDER BY count DESC
     LIMIT $2`,
    [days, limit]
  );

  return result.rows.map((r) => ({
    queryPattern: r.query_pattern,
    count: r.count,
    avgResponseMs: r.avg_response_ms,
    helpfulnessRate: r.helpfulness_rate != null ? Number(r.helpfulness_rate) : null,
  }));
}

// ============================================================================
// Spending Overview (Org-wide)
// ============================================================================

export async function getSpendingOverview(days: number = 90): Promise<SpendingOverview> {
  const [totalsResult, deptResult, catResult] = await Promise.all([
    query<{
      total_spending: number;
      total_transactions: number;
      avg_transaction: number;
    }>(
      `SELECT
         COALESCE(SUM(amount), 0)::numeric AS total_spending,
         COUNT(*)::int AS total_transactions,
         COALESCE(AVG(amount), 0)::numeric AS avg_transaction
       FROM mv_expense_analytics
       WHERE transaction_date >= CURRENT_DATE - ($1 || ' days')::interval`,
      [days]
    ),
    query<{ department: string; total: number; count: number }>(
      `SELECT
         COALESCE(department_name, 'Unassigned') AS department,
         SUM(amount)::numeric AS total,
         COUNT(*)::int AS count
       FROM mv_expense_analytics
       WHERE transaction_date >= CURRENT_DATE - ($1 || ' days')::interval
       GROUP BY department_name
       ORDER BY total DESC
       LIMIT 10`,
      [days]
    ),
    query<{ category: string; total: number; count: number }>(
      `SELECT
         category,
         SUM(amount)::numeric AS total,
         COUNT(*)::int AS count
       FROM mv_expense_analytics
       WHERE transaction_date >= CURRENT_DATE - ($1 || ' days')::interval
       GROUP BY category
       ORDER BY total DESC
       LIMIT 10`,
      [days]
    ),
  ]);

  const t = totalsResult.rows[0];

  return {
    totalSpending: Number(t.total_spending),
    totalTransactions: t.total_transactions,
    avgTransaction: Number(t.avg_transaction),
    topDepartments: deptResult.rows.map((r) => ({
      department: r.department,
      total: Number(r.total),
      count: r.count,
    })),
    topCategories: catResult.rows.map((r) => ({
      category: r.category,
      total: Number(r.total),
      count: r.count,
    })),
  };
}

// ============================================================================
// Anomaly Stats
// ============================================================================

export async function getAnomalyStats(days: number = 90): Promise<AnomalyStats> {
  const [totalResult, byTypeResult, bySeverityResult, byStatusResult] = await Promise.all([
    query<{ total: number; resolved: number }>(
      `SELECT
         COUNT(*)::int AS total,
         COUNT(*) FILTER (WHERE status IN ('reviewed', 'dismissed', 'confirmed'))::int AS resolved
       FROM expense_anomalies
       WHERE detected_at >= NOW() - ($1 || ' days')::interval`,
      [days]
    ),
    query<{ anomaly_type: string; count: number }>(
      `SELECT anomaly_type, COUNT(*)::int AS count
       FROM expense_anomalies
       WHERE detected_at >= NOW() - ($1 || ' days')::interval
       GROUP BY anomaly_type
       ORDER BY count DESC`,
      [days]
    ),
    query<{ severity: string; count: number }>(
      `SELECT severity, COUNT(*)::int AS count
       FROM expense_anomalies
       WHERE detected_at >= NOW() - ($1 || ' days')::interval
       GROUP BY severity
       ORDER BY count DESC`,
      [days]
    ),
    query<{ status: string; count: number }>(
      `SELECT status, COUNT(*)::int AS count
       FROM expense_anomalies
       WHERE detected_at >= NOW() - ($1 || ' days')::interval
       GROUP BY status
       ORDER BY count DESC`,
      [days]
    ),
  ]);

  const t = totalResult.rows[0];

  return {
    total: t.total,
    byType: byTypeResult.rows.map((r) => ({
      anomalyType: r.anomaly_type,
      count: r.count,
    })),
    bySeverity: bySeverityResult.rows.map((r) => ({
      severity: r.severity,
      count: r.count,
    })),
    byStatus: byStatusResult.rows.map((r) => ({
      status: r.status,
      count: r.count,
    })),
    resolutionRate: t.total > 0 ? Number((t.resolved / t.total).toFixed(4)) : 0,
  };
}

// ============================================================================
// Model Performance
// ============================================================================

export async function getModelPerformance(days: number = 30): Promise<ModelPerformance[]> {
  const result = await query<{
    model: string;
    query_count: number;
    avg_response_ms: number;
    avg_tokens: number;
    helpfulness_rate: number | null;
    error_count: number;
  }>(
    `SELECT
       COALESCE(model_used, 'unknown') AS model,
       COUNT(*)::int AS query_count,
       COALESCE(AVG(execution_time_ms), 0)::int AS avg_response_ms,
       COALESCE(AVG(tokens_used), 0)::int AS avg_tokens,
       AVG(CASE WHEN was_helpful = true THEN 1.0 WHEN was_helpful = false THEN 0.0 ELSE NULL END) AS helpfulness_rate,
       COUNT(*) FILTER (WHERE response_text IS NULL OR response_text = '')::int AS error_count
     FROM llm_queries
     WHERE created_at >= NOW() - ($1 || ' days')::interval
     GROUP BY model_used
     ORDER BY query_count DESC`,
    [days]
  );

  return result.rows.map((r) => ({
    model: r.model,
    queryCount: r.query_count,
    avgResponseMs: r.avg_response_ms,
    avgTokens: r.avg_tokens,
    helpfulnessRate: r.helpfulness_rate != null ? Number(r.helpfulness_rate) : null,
    errorRate: r.query_count > 0 ? Number((r.error_count / r.query_count).toFixed(4)) : 0,
  }));
}
