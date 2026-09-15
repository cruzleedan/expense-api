import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { OpenAPIHono } from '@hono/zod-openapi';
import { usersRouter } from './users.js';
import { globalErrorHandler } from '../middleware/errorHandler.js';
import { closePool } from '../db/client.js';

after(async () => {
  await closePool();
});

test('anonymous user administration requests fail before service access', async () => {
  const app = new OpenAPIHono();
  app.onError(globalErrorHandler);
  app.route('/users', usersRouter);

  const response = await app.request('/users');
  assert.equal(response.status, 401);
});
