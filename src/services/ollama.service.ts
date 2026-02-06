import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';

export interface OllamaMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface OllamaOptions {
  model?: string;
  temperature?: number;
  num_predict?: number;
}

interface OllamaChatChunk {
  model: string;
  message: { role: string; content: string };
  done: boolean;
  total_duration?: number;
  eval_count?: number;
  prompt_eval_count?: number;
}

/**
 * Stream a chat completion from Ollama, yielding content chunks.
 */
export async function* chatStream(
  messages: OllamaMessage[],
  options?: OllamaOptions
): AsyncGenerator<string, void, undefined> {
  const model = options?.model ?? env.OLLAMA_MODEL;

  const response = await fetch(`${env.OLLAMA_HOST}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      messages,
      stream: true,
      options: {
        temperature: options?.temperature ?? 0.4,
        num_predict: options?.num_predict ?? 2048,
      },
    }),
    signal: AbortSignal.timeout(env.OLLAMA_TIMEOUT),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Ollama chat failed (${response.status}): ${body}`);
  }

  if (!response.body) {
    throw new Error('Ollama returned no response body');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // Ollama streams NDJSON — one JSON object per line
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        try {
          const chunk = JSON.parse(trimmed) as OllamaChatChunk;
          if (chunk.message?.content) {
            yield chunk.message.content;
          }
        } catch {
          logger.warn('Failed to parse Ollama chunk', { line: trimmed });
        }
      }
    }

    // Process any remaining buffer
    if (buffer.trim()) {
      try {
        const chunk = JSON.parse(buffer.trim()) as OllamaChatChunk;
        if (chunk.message?.content) {
          yield chunk.message.content;
        }
      } catch {
        // ignore trailing partial data
      }
    }
  } finally {
    reader.releaseLock();
  }
}

/**
 * Non-streaming chat completion. Returns the full response text.
 */
export async function chat(
  messages: OllamaMessage[],
  options?: OllamaOptions
): Promise<{ content: string; evalCount: number; promptEvalCount: number }> {
  const model = options?.model ?? env.OLLAMA_MODEL;

  const response = await fetch(`${env.OLLAMA_HOST}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      messages,
      stream: false,
      options: {
        temperature: options?.temperature ?? 0.4,
        num_predict: options?.num_predict ?? 2048,
      },
    }),
    signal: AbortSignal.timeout(env.OLLAMA_TIMEOUT),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Ollama chat failed (${response.status}): ${body}`);
  }

  const data = (await response.json()) as OllamaChatChunk;

  return {
    content: data.message?.content ?? '',
    evalCount: data.eval_count ?? 0,
    promptEvalCount: data.prompt_eval_count ?? 0,
  };
}

export interface OllamaModel {
  name: string;
  size: number;
  details: { family: string; parameter_size: string; quantization_level: string };
}

/**
 * List models available on the Ollama instance.
 */
export async function listModels(): Promise<OllamaModel[]> {
  const response = await fetch(`${env.OLLAMA_HOST}/api/tags`, {
    signal: AbortSignal.timeout(5000),
  });

  if (!response.ok) {
    throw new Error(`Ollama list models failed (${response.status})`);
  }

  const data = (await response.json()) as { models: OllamaModel[] };
  return data.models ?? [];
}
