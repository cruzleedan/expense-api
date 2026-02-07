import { z } from '@hono/zod-openapi';

// Request: send a chat message
export const SendChatMessageSchema = z.object({
  message: z.string().min(1).max(2000).openapi({
    example: 'What were my top spending categories last month?',
    description: 'The user message to send to the assistant',
  }),
  sessionId: z.string().uuid().optional().openapi({
    example: '550e8400-e29b-41d4-a716-446655440000',
    description: 'Session ID to continue an existing conversation. Omit to start a new session.',
  }),
  model: z.string().optional().openapi({
    example: 'qwen2.5:7b',
    description: 'Model to use for this message. Omit to use user preference or system default.',
  }),
}).openapi('SendChatMessage');

// Session path param
export const SessionIdParamSchema = z.object({
  sessionId: z.string().uuid().openapi({ example: '550e8400-e29b-41d4-a716-446655440000' }),
});

// Message ID path param
export const MessageIdParamSchema = z.object({
  messageId: z.string().uuid().openapi({ example: '550e8400-e29b-41d4-a716-446655440000' }),
});

// Response: chat message
export const ChatMessageSchema = z.object({
  id: z.string().uuid(),
  role: z.enum(['user', 'assistant']),
  content: z.string(),
  createdAt: z.string().datetime(),
  wasHelpful: z.boolean().nullable(),
}).openapi('ChatMessage');

// Response: chat session
export const ChatSessionSchema = z.object({
  sessionId: z.string().uuid(),
  title: z.string(),
  lastMessageAt: z.string().datetime(),
  messageCount: z.number().int(),
}).openapi('ChatSession');

// Response: session list
export const ChatSessionListSchema = z.object({
  data: z.array(ChatSessionSchema),
}).openapi('ChatSessionList');

// Response: session messages
export const ChatSessionMessagesSchema = z.object({
  data: z.array(ChatMessageSchema),
}).openapi('ChatSessionMessages');

// Response: available chat model
export const ChatModelSchema = z.object({
  name: z.string(),
  size: z.number(),
  parameterSize: z.string(),
  family: z.string(),
}).openapi('ChatModel');

// Response: models list
export const ChatModelListSchema = z.object({
  data: z.array(ChatModelSchema),
  default: z.string(),
}).openapi('ChatModelList');

// Request: update LLM preferences
export const LlmPreferencesSchema = z.object({
  defaultModel: z.string().optional().openapi({
    example: 'qwen2.5:7b',
    description: 'Default model to use for chat',
  }),
}).openapi('LlmPreferences');

// Response: LLM preferences
export const LlmPreferencesResponseSchema = z.object({
  data: LlmPreferencesSchema,
}).openapi('LlmPreferencesResponse');

// Request: feedback
export const FeedbackSchema = z.object({
  wasHelpful: z.boolean().openapi({ example: true }),
  feedback: z.string().max(500).optional().openapi({
    example: 'This was exactly what I needed',
    description: 'Optional text feedback about the response',
  }),
}).openapi('ChatFeedback');
