/**
 * Backfill embedding vectors for existing data.
 *
 * Reads rows with NULL embeddings from each table, generates vectors
 * via Ollama's nomic-embed-text model, and stores them back.
 *
 * Usage:
 *   npx tsx src/scripts/backfill-embeddings.ts
 *
 * Environment:
 *   DATABASE_URL   — PostgreSQL connection string (required)
 *   OLLAMA_HOST    — Ollama API URL (default: http://shared-ollama:11434)
 *   CONCURRENCY    — Parallel embedding requests (default: 5)
 */

import pg from 'pg';
import { embedText, toPgVector } from '../services/embedding.service.js';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('DATABASE_URL is required');
  process.exit(1);
}

const CONCURRENCY = parseInt(process.env.CONCURRENCY ?? '5', 10);

const pool = new pg.Pool({ connectionString: DATABASE_URL });

interface BackfillTarget {
  table: string;
  idColumn: string;
  textColumn: string;       // column to read text from
  embeddingColumn: string;  // column to write vector to
  textBuilder?: (row: Record<string, unknown>) => string;  // custom text builder
  extraColumns?: string[];  // additional columns to select for textBuilder
}

const TARGETS: BackfillTarget[] = [
  {
    table: 'expense_categories',
    idColumn: 'id',
    textColumn: 'name',
    embeddingColumn: 'name_embedding',
    extraColumns: ['description', 'keywords', 'synonyms'],
    textBuilder: (row) => {
      const parts = [row.name as string];
      if (row.description) parts.push(row.description as string);
      if (row.keywords) parts.push(`Keywords: ${(row.keywords as string[]).join(', ')}`);
      if (row.synonyms) parts.push(`Synonyms: ${(row.synonyms as string[]).join(', ')}`);
      return parts.join('. ');
    },
  },
  {
    table: 'expense_lines',
    idColumn: 'id',
    textColumn: 'description',
    embeddingColumn: 'description_embedding',
    extraColumns: ['category', 'merchant_name', 'amount'],
    textBuilder: (row) => {
      const parts = [row.description as string];
      if (row.category) parts.push(`Category: ${row.category}`);
      if (row.merchant_name) parts.push(`Merchant: ${row.merchant_name}`);
      if (row.amount) parts.push(`Amount: $${row.amount}`);
      return parts.join('. ');
    },
  },
  {
    table: 'expense_reports',
    idColumn: 'id',
    textColumn: 'title',
    embeddingColumn: 'content_embedding',
    extraColumns: ['ai_summary', 'purpose'],
    textBuilder: (row) => {
      const parts = [row.title as string];
      if (row.purpose) parts.push(row.purpose as string);
      if (row.ai_summary) parts.push(row.ai_summary as string);
      return parts.join('. ');
    },
  },
  {
    table: 'merchants',
    idColumn: 'id',
    textColumn: 'normalized_name',
    embeddingColumn: 'name_embedding',
    extraColumns: ['merchant_type'],
    textBuilder: (row) => {
      const parts = [row.normalized_name as string];
      if (row.merchant_type) parts.push(`Type: ${row.merchant_type}`);
      return parts.join('. ');
    },
  },
  {
    table: 'projects',
    idColumn: 'id',
    textColumn: 'name',
    embeddingColumn: 'name_embedding',
    extraColumns: ['description', 'client_name', 'client_industry'],
    textBuilder: (row) => {
      const parts = [row.name as string];
      if (row.description) parts.push(row.description as string);
      if (row.client_name) parts.push(`Client: ${row.client_name}`);
      if (row.client_industry) parts.push(`Industry: ${row.client_industry}`);
      return parts.join('. ');
    },
  },
];

async function backfillTable(target: BackfillTarget): Promise<{ succeeded: number; failed: number }> {
  const selectCols = [target.idColumn, target.textColumn, ...(target.extraColumns ?? [])].join(', ');
  const { rows } = await pool.query(
    `SELECT ${selectCols} FROM ${target.table} WHERE ${target.embeddingColumn} IS NULL AND ${target.textColumn} IS NOT NULL`
  );

  if (rows.length === 0) {
    console.log(`  ${target.table}: no rows to backfill`);
    return { succeeded: 0, failed: 0 };
  }

  console.log(`  ${target.table}: ${rows.length} rows to embed`);

  let succeeded = 0;
  let failed = 0;
  let index = 0;

  async function worker() {
    while (index < rows.length) {
      const current = index++;
      const row = rows[current];
      const text = target.textBuilder
        ? target.textBuilder(row)
        : (row[target.textColumn] as string);

      if (!text || text.trim().length === 0) {
        failed++;
        continue;
      }

      try {
        const embedding = await embedText(text);
        const vectorStr = toPgVector(embedding);
        await pool.query(
          `UPDATE ${target.table} SET ${target.embeddingColumn} = $1::vector WHERE ${target.idColumn} = $2`,
          [vectorStr, row[target.idColumn]]
        );
        succeeded++;
      } catch (error) {
        failed++;
        console.error(`  Failed ${target.table}/${row[target.idColumn]}: ${error instanceof Error ? error.message : error}`);
      }

      if ((succeeded + failed) % 20 === 0) {
        console.log(`  ${target.table}: ${succeeded + failed}/${rows.length} (${succeeded} ok, ${failed} failed)`);
      }
    }
  }

  const workers = Array.from({ length: Math.min(CONCURRENCY, rows.length) }, () => worker());
  await Promise.all(workers);

  return { succeeded, failed };
}

async function main() {
  console.log('=== Backfill Embeddings ===');
  console.log(`Ollama host: ${process.env.OLLAMA_HOST ?? 'http://shared-ollama:11434'}`);
  console.log(`Concurrency: ${CONCURRENCY}`);
  console.log('');

  const totals = { succeeded: 0, failed: 0 };

  for (const target of TARGETS) {
    const result = await backfillTable(target);
    totals.succeeded += result.succeeded;
    totals.failed += result.failed;
  }

  console.log('');
  console.log(`=== Done: ${totals.succeeded} succeeded, ${totals.failed} failed ===`);

  await pool.end();
}

main().catch((error) => {
  console.error('Backfill failed:', error);
  process.exit(1);
});
