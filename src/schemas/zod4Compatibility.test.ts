import test from 'node:test';
import assert from 'node:assert/strict';
import { PaginationQuerySchema, SyncManifestQuerySchema } from './common.js';
import { ExpenseReportListQuerySchema } from './expenseReport.js';
import { InsightQuerySchema } from './insight.js';
import { UpdateUserSchema } from './user.js';

test('query defaults still pass through numeric and boolean transforms', () => {
  assert.deepEqual(PaginationQuerySchema.parse({}), { page: 1, limit: 20, sortOrder: 'asc' });
  assert.deepEqual(SyncManifestQuerySchema.parse({}), { page: 1, limit: 500 });
  assert.deepEqual(ExpenseReportListQuerySchema.parse({}), {
    page: 1,
    limit: 20,
    scope: 'own',
    sortOrder: 'asc',
  });
  assert.deepEqual(InsightQuerySchema.parse({}), { limit: 20, offset: 0, includeStale: false });
  assert.deepEqual(InsightQuerySchema.parse({ limit: '5', offset: '2', includeStale: 'true' }), {
    limit: 5,
    offset: 2,
    includeStale: true,
  });
  assert.equal(PaginationQuerySchema.safeParse({ page: '0' }).success, false);
  assert.equal(PaginationQuerySchema.safeParse({ limit: '101' }).success, false);
});

test('free-form JSON records still accept string keys and heterogeneous values', () => {
  const profile = { average: 1500, categories: ['Travel', 'Meals'], active: true, nested: { currency: 'USD' } };
  assert.deepEqual(UpdateUserSchema.parse({ spendingProfile: profile }), { spendingProfile: profile });
});
