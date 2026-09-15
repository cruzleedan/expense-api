import test from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { requestBodyLimit } from './requestBodyLimit.js';
import { PayloadTooLargeError } from '../types/index.js';

function createTestApp() {
  const app = new Hono();
  app.use('*', requestBodyLimit(5));
  app.post('/', async (c) => c.text(await c.req.text()));
  app.onError((error, c) => {
    if (error instanceof PayloadTooLargeError) return c.text(error.code ?? '', 413);
    return c.text('unexpected', 500);
  });
  return app;
}

test('request body limit rejects an oversized Content-Length before parsing', async () => {
  const response = await createTestApp().request('/', {
    method: 'POST',
    headers: { 'content-length': '6' },
    body: '123456',
  });

  assert.equal(response.status, 413);
  assert.equal(await response.text(), 'PAYLOAD_TOO_LARGE');
});

test('request body limit counts streaming bodies without Content-Length', async () => {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('123'));
      controller.enqueue(new TextEncoder().encode('456'));
      controller.close();
    },
  });
  const request = new Request('http://localhost/', {
    method: 'POST',
    body,
    duplex: 'half',
  } as RequestInit);
  const response = await createTestApp().fetch(request);

  assert.equal(response.status, 413);
  assert.equal(await response.text(), 'PAYLOAD_TOO_LARGE');
});
