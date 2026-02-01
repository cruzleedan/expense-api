import type { MiddlewareHandler } from 'hono';
import { keysToCamel } from '../utils/caseTransform.js';

/**
 * Middleware that transforms JSON response bodies from snake_case to camelCase
 */
export const camelCaseResponse: MiddlewareHandler = async (c, next) => {
  await next();

  const contentType = c.res.headers.get('content-type');
  if (!contentType?.includes('application/json')) {
    return;
  }

  const body = await c.res.json();
  const transformed = keysToCamel(body);

  c.res = new Response(JSON.stringify(transformed), {
    status: c.res.status,
    headers: c.res.headers,
  });
};
