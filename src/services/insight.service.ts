import { query } from '../db/client.js';
import { db } from '../db/drizzle.js';
import { expenseInsights, expenseAnomalies } from '../db/schema.js';
import type { ExpenseInsight, ExpenseAnomaly } from '../db/schema.js';
import { chat } from './ollama.service.js';
import { getLlmPromptTemplateByName, renderTemplate } from './llmPromptTemplate.service.js';
import { logger } from '../utils/logger.js';
import { eq, and, or, desc, count, gt, type SQL } from 'drizzle-orm';
import { sql } from 'drizzle-orm';

export type Insight = ExpenseInsight;
export type Anomaly = ExpenseAnomaly;

// ============================================================================
// Insight Queries
// ============================================================================

export async function getInsightsForUser(
  userId: string,
  options?: { type?: string; limit?: number; offset?: number; includeStale?: boolean }
): Promise<{ insights: ExpenseInsight[]; total: number }> {
  const scopeCond = or(
    and(
      eq(expenseInsights.scopeType, 'user'),
      eq(expenseInsights.scopeId, userId)
    ),
    eq(expenseInsights.scopeType, 'global')
  );

  const conditions: (SQL | undefined)[] = [
    scopeCond,
    !options?.includeStale ? eq(expenseInsights.isStale, false) : undefined,
    options?.type ? eq(expenseInsights.insightType, options.type) : undefined,
  ];
  const where = and(...(conditions.filter(Boolean) as SQL[]));

  const limit = options?.limit ?? 20;
  const offset = options?.offset ?? 0;

  const [rows, [{ total }]] = await Promise.all([
    db
      .select()
      .from(expenseInsights)
      .where(where)
      .orderBy(desc(expenseInsights.isPinned), desc(expenseInsights.generatedAt))
      .limit(limit)
      .offset(offset),
    db.select({ total: count() }).from(expenseInsights).where(where),
  ]);

  return { insights: rows, total };
}

export async function getUnreadInsightCount(userId: string): Promise<number> {
  const scopeCond = or(
    and(
      eq(expenseInsights.scopeType, 'user'),
      eq(expenseInsights.scopeId, userId)
    ),
    eq(expenseInsights.scopeType, 'global')
  );
  const [{ total }] = await db
    .select({ total: count() })
    .from(expenseInsights)
    .where(
      and(
        scopeCond,
        eq(expenseInsights.isStale, false),
        gt(expenseInsights.generatedAt, sql`NOW() - INTERVAL '7 days'`)
      )
    );
  return total;
}

export async function pinInsight(userId: string, insightId: string): Promise<void> {
  const scopeCond = or(
    and(
      eq(expenseInsights.scopeType, 'user'),
      eq(expenseInsights.scopeId, userId)
    ),
    eq(expenseInsights.scopeType, 'global')
  );
  const updated = await db
    .update(expenseInsights)
    .set({ isPinned: true })
    .where(and(eq(expenseInsights.id, insightId), scopeCond))
    .returning({ id: expenseInsights.id });
  if (updated.length === 0) {
    throw new Error('Insight not found or not accessible');
  }
}

export async function dismissInsight(userId: string, insightId: string): Promise<void> {
  const scopeCond = or(
    and(
      eq(expenseInsights.scopeType, 'user'),
      eq(expenseInsights.scopeId, userId)
    ),
    eq(expenseInsights.scopeType, 'global')
  );
  const updated = await db
    .update(expenseInsights)
    .set({ isStale: true })
    .where(and(eq(expenseInsights.id, insightId), scopeCond))
    .returning({ id: expenseInsights.id });
  if (updated.length === 0) {
    throw new Error('Insight not found or not accessible');
  }
}

// ============================================================================
// Anomaly Queries
// ============================================================================

