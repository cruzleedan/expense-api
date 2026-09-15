import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { closePool, pool } from './client.js';
import { migrateAdministratorRoleCatalog } from '../services/roleCatalog.service.js';

after(closePool);

test('reviewed upgrades repair legacy data atomically without replaying bootstrap', {
  skip: process.env.SCHEMA_UPGRADE_INTEGRATION !== '1',
}, async () => {
  const existing = await pool.query("SELECT COUNT(*)::int AS count FROM pg_tables WHERE schemaname = 'public'");
  assert.equal(existing.rows[0].count, 0, 'Upgrade tests require an empty disposable database');
  await pool.query(await readFile(new URL('../../src/db/schema.sql', import.meta.url), 'utf8'));
  const tables = await pool.query("SELECT COUNT(*)::int AS count FROM pg_tables WHERE schemaname = 'public'");
  assert.equal(tables.rows[0].count, 35);
  const role = await pool.query<{ id: string; name: string }>("SELECT id, name FROM roles WHERE name IN ('super_admin', 'admin')");
  const rootRoleId = role.rows.find((item) => item.name === 'super_admin')!.id;
  const adminRoleId = role.rows.find((item) => item.name === 'admin')!.id;
  const rootId = randomUUID();
  const adminId = randomUUID();
  const sessionId = randomUUID();
  await pool.query(
    `INSERT INTO users (id, email, is_active, is_verified) VALUES
     ($1, 'upgrade-root@example.test', true, true), ($2, 'upgrade-admin@example.test', true, true)`,
    [rootId, adminId]
  );
  await pool.query('INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2), ($3, $4)', [rootId, rootRoleId, adminId, adminRoleId]);
  await pool.query(
    `INSERT INTO refresh_tokens (id, user_id, token_hash, expires_at)
     VALUES ($1, $2, 'upgrade-test-token-hash', NOW() + INTERVAL '1 hour')`, [sessionId, rootId]
  );

  // Model the pre-WORK-0029 structure only after proving this database was empty.
  await pool.query(`
    ALTER TABLE refresh_tokens DROP COLUMN step_up_verified_at;
    ALTER TABLE permissions DROP CONSTRAINT permissions_critical_requires_mfa;
    ALTER TABLE permissions ALTER COLUMN requires_mfa DROP NOT NULL;
    UPDATE permissions SET requires_mfa = false WHERE risk_level = 'critical';
    UPDATE permissions SET requires_mfa = NULL WHERE name = 'report.view.own';
    CREATE FUNCTION upgrade_test_reject_permissions() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION 'simulated upgrade failure'; END;
    $$;
    CREATE TRIGGER upgrade_test_reject_permissions BEFORE UPDATE ON permissions
      FOR EACH ROW EXECUTE FUNCTION upgrade_test_reject_permissions();
  `);
  const applyUpgrade = () => spawnSync('bash', [
    'scripts/apply-db-change.sh', 'src/db/changes/0029-rbac-step-up.sql',
  ], {
    encoding: 'utf8', timeout: 30000,
    env: { ...process.env, DB_CONTAINER: '', DATABASE_URL: process.env.DATABASE_URL },
  });
  const failed = applyUpgrade();
  assert.equal(failed.status, 3, failed.error?.message || failed.stderr);
  assert.match(failed.stderr, /simulated upgrade failure/);
  const absent = await pool.query(
    `SELECT COUNT(*)::int AS count FROM information_schema.columns
     WHERE table_name = 'refresh_tokens' AND column_name = 'step_up_verified_at'`
  );
  assert.equal(absent.rows[0].count, 0, 'failed upgrade must roll back its earlier ALTER TABLE');
  await pool.query('DROP TRIGGER upgrade_test_reject_permissions ON permissions; DROP FUNCTION upgrade_test_reject_permissions()');
  for (let application = 0; application < 2; application++) {
    const result = applyUpgrade();
    assert.equal(result.status, 0, result.error?.message || result.stderr);
  }
  const constraints = await pool.query(
    `SELECT COUNT(*)::int AS count FROM pg_constraint
     WHERE conname = 'permissions_critical_requires_mfa' AND convalidated`
  );
  assert.equal(constraints.rows[0].count, 1);
  const badFlags = await pool.query(
    `SELECT COUNT(*)::int AS count FROM permissions
     WHERE requires_mfa IS NULL OR (risk_level = 'critical' AND NOT requires_mfa)`
  );
  assert.equal(badFlags.rows[0].count, 0);
  await assert.rejects(
    pool.query("UPDATE permissions SET requires_mfa = false WHERE name = 'role.assign.admin'"),
    /permissions_critical_requires_mfa/
  );
  const session = await pool.query<{ id: string; step_up_verified_at: Date | null }>(
    'SELECT id, step_up_verified_at FROM refresh_tokens WHERE id = $1', [sessionId]
  );
  assert.deepEqual(session.rows, [{ id: sessionId, step_up_verified_at: null }]);

  // Model the legacy denylist, then exercise the approved grant-data upgrade.
  await pool.query(
    `INSERT INTO role_permissions (role_id, permission_id)
     SELECT $1, id FROM permissions WHERE name NOT IN (
       'role.assign.admin', 'role.assign.finance', 'user.delete', 'user.impersonate',
       'system.restore', 'workflow.override', 'report.force_approve'
     ) ON CONFLICT DO NOTHING`, [adminRoleId]
  );
  const preview = await migrateAdministratorRoleCatalog();
  assert.equal(preview.changed, true);
  assert.equal(preview.affectedUserCount, 1);
  const result = await migrateAdministratorRoleCatalog({ apply: true, operatorLabel: 'upgrade-integration-test' });
  assert.equal(result.changed, true);
  assert.equal((await migrateAdministratorRoleCatalog({ apply: true, operatorLabel: 'upgrade-repeat-test' })).changed, false);
  const versions = await pool.query<{ id: string; roles_version: number }>('SELECT id, roles_version FROM users');
  assert.equal(versions.rows.find((user) => user.id === adminId)!.roles_version, 2);
  assert.equal(versions.rows.find((user) => user.id === rootId)!.roles_version, 1);
  const assignments = await pool.query('SELECT user_id, role_id FROM user_roles ORDER BY user_id');
  assert.equal(assignments.rows.length, 2);
});
