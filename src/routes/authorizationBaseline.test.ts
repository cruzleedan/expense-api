import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { app } from '../app.js';
import { closePool } from '../db/client.js';

after(closePool);

// Baseline gates for anonymous access only. Full role/resource coverage is WORK-0040.
test('protected route families reject anonymous access before database/service work', async () => {
  const id = '00000000-0000-4000-8000-000000000001';
  for (const path of [
    '/v1/users', '/v1/roles', '/v1/permissions', '/v1/expense-reports',
    `/v1/expense-lines/${id}`, `/v1/receipts/${id}`,
    `/v1/expense-reports/${id}/lines`, `/v1/expense-reports/${id}/receipts`,
    '/v1/projects', '/v1/expense-categories', '/v1/expense-policies',
    '/v1/llm-prompt-templates', '/v1/analytics', '/v1/insights', '/v1/anomalies',
    '/v1/admin/analytics/spending-overview',
  ]) {
    const response = await app.request(path);
    assert.equal(response.status, 401, path);
    assert.equal((await response.json() as { error: { code: string } }).error.code, 'UNAUTHORIZED', path);
  }
});
