import { query } from '../db/client.js';
import { logger } from '../utils/logger.js';
import { embedText, toPgVector } from './embedding.service.js';

/**
 * Build a complete context string for the LLM system prompt.
 * Combines SQL-based summaries with semantic search results (RAG).
 */
export async function buildUserContext(
  userId: string,
  queryText?: string
): Promise<{ expenseContext: string; semanticContext: string }> {
  const [summary, categories, merchants, anomalies, recentExpenses, semanticResults] =
    await Promise.all([
      getSpendingSummary(userId),
      getCategoryBreakdown(userId),
      getTopMerchants(userId),
      getAnomalies(userId),
      getRecentExpenses(userId),
      queryText ? semanticSearch(userId, queryText) : Promise.resolve(null),
    ]);

  const expenseContext = formatExpenseContext(summary, categories, merchants, anomalies, recentExpenses);
  const semanticContext = semanticResults ? formatSemanticContext(semanticResults) : 'No semantic results available.';

  return { expenseContext, semanticContext };
}

// ============================================================================
// SQL-based context queries
// ============================================================================

interface SpendingSummaryRow {
  period_type: string;
  period_start: string;
  total_amount: number;
  transaction_count: number;
  report_count: number;
  avg_transaction: number | null;
  prev_period_amount: number | null;
  pct_change: number | null;
  category_breakdown: Record<string, number> | null;
  top_merchants: Array<{ name: string; amount: number; count: number }> | null;
}

async function getSpendingSummary(userId: string): Promise<SpendingSummaryRow | null> {
  const result = await query<SpendingSummaryRow>(
    `SELECT period_type, period_start, total_amount, transaction_count, report_count,
            avg_transaction, prev_period_amount, pct_change, category_breakdown, top_merchants
     FROM spending_summaries
     WHERE user_id = $1 AND period_type = 'monthly'
     ORDER BY period_start DESC
     LIMIT 1`,
    [userId]
  );
  return result.rows[0] ?? null;
}

interface CategoryRow {
  category: string;
  total: number;
  count: number;
}

async function getCategoryBreakdown(userId: string): Promise<CategoryRow[]> {
  const result = await query<CategoryRow>(
    `SELECT category, SUM(amount)::numeric AS total, COUNT(*)::int AS count
     FROM mv_expense_analytics
     WHERE user_id = $1
       AND transaction_date >= CURRENT_DATE - INTERVAL '30 days'
     GROUP BY category
     ORDER BY total DESC
     LIMIT 10`,
    [userId]
  );
  return result.rows;
}

interface MerchantRow {
  merchant_name: string;
  total: number;
  count: number;
}

async function getTopMerchants(userId: string): Promise<MerchantRow[]> {
  const result = await query<MerchantRow>(
    `SELECT merchant_name, SUM(amount)::numeric AS total, COUNT(*)::int AS count
     FROM mv_expense_analytics
     WHERE user_id = $1
       AND merchant_name IS NOT NULL
       AND transaction_date >= CURRENT_DATE - INTERVAL '30 days'
     GROUP BY merchant_name
     ORDER BY total DESC
     LIMIT 10`,
    [userId]
  );
  return result.rows;
}

interface AnomalyRow {
  anomaly_type: string;
  severity: string;
  explanation: string;
  detected_at: string;
}

async function getAnomalies(userId: string): Promise<AnomalyRow[]> {
  const result = await query<AnomalyRow>(
    `SELECT anomaly_type, severity, explanation, detected_at
     FROM expense_anomalies
     WHERE user_id = $1
       AND status = 'open'
     ORDER BY detected_at DESC
     LIMIT 5`,
    [userId]
  );
  return result.rows;
}

interface RecentExpenseRow {
  description: string;
  amount: number;
  category: string;
  merchant_name: string | null;
  transaction_date: string;
  report_title: string;
}

async function getRecentExpenses(userId: string): Promise<RecentExpenseRow[]> {
  const result = await query<RecentExpenseRow>(
    `SELECT description, amount, category, merchant_name, transaction_date, report_title
     FROM mv_expense_analytics
     WHERE user_id = $1
     ORDER BY transaction_date DESC
     LIMIT 15`,
    [userId]
  );
  return result.rows;
}

// ============================================================================
// RAG: Semantic search
// ============================================================================

interface SemanticResult {
  source: string;
  description: string;
  amount?: number;
  category?: string;
  date?: string;
  similarity: number;
}

