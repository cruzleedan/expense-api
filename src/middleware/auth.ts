import type { MiddlewareHandler, Context } from 'hono';
import { verifyAccessToken } from '../services/auth.service.js';
import { UnauthorizedError } from '../types/index.js';
import type { JwtPayload } from '../types/index.js';

declare module 'hono' {
  interface ContextVariableMap {
    user: JwtPayload;
    userId: string;
  }
}

export const authMiddleware: MiddlewareHandler = async (c, next) => {
  const authHeader = c.req.header('authorization');

  if (!authHeader?.startsWith('Bearer ')) {
    throw new UnauthorizedError('Missing or invalid authorization header');
  }

  const token = authHeader.slice(7);

  try {
    const payload = await verifyAccessToken(token);
    c.set('user', payload);
    c.set('userId', payload.sub);
  } catch {
    throw new UnauthorizedError('Invalid or expired token');
  }

  await next();
};

export function getUser(c: Context): JwtPayload {
  const user = c.get('user');
  if (!user) {
    throw new UnauthorizedError('User not authenticated');
  }
  return user;
}

export function getUserId(c: Context): string {
  const userId = c.get('userId');
  if (!userId) {
    throw new UnauthorizedError('User not authenticated');
  }
  return userId;
}
