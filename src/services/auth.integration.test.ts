import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import * as jose from 'jose';
import { OpenAPIHono } from '@hono/zod-openapi';
import { pool, closePool } from '../db/client.js';
import { env } from '../config/env.js';
import { createUser } from './user.service.js';
import { registerWithEmail, loginWithEmail, loginWithOAuth, generateTokens,
  verifyAccessToken, refreshTokens, logout, revokeAllTokens, revokeSession, establishSessionStepUp, getUserSessions } from './auth.service.js';
import { linkProviderIdentity } from './identity.service.js';
import { authRouter } from '../routes/auth.js';
import { globalErrorHandler } from '../middleware/errorHandler.js';
import type { User } from '../types/index.js';

after(closePool);
test('WORK-0030 session, identity, and account lifecycle regressions', {
  skip: process.env.AUTH_INTEGRATION !== '1',
}, async t => {
  assert.equal((await pool.query("SELECT COUNT(*)::int AS count FROM pg_tables WHERE schemaname = 'public'")).rows[0].count, 0,
    'Auth regressions require an empty disposable database');
  await pool.query(await readFile(new URL('../../src/db/schema.sql', import.meta.url), 'utf8'));
  const password = 'Correct!Pass2026';
  const account = async () => {
    const created = await createUser({ email: `auth-${randomUUID()}@example.test`, password });
    return (await pool.query<User>('SELECT * FROM users WHERE id = $1', [created.id])).rows[0];
  };
  const tokenId = (token: string) => jose.decodeJwt(token).jti!;
  const active = async (userId: string) => (await pool.query<{ id: string; family_id: string }>(
    'SELECT id, family_id FROM refresh_tokens WHERE user_id = $1 AND revoked_at IS NULL AND expires_at > NOW()', [userId])).rows;

  await t.test('provisioning policy is shared; pending registration has no session and cannot log in', async () => {
    await assert.rejects(createUser({ email: 'weak@example.test', password: '12345678' }), /Password must/);
    const pending = await registerWithEmail('pending@example.test', password);
    assert.equal(pending.user.is_active, false);
    assert.equal(pending.user.is_verified, false);
    assert.equal((await active(pending.user.id)).length, 0);
    assert.equal((await pool.query('SELECT 1 FROM user_roles WHERE user_id = $1', [pending.user.id])).rowCount, 1);
    await assert.rejects(loginWithEmail(pending.user.email, password), /not active and verified/);
    await assert.rejects(generateTokens(pending.user), /not active and verified/);
    await assert.rejects(registerWithEmail('pending@example.test', password), /already registered/);
  });
  await t.test('account/default-role failure rolls back both administrator and pending account creation', async () => {
    await pool.query(`CREATE FUNCTION auth_test_role_failure() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'simulated default role failure'; END; $$;
      CREATE TRIGGER auth_test_role_failure BEFORE INSERT ON user_roles FOR EACH ROW EXECUTE FUNCTION auth_test_role_failure()`);
    try {
      await assert.rejects(createUser({ email: 'role-failure@example.test', password }), /simulated default role failure/);
      await assert.rejects(registerWithEmail('pending-role-failure@example.test', password), /simulated default role failure/);
      assert.equal((await pool.query("SELECT 1 FROM users WHERE email LIKE '%role-failure@example.test'")).rowCount, 0);
    } finally { await pool.query('DROP TRIGGER auth_test_role_failure ON user_roles; DROP FUNCTION auth_test_role_failure()'); }
    await pool.query("UPDATE roles SET is_active = false WHERE name = 'employee'");
    try {
      await assert.rejects(createUser({ email: 'missing-role@example.test', password }), /default employee role is unavailable/);
      assert.equal((await pool.query("SELECT 1 FROM users WHERE email = 'missing-role@example.test'")).rowCount, 0);
    } finally { await pool.query("UPDATE roles SET is_active = true WHERE name = 'employee'"); }
  });
  await t.test('concurrent failed logins commit each increment and lock the account without minting tokens', async () => {
    const user = await account();
    const outcomes = await Promise.allSettled(Array.from({ length: 5 }, () => loginWithEmail(user.email, 'wrong')));
    assert.equal(outcomes.filter(o => o.status === 'rejected').length, 5);
    const current = (await pool.query<User>('SELECT * FROM users WHERE id = $1', [user.id])).rows[0];
    assert.equal(current.failed_login_attempts, 5);
    assert.ok(current.locked_until && current.locked_until.getTime() > Date.now());
    await assert.rejects(loginWithEmail(user.email, password), /locked/);
    assert.equal((await active(user.id)).length, 0);
  });
  await t.test('login bookkeeping, cap eviction, token insert, and access signing roll back together', async () => {
    const user = await account();
    await Promise.all(Array.from({ length: 5 }, () => generateTokens(user)));
    await pool.query('UPDATE users SET failed_login_attempts = 2 WHERE id = $1', [user.id]);
    const before = (await pool.query('SELECT failed_login_attempts, last_login_at FROM users WHERE id = $1', [user.id])).rows;
    const sessions = await active(user.id);
    const lifetime = env.JWT_ACCESS_EXPIRES_IN;
    env.JWT_ACCESS_EXPIRES_IN = 'invalid'; // Force failure after INSERT; startup rejects this in production.
    try { await assert.rejects(loginWithEmail(user.email, password), /JWT duration/); }
    finally { env.JWT_ACCESS_EXPIRES_IN = lifetime; }
    assert.deepEqual((await pool.query('SELECT failed_login_attempts, last_login_at FROM users WHERE id = $1', [user.id])).rows, before);
    assert.deepEqual(await active(user.id), sessions);
    assert.equal((await pool.query('SELECT 1 FROM refresh_tokens WHERE user_id = $1', [user.id])).rowCount, 5);
  });
  await t.test('concurrent refresh has one winner; replay commits family containment without touching sibling sessions', async () => {
    const user = await account();
    const first = await generateTokens(user);
    const sibling = await generateTokens(user);
    const outcomes = await Promise.allSettled([refreshTokens(first.refreshToken), refreshTokens(first.refreshToken)]);
    assert.equal(outcomes.filter(o => o.status === 'fulfilled').length, 1);
    const loser = outcomes.find(o => o.status === 'rejected') as PromiseRejectedResult;
    assert.match(String(loser.reason), /reuse detected/);
    const winner = (outcomes.find(o => o.status === 'fulfilled') as PromiseFulfilledResult<Awaited<ReturnType<typeof refreshTokens>>>).value;
    await assert.rejects(verifyAccessToken(first.accessToken), /revoked/);
    await assert.rejects(verifyAccessToken(winner.accessToken), /revoked/);
    await assert.rejects(refreshTokens(winner.refreshToken), /revoked/);
    assert.equal((await verifyAccessToken(sibling.accessToken)).sub, user.id);
    assert.equal((await active(user.id)).length, 1);
    const history = (await pool.query('SELECT rotated_at, revoked_at FROM refresh_tokens WHERE user_id = $1 AND family_id = $2',
      [user.id, jose.decodeJwt(first.refreshToken).family_id])).rows;
    assert.equal(history.length, 2);
    assert.equal(history.filter(row => row.rotated_at).length, 1);
    assert.ok(history.every(row => row.revoked_at));
  });
  await t.test('rotation preserves family age but does not carry password step-up to a new session row', async () => {
    const user = await account();
    const first = await generateTokens(user);
    await establishSessionStepUp(user.id, tokenId(first.refreshToken), password);
    const rotated = await refreshTokens(first.refreshToken);
    const rows = (await pool.query('SELECT family_id, family_created_at, step_up_verified_at FROM refresh_tokens WHERE user_id = $1 ORDER BY created_at', [user.id])).rows;
    assert.equal(rows[0].family_id, rows[1].family_id);
    assert.equal(rows[0].family_created_at.getTime(), rows[1].family_created_at.getTime());
    assert.ok(rows[0].step_up_verified_at);
    assert.equal(rows[1].step_up_verified_at, null);
    await assert.rejects(verifyAccessToken(first.accessToken), /revoked/);
    assert.equal((await verifyAccessToken(rotated.accessToken)).sub, user.id);
  });
  await t.test('failed rotation rolls back its consumed parent, inserted child, and step-up reset', async () => {
    const user = await account(); const original = await generateTokens(user);
    await establishSessionStepUp(user.id, tokenId(original.refreshToken), password);
    const before = (await pool.query('SELECT * FROM refresh_tokens WHERE user_id = $1', [user.id])).rows;
    const lifetime = env.JWT_ACCESS_EXPIRES_IN; env.JWT_ACCESS_EXPIRES_IN = 'invalid';
    try { await assert.rejects(refreshTokens(original.refreshToken), /JWT duration/); }
    finally { env.JWT_ACCESS_EXPIRES_IN = lifetime; }
    assert.deepEqual((await pool.query('SELECT * FROM refresh_tokens WHERE user_id = $1', [user.id])).rows, before);
    assert.equal((await verifyAccessToken(original.accessToken)).sub, user.id);
    assert.ok((await refreshTokens(original.refreshToken)).accessToken);
  });
  await t.test('expired signed ancestors still contain replay/logout, but expired current tokens cannot mint', async () => {
    const user = await account(); const lifetime = env.JWT_REFRESH_EXPIRES_IN;
    env.JWT_REFRESH_EXPIRES_IN = '2s';
    let original; let logoutOriginal; let expiredCurrent;
    try {
      original = await generateTokens(user); logoutOriginal = await generateTokens(user); expiredCurrent = await generateTokens(user);
    } finally { env.JWT_REFRESH_EXPIRES_IN = lifetime; }
    const child = await refreshTokens(original.refreshToken);
    const logoutChild = await refreshTokens(logoutOriginal.refreshToken);
    const sibling = await generateTokens(user);
    const expiry = Math.max(...[original, logoutOriginal, expiredCurrent].map(tokens => jose.decodeJwt(tokens.refreshToken).exp!));
    await new Promise(resolve => setTimeout(resolve, Math.max(0, expiry * 1000 - Date.now() + 30)));
    await assert.rejects(refreshTokens(original.refreshToken), /reuse detected/);
    await assert.rejects(verifyAccessToken(child.accessToken), /revoked/);
    await logout(logoutOriginal.refreshToken);
    await assert.rejects(verifyAccessToken(logoutChild.accessToken), /revoked/);
    await assert.rejects(refreshTokens(expiredCurrent.refreshToken), /expired/);
    assert.equal((await verifyAccessToken(sibling.accessToken)).sub, user.id);
  });
  await t.test('parallel logins never exceed five; tied family ages use deterministic family-id eviction', async () => {
    const user = await account();
    await Promise.all(Array.from({ length: 9 }, () => loginWithEmail(user.email, password)));
    assert.equal((await active(user.id)).length, 5);
    await pool.query("UPDATE refresh_tokens SET family_created_at = '2026-01-01T00:00:00Z' WHERE user_id = $1", [user.id]);
    const retained = (await pool.query<{ family_id: string }>(`SELECT family_id FROM refresh_tokens
      WHERE user_id = $1 AND revoked_at IS NULL ORDER BY family_id DESC LIMIT 4`, [user.id])).rows.map(row => row.family_id);
    const newest = await generateTokens(user);
    assert.deepEqual((await active(user.id)).map(row => row.family_id).sort(),
      [...retained, jose.decodeJwt(newest.refreshToken).family_id as string].sort());
  });
  await t.test('legacy ledger rows remain preserved but cannot consume/list current sessions or back a new access token', async () => {
    const user = await account(); const legacyIds = Array.from({ length: 6 }, () => randomUUID());
    for (const id of legacyIds) await pool.query(`INSERT INTO refresh_tokens(id,user_id,token_hash,expires_at)
      VALUES ($1,$2,$3,NOW() + INTERVAL '1 day')`, [id, user.id, `legacy-${id}`]);
    assert.equal((await getUserSessions(user.id)).length, 0);
    const tokens = await generateTokens(user);
    assert.equal((await getUserSessions(user.id)).length, 1);
    assert.equal((await pool.query('SELECT 1 FROM refresh_tokens WHERE user_id = $1 AND auth_version = 1 AND revoked_at IS NULL', [user.id])).rowCount, 6);
    // jose 6 types decodeJwt's result as an unconstrained generic, which can't be spread; name the payload type (WORK-0052).
    const forgedBinding = await new jose.SignJWT({ ...jose.decodeJwt<jose.JWTPayload>(tokens.accessToken), refresh_token_id: legacyIds[0] })
      .setProtectedHeader({ alg: 'HS256' }).sign(new TextEncoder().encode(env.JWT_SECRET));
    await assert.rejects(verifyAccessToken(forgedBinding), /revoked/);
  });
  await t.test('disabled/unverified accounts, privilege version changes, and expired ledger entries fail closed', async () => {
    for (const column of ['is_active', 'is_verified'] as const) {
      const user = await account(); const tokens = await generateTokens(user);
      await pool.query(`UPDATE users SET ${column} = false WHERE id = $1`, [user.id]);
      await assert.rejects(verifyAccessToken(tokens.accessToken), /not active and verified/);
      await assert.rejects(refreshTokens(tokens.refreshToken), /not active and verified/);
      assert.equal((await pool.query('SELECT 1 FROM refresh_tokens WHERE user_id = $1', [user.id])).rowCount, 1);
    }
    const user = await account(); const tokens = await generateTokens(user);
    await pool.query('UPDATE users SET roles_version = roles_version + 1 WHERE id = $1', [user.id]);
    await assert.rejects(verifyAccessToken(tokens.accessToken), /permission changes/);
    const refreshed = await refreshTokens(tokens.refreshToken);
    assert.equal((await verifyAccessToken(refreshed.accessToken)).roles_version, 2);
    await pool.query('UPDATE refresh_tokens SET expires_at = NOW() - INTERVAL \'1 second\' WHERE id = $1', [tokenId(refreshed.refreshToken)]);
    await assert.rejects(verifyAccessToken(refreshed.accessToken), /revoked or expired/);
    await assert.rejects(refreshTokens(refreshed.refreshToken), /revoked or expired/);
  });
  await t.test('legacy, unbound, wrong-version/type/algorithm and cross-user tokens are rejected', async () => {
    const user = await account(); const tokens = await generateTokens(user);
    const current = jose.decodeJwt(tokens.accessToken);
    const secret = new TextEncoder().encode(env.JWT_SECRET);
    const sign = (payload: jose.JWTPayload, algorithm = 'HS256') => new jose.SignJWT(payload)
      .setProtectedHeader({ alg: algorithm }).setIssuedAt().setExpirationTime('1h').sign(secret);
    await assert.rejects(verifyAccessToken(await sign({ sub: user.id, email: user.email, type: 'access' })));
    for (const change of [{ auth_version: 1 }, { refresh_token_id: undefined }, { roles_version: undefined },
      { type: 'refresh' }, { sub: randomUUID() }, { refresh_token_id: randomUUID() }]) {
      await assert.rejects(verifyAccessToken(await sign({ ...current, ...change })));
    }
    await assert.rejects(verifyAccessToken(await sign(current, 'HS384')), /Invalid token/);
    await assert.rejects(refreshTokens(tokens.accessToken), /Unsupported/);
    const other = await account(); const otherTokens = await generateTokens(other);
    await assert.rejects(verifyAccessToken(await sign({ ...current, refresh_token_id: tokenId(otherTokens.refreshToken) })), /revoked/);
    await assert.rejects(refreshTokens(await sign({ auth_version: 2, type: 'refresh', sub: user.id,
      jti: tokenId(otherTokens.refreshToken), family_id: jose.decodeJwt(otherTokens.refreshToken).family_id })), /Invalid refresh/);
  });
  await t.test('logout and revoking a rotated ancestor revoke the whole family; revoke-all invalidates access too', async () => {
    const user = await account(); const original = await generateTokens(user);
    const rotated = await refreshTokens(original.refreshToken);
    const sibling = await generateTokens(user);
    await logout(original.refreshToken);
    await assert.rejects(verifyAccessToken(rotated.accessToken), /revoked/);
    assert.equal((await verifyAccessToken(sibling.accessToken)).sub, user.id);
    const second = await generateTokens(user); const next = await refreshTokens(second.refreshToken);
    assert.equal(await revokeSession(user.id, tokenId(second.refreshToken)), true);
    await assert.rejects(verifyAccessToken(next.accessToken), /revoked/);
    const other = await account();
    assert.equal(await revokeSession(other.id, tokenId(sibling.refreshToken)), false);
    await revokeAllTokens(user.id);
    await assert.rejects(verifyAccessToken(sibling.accessToken), /revoked/);
    assert.equal((await active(user.id)).length, 0);
    const deleted = await account(); const deletedTokens = await generateTokens(deleted);
    await pool.query('DELETE FROM users WHERE id = $1', [deleted.id]);
    await logout(deletedTokens.refreshToken); // Idempotent; do not strand a stale cookie.
  });
  await t.test('email matches never link or provision; subject collision has exactly one owner, with multiple identities supported', async () => {
    const a = await account(); const b = await account();
    await assert.rejects(loginWithOAuth('google', 'unlinked', a.email), /not linked/);
    assert.equal((await active(a.id)).length, 0);
    assert.equal((await pool.query('SELECT 1 FROM user_identities')).rowCount, 0);
    const aActor = await verifyAccessToken((await generateTokens(a)).accessToken);
    const bActor = await verifyAccessToken((await generateTokens(b)).accessToken);
    await assert.rejects(linkProviderIdentity(aActor, 'google', 'bad-password', 'wrong'), /current account password/);
    const results = await Promise.allSettled([
      linkProviderIdentity(aActor, 'google', 'collision', password), linkProviderIdentity(bActor, 'google', 'collision', password),
    ]);
    assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
    assert.match(String((results.find(r => r.status === 'rejected') as PromiseRejectedResult).reason), /another account/);
    const owner = (await pool.query<{ user_id: string }>("SELECT user_id FROM user_identities WHERE provider = 'google' AND subject = 'collision'")).rows[0].user_id;
    const ownerActor = owner === a.id ? aActor : bActor;
    await linkProviderIdentity(ownerActor, 'google', 'second-google', password);
    await linkProviderIdentity(ownerActor, 'facebook', 'collision', password);
    await linkProviderIdentity(ownerActor, 'google', 'collision', password); // idempotent, no duplicate audit
    assert.equal((await pool.query('SELECT 1 FROM user_identities WHERE user_id = $1', [owner])).rowCount, 3);
    const logged = await loginWithOAuth('google', 'collision', 'attacker-changed@example.test');
    assert.equal(logged.user.id, owner);
    assert.equal(logged.user.oauth_provider, null);
    assert.notEqual(logged.user.email, 'attacker-changed@example.test');
    assert.equal((await pool.query("SELECT 1 FROM audit_logs WHERE action = 'authentication.identity_linked'")).rowCount, 3);
    await revokeSession(owner, ownerActor.refresh_token_id!);
    await assert.rejects(linkProviderIdentity(ownerActor, 'google', 'revoked-actor', password), /active session/);
  });
  await t.test('identity audit failure rolls back the binding without changing the local account', async () => {
    const user = await account(); const actor = await verifyAccessToken((await generateTokens(user)).accessToken);
    await pool.query(`CREATE FUNCTION auth_test_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'simulated identity audit failure'; END; $$;
      CREATE TRIGGER auth_test_audit_failure BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION auth_test_audit_failure()`);
    try {
      await assert.rejects(linkProviderIdentity(actor, 'google', 'audit-failure', password), /simulated identity audit failure/);
      assert.equal((await pool.query("SELECT 1 FROM user_identities WHERE subject = 'audit-failure'")).rowCount, 0);
    } finally { await pool.query('DROP TRIGGER auth_test_audit_failure ON audit_logs; DROP FUNCTION auth_test_audit_failure()'); }
  });
  await t.test('HTTP login/refresh cookie and body transport, logout and disabled deletion preserve truthful boundaries', async () => {
    const user = await account(); const app = new OpenAPIHono();
    app.onError(globalErrorHandler); app.route('/auth', authRouter);
    const lifetime = env.JWT_REFRESH_EXPIRES_IN; env.JWT_REFRESH_EXPIRES_IN = '2h';
    const json = { 'content-type': 'application/json', 'user-agent': 'auth-regression', 'x-forwarded-for': '192.0.2.11' };
    try {
      const login = await app.request('/auth/login', { method: 'POST', headers: json, body: JSON.stringify({ email: user.email, password }) });
      assert.equal(login.status, 200);
      const loginCookie = login.headers.get('set-cookie')!;
      assert.match(loginCookie, /Max-Age=7[12]\d\d/);
      assert.match(loginCookie, /HttpOnly/); assert.match(loginCookie, /SameSite=Lax/);
      let cookie = loginCookie.split(';')[0];
      let refreshToken = decodeURIComponent(cookie.split('=')[1]);
      const metadata = (await pool.query('SELECT ip_address, user_agent, expires_at FROM refresh_tokens WHERE id = $1', [tokenId(refreshToken)])).rows[0];
      assert.equal(metadata.ip_address, null); assert.equal(metadata.user_agent, 'auth-regression');
      assert.equal(metadata.expires_at.getTime(), jose.decodeJwt(refreshToken).exp! * 1000);
      const invalid = await app.request('/auth/refresh', { method: 'POST', headers: { ...json, cookie }, body: '{"refreshToken":123}' });
      assert.equal(invalid.status, 400);
      assert.equal((await active(user.id)).length, 1);
      const first = await app.request('/auth/refresh', { method: 'POST', headers: { cookie } });
      assert.equal(first.status, 200); cookie = first.headers.get('set-cookie')!.split(';')[0];
      refreshToken = decodeURIComponent(cookie.split('=')[1]);
      const second = await app.request('/auth/refresh', { method: 'POST', headers: json, body: JSON.stringify({ refreshToken }) });
      assert.equal(second.status, 200);
      const access = (await second.json() as { accessToken: string }).accessToken;
      refreshToken = decodeURIComponent(second.headers.get('set-cookie')!.split(';')[0].split('=')[1]);
      const before = (await pool.query('SELECT * FROM users WHERE id = $1', [user.id])).rows;
      for (const body of [JSON.stringify({ email: user.email, password }), '{']) {
        const response = await app.request('/auth/delete-account', { method: 'POST', headers: json, body });
        assert.equal(response.status, 403); assert.equal(response.headers.has('set-cookie'), false);
      }
      assert.deepEqual((await pool.query('SELECT * FROM users WHERE id = $1', [user.id])).rows, before);
      assert.equal((await verifyAccessToken(access)).sub, user.id);
      const loggedOut = await app.request('/auth/logout', { method: 'POST', headers: json, body: JSON.stringify({ refreshToken }) });
      assert.equal(loggedOut.status, 200); assert.match(loggedOut.headers.get('set-cookie')!, /Max-Age=0/);
      await assert.rejects(verifyAccessToken(access), /revoked/);
    } finally { env.JWT_REFRESH_EXPIRES_IN = lifetime; }
  });
});
