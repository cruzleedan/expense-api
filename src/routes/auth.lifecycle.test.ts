import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { OpenAPIHono } from '@hono/zod-openapi';
import { authRouter } from './auth.js';
import { globalErrorHandler } from '../middleware/errorHandler.js';
import { closePool, pool } from '../db/client.js';
import { LinkGoogleIdentityRequestSchema, LinkFacebookIdentityRequestSchema, RefreshRequestSchema } from '../schemas/auth.js';

after(closePool);
test('self-service deletion fails closed before validation or any database/session operation', async () => {
  const app = new OpenAPIHono();
  app.onError(globalErrorHandler);
  app.route('/auth', authRouter);
  let databaseCalls = 0;
  const original = pool.connect;
  pool.connect = (() => { databaseCalls++; throw new Error('Unexpected database access'); }) as typeof pool.connect;
  try {
    for (const body of [undefined, '{', '{}', JSON.stringify({ email: 'person@example.test', password: 'Correct!Pass2026' })]) {
      const response = await app.request('/auth/delete-account', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body,
      });
      assert.equal(response.status, 403);
      assert.match((await response.json() as { error: { message: string } }).error.message, /disabled pending/);
      assert.equal(response.headers.has('set-cookie'), false);
    }
    assert.equal(databaseCalls, 0);
  } finally { pool.connect = original; }
});
test('identity linking is strictly own-account and cannot accept client ownership or verification claims', async () => {
  for (const [schema, valid] of [
    [LinkGoogleIdentityRequestSchema, { idToken: 'provider-proof', password: 'current-password' }],
    [LinkFacebookIdentityRequestSchema, { accessToken: 'provider-proof', password: 'current-password' }],
  ] as const) {
    assert.equal(schema.safeParse(valid).success, true);
    for (const extra of [{ userId: 'other-user' }, { email: 'matched@example.test' }, { verified: true }, { subject: 'untrusted' }]) {
      assert.equal(schema.safeParse({ ...valid, ...extra }).success, false);
    }
  }
  const app = new OpenAPIHono();
  app.onError(globalErrorHandler);
  app.route('/auth', authRouter);
  for (const provider of ['google', 'facebook']) {
    assert.equal((await app.request(`/auth/identities/${provider}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
    })).status, 401);
  }
});
test('refresh body validation cannot silently fall back to cookie for invalid/unknown fields', () => {
  assert.equal(RefreshRequestSchema.safeParse({}).success, true);
  assert.equal(RefreshRequestSchema.safeParse({ refreshToken: 'token' }).success, true);
  for (const body of [{ refreshToken: 123 }, { refreshToken: '' }, { refreshToken: 'token', userId: 'other' }]) {
    assert.equal(RefreshRequestSchema.safeParse(body).success, false);
  }
});