export async function getAnomaliesForUser(
  userId: string,
  options?: { status?: string; severity?: string; limit?: number; offset?: number }
): Promise<{ anomalies: ExpenseAnomaly[]; total: number }> {
  const conditions: (SQL | undefined)[] = [
    eq(expenseAnomalies.userId, userId),
    options?.status ? eq(expenseAnomalies.status, options.status) : undefined,
    options?.severity ? eq(expenseAnomalies.severity, options.severity) : undefined,
  ];
  const where = and(...(conditions.filter(Boolean) as SQL[]));

  const limit = options?.limit ?? 20;
  const offset = options?.offset ?? 0;

  const [rows, [{ total }]] = await Promise.all([
    db
      .select()
      .from(expenseAnomalies)
      .where(where)
      .orderBy(desc(expenseAnomalies.detectedAt))
      .limit(limit)
      .offset(offset),
    db.select({ total: count() }).from(expenseAnomalies).where(where),
  ]);

  return { anomalies: rows, total };
}

export async function reviewAnomaly(
  userId: string,
  anomalyId: string,
  notes?: string
): Promise<void> {
  const updated = await db
    .update(expenseAnomalies)
    .set({
      status: 'reviewed',
      reviewedBy: userId,
      reviewedAt: sql`NOW()`,
      reviewNotes: notes ?? null,
    })
    .where(and(eq(expenseAnomalies.id, anomalyId), eq(expenseAnomalies.userId, userId)))
    .returning({ id: expenseAnomalies.id });
  if (updated.length === 0) {
    throw new Error('Anomaly not found or not accessible');
  }
}

export async function dismissAnomaly(userId: string, anomalyId: string): Promise<void> {
  const updated = await db
    .update(expenseAnomalies)
    .set({
      status: 'dismissed',
      reviewedBy: userId,
      reviewedAt: sql`NOW()`,
    })
    .where(and(eq(expenseAnomalies.id, anomalyId), eq(expenseAnomalies.userId, userId)))
    .returning({ id: expenseAnomalies.id });
  if (updated.length === 0) {
    throw new Error('Anomaly not found or not accessible');
  }
}

// ============================================================================
// Insight Generation (Background job logic - uses raw SQL)
// ============================================================================

interface ActiveUser {
  id: string;
  email: string;
}

async function getActiveUsers(): Promise<ActiveUser[]> {
  const result = await query<ActiveUser>(
    `SELECT id, email FROM users WHERE is_active = true`
  );
  return result.rows;
}

interface SpendingSummaryRow {
  total_amount: number;
  transaction_count: number;
  pct_change: number | null;
  category_breakdown: Record<string, number> | null;
  period_start: string;
}

async function getUserSpendingSummary(userId: string): Promise<SpendingSummaryRow | null> {
  const result = await query<SpendingSummaryRow>(
    `SELECT total_amount, transaction_count, pct_change, category_breakdown, period_start
     FROM spending_summaries
     WHERE user_id = $1 AND period_type = 'monthly'
     ORDER BY period_start DESC
     LIMIT 1`,
    [userId]
  );
  return result.rows[0] ?? null;
}

