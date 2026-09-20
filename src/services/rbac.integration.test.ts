import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, scrypt } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { closePool, pool } from '../db/client.js';
import {
  deactivateAccount,
  establishSessionStepUp,
  generateAccessToken,
  verifyAccessToken,
} from './auth.service.js';
import {
  assignRoleToUser,
  deletePermission,
  deleteRole,
  removeRoleFromUser,
  setUserRoles,
  updateRolePermissions,
  type RbacMutationActor,
} from './rbac.service.js';

after(async () => {
  await closePool();
});

test('RBAC transactions serialize final-state controls and invalidate stale tokens', {
  skip: process.env.RBAC_INTEGRATION !== '1',
}, async () => {
  const existingTables = await pool.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM information_schema.tables
     WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`
  );
  assert.equal(existingTables.rows[0].count, '0', 'RBAC integration tests require an empty disposable database');
  const schema = await readFile(new URL('../../src/db/schema.sql', import.meta.url), 'utf8');
  await pool.query(schema);

  const actorId = randomUUID();
  const actorRoleId = randomUUID();
  const actorSessionId = randomUUID();
  await pool.query(
    `INSERT INTO users (id, email, username, is_active, is_verified)
     VALUES ($1, $2, 'rbac-operator', true, true)`,
    [actorId, `rbac-operator-${actorId}@example.test`]
  );
  await pool.query(
    `INSERT INTO roles (id, name, description, is_system)
     VALUES ($1, $2, 'RBAC integration-test operator', false)`,
    [actorRoleId, `rbac-operator-${actorRoleId}`]
  );
  await pool.query(
    `INSERT INTO role_permissions (role_id, permission_id)
     SELECT $1, id FROM permissions
     WHERE name = ANY($2::text[])`,
    [actorRoleId, ['role.assign', 'role.assign.admin', 'role.delete', 'role.edit', 'permission.delete']]
  );
  await pool.query('INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2)', [actorId, actorRoleId]);
  await pool.query(
    `INSERT INTO refresh_tokens
       (id, user_id, token_hash, expires_at, step_up_verified_at, auth_version)
     VALUES ($1, $2, $3, NOW() + INTERVAL '1 hour', NOW(), 2)`,
    [actorSessionId, actorId, `test-${actorSessionId}`]
  );
  const actor: RbacMutationActor = { id: actorId, rolesVersion: 1, sessionId: actorSessionId };
  const stepUpPassword = 'Test-only-step-up-password!42';
  const passwordSalt = '00112233445566778899aabbccddeeff';
  const passwordKey = await promisify(scrypt)(stepUpPassword, passwordSalt, 64) as Buffer;
  await pool.query('UPDATE users SET password_hash = $2 WHERE id = $1', [
    actorId,
    `${passwordSalt}:${passwordKey.toString('hex')}`,
  ]);
  await pool.query('UPDATE refresh_tokens SET step_up_verified_at = NULL WHERE id = $1', [actorSessionId]);
  await assert.rejects(
    establishSessionStepUp(actorId, actorSessionId, 'incorrect-password'),
    /Invalid credentials/
  );
  const stepUp = await establishSessionStepUp(actorId, actorSessionId, stepUpPassword);
  assert.ok(stepUp.expiresAt.getTime() > stepUp.verifiedAt.getTime());

  const staleUserId = randomUUID();
  const staleRoleId = randomUUID();
  await pool.query(
    `INSERT INTO users (id, email, username, is_active, is_verified)
     VALUES ($1, $2, 'stale-user', true, true)`,
    [staleUserId, `stale-${staleUserId}@example.test`]
  );
  await pool.query(
    `INSERT INTO roles (id, name, is_system) VALUES ($1, $2, false)`,
    [staleRoleId, `stale-role-${staleRoleId}`]
  );
  await pool.query('INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2)', [staleUserId, staleRoleId]);
  const staleToken = await generateAccessToken({
    id: staleUserId,
    email: `stale-${staleUserId}@example.test`,
    username: 'stale-user',
    roles_version: 1,
  });
  // Model a request that passed middleware before a prior mutation committed.
  await pool.query('UPDATE users SET roles_version = roles_version + 1 WHERE id = $1', [actorId]);
  await assert.rejects(deleteRole(staleRoleId, actor), /permission changes/);
  const preservedRole = await pool.query('SELECT id FROM roles WHERE id = $1', [staleRoleId]);
  assert.equal(preservedRole.rows.length, 1);
  actor.rolesVersion = 2;
  await deleteRole(staleRoleId, actor);
  await assert.rejects(verifyAccessToken(staleToken), /permission changes/);

  const sodUserId = randomUUID();
  const approveRoleId = randomUUID();
  const postRoleId = randomUUID();
  await pool.query(
    `INSERT INTO users (id, email, is_active, is_verified) VALUES ($1, $2, true, true)`,
    [sodUserId, `sod-${sodUserId}@example.test`]
  );
  await pool.query(
    `INSERT INTO roles (id, name, is_system) VALUES
       ($1, $2, false), ($3, $4, false)`,
    [approveRoleId, `approve-${approveRoleId}`, postRoleId, `post-${postRoleId}`]
  );
  await pool.query(
    `INSERT INTO role_permissions (role_id, permission_id)
     SELECT $1::uuid, id FROM permissions WHERE name = 'report.approve'
     UNION ALL
     SELECT $2::uuid, id FROM permissions WHERE name = 'report.post'`,
    [approveRoleId, postRoleId]
  );
  const concurrentAssignments = await Promise.allSettled([
    assignRoleToUser(sodUserId, approveRoleId, actor),
    assignRoleToUser(sodUserId, postRoleId, actor),
  ]);
  assert.equal(concurrentAssignments.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal(concurrentAssignments.filter((result) => result.status === 'rejected').length, 1);
  const sodRoleCount = await pool.query<{ count: string }>(
    'SELECT COUNT(*)::text AS count FROM user_roles WHERE user_id = $1',
    [sodUserId]
  );
  assert.equal(sodRoleCount.rows[0].count, '1');

  const inactiveRoleId = randomUUID();
  await pool.query(
    `INSERT INTO roles (id, name, is_system, is_active) VALUES ($1, $2, false, false)`,
    [inactiveRoleId, `inactive-${inactiveRoleId}`]
  );
  await assert.rejects(assignRoleToUser(sodUserId, inactiveRoleId, actor), /Active role not found/);
  await pool.query('INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2)', [sodUserId, inactiveRoleId]);
  await removeRoleFromUser(sodUserId, inactiveRoleId, actor);
  const inactiveAssignments = await pool.query(
    'SELECT role_id FROM user_roles WHERE user_id = $1 AND role_id = $2', [sodUserId, inactiveRoleId]
  );
  assert.equal(inactiveAssignments.rows.length, 0);

  const updateUserId = randomUUID();
  const updateRoleId = randomUUID();
  await pool.query(
    `INSERT INTO users (id, email, is_active, is_verified) VALUES ($1, $2, true, true)`,
    [updateUserId, `role-update-${updateUserId}@example.test`]
  );
  await pool.query(
    `INSERT INTO roles (id, name, is_system) VALUES ($1, $2, false)`,
    [updateRoleId, `role-update-${updateRoleId}`]
  );
  const toxicPermissionIds = await pool.query<{ id: string }>(
    `SELECT id FROM permissions WHERE name = ANY($1::text[]) ORDER BY name`,
    [['report.approve', 'report.post']]
  );
  await pool.query(
    `INSERT INTO role_permissions (role_id, permission_id) VALUES ($1, $2)`,
    [updateRoleId, toxicPermissionIds.rows[0].id]
  );
  await pool.query('INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2)', [updateUserId, updateRoleId]);
  await assert.rejects(
    updateRolePermissions(updateRoleId, toxicPermissionIds.rows.map((row) => row.id), actor),
    /Separation of duties violation/
  );
  const unchangedPermissionCount = await pool.query<{ count: string }>(
    'SELECT COUNT(*)::text AS count FROM role_permissions WHERE role_id = $1',
    [updateRoleId]
  );
  assert.equal(unchangedPermissionCount.rows[0].count, '1');
  // A replacement can be safe for the role but toxic when combined with another role.
  await pool.query('INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2)', [updateUserId, approveRoleId]);
  await assert.rejects(
    updateRolePermissions(updateRoleId, [toxicPermissionIds.rows[1].id], actor),
    /Separation of duties violation for user/
  );
  // Replacing all approval roles with a posting role must evaluate only the final set.
  await setUserRoles(updateUserId, [postRoleId], actor);
  const replacementRoles = await pool.query<{ role_id: string }>(
    'SELECT role_id FROM user_roles WHERE user_id = $1', [updateUserId]
  );
  assert.deepEqual(replacementRoles.rows.map((row) => row.role_id), [postRoleId]);
  const rejectedUpdateAudits = await pool.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM audit_logs
     WHERE action = 'role.permissions.update' AND resource_id = $1`, [updateRoleId]
  );
  assert.equal(rejectedUpdateAudits.rows[0].count, '0');

  const superAdminRole = await pool.query<{ id: string }>(
    `SELECT id FROM roles WHERE name = 'super_admin'`
  );
  const firstAdminId = randomUUID();
  const secondAdminId = randomUUID();
  await pool.query(
    `INSERT INTO users (id, email, is_active, is_verified) VALUES
       ($1, $2, true, true), ($3, $4, true, true)`,
    [
      firstAdminId,
      `first-admin-${firstAdminId}@example.test`,
      secondAdminId,
      `second-admin-${secondAdminId}@example.test`,
    ]
  );
  await pool.query(
    `INSERT INTO user_roles (user_id, role_id) VALUES ($1, $3), ($2, $3)`,
    [firstAdminId, secondAdminId, superAdminRole.rows[0].id]
  );
  await pool.query(
    `UPDATE refresh_tokens SET step_up_verified_at = NOW() - INTERVAL '10 minutes' WHERE id = $1`,
    [actorSessionId]
  );
  await assert.rejects(
    removeRoleFromUser(firstAdminId, superAdminRole.rows[0].id, actor),
    /step-up authentication/
  );
  await pool.query('UPDATE refresh_tokens SET step_up_verified_at = NOW() WHERE id = $1', [actorSessionId]);
  const concurrentRemovals = await Promise.allSettled([
    removeRoleFromUser(firstAdminId, superAdminRole.rows[0].id, actor),
    removeRoleFromUser(secondAdminId, superAdminRole.rows[0].id, actor),
  ]);
  assert.equal(concurrentRemovals.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal(concurrentRemovals.filter((result) => result.status === 'rejected').length, 1);
  const adminCount = await pool.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count
     FROM user_roles ur JOIN users u ON u.id = ur.user_id
     WHERE ur.role_id = $1 AND u.is_active = true AND u.is_verified = true`,
    [superAdminRole.rows[0].id]
  );
  assert.equal(adminCount.rows[0].count, '1');
  const remainingAdmin = await pool.query<{ user_id: string }>(
    'SELECT user_id FROM user_roles WHERE role_id = $1',
    [superAdminRole.rows[0].id]
  );
  await assert.rejects(
    deactivateAccount(remainingAdmin.rows[0].user_id),
    /final active verified super administrator/
  );

  const assignedPermissionId = randomUUID();
  const assignedRoleId = randomUUID();
  const permissionUserId = randomUUID();
  await pool.query(
    `INSERT INTO permissions (id, name, risk_level, requires_mfa)
     VALUES ($1, $2, 'low', false)`,
    [assignedPermissionId, `test.permission.${assignedPermissionId}`]
  );
  await pool.query(
    `INSERT INTO roles (id, name, is_system) VALUES ($1, $2, false)`,
    [assignedRoleId, `permission-role-${assignedRoleId}`]
  );
  await pool.query(
    `INSERT INTO users (id, email, is_active, is_verified)
     VALUES ($1, $2, true, true)`,
    [permissionUserId, `permission-user-${permissionUserId}@example.test`]
  );
  await pool.query('INSERT INTO role_permissions (role_id, permission_id) VALUES ($1, $2)', [assignedRoleId, assignedPermissionId]);
  await pool.query('INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2)', [permissionUserId, assignedRoleId]);
  // An audit failure must roll back both grant removal and token invalidation.
  await pool.query(`
    CREATE FUNCTION rbac_test_reject_audit() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF NEW.action = 'permission.delete' THEN
        RAISE EXCEPTION 'simulated RBAC audit failure';
      END IF;
      RETURN NEW;
    END;
    $$;
    CREATE TRIGGER rbac_test_reject_audit BEFORE INSERT ON audit_logs
      FOR EACH ROW EXECUTE FUNCTION rbac_test_reject_audit();
  `);
  await assert.rejects(deletePermission(assignedPermissionId, actor), /simulated RBAC audit failure/);
  const rolledBackPermission = await pool.query('SELECT id FROM permissions WHERE id = $1', [assignedPermissionId]);
  assert.equal(rolledBackPermission.rows.length, 1);
  const unchangedUser = await pool.query<{ roles_version: number }>(
    'SELECT roles_version FROM users WHERE id = $1', [permissionUserId]
  );
  assert.equal(unchangedUser.rows[0].roles_version, 1);
  await pool.query(`
    DROP TRIGGER rbac_test_reject_audit ON audit_logs;
    DROP FUNCTION rbac_test_reject_audit();
  `);
  await deletePermission(assignedPermissionId, actor);
  const invalidated = await pool.query<{ roles_version: number }>(
    'SELECT roles_version FROM users WHERE id = $1',
    [permissionUserId]
  );
  assert.equal(invalidated.rows[0].roles_version, 2);
  const deletionAudit = await pool.query<{ is_sensitive: boolean }>(
    `SELECT is_sensitive FROM audit_logs
     WHERE action = 'permission.delete' AND resource_id = $1`, [assignedPermissionId]
  );
  assert.equal(deletionAudit.rows.length, 1);
  assert.equal(deletionAudit.rows[0].is_sensitive, true);
});
