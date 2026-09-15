import { readFile, writeFile } from 'node:fs/promises';
import SwaggerParser from '@apidevtools/swagger-parser';
import { assertContractParity, assertInternalReferences, openapiContract } from './openapi-contract.mjs';

// Generating the document must not start HTTP listeners, jobs, or use live secrets.
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = 'postgresql://test:test@127.0.0.1:1/expense_test';
process.env.JWT_SECRET = 'test-only-secret-that-is-at-least-32-characters';
const { app } = await import('../dist/app.js');
const { closePool } = await import('../dist/db/client.js');
const baselinePath = new URL('../contracts/openapi.json', import.meta.url);

try {
  const args = process.argv.slice(2);
  if (args.length > 1 || (args.length === 1 && args[0] !== '--write-baseline')) {
    throw new Error('Usage: verify-openapi.mjs [--write-baseline]');
  }
  const response = await app.request('/openapi.json');
  if (response.status !== 200) throw new Error(`OpenAPI generation returned ${response.status}`);
  const document = await response.json();
  assertInternalReferences(document);
  // Disable all external resolution; a schema reference must never trigger network/file access.
  await SwaggerParser.validate(structuredClone(document), {
    resolve: { external: false },
    dereference: { circular: 'ignore' },
  });
  const contract = openapiContract(document);
  if (args[0] === '--write-baseline') {
    await writeFile(baselinePath, `${JSON.stringify(contract, null, 2)}\n`);
    process.stdout.write('OpenAPI baseline written; review its diff and client impact before committing.\n');
  } else {
    const baseline = JSON.parse(await readFile(baselinePath, 'utf8'));
    assertContractParity(contract, baseline);
    process.stdout.write(`verify-openapi: OK (${Object.keys(document.paths).length} paths; structural validation and reviewed contract parity)\n`);
  }
} catch (error) {
  process.stderr.write(`verify-openapi: FAIL: ${error.message}\n`);
  process.exitCode = 1;
} finally {
  await closePool();
}
