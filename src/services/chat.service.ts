import { query } from '../db/client.js';
import { logger } from '../utils/logger.js';
import { buildUserContext } from './chatContext.service.js';
import { chatStream, type OllamaMessage } from './ollama.service.js';
import { embedText, toPgVector } from './embedding.service.js';
import {
  getLlmPromptTemplateByName,
  renderTemplate,
} from './llmPromptTemplate.service.js';
import { NotFoundError } from '../types/index.js';
import {
  getSpendingByCategory,
  getSpendingTrend,
  getPeriodComparison,
} from './analytics.service.js';

const MAX_HISTORY_MESSAGES = 20;
const CHAT_TEMPLATE_NAME = 'chat_assistant';

export interface ChartConfig {
  chartType: 'bar' | 'line' | 'pie';
  title: string;
  data: Array<{ label: string; value: number }>;
  xAxisLabel?: string;
  yAxisLabel?: string;
}

export interface ChatStreamEvent {
  type: 'token' | 'metadata' | 'chart' | 'error';
  content?: string;
  sessionId?: string;
  messageId?: string;
  model?: string;
  tokensUsed?: number;
  chart?: ChartConfig;
  error?: string;
}

interface StreamChatParams {
  userId: string;
  sessionId: string;
  message: string;
  model?: string;
}

/**
 * Stream a chat response for a user message.
 * Builds context, calls Ollama with streaming, saves the exchange.
 */
