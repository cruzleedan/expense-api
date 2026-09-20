import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { pool, closePool } from './client.js';

after(closePool);
test('WORK-0030 reviewed additive upgrade preserves ownership and rolls back ambiguity/failure', {
  skip: process.env.AUTH_UPGRADE_INTEGRATION !== '1',
}, async () => {
  assert.equal((await pool.query("SELECT COUNT(*)::int AS count FROM pg_tables WHERE schemaname = 'public'")).rows[0].count, 0,
    'Auth upgrade requires an empty disposable database');
  const bootstrap = await readFile(new URL('../../src/db/schema.sql', import.meta.url), 'utf8');
  await pool.query(bootstrap);
  const owner = randomUUID(); const other = randomUUID(); const token = randomUUID();
  await pool.query(`INSERT INTO users(id, email, oauth_provider, oauth_id, is_active, is_verified)
    VALUES ($1,'identity-owner@example.test','google','legacy-subject',true,true),
    ($2,'identity-other@example.test',NULL,NULL,true,true)`, [owner, other]);
  await pool.query(`INSERT INTO user_roles(user_id, role_id) SELECT $1,id FROM roles WHERE name = 'employee'`, [owner]);
  await pool.query(`INSERT INTO refresh_tokens(id,user_id,token_hash,expires_at)
    VALUES ($1,$2,'legacy-hash',NOW() + INTERVAL '1 hour')`, [token, owner]);
  // Only modify structure after the explicit disposable/empty target check.
  await pool.query(`DROP TABLE user_identities;
    DROP INDEX idx_refresh_tokens_hash_unique;
    ALTER TABLE refresh_tokens DROP COLUMN family_id, DROP COLUMN family_created_at, DROP COLUMN rotated_at, DROP COLUMN auth_version`);
  const apply = () => spawnSync('bash', ['scripts/apply-db-change.sh', 'src/db/changes/0030-session-families-and-identities.sql'], {
    encoding: 'utf8', timeout: 30000,
    env: { ...process.env, DB_CONTAINER: '', DATABASE_URL: process.env.DATABASE_URL },
  });
  const noFamilies = async () => assert.equal((await pool.query(`SELECT COUNT(*)::int AS count FROM information_schema.columns
    WHERE table_name = 'refresh_tokens' AND column_name = 'family_id'`)).rows[0].count, 0);
  await pool.query("UPDATE users SET oauth_provider = 'google', oauth_id = 'legacy-subject' WHERE id = $1", [other]);
  let result = apply(); assert.equal(result.status, 3); assert.match(result.stderr, /duplicate legacy provider subject/); await noFamilies();
  await pool.query('UPDATE users SET oauth_provider = NULL WHERE id = $1', [other]);
  result = apply(); assert.equal(result.status, 3); assert.match(result.stderr, /incomplete or unsupported/); await noFamilies();
  await pool.query('UPDATE users SET oauth_id = NULL WHERE id = $1', [other]);
  const duplicate = randomUUID();
  await pool.query(`INSERT INTO refresh_tokens(id,user_id,token_hash,expires_at)
    VALUES ($1,$2,'legacy-hash',NOW() + INTERVAL '1 hour')`, [duplicate, owner]);
  result = apply(); assert.equal(result.status, 3); assert.match(result.stderr, /duplicate refresh token hash/); await noFamilies();
  await pool.query('DELETE FROM refresh_tokens WHERE id = $1', [duplicate]);

  // A partially installed identity table must not overwrite an existing owner.
  const tableSql = /CREATE TABLE IF NOT EXISTS user_identities\s*\([\s\S]*?\n\);/.exec(bootstrap)?.[0];
  assert.ok(tableSql); await pool.query(tableSql);
  await pool.query("INSERT INTO user_identities(user_id,provider,subject) VALUES ($1,'google','legacy-subject')", [other]);
  result = apply(); assert.equal(result.status, 3); assert.match(result.stderr, /conflicts with legacy ownership/); await noFamilies();
  await pool.query('DELETE FROM user_identities');
  await pool.query(`CREATE FUNCTION auth_upgrade_failure() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION 'simulated identity backfill failure'; END; $$;
    CREATE TRIGGER auth_upgrade_failure BEFORE INSERT ON user_identities FOR EACH ROW EXECUTE FUNCTION auth_upgrade_failure()`);
  result = apply(); assert.equal(result.status, 3); assert.match(result.stderr, /simulated identity backfill failure/); await noFamilies();
  assert.equal((await pool.query('SELECT 1 FROM user_identities')).rowCount, 0);
  await pool.query('DROP TRIGGER auth_upgrade_failure ON user_identities; DROP FUNCTION auth_upgrade_failure()');
  const preserved = async () => ({
    users: (await pool.query('SELECT * FROM users ORDER BY id')).rows,
    assignments: (await pool.query('SELECT * FROM user_roles ORDER BY user_id,role_id')).rows,
    grants: (await pool.query('SELECT * FROM role_permissions ORDER BY role_id,permission_id')).rows,
    audits: (await pool.query('SELECT * FROM audit_logs')).rows,
  });
  const before = await preserved();
  result = apply(); assert.equal(result.status, 0, result.error?.message || result.stderr);
  const first = (await pool.query('SELECT * FROM refresh_tokens ORDER BY id')).rows;
  assert.equal(first.length, 1); assert.ok(first[0].family_id); assert.equal(first[0].rotated_at, null);
  assert.equal(first[0].family_created_at.getTime(), first[0].created_at.getTime());
  assert.equal(first[0].revoked_at, null); assert.equal(first[0].id, token);
  assert.equal(first[0].auth_version, 1, 'Legacy ledger rows stay historical, not current active sessions');
  const identity = (await pool.query('SELECT user_id, provider, subject FROM user_identities')).rows;
  assert.deepEqual(identity, [{ user_id: owner, provider: 'google', subject: 'legacy-subject' }]);
  result = apply(); assert.equal(result.status, 0, result.error?.message || result.stderr);
  assert.deepEqual((await pool.query('SELECT * FROM refresh_tokens ORDER BY id')).rows, first);
  assert.deepEqual((await pool.query('SELECT user_id, provider, subject FROM user_identities')).rows, identity);
  assert.deepEqual(await preserved(), before);
  assert.equal((await pool.query("SELECT COUNT(*)::int AS count FROM pg_tables WHERE schemaname = 'public'")).rows[0].count, 36);
  await assert.rejects(pool.query("INSERT INTO user_identities(user_id,provider,subject) VALUES ($1,'google','legacy-subject')", [other]), /provider_subject_unique/);
  await assert.rejects(pool.query(`INSERT INTO refresh_tokens(user_id,token_hash,expires_at,family_id)
    VALUES ($1,'other-hash',NOW() + INTERVAL '1 hour',$2)`, [owner, first[0].family_id]), /active_family/);
});
