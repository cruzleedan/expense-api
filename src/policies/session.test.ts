import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { SignJWT } from 'jose';
import { OpenAPIHono } from '@hono/zod-openapi';
import { serve } from '@hono/node-server';
import { once } from 'node:events';
import { durationSeconds, isSessionId } from './session.js';
import { sessionRequestMetadata, refreshCookieMaxAge } from '../utils/sessionRequest.js';

test('JWT lifetimes are positive, bounded and use one duration parser', () => {
  for (const [text, seconds] of [['15m', 900], ['7d', 604800], ['2h', 7200], ['1s', 1]] as const) {
    assert.equal(durationSeconds(text), seconds);
  }
  for (const text of ['0s', '-1d', '15 minutes', '1.5h', '99999999999999d']) assert.throws(() => durationSeconds(text));
  assert.equal(isSessionId(randomUUID()), true);
  for (const id of ['', 'not-a-uuid', 'a'.repeat(32), undefined]) assert.equal(isSessionId(id), false);
});

test('cookie max-age is derived from minted expiry, including non-default lifetimes', async () => {
  const token = await new SignJWT({}).setProtectedHeader({ alg: 'HS256' }).setExpirationTime(12345)
    .sign(new TextEncoder().encode('test-secret'));
  assert.equal(refreshCookieMaxAge(token, 12300), 45);
  assert.equal(refreshCookieMaxAge(token, 13000), 0);
});

test('session metadata never promotes spoofable forwarded headers to client identity', async () => {
  const app = new OpenAPIHono();
  app.get('/', c => c.json(sessionRequestMetadata(c)));
  const response = await app.request('/', { headers: {
    'x-forwarded-for': '192.0.2.11', 'cf-connecting-ip': '192.0.2.12', 'user-agent': 'x'.repeat(1000),
  } });
  const [address, agent] = await response.json() as [null, string];
  assert.equal(address, null);
  assert.equal(agent.length, 512);
});

test('Node request metadata records the actual socket peer, not forwarded claims', async () => {
  const app = new OpenAPIHono();
  app.get('/', c => c.json(sessionRequestMetadata(c)));
  const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 0 });
  try {
    await once(server, 'listening');
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const response = await fetch(`http://127.0.0.1:${address.port}/`, { headers: {
      'x-forwarded-for': '192.0.2.13', 'cf-connecting-ip': '192.0.2.14', 'user-agent': 'socket-regression',
    } });
    assert.deepEqual(await response.json(), ['127.0.0.1', 'socket-regression']);
  } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
});
