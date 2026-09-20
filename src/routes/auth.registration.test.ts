import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { OpenAPIHono } from '@hono/zod-openapi';
import { authRouter } from './auth.js';
import { errorHandler, globalErrorHandler } from '../middleware/errorHandler.js';
import { closePool } from '../db/client.js';

after(async () => {
  await closePool();
});

test('public registration cannot bootstrap an authenticated account', async () => {
  const app = new OpenAPIHono();
  app.use('*', errorHandler);
  app.onError(globalErrorHandler);
  app.route('/auth', authRouter);

  const response = await app.request('/auth/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      email: 'attacker@example.com',
      password: 'StrongPassword123!',
    }),
  });

  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), {
    error: {
      message: 'Public registration is disabled; contact an administrator',
      code: 'FORBIDDEN',
    },
  });
});
