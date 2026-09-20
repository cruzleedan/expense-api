import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { NotFoundError } from '../types/index.js';

test('patched S3 SDK preserves storage, XML errors, and presigned URL contracts', async (t) => {
  const objects = new Map<string, Buffer>();
  const requests: string[] = [];
  const server = createServer(async (request, response) => {
    const key = decodeURIComponent(new URL(request.url!, 'http://test.invalid').pathname);
    requests.push(request.method!);
    if (!request.headers.authorization?.startsWith('AWS4-HMAC-SHA256 ')) {
      response.writeHead(403).end();
      return;
    }
    if (request.method === 'PUT') {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      objects.set(key, Buffer.concat(chunks));
      response.writeHead(200, { etag: '"test-etag"' }).end();
    } else if (request.method === 'DELETE') {
      objects.delete(key);
      response.writeHead(204).end();
    } else if (objects.has(key)) {
      response.writeHead(200, { 'content-length': objects.get(key)!.length });
      response.end(request.method === 'HEAD' ? undefined : objects.get(key));
    } else {
      response.writeHead(404, { 'content-type': 'application/xml' });
      response.end(request.method === 'HEAD' ? undefined
        : '<Error><Code>NoSuchKey</Code><Message>Missing test receipt</Message><Key>missing</Key></Error>');
    }
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise<void>((resolve, reject) => {
    server.closeAllConnections();
    server.close((error) => error ? reject(error) : resolve());
  }));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  process.env.S3_ENDPOINT = `http://127.0.0.1:${address.port}`;
  process.env.S3_ACCESS_KEY_ID = 'test-only-access-key';
  process.env.S3_SECRET_ACCESS_KEY = 'test-only-secret-key';
  process.env.S3_BUCKET = 'expense-tests';
  process.env.S3_REGION = 'us-east-1';
  const { S3StorageProvider } = await import('./s3Storage.js');
  const storage = new S3StorageProvider();
  const body = Buffer.from('test receipt bytes');
  const key = await storage.save(body, 'test receipt.pdf');
  assert.match(key, /^\d{4}\/\d{2}\/[\w-]+-test_receipt\.pdf$/);
  assert.equal(storage.getUrl(key), key);
  assert.equal(await storage.exists(key), true);
  assert.deepEqual(await storage.get(key), body);
  await assert.rejects(storage.get('missing'), NotFoundError);
  assert.equal(await storage.exists('missing'), false);

  assert.equal(storage.supportsPresignedUrls(), true);
  const beforeSigning = requests.length;
  const upload = await storage.getPresignedUploadUrl('another.pdf', {
    expiresIn: 300, contentType: 'application/pdf', contentLength: body.length,
  });
  const download = await storage.getPresignedDownloadUrl(key, { expiresIn: 300 });
  for (const signed of [upload, download]) {
    const url = new URL(signed.url);
    assert.equal(url.origin, process.env.S3_ENDPOINT);
    assert.equal(url.searchParams.get('X-Amz-Expires'), '300');
    assert.equal(url.searchParams.get('X-Amz-Algorithm'), 'AWS4-HMAC-SHA256');
    assert.ok(url.searchParams.get('X-Amz-Signature'));
    assert.ok(signed.expiresAt.getTime() > Date.now());
  }
  assert.equal(requests.length, beforeSigning, 'presigning must not perform a storage write');
  await storage.delete(key);
  assert.equal(await storage.exists(key), false);
  assert.deepEqual(requests, ['PUT', 'HEAD', 'GET', 'GET', 'HEAD', 'DELETE', 'HEAD']);
});