export async function generateDailyInsights(): Promise<number> {
  let generated = 0;
  const users = await getActiveUsers();

  for (const user of users) {
    try {
      const summary = await getUserSpendingSummary(user.id);
      if (!summary || summary.transaction_count === 0) continue;

      const existing = await query(
        `SELECT id FROM expense_insights
         WHERE scope_type = 'user' AND scope_id = $1::uuid
           AND insight_type = 'summary'
           AND generated_at > NOW() - INTERVAL '1 day'`,
        [user.id]
      );
      if (existing.rows.length > 0) continue;

      await query(
        `UPDATE expense_insights SET is_stale = true
         WHERE scope_type = 'user' AND scope_id = $1::uuid
           AND insight_type = 'summary' AND is_stale = false`,
        [user.id]
      );

      const categories = summary.category_breakdown
        ? Object.entries(summary.category_breakdown)
            .map(([cat, amt]) => `${cat}: $${Number(amt).toFixed(2)}`)
            .join(', ')
        : 'No category data';

      const changeStr =
        summary.pct_change != null
          ? `${summary.pct_change > 0 ? '+' : ''}${summary.pct_change}% vs previous month`
          : 'no prior period data';

      const contextStr =
        `Total spending: $${Number(summary.total_amount).toFixed(2)} (${changeStr}). ` +
        `Transactions: ${summary.transaction_count}. ` +
        `Categories: ${categories}.`;

      let template;
      try {
        template = await getLlmPromptTemplateByName('monthly_summary');
      } catch {
        logger.warn('monthly_summary template not found, using fallback');
        template = null;
      }

      let systemPrompt = 'You are a financial analysis assistant. Be concise and data-driven.';
      let userPrompt = `Generate a brief monthly spending summary for this user.\n\n${contextStr}`;

      if (template) {
        const rendered = renderTemplate(template, {
          spending_summary: contextStr,
          user_info: `User: ${user.email}`,
        });
        if (rendered.systemPrompt) systemPrompt = rendered.systemPrompt;
        userPrompt = rendered.userPrompt;
      }

      const response = await chat(
        [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        { temperature: 0.3, num_predict: 500 }
      );

      const lines = response.content.trim().split('\n');
      const title = lines[0].replace(/^[#*]+\s*/, '').slice(0, 200) || 'Monthly Spending Summary';

      await query(
        `INSERT INTO expense_insights (
          scope_type, scope_id, period_start, period_end,
          insight_type, title, content, supporting_data,
          confidence, generated_by
        ) VALUES (
          'user', $1::uuid, $2::date, (CURRENT_DATE),
          'summary', $3, $4, $5,
          0.8, 'system'
        )`,
        [
          user.id,
          summary.period_start,
          title,
          response.content.trim(),
          JSON.stringify({ total_amount: summary.total_amount, pct_change: summary.pct_change }),
        ]
      );

      generated++;
    } catch (error) {
      logger.error('Failed to generate insight for user', {
        userId: user.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return generated;
}

export async function detectAnomalies(): Promise<number> {
  let detected = 0;

  const recentLines = await query<{
    id: string;
    user_id: string;
    report_id: string;
    amount: number;
    category: string;
    description: string;
    merchant_name: string | null;
  }>(
    `SELECT el.id, er.user_id, el.report_id, el.amount, el.category, el.description, el.merchant_name
     FROM expense_lines el
     JOIN expense_reports er ON el.report_id = er.id
     WHERE el.created_at > NOW() - INTERVAL '24 hours'
       AND NOT EXISTS (
         SELECT 1 FROM expense_anomalies ea
         WHERE ea.expense_line_id = el.id
       )
     ORDER BY el.created_at DESC
     LIMIT 100`
  );

  for (const line of recentLines.rows) {
    try {
      if (!line.category || Number(line.amount) === 0) continue;

      const anomalyResult = await query<{
        is_anomaly: boolean;
        z_score: number;
        expected_range: { min: number; max: number } | null;
        explanation: string;
      }>(
        `SELECT * FROM detect_amount_anomaly($1, $2, $3)`,
        [line.amount, line.category, line.user_id]
      );

      const row = anomalyResult.rows[0];
      if (row && row.is_anomaly) {
        const severity =
          Math.abs(row.z_score) >= 4 ? 'high' : Math.abs(row.z_score) >= 3 ? 'medium' : 'low';

        let explanation = row.explanation;
        try {
          let template;
          try {
            template = await getLlmPromptTemplateByName('anomaly_explanation');
          } catch {
            template = null;
          }

          let systemPrompt = 'You are a fraud/anomaly detection assistant. Be concise.';
          let userPrompt = `Explain this anomaly: ${row.explanation}. Amount: $${line.amount}, Category: ${line.category}, Merchant: ${line.merchant_name ?? 'Unknown'}`;

          if (template) {
            const rendered = renderTemplate(template, {
              anomaly_context: JSON.stringify({
                amount: line.amount,
                category: line.category,
                merchant: line.merchant_name,
                z_score: row.z_score,
                expected_range: row.expected_range,
              }),
              historical_stats: `Z-score: ${row.z_score.toFixed(2)}`,
              user_info: `User ID: ${line.user_id}`,
            });
            if (rendered.systemPrompt) systemPrompt = rendered.systemPrompt;
            userPrompt = rendered.userPrompt;
          }

          const llmResponse = await chat(
            [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: userPrompt },
            ],
            { temperature: 0.2, num_predict: 300 }
          );
          explanation = llmResponse.content.trim();
        } catch {
          // Keep the SQL-generated explanation
        }

        await query(
          `INSERT INTO expense_anomalies (
            expense_line_id, report_id, user_id,
            anomaly_type, severity, confidence, context, explanation
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            line.id,
            line.report_id,
            line.user_id,
            'amount_outlier',
            severity,
            Math.min(Math.abs(row.z_score) / 5, 1),
            JSON.stringify({
              expected_range: row.expected_range,
              actual: line.amount,
              z_score: row.z_score,
              category: line.category,
              merchant: line.merchant_name,
            }),
            explanation,
          ]
        );

        detected++;
      }
    } catch (error) {
      logger.error('Failed to check anomaly for expense line', {
        lineId: line.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const duplicates = await query<{
    user_id: string;
    report_id: string;
    line_id_a: string;
    line_id_b: string;
    merchant_name: string;
    amount: number;
    days_apart: number;
  }>(
    `SELECT DISTINCT ON (a.id)
       er_a.user_id,
       a.report_id,
       a.id as line_id_a,
       b.id as line_id_b,
       a.merchant_name,
       a.amount,
       ABS(EXTRACT(DAY FROM a.transaction_date - b.transaction_date))::int as days_apart
     FROM expense_lines a
     JOIN expense_lines b ON a.id != b.id
       AND a.merchant_name = b.merchant_name
       AND ABS(a.amount - b.amount) < 1
       AND ABS(EXTRACT(DAY FROM a.transaction_date - b.transaction_date)) <= 7
     JOIN expense_reports er_a ON a.report_id = er_a.id
     WHERE a.created_at > NOW() - INTERVAL '24 hours'
       AND a.merchant_name IS NOT NULL
       AND NOT EXISTS (
         SELECT 1 FROM expense_anomalies ea
         WHERE ea.expense_line_id = a.id AND ea.anomaly_type = 'duplicate_suspect'
       )
     LIMIT 50`
  );

  for (const dup of duplicates.rows) {
    try {
      await query(
        `INSERT INTO expense_anomalies (
          expense_line_id, report_id, user_id,
          anomaly_type, severity, confidence, context, explanation
        ) VALUES ($1, $2, $3, 'duplicate_suspect', 'medium', 0.7, $4, $5)`,
        [
          dup.line_id_a,
          dup.report_id,
          dup.user_id,
          JSON.stringify({
            matching_line_id: dup.line_id_b,
            merchant: dup.merchant_name,
            amount: dup.amount,
            days_apart: dup.days_apart,
          }),
          `Possible duplicate: same merchant "${dup.merchant_name}" and amount $${Number(dup.amount).toFixed(2)} within ${dup.days_apart} day(s)`,
        ]
      );
      detected++;
    } catch (error) {
      logger.error('Failed to insert duplicate anomaly', {
        lineId: dup.line_id_a,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return detected;
}

export async function refreshMaterializedViews(): Promise<void> {
  try {
    await query('REFRESH MATERIALIZED VIEW CONCURRENTLY mv_expense_analytics');
    logger.info('Refreshed mv_expense_analytics');
  } catch (error) {
    logger.error('Failed to refresh materialized views', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
