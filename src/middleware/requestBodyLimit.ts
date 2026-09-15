import type { MiddlewareHandler } from 'hono';
import { PayloadTooLargeError } from '../types/index.js';

/**
 * Reject oversized bodies before multipart parsing buffers them in memory.
 * The stream wrapper also covers requests without Content-Length and requests
 * using transfer encoding, so the header is never treated as authoritative.
 */
export function requestBodyLimit(maxSize: number): MiddlewareHandler {
  return async (c, next) => {
    const request = c.req.raw;
    const contentLength = request.headers.get('content-length');
    if (contentLength !== null) {
      const parsedLength = Number(contentLength);
      if (!Number.isSafeInteger(parsedLength) || parsedLength < 0) {
        throw new PayloadTooLargeError('Invalid Content-Length header');
      }
      if (parsedLength > maxSize) throw new PayloadTooLargeError();
    }

    if (!request.body) {
      await next();
      return;
    }

    let consumed = 0;
    const source = request.body.getReader();
    const limitedBody = new ReadableStream<Uint8Array>({
      async pull(controller) {
        const { done, value } = await source.read();
        if (done) {
          controller.close();
          return;
        }

        consumed += value.byteLength;
        if (consumed > maxSize) {
          await source.cancel('request body size limit exceeded');
          controller.error(new PayloadTooLargeError());
          return;
        }

        controller.enqueue(value);
      },
      cancel(reason) {
        return source.cancel(reason);
      },
    });

    c.req.raw = new Request(request, {
      body: limitedBody,
      duplex: 'half',
    } as RequestInit);

    await next();
  };
}
