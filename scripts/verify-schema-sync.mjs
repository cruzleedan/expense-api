import { readFile } from 'node:fs/promises';
import process from 'node:process';

const sql = await readFile('src/db/schema.sql', 'utf8');
const drizzle = await readFile('src/db/schema.ts', 'utf8');

const sqlTables = new Set(
  [...sql.matchAll(/CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+([a-zA-Z0-9_]+)/gi)]
    .map((match) => match[1])
);
const drizzleTables = new Set(
  [...drizzle.matchAll(/pgTable\(\s*['"]([a-zA-Z0-9_]+)['"]/g)]
    .map((match) => match[1])
);

const missingFromDrizzle = [...sqlTables].filter((table) => !drizzleTables.has(table)).sort();
const missingFromSql = [...drizzleTables].filter((table) => !sqlTables.has(table)).sort();

if (missingFromDrizzle.length || missingFromSql.length) {
  if (missingFromDrizzle.length) {
    process.stderr.write(`FAIL: tables missing from schema.ts: ${missingFromDrizzle.join(', ')}\n`);
  }
  if (missingFromSql.length) {
    process.stderr.write(`FAIL: tables missing from schema.sql: ${missingFromSql.join(', ')}\n`);
  }
  process.exit(1);
}

process.stdout.write(`verify-schema-sync: OK (${sqlTables.size} tables)\n`);
