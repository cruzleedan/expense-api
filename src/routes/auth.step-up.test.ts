import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { OpenAPIHono } from '@hono/zod-openapi';
import { authRouter } from './auth.js';
import { StepUpRequestSchema } from '../schemas/auth.js';
import { globalErrorHandler } from '../middleware/errorHandler.js';
import { closePool } from '../db/client.js';

after(async () => {
  await closePool();
});

test('step-up accepts only a nonempty password, never client-supplied assurance', () => {
  assert.equal(StepUpRequestSchema.safeParse({ password: 'current-password' }).success, true);
  assert.equal(StepUpRequestSchema.safeParse({ password: '' }).success, false);
  assert.equal(StepUpRequestSchema.safeParse({
    password: 'current-password',
    verifiedAt: '2026-09-15T12:00:00Z',
  }).success, false);
});

test('anonymous step-up requests fail before credential or database access', async () => {
  const app = new OpenAPIHono();
  app.onError(globalErrorHandler);
  app.route('/auth', authRouter);

  const response = await app.request('/auth/step-up', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password: 'current-password' }),
  });
  assert.equal(response.status, 401);
});