export async function* streamChat(
  params: StreamChatParams
): AsyncGenerator<ChatStreamEvent, void, undefined> {
  const { userId, sessionId, message, model: requestModel } = params;
  const startTime = Date.now();

  // 1. Load prompt template
  let template;
  try {
    template = await getLlmPromptTemplateByName(CHAT_TEMPLATE_NAME);
  } catch {
    logger.error('Chat template not found', { name: CHAT_TEMPLATE_NAME });
    yield { type: 'error', error: 'Chat assistant is not configured. Please seed the chat_assistant prompt template.' };
    return;
  }

  // 2. Build expense context (SQL + RAG)
  const { expenseContext, semanticContext } = await buildUserContext(userId, message);

  // 3. Render system prompt with context
  const rendered = renderTemplate(template, {
    expense_context: expenseContext,
    semantic_context: semanticContext,
    user_message: message,
  });

  // 4. Load conversation history
  const history = await getSessionHistory(userId, sessionId, MAX_HISTORY_MESSAGES);

  // 5. Build Ollama messages
  const ollamaMessages: OllamaMessage[] = [];

  if (rendered.systemPrompt) {
    ollamaMessages.push({ role: 'system', content: rendered.systemPrompt });
  }

  for (const msg of history) {
    ollamaMessages.push({ role: msg.role as 'user' | 'assistant', content: msg.content });
  }

  ollamaMessages.push({ role: 'user', content: message });

  // 6. Resolve model: request param > user pref > template > env default
  let userPreferredModel: string | undefined;
  try {
    const prefResult = await query<{ llm_preferences: Record<string, unknown> | null }>(
      `SELECT llm_preferences FROM users WHERE id = $1`,
      [userId]
    );
    const prefs = prefResult.rows[0]?.llm_preferences;
    if (prefs?.defaultModel && typeof prefs.defaultModel === 'string') {
      userPreferredModel = prefs.defaultModel;
    }
  } catch {
    // Non-fatal — fall through to template/env default
  }

  const model = requestModel ?? userPreferredModel ?? template.preferred_model ?? undefined;
  let fullResponse = '';
  let tokensUsed = 0;

  try {
    for await (const chunk of chatStream(ollamaMessages, {
      model,
      temperature: parseFloat(String(template.temperature)),
      num_predict: template.max_tokens,
    })) {
      fullResponse += chunk;
      tokensUsed++;
      yield { type: 'token', content: chunk };
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error('Ollama streaming failed', { error: msg, sessionId });
    yield { type: 'error', error: `LLM error: ${msg}` };
    return;
  }

  // 7. Detect chart intent and emit chart data if applicable
  const chartConfig = await detectAndBuildChart(userId, message);
  if (chartConfig) {
    yield { type: 'chart', chart: chartConfig };
  }

  // 8. Save the exchange to llm_queries
  const executionTimeMs = Date.now() - startTime;

  let queryEmbedding: string | null = null;
  try {
    const embedding = await embedText(message);
    queryEmbedding = toPgVector(embedding);
  } catch {
    // Non-fatal — embedding the query is best-effort
  }

  let messageId: string | undefined;
  try {
    const insertResult = await query<{ id: string }>(
      `INSERT INTO llm_queries (user_id, session_id, query_text, query_embedding, response_text, model_used, tokens_used, execution_time_ms)
       VALUES ($1, $2, $3, $4::vector, $5, $6, $7, $8)
       RETURNING id`,
      [userId, sessionId, message, queryEmbedding, fullResponse, model ?? null, tokensUsed, executionTimeMs]
    );
    messageId = insertResult.rows[0]?.id;
  } catch (error) {
    logger.error('Failed to save chat exchange', {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  // 9. Yield metadata and done
  yield {
    type: 'metadata',
    sessionId,
    messageId,
    model: model ?? 'default',
    tokensUsed,
  };
}

// ============================================================================
// Chart intent detection
// ============================================================================

const CATEGORY_PATTERNS = /\b(categor|breakdown|pie\s*chart|donut|by\s+category|spending\s+categor)\b/i;
const TREND_PATTERNS = /\b(trend|over\s+time|monthly|month\s+to\s+month|line\s*chart|spending\s+trend|last\s+\d+\s+months?)\b/i;
const COMPARISON_PATTERNS = /\b(compar|vs\.?|versus|this\s+month|last\s+month|period|quarter\s+compar)\b/i;
const CHART_TRIGGER = /\b(chart|graph|plot|visual|show\s+me)\b/i;

async function detectAndBuildChart(
  userId: string,
  message: string
): Promise<ChartConfig | null> {
  const lowerMsg = message.toLowerCase();

  // Only generate charts when the user explicitly asks for a visual
  // or uses keywords that strongly imply wanting a chart
  const wantsChart = CHART_TRIGGER.test(lowerMsg);
  const mentionsCategory = CATEGORY_PATTERNS.test(lowerMsg);
  const mentionsTrend = TREND_PATTERNS.test(lowerMsg);
  const mentionsComparison = COMPARISON_PATTERNS.test(lowerMsg);

  if (!wantsChart && !mentionsCategory && !mentionsTrend && !mentionsComparison) {
    return null;
  }

  try {
    // Prefer trend if mentioned, then category, then comparison
    if (mentionsTrend || (wantsChart && lowerMsg.includes('month'))) {
      const monthMatch = lowerMsg.match(/last\s+(\d+)\s+months?/);
      const months = monthMatch ? parseInt(monthMatch[1], 10) : 12;
      const data = await getSpendingTrend(userId, months);
      if (data.length === 0) return null;
      return {
        chartType: 'line',
        title: `Monthly Spending Trend (${months} months)`,
        data: data.map(d => ({ label: d.period, value: Number(d.total) })),
        xAxisLabel: 'Month',
        yAxisLabel: 'Amount ($)',
      };
    }

    if (mentionsCategory || (wantsChart && !mentionsTrend && !mentionsComparison)) {
      const daysMatch = lowerMsg.match(/last\s+(\d+)\s+days?/);
      const days = daysMatch ? parseInt(daysMatch[1], 10) : 30;
      const data = await getSpendingByCategory(userId, days);
      if (data.length === 0) return null;
      return {
        chartType: data.length <= 6 ? 'pie' : 'bar',
        title: `Spending by Category (${days} days)`,
        data: data.map(d => ({ label: d.category, value: Number(d.total) })),
        xAxisLabel: 'Category',
        yAxisLabel: 'Amount ($)',
      };
    }

    if (mentionsComparison) {
      const isQuarter = lowerMsg.includes('quarter');
      const comparison = await getPeriodComparison(userId, isQuarter ? 'quarter' : 'month');
      const periodLabel = isQuarter ? 'Quarter' : 'Month';
      return {
        chartType: 'bar',
        title: `${periodLabel}-over-${periodLabel} Comparison`,
        data: [
          { label: `Previous ${periodLabel}`, value: comparison.previous.total },
          { label: `Current ${periodLabel}`, value: comparison.current.total },
        ],
        xAxisLabel: 'Period',
        yAxisLabel: 'Amount ($)',
      };
    }
  } catch (error) {
    logger.warn('Chart generation failed, continuing without chart', {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  return null;
}

// ============================================================================
// Session management
// ============================================================================

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
  wasHelpful: boolean | null;
}

async function getSessionHistory(
  userId: string,
  sessionId: string,
  limit: number
): Promise<ChatMessage[]> {
  const result = await query<ChatMessage>(
    `SELECT id, 'user' AS role, query_text AS content, created_at AS "createdAt", NULL AS "wasHelpful"
     FROM llm_queries
     WHERE user_id = $1 AND session_id = $2
     UNION ALL
     SELECT id, 'assistant' AS role, response_text AS content, created_at AS "createdAt", was_helpful AS "wasHelpful"
     FROM llm_queries
     WHERE user_id = $1 AND session_id = $2
     ORDER BY "createdAt" ASC
     LIMIT $3`,
    [userId, sessionId, limit]
  );
  return result.rows;
}

export interface ChatSession {
  sessionId: string;
  title: string;
  lastMessageAt: string;
  messageCount: number;
}

export async function listSessions(userId: string): Promise<ChatSession[]> {
  const result = await query<ChatSession>(
    `SELECT
       session_id AS "sessionId",
       SUBSTRING(MIN(query_text) FROM 1 FOR 80) AS title,
       MAX(created_at) AS "lastMessageAt",
       COUNT(*)::int AS "messageCount"
     FROM llm_queries
     WHERE user_id = $1 AND session_id IS NOT NULL
     GROUP BY session_id
     ORDER BY "lastMessageAt" DESC
     LIMIT 50`,
    [userId]
  );
  return result.rows;
}

export async function getSessionMessages(
  userId: string,
  sessionId: string
): Promise<ChatMessage[]> {
  // Verify session belongs to user
  const check = await query(
    `SELECT 1 FROM llm_queries WHERE user_id = $1 AND session_id = $2 LIMIT 1`,
    [userId, sessionId]
  );
  if (check.rowCount === 0) {
    throw new NotFoundError('Chat session');
  }

  return getSessionHistory(userId, sessionId, 200);
}

export async function deleteSession(userId: string, sessionId: string): Promise<void> {
  const result = await query(
    `DELETE FROM llm_queries WHERE user_id = $1 AND session_id = $2`,
    [userId, sessionId]
  );
  if (result.rowCount === 0) {
    throw new NotFoundError('Chat session');
  }
}

// ============================================================================
// LLM preferences
// ============================================================================

export interface LlmPreferences {
  defaultModel?: string;
}

export async function getUserLlmPreferences(userId: string): Promise<LlmPreferences> {
  const result = await query<{ llm_preferences: Record<string, unknown> | null }>(
    `SELECT llm_preferences FROM users WHERE id = $1`,
    [userId]
  );
  if (result.rows.length === 0) {
    throw new NotFoundError('User');
  }
  const prefs = result.rows[0].llm_preferences;
  return {
    defaultModel: typeof prefs?.defaultModel === 'string' ? prefs.defaultModel : undefined,
  };
}

export async function updateUserLlmPreferences(
  userId: string,
  preferences: LlmPreferences
): Promise<LlmPreferences> {
  const result = await query<{ llm_preferences: Record<string, unknown> | null }>(
    `UPDATE users
     SET llm_preferences = COALESCE(llm_preferences, '{}'::jsonb) || $1::jsonb,
         updated_at = NOW()
     WHERE id = $2
     RETURNING llm_preferences`,
    [JSON.stringify(preferences), userId]
  );
  if (result.rows.length === 0) {
    throw new NotFoundError('User');
  }
  const prefs = result.rows[0].llm_preferences;
  return {
    defaultModel: typeof prefs?.defaultModel === 'string' ? prefs.defaultModel : undefined,
  };
}

export async function submitFeedback(
  userId: string,
  messageId: string,
  wasHelpful: boolean,
  feedback?: string
): Promise<void> {
  const result = await query(
    `UPDATE llm_queries
     SET was_helpful = $1, user_feedback = $2
     WHERE id = $3 AND user_id = $4`,
    [wasHelpful, feedback ?? null, messageId, userId]
  );
  if (result.rowCount === 0) {
    throw new NotFoundError('Chat message');
  }
}
