import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import pg from 'pg';

// Deliberately separate from DATABASE_URL: never infer a test target from app configuration.
const configuredUrl = process.env.TEST_DATABASE_URL;
if (!configuredUrl || process.env.NODE_ENV !== 'test') {
  throw new Error('Set NODE_ENV=test and TEST_DATABASE_URL for a disposable expense_test_control database');
}
const controlUrl = new URL(configuredUrl);
if (!['postgres:', 'postgresql:'].includes(controlUrl.protocol)
  || controlUrl.pathname !== '/expense_test_control') {
  throw new Error('Refusing database tests: TEST_DATABASE_URL must target expense_test_control');
}
const control = new pg.Pool({ connectionString: controlUrl.toString(), max: 1, connectionTimeoutMillis: 2000 });
const suites = [
  { name: 'rbac', flag: 'RBAC_INTEGRATION', file: 'dist/services/rbac.integration.test.js' },
  { name: 'catalog', flag: 'ADMIN_CATALOG_INTEGRATION', file: 'dist/services/roleCatalog.integration.test.js' },
  { name: 'upgrade', flag: 'SCHEMA_UPGRADE_INTEGRATION', file: 'dist/db/schemaUpgrade.integration.test.js' },
];

try {
  const tables = await control.query("SELECT COUNT(*)::int AS count FROM pg_tables WHERE schemaname = 'public'");
  if (tables.rows[0].count !== 0) throw new Error('Refusing populated expense_test_control database');
  for (const suite of suites) {
    // Only names generated in this invocation can be created or dropped.
    const database = `expense_test_${suite.name}_${randomUUID().replaceAll('-', '')}`;
    const suiteUrl = new URL(controlUrl);
    suiteUrl.pathname = `/${database}`;
    await control.query(`CREATE DATABASE "${database}"`);
    try {
      const exitCode = await new Promise((resolve, reject) => {
        const child = spawn(process.execPath, ['--test', suite.file], {
          stdio: 'inherit', timeout: 120000,
          env: {
            ...process.env, NODE_ENV: 'test', DATABASE_URL: suiteUrl.toString(),
            JWT_SECRET: 'test-only-secret-that-is-at-least-32-characters',
            RBAC_INTEGRATION: '0', ADMIN_CATALOG_INTEGRATION: '0', SCHEMA_UPGRADE_INTEGRATION: '0',
            [suite.flag]: '1',
          },
        });
        child.on('error', reject);
        child.on('exit', (code) => resolve(code));
      });
      if (exitCode !== 0) throw new Error(`PostgreSQL suite ${suite.name} failed`);
    } finally {
      await control.query(`DROP DATABASE "${database}" WITH (FORCE)`);
    }
  }
  process.stdout.write('test-postgres: OK (isolated bootstrap, RBAC, catalog, and existing-database upgrades)\n');
} finally {
  await control.end();
}
