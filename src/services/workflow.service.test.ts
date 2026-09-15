import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateActiveExpenseLineTotal } from './workflow.service.js';
import { ValidationError } from '../types/index.js';

type QueryClient = Parameters<typeof calculateActiveExpenseLineTotal>[1];

function clientReturning(lineCount: string, total: string, inspectSql?: (sql: string) => void): QueryClient {
  return {
    query: (async (sql: string) => {
      inspectSql?.(sql);
      return { rows: [{ line_count: lineCount, total }] };
    }) as QueryClient['query'],
  };
}

test('submission totals only active expense lines', async () => {
  const total = await calculateActiveExpenseLineTotal(
    'report-id',
    clientReturning('2', '125.50', (sql) => {
      assert.match(sql, /deleted_at IS NULL/);
      assert.match(sql, /COUNT\(\*\)/);
      assert.match(sql, /SUM\(amount\)/);
    })
  );
  assert.equal(total, 125.5);
});

test('submission rejects empty or deleted-only reports', async () => {
  await assert.rejects(
    calculateActiveExpenseLineTotal('report-id', clientReturning('0', '0')),
    ValidationError
  );
});
