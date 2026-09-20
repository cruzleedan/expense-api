import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { assertContractParity, assertInternalReferences, openapiContract } from './openapi-contract.mjs';

const fixture = {
  openapi: '3.0.0',
  paths: { '/v1/reports': { post: { requestBody: { required: true }, responses: { 200: { description: 'ok' } } } } },
  components: { schemas: { Report: { type: 'object', properties: { amount: { type: 'number' } } } } },
  security: [{ Bearer: [] }], servers: [{ url: 'http://localhost:3000' }],
};

test('contract gate rejects removed routes, changed field types, and stronger request requirements', () => {
  for (const mutate of [
    (doc) => { delete doc.paths['/v1/reports']; },
    (doc) => { doc.components.schemas.Report.properties.amount.type = 'string'; },
    (doc) => { doc.components.schemas.Report.required = ['amount']; },
    (doc) => { doc.paths['/v1/added'] = {}; },
  ]) {
    const changed = structuredClone(fixture);
    mutate(changed);
    assert.throws(() => assertContractParity(openapiContract(changed), openapiContract(fixture)), /contract changed/);
  }
  const reordered = Object.fromEntries(Object.entries(fixture).reverse());
  assert.doesNotThrow(() => assertContractParity(openapiContract(reordered), openapiContract(fixture)));
});

test('generated document cannot resolve external network or file references', () => {
  assert.doesNotThrow(() => assertInternalReferences({ schema: { $ref: '#/components/schemas/Report' } }));
  for (const reference of ['https://example.test/schema.json', 'file:///etc/passwd', '../private.json']) {
    assert.throws(() => assertInternalReferences({ schema: { $ref: reference } }), /must be internal/);
  }
});

test('PostgreSQL runner refuses missing or application database targets before connecting', () => {
  for (const database of ['', 'postgresql://test:test@127.0.0.1:1/expense_db']) {
    const result = spawnSync(process.execPath, ['scripts/test-postgres.mjs'], {
      encoding: 'utf8', timeout: 5000,
      env: { ...process.env, NODE_ENV: 'test', TEST_DATABASE_URL: database },
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /expense_test_control/);
    assert.doesNotMatch(result.stderr, /ECONNREFUSED/);
  }
});

test('patched tsx loader executes TypeScript policies with ESM runtime extensions', () => {
  const result = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e',
    "import { assertExpectedVersion } from './src/policies/reportLifecycle.ts'; assertExpectedVersion(1, 1);",
  ], { encoding: 'utf8', timeout: 5000 });
  assert.equal(result.status, 0, result.stderr);
});
