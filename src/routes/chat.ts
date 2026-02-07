import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import { authMiddleware } from '../middleware/auth.js';
import {
  streamChat,
  listSessions,
  getSessionMessages,
  deleteSession,
  submitFeedback,
  getUserLlmPreferences,
  updateUserLlmPreferences,
} from '../services/chat.service.js';
import { listModels } from '../services/ollama.service.js';
import { env } from '../config/env.js';
import {
  SendChatMessageSchema,
  SessionIdParamSchema,
  MessageIdParamSchema,
  ChatSessionListSchema,
  ChatSessionMessagesSchema,
  ChatModelListSchema,
  LlmPreferencesSchema,
  LlmPreferencesResponseSchema,
  FeedbackSchema,
} from '../schemas/chat.js';
import { ErrorSchema, MessageSchema, AuthHeaderSchema } from '../schemas/common.js';
import { z } from '@hono/zod-openapi';

const chatRouter = new OpenAPIHono();

// All routes require authentication
chatRouter.use('*', authMiddleware);

const security = [{ Bearer: [] }];

// ============================================================================
// POST /v1/chat — Stream a chat response (SSE)
// ============================================================================

const streamRoute = createRoute({
  method: 'post',
  path: '/',
  tags: ['Chat'],
  summary: 'Send message and stream response',
  description: 'Send a message to the AI assistant and receive a streamed SSE response',
  security,
  request: {
    headers: AuthHeaderSchema,
    body: {
      content: { 'application/json': { schema: SendChatMessageSchema } },
    },
  },
  responses: {
    200: {
      description: 'SSE stream of chat response tokens',
      content: { 'text/event-stream': { schema: z.any() } },
    },
    400: {
      description: 'Validation error',
      content: { 'application/json': { schema: ErrorSchema } },
    },
    401: {
      description: 'Unauthorized',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
});

chatRouter.openapi(streamRoute, async (c) => {
  const { message, sessionId, model } = c.req.valid('json');
  const userId = c.get('userId');
  const resolvedSessionId = sessionId ?? crypto.randomUUID();

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      try {
        for await (const event of streamChat({ userId, sessionId: resolvedSessionId, message, model })) {
          const data = JSON.stringify(event);
          controller.enqueue(encoder.encode(`data: ${data}\n\n`));
        }
        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : 'Internal error';
        const data = JSON.stringify({ type: 'error', error: errMsg });
        controller.enqueue(encoder.encode(`data: ${data}\n\n`));
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
});

// ============================================================================
// GET /v1/chat/sessions — List chat sessions
// ============================================================================

const listSessionsRoute = createRoute({
  method: 'get',
  path: '/sessions',
  tags: ['Chat'],
  summary: 'List chat sessions',
  description: 'Get a list of the authenticated user\'s chat sessions',
  security,
  request: {
    headers: AuthHeaderSchema,
  },
  responses: {
    200: {
      description: 'List of chat sessions',
      content: { 'application/json': { schema: ChatSessionListSchema } },
    },
    401: {
      description: 'Unauthorized',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
});

chatRouter.openapi(listSessionsRoute, async (c) => {
  const userId = c.get('userId');
  const sessions = await listSessions(userId);
  return c.json({ data: sessions }, 200);
});

// ============================================================================
// GET /v1/chat/sessions/:sessionId — Get session messages
// ============================================================================

const getSessionRoute = createRoute({
  method: 'get',
  path: '/sessions/{sessionId}',
  tags: ['Chat'],
  summary: 'Get session messages',
  description: 'Get all messages for a specific chat session',
  security,
  request: {
    headers: AuthHeaderSchema,
    params: SessionIdParamSchema,
  },
  responses: {
    200: {
      description: 'Session messages',
      content: { 'application/json': { schema: ChatSessionMessagesSchema } },
    },
    401: {
      description: 'Unauthorized',
      content: { 'application/json': { schema: ErrorSchema } },
    },
    404: {
      description: 'Session not found',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
});

chatRouter.openapi(getSessionRoute, async (c) => {
  const userId = c.get('userId');
  const { sessionId } = c.req.valid('param');
  const messages = await getSessionMessages(userId, sessionId);
  return c.json({ data: messages }, 200);
});

// ============================================================================
// DELETE /v1/chat/sessions/:sessionId — Delete a session
// ============================================================================

const deleteSessionRoute = createRoute({
  method: 'delete',
  path: '/sessions/{sessionId}',
  tags: ['Chat'],
  summary: 'Delete chat session',
  description: 'Delete a chat session and all its messages',
  security,
  request: {
    headers: AuthHeaderSchema,
    params: SessionIdParamSchema,
  },
  responses: {
    200: {
      description: 'Session deleted',
      content: { 'application/json': { schema: MessageSchema } },
    },
    401: {
      description: 'Unauthorized',
      content: { 'application/json': { schema: ErrorSchema } },
    },
    404: {
      description: 'Session not found',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
});

chatRouter.openapi(deleteSessionRoute, async (c) => {
  const userId = c.get('userId');
  const { sessionId } = c.req.valid('param');
  await deleteSession(userId, sessionId);
  return c.json({ message: 'Session deleted' }, 200);
});

// ============================================================================
// POST /v1/chat/messages/:messageId/feedback — Submit feedback
// ============================================================================

const feedbackRoute = createRoute({
  method: 'post',
  path: '/messages/{messageId}/feedback',
  tags: ['Chat'],
  summary: 'Submit feedback on a response',
  description: 'Rate an assistant response as helpful or not helpful',
  security,
  request: {
    headers: AuthHeaderSchema,
    params: MessageIdParamSchema,
    body: {
      content: { 'application/json': { schema: FeedbackSchema } },
    },
  },
  responses: {
    200: {
      description: 'Feedback submitted',
      content: { 'application/json': { schema: MessageSchema } },
    },
    401: {
      description: 'Unauthorized',
      content: { 'application/json': { schema: ErrorSchema } },
    },
    404: {
      description: 'Message not found',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
});

chatRouter.openapi(feedbackRoute, async (c) => {
  const userId = c.get('userId');
  const { messageId } = c.req.valid('param');
  const { wasHelpful, feedback } = c.req.valid('json');
  await submitFeedback(userId, messageId, wasHelpful, feedback);
  return c.json({ message: 'Feedback submitted' }, 200);
});

// ============================================================================
// GET /v1/chat/models — List available models
// ============================================================================

const EMBEDDING_MODELS = ['nomic-embed-text', 'mxbai-embed-large', 'all-minilm'];

const modelsRoute = createRoute({
  method: 'get',
  path: '/models',
  tags: ['Chat'],
  summary: 'List available chat models',
  description: 'Returns the list of models available for chat, excluding embedding-only models',
  security,
  request: {
    headers: AuthHeaderSchema,
  },
  responses: {
    200: {
      description: 'Available models',
      content: { 'application/json': { schema: ChatModelListSchema } },
    },
    401: {
      description: 'Unauthorized',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
});

chatRouter.openapi(modelsRoute, async (c) => {
  const allModels = await listModels();
  const chatModels = allModels.filter(
    (m) => !EMBEDDING_MODELS.some((emb) => m.name.startsWith(emb))
  );

  return c.json({
    data: chatModels.map((m) => ({
      name: m.name,
      size: m.size,
      parameterSize: m.details.parameter_size,
      family: m.details.family,
    })),
    default: env.OLLAMA_MODEL,
  }, 200);
});

// ============================================================================
// GET /v1/chat/preferences — Get user's LLM preferences
// ============================================================================

const getPreferencesRoute = createRoute({
  method: 'get',
  path: '/preferences',
  tags: ['Chat'],
  summary: 'Get LLM preferences',
  description: 'Get the authenticated user\'s LLM preferences (e.g., default model)',
  security,
  request: {
    headers: AuthHeaderSchema,
  },
  responses: {
    200: {
      description: 'User LLM preferences',
      content: { 'application/json': { schema: LlmPreferencesResponseSchema } },
    },
    401: {
      description: 'Unauthorized',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
});

chatRouter.openapi(getPreferencesRoute, async (c) => {
  const userId = c.get('userId');
  const prefs = await getUserLlmPreferences(userId);
  return c.json({ data: prefs }, 200);
});

// ============================================================================
// PUT /v1/chat/preferences — Update user's LLM preferences
// ============================================================================

const updatePreferencesRoute = createRoute({
  method: 'put',
  path: '/preferences',
  tags: ['Chat'],
  summary: 'Update LLM preferences',
  description: 'Update the authenticated user\'s LLM preferences (e.g., default model)',
  security,
  request: {
    headers: AuthHeaderSchema,
    body: {
      content: { 'application/json': { schema: LlmPreferencesSchema } },
    },
  },
  responses: {
    200: {
      description: 'Updated preferences',
      content: { 'application/json': { schema: LlmPreferencesResponseSchema } },
    },
    401: {
      description: 'Unauthorized',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
});

chatRouter.openapi(updatePreferencesRoute, async (c) => {
  const userId = c.get('userId');
  const input = c.req.valid('json');
  const prefs = await updateUserLlmPreferences(userId, input);
  return c.json({ data: prefs }, 200);
});

export { chatRouter };
