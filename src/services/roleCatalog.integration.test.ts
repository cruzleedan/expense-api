import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { OpenAPIHono } from '@hono/zod-openapi';
import { closePool, pool } from '../db/client.js';
import { ADMIN_PERMISSION_NAMES, ORDINARY_SYSTEM_ROLE_NAMES } from '../policies/roleCatalog.js';
import { evaluateSodPermissions } from '../policies/rbac.js';
import { generateAccessToken, verifyAccessToken } from './auth.service.js';
import { migrateAdministratorRoleCatalog } from './roleCatalog.service.js';
import { rolesRouter } from '../routes/roles.js';
import { usersRouter } from '../routes/users.js';
import { camelCaseResponse } from '../middleware/camelCase.js';
import { errorHandler, globalErrorHandler } from '../middleware/errorHandler.js';
import { RoleWithPermissionsSchema } from '../schemas/role.js';

after(async () => {
  await closePool();
});

test('administrator catalog migration is atomic, repeatable, and compatible with seeded-role APIs', {
  skip: process.env.ADMIN_CATALOG_INTEGRATION !== '1',
}, async () => {
  const existing = await pool.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM information_schema.tables
     WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`
  );
  assert.equal(existing.rows[0].count, '0', 'Catalog integration tests require an empty disposable database');
  await pool.query(await readFile(new URL('../../src/db/schema.sql', import.meta.url), 'utf8'));

  const roleRows = await pool.query<{ id: string; name: string }>('SELECT id, name FROM roles');
  const roleIds = new Map(roleRows.rows.map((role) => [role.name, role.id]));
  const adminRoleId = roleIds.get('admin')!;
  const grantNames = async (roleId: string) => {
    const grants = await pool.query<{ name: string }>(
      `SELECT p.name FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id
       WHERE rp.role_id = $1 ORDER BY p.name`, [roleId]
    );
    return grants.rows.map((grant) => grant.name);
  };
  assert.deepEqual(await grantNames(adminRoleId), [...ADMIN_PERMISSION_NAMES].sort());
  const sodRows = await pool.query<{ name: string; description: string | null; permission_set: string[] }>(
    'SELECT name, description, permission_set FROM sod_rules WHERE is_active'
  );
  const rules = sodRows.rows.map((rule) => ({
    name: rule.name, description: rule.description, permissionSet: rule.permission_set,
  }));
  for (const name of ORDINARY_SYSTEM_ROLE_NAMES) {
    assert.deepEqual(evaluateSodPermissions(await grantNames(roleIds.get(name)!), rules), [], name);
  }
  const superAdminGrants = await grantNames(roleIds.get('super_admin')!);
  assert.equal(evaluateSodPermissions(superAdminGrants, rules).length, 6);

  const rootId = randomUUID();
  const adminUserId = randomUUID();
  const inactiveUserId = randomUUID();
  const financeAdminId = randomUUID();
  const unaffectedUserId = randomUUID();
  const rootSessionId = randomUUID();
  const affectedIds: string[] = [rootId, adminUserId, inactiveUserId, financeAdminId];
  for (const id of [...affectedIds, unaffectedUserId]) {
    await pool.query(
      `INSERT INTO users (id, email, username, is_active, is_verified) VALUES ($1, $2, 'catalog-test', $3, true)`,
      [id, `catalog-${id}@example.test`, id !== inactiveUserId]
    );
  }
  for (const id of affectedIds) {
    await pool.query('INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2)', [id, adminRoleId]);
  }
  await pool.query('INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2)', [rootId, roleIds.get('super_admin')]);
  await pool.query('INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2)', [inactiveUserId, roleIds.get('employee')]);
  await pool.query('INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2)', [financeAdminId, roleIds.get('finance')]);
  await pool.query('INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2)', [unaffectedUserId, roleIds.get('finance')]);
  await pool.query(
    `INSERT INTO refresh_tokens (id, user_id, token_hash, expires_at, step_up_verified_at, auth_version)
     VALUES ($1, $2, $3, NOW() + INTERVAL '1 hour', NOW(), 2)`,
    [rootSessionId, rootId, `catalog-session-${rootSessionId}`]
  );

  // Model the pre-WORK-0047 denylist in this disposable database only.
  await pool.query('DELETE FROM role_permissions WHERE role_id = $1', [adminRoleId]);
  await pool.query(`INSERT INTO permissions (name, risk_level, requires_mfa) VALUES ('catalog.future.permission', 'low', false)`);
  await pool.query(
    `INSERT INTO role_permissions (role_id, permission_id)
     SELECT $1, id FROM permissions WHERE name NOT IN (
       'role.assign.admin', 'role.assign.finance', 'user.delete', 'user.impersonate',
       'system.restore', 'workflow.override', 'report.force_approve'
     )`, [adminRoleId]
  );
  const legacyNames = await grantNames(adminRoleId);
  const retainedGrant = await pool.query<{ permission_id: string; granted_at: Date }>(
    `SELECT rp.permission_id, rp.granted_at FROM role_permissions rp
     JOIN permissions p ON p.id = rp.permission_id WHERE rp.role_id = $1 AND p.name = 'user.edit'`,
    [adminRoleId]
  );
  const staleToken = await generateAccessToken({
    id: adminUserId, email: `catalog-${adminUserId}@example.test`, username: 'catalog-test', roles_version: 1,
  });
  assert.ok((await verifyAccessToken(staleToken)).permissions.includes('report.post'));
  const snapshot = async () => {
    const versions = await pool.query<{ id: string; roles_version: number }>('SELECT id, roles_version FROM users ORDER BY id');
    const assignments = await pool.query('SELECT user_id, role_id, assigned_by, assigned_at FROM user_roles ORDER BY user_id, role_id');
    const audits = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM audit_logs WHERE metadata->>'work_item' = 'WORK-0047'`
    );
    return { grants: await grantNames(adminRoleId), versions: versions.rows, assignments: assignments.rows, audits: audits.rows[0].count };
  };
  const before = await snapshot();
  const preview = await migrateAdministratorRoleCatalog();
  assert.equal(preview.mode, 'dry-run');
  assert.equal(preview.changed, true);
  assert.equal(preview.affectedUserCount, affectedIds.length);
  assert.equal(preview.eligibleControlPlaneAdmins, 1);
  assert.deepEqual(await snapshot(), before);
  await assert.rejects(migrateAdministratorRoleCatalog({ apply: true }), /operator label is required/);

  await pool.query("UPDATE permissions SET name = 'catalog.missing.form.publish' WHERE name = 'form.publish'");
  await assert.rejects(migrateAdministratorRoleCatalog(), /permissions are missing: form.publish/);
  await pool.query("UPDATE permissions SET name = 'form.publish' WHERE name = 'catalog.missing.form.publish'");
  await pool.query('UPDATE users SET is_active = false WHERE id = $1', [rootId]);
  await assert.rejects(migrateAdministratorRoleCatalog(), /active verified system super administrator/);
  await pool.query('UPDATE users SET is_active = true WHERE id = $1', [rootId]);
  await pool.query('UPDATE roles SET is_system = false WHERE id = $1', [adminRoleId]);
  await assert.rejects(migrateAdministratorRoleCatalog(), /system role catalog is missing or has been replaced/);
  await pool.query('UPDATE roles SET is_system = true WHERE id = $1', [adminRoleId]);

  // Do not repair one role while accepting another incompatible system definition.
  await pool.query(
    `INSERT INTO role_permissions (role_id, permission_id)
     SELECT $1, id FROM permissions WHERE name = 'report.edit.all'`, [roleIds.get('auditor')]
  );
  await assert.rejects(migrateAdministratorRoleCatalog(), /Separation of duties violation for system role auditor/);
  await pool.query(
    `DELETE FROM role_permissions WHERE role_id = $1
     AND permission_id = (SELECT id FROM permissions WHERE name = 'report.edit.all')`, [roleIds.get('auditor')]
  );

  // Catalog repair must not silently compensate for an unrelated toxic combination.
  await pool.query('INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2)', [financeAdminId, roleIds.get('approver')]);
  await assert.rejects(
    migrateAdministratorRoleCatalog({ apply: true, operatorLabel: 'integration-test' }),
    /Separation of duties violation for user/
  );
  await pool.query('DELETE FROM user_roles WHERE user_id = $1 AND role_id = $2', [financeAdminId, roleIds.get('approver')]);
  assert.deepEqual(await snapshot(), before);

  await pool.query(`
    CREATE FUNCTION catalog_test_reject_audit() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF NEW.metadata->>'work_item' = 'WORK-0047' THEN
        RAISE EXCEPTION 'simulated catalog audit failure';
      END IF;
      RETURN NEW;
    END;
    $$;
    CREATE TRIGGER catalog_test_reject_audit BEFORE INSERT ON audit_logs
      FOR EACH ROW EXECUTE FUNCTION catalog_test_reject_audit();
  `);
  await assert.rejects(
    migrateAdministratorRoleCatalog({ apply: true, operatorLabel: 'integration-test' }),
    /simulated catalog audit failure/
  );
  assert.deepEqual(await snapshot(), before);
  await pool.query('DROP TRIGGER catalog_test_reject_audit ON audit_logs; DROP FUNCTION catalog_test_reject_audit()');

  const applications = await Promise.all([
    migrateAdministratorRoleCatalog({ apply: true, operatorLabel: 'integration-test-a' }),
    migrateAdministratorRoleCatalog({ apply: true, operatorLabel: 'integration-test-b' }),
  ]);
  assert.equal(applications.filter((application) => application.changed).length, 1);
  const afterMigration = await snapshot();
  assert.deepEqual(afterMigration.grants, [...ADMIN_PERMISSION_NAMES].sort());
  assert.deepEqual(afterMigration.assignments, before.assignments);
  assert.equal(afterMigration.audits, '1');
  for (const user of afterMigration.versions) {
    assert.equal(user.roles_version, affectedIds.includes(user.id) ? 2 : 1);
  }
  assert.deepEqual(await grantNames(roleIds.get('super_admin')!), superAdminGrants);
  const retainedAfter = await pool.query<{ permission_id: string; granted_at: Date }>(
    'SELECT permission_id, granted_at FROM role_permissions WHERE role_id = $1 AND permission_id = $2',
    [adminRoleId, retainedGrant.rows[0].permission_id]
  );
  assert.deepEqual(retainedAfter.rows, retainedGrant.rows);
  await assert.rejects(verifyAccessToken(staleToken), /permission changes/);
  const freshAdminToken = await generateAccessToken({
    id: adminUserId, email: `catalog-${adminUserId}@example.test`, username: 'catalog-test', roles_version: 2,
  });
  const newClaims = await verifyAccessToken(freshAdminToken);
  assert.ok(newClaims.permissions.includes('user.edit'));
  assert.ok(newClaims.permissions.includes('report.view.all'));
  assert.equal(newClaims.permissions.includes('report.post'), false);
  const audit = await pool.query<{ actor_id: string | null; is_sensitive: boolean; metadata: Record<string, unknown> }>(
    "SELECT actor_id, is_sensitive, metadata FROM audit_logs WHERE metadata->>'work_item' = 'WORK-0047'"
  );
  assert.equal(audit.rows[0].actor_id, null);
  assert.equal(audit.rows[0].is_sensitive, true);
  assert.equal(audit.rows[0].metadata.database_operator, 'expense_test');
  assert.ok(Array.isArray(audit.rows[0].metadata.invalidated_users));

  const app = new OpenAPIHono();
  app.use('*', errorHandler);
  app.use('*', camelCaseResponse);
  app.onError(globalErrorHandler);
  app.route('/v1/roles', rolesRouter);
  app.route('/v1/users', usersRouter);
  const adminDetail = await app.request(`/v1/roles/${adminRoleId}`, {
    headers: { authorization: `Bearer ${freshAdminToken}` },
  });
  assert.equal(adminDetail.status, 200);
  const roleDetail = RoleWithPermissionsSchema.parse(await adminDetail.json());
  assert.equal(roleDetail.name, 'admin');
  assert.equal(roleDetail.isSystem, true);
  assert.deepEqual(roleDetail.permissions.map((permission) => permission.name).sort(), [...ADMIN_PERMISSION_NAMES].sort());
  const rootToken = await generateAccessToken({
    id: rootId, email: `catalog-${rootId}@example.test`, username: 'catalog-test', roles_version: 2,
  }, rootSessionId);
  const command = (path: string, method: string, roleIdsForCommand: string[]) => app.request(path, {
    method,
    headers: { authorization: `Bearer ${rootToken}`, 'content-type': 'application/json' },
    body: JSON.stringify(method === 'post' ? { roleId: roleIdsForCommand[0] } : { roleIds: roleIdsForCommand }),
  });
  assert.equal((await command(`/v1/roles/users/${unaffectedUserId}/roles`, 'post', [adminRoleId])).status, 200);
  assert.equal((await command(`/v1/users/${unaffectedUserId}/roles`, 'put', [adminRoleId, roleIds.get('approver')!])).status, 200);
  const rejected = await command(`/v1/users/${unaffectedUserId}/roles`, 'put', [adminRoleId, roleIds.get('approver')!, roleIds.get('finance')!]);
  assert.equal(rejected.status, 400);
  assert.equal((await command(`/v1/roles/users/${unaffectedUserId}/roles`, 'put', [adminRoleId, roleIds.get('finance')!])).status, 200);
  const rootAccount = await pool.query<{ is_active: boolean; is_verified: boolean }>('SELECT is_active, is_verified FROM users WHERE id = $1', [rootId]);
  assert.deepEqual(rootAccount.rows[0], { is_active: true, is_verified: true });
  assert.ok(legacyNames.includes('catalog.future.permission'));
  assert.equal((await grantNames(adminRoleId)).includes('catalog.future.permission'), false);
});