async function semanticSearch(userId: string, queryText: string): Promise<SemanticResult[]> {
  let queryEmbedding: number[];
  try {
    queryEmbedding = await embedText(queryText);
  } catch (error) {
    logger.warn('Embedding failed for semantic search, skipping RAG', {
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }

  const vectorStr = toPgVector(queryEmbedding);
  const results: SemanticResult[] = [];

  // Search expense lines by description similarity
  const lineResults = await query<{
    description: string;
    amount: number;
    category: string;
    transaction_date: string;
    similarity: number;
  }>(
    `SELECT el.description, el.amount, el.category, el.transaction_date,
            1 - (el.description_embedding <=> $1::vector) AS similarity
     FROM expense_lines el
     JOIN expense_reports er ON el.report_id = er.id
     WHERE el.description_embedding IS NOT NULL
       AND er.user_id = $2
     ORDER BY el.description_embedding <=> $1::vector
     LIMIT 10`,
    [vectorStr, userId]
  );

  for (const row of lineResults.rows) {
    if (row.similarity > 0.3) {
      results.push({
        source: 'expense',
        description: row.description,
        amount: row.amount,
        category: row.category,
        date: row.transaction_date,
        similarity: row.similarity,
      });
    }
  }

  // Search past insights by content similarity
  const insightResults = await query<{
    title: string;
    content: string;
    similarity: number;
  }>(
    `SELECT title, content,
            1 - (content_embedding <=> $1::vector) AS similarity
     FROM expense_insights
     WHERE content_embedding IS NOT NULL
       AND (scope_type = 'user' AND scope_id = $2::uuid OR scope_type = 'global')
       AND is_stale = false
     ORDER BY content_embedding <=> $1::vector
     LIMIT 5`,
    [vectorStr, userId]
  );

  for (const row of insightResults.rows) {
    if (row.similarity > 0.3) {
      results.push({
        source: 'insight',
        description: `${row.title}: ${row.content}`,
        similarity: row.similarity,
      });
    }
  }

  return results;
}

// ============================================================================
// Formatting helpers
// ============================================================================

function formatExpenseContext(
  summary: SpendingSummaryRow | null,
  categories: CategoryRow[],
  merchants: MerchantRow[],
  anomalies: AnomalyRow[],
  recentExpenses: RecentExpenseRow[]
): string {
  const sections: string[] = [];

  if (summary) {
    const changeStr = summary.pct_change != null
      ? ` (${summary.pct_change > 0 ? '+' : ''}${summary.pct_change}% vs previous period)`
      : '';
    sections.push(
      `**Current Month Summary:**\n` +
      `- Total spending: $${Number(summary.total_amount).toFixed(2)}${changeStr}\n` +
      `- Transactions: ${summary.transaction_count}\n` +
      `- Reports: ${summary.report_count}\n` +
      `- Avg per transaction: $${summary.avg_transaction != null ? Number(summary.avg_transaction).toFixed(2) : 'N/A'}`
    );
  }

  if (categories.length > 0) {
    const catLines = categories.map(c => `- ${c.category}: $${Number(c.total).toFixed(2)} (${c.count} transactions)`);
    sections.push(`**Spending by Category (last 30 days):**\n${catLines.join('\n')}`);
  }

  if (merchants.length > 0) {
    const merchLines = merchants.map(m => `- ${m.merchant_name}: $${Number(m.total).toFixed(2)} (${m.count} transactions)`);
    sections.push(`**Top Merchants (last 30 days):**\n${merchLines.join('\n')}`);
  }

  if (anomalies.length > 0) {
    const anomalyLines = anomalies.map(a => `- [${a.severity.toUpperCase()}] ${a.explanation}`);
    sections.push(`**Open Anomalies:**\n${anomalyLines.join('\n')}`);
  }

  if (recentExpenses.length > 0) {
    const expLines = recentExpenses.map(e =>
      `- ${e.transaction_date}: $${Number(e.amount).toFixed(2)} — ${e.description}${e.merchant_name ? ` (${e.merchant_name})` : ''} [${e.category}]`
    );
    sections.push(`**Recent Expenses:**\n${expLines.join('\n')}`);
  }

  return sections.length > 0 ? sections.join('\n\n') : 'No expense data available for this user.';
}

function formatSemanticContext(results: SemanticResult[]): string {
  if (results.length === 0) return 'No semantically relevant data found.';

  const lines = results.map(r => {
    if (r.source === 'expense') {
      return `- [Expense] ${r.description} — $${r.amount?.toFixed(2)} (${r.category}, ${r.date})`;
    }
    return `- [Insight] ${r.description}`;
  });

  return `**Semantically Relevant Items:**\n${lines.join('\n')}`;
}
