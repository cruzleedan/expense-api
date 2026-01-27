import type { MiddlewareHandler } from 'hono';
import { env } from '../config/env.js';
import { AppError } from '../types/index.js';

interface RateLimitEntry {
  count: number;
  resetTime: number;
}

// In-memory store (use Redis in production for multi-instance)
const store = new Map<string, RateLimitEntry>();

// Clean up expired entries periodically
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of store.entries()) {
    if (entry.resetTime < now) {
      store.delete(key);
    }
  }
}, 60000); // Clean every minute

interface RateLimitOptions {
  windowMs?: number;
  maxRequests?: number;
  keyGenerator?: (c: { req: { header: (name: string) => string | undefined } }) => string;
}

export function rateLimit(options: RateLimitOptions = {}): MiddlewareHandler {
  const windowMs = options.windowMs ?? env.RATE_LIMIT_WINDOW_MS;
  const maxRequests = options.maxRequests ?? env.RATE_LIMIT_MAX_REQUESTS;
  const keyGenerator = options.keyGenerator ?? defaultKeyGenerator;

  return async (c, next) => {
    const key = keyGenerator(c);
    const now = Date.now();

    let entry = store.get(key);

    if (!entry || entry.resetTime < now) {
      entry = {
        count: 0,
        resetTime: now + windowMs,
      };
    }

    entry.count++;
    store.set(key, entry);

    const remaining = Math.max(0, maxRequests - entry.count);
    const resetSeconds = Math.ceil((entry.resetTime - now) / 1000);

    c.header('X-RateLimit-Limit', maxRequests.toString());
    c.header('X-RateLimit-Remaining', remaining.toString());
    c.header('X-RateLimit-Reset', resetSeconds.toString());

    if (entry.count > maxRequests) {
      c.header('Retry-After', resetSeconds.toString());
      throw new AppError(429, 'Too many requests', 'RATE_LIMIT_EXCEEDED');
    }

    await next();
  };
}

function defaultKeyGenerator(c: { req: { header: (name: string) => string | undefined } }): string {
  // Use X-Forwarded-For in production behind proxy, otherwise use a placeholder
  const forwarded = c.req.header('x-forwarded-for');
  const ip = forwarded?.split(',')[0]?.trim() ?? 'unknown';
  return `rate:${ip}`;
}

// Stricter rate limit for auth endpoints
export const authRateLimit = rateLimit({
  maxRequests: env.RATE_LIMIT_AUTH_MAX_REQUESTS,
});
