import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';

const EMBED_DIMENSIONS = 768;

interface OllamaEmbedResponse {
  model: string;
  embeddings: number[][];
}

/**
 * Generate an embedding vector for the given text using Ollama.
 */
export async function embedText(text: string): Promise<number[]> {
  const response = await fetch(`${env.OLLAMA_HOST}/api/embed`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: env.OLLAMA_EMBED_MODEL,
      input: text,
    }),
    signal: AbortSignal.timeout(env.OLLAMA_TIMEOUT),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Ollama embed failed (${response.status}): ${body}`);
  }

  const data = (await response.json()) as OllamaEmbedResponse;

  if (!data.embeddings?.[0] || data.embeddings[0].length !== EMBED_DIMENSIONS) {
    throw new Error(
      `Unexpected embedding dimensions: expected ${EMBED_DIMENSIONS}, got ${data.embeddings?.[0]?.length ?? 0}`
    );
  }

  return data.embeddings[0];
}

/**
 * Format a vector array as a pgvector-compatible string: '[0.1,0.2,...]'
 */
export function toPgVector(embedding: number[]): string {
  return `[${embedding.join(',')}]`;
}

/**
 * Embed text and store the result in the specified table/column.
 */
export async function embedAndStore(
  query: (sql: string, params: unknown[]) => Promise<unknown>,
  table: string,
  id: string,
  text: string,
  column: string
): Promise<void> {
  const embedding = await embedText(text);
  const vectorStr = toPgVector(embedding);

  // Parameterize the id and vector value; table/column are developer-controlled constants
  await query(
    `UPDATE ${table} SET ${column} = $1::vector WHERE id = $2`,
    [vectorStr, id]
  );
}

interface BatchItem {
  table: string;
  id: string;
  text: string;
  column: string;
}

/**
 * Embed and store multiple items with concurrency control.
 */
export async function batchEmbed(
  query: (sql: string, params: unknown[]) => Promise<unknown>,
  items: BatchItem[],
  concurrency: number = 5,
  onProgress?: (completed: number, total: number) => void
): Promise<{ succeeded: number; failed: number }> {
  let succeeded = 0;
  let failed = 0;
  let index = 0;

  async function worker() {
    while (index < items.length) {
      const current = index++;
      const item = items[current];
      try {
        await embedAndStore(query, item.table, item.id, item.text, item.column);
        succeeded++;
      } catch (error) {
        failed++;
        logger.error('Embedding failed', {
          table: item.table,
          id: item.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
      onProgress?.(succeeded + failed, items.length);
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => worker());
  await Promise.all(workers);

  return { succeeded, failed };
}

/**
 * Check if the Ollama service is reachable.
 */
export async function isOllamaAvailable(): Promise<boolean> {
  try {
    const response = await fetch(`${env.OLLAMA_HOST}/api/tags`, {
      method: 'GET',
      signal: AbortSignal.timeout(5000),
    });
    return response.ok;
  } catch {
    return false;
  }
}
