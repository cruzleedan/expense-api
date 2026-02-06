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

const MAX_HISTORY_MESSAGES = 20;
const CHAT_TEMPLATE_NAME = 'chat_assistant';

export interface ChatStreamEvent {
  type: 'token' | 'metadata' | 'error';
  content?: string;
  sessionId?: string;
  messageId?: string;
  model?: string;
  tokensUsed?: number;
  error?: string;
}

interface StreamChatParams {
  userId: string;
  sessionId: string;
  message: string;
}

/**
 * Stream a chat response for a user message.
 * Builds context, calls Ollama with streaming, saves the exchange.
 */
export async function* streamChat(
  params: StreamChatParams
): AsyncGenerator<ChatStreamEvent, void, undefined> {
  const { userId, sessionId, message } = params;
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

  // 6. Stream from Ollama
  const model = template.preferred_model ?? undefined;
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

  // 7. Save the exchange to llm_queries
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

  // 8. Yield metadata and done
  yield {
    type: 'metadata',
    sessionId,
    messageId,
    model: model ?? 'default',
    tokensUsed,
  };
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
