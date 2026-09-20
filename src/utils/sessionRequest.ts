import { getConnInfo } from '@hono/node-server/conninfo';
import type { Context } from 'hono';
import { isIP } from 'node:net';
import { decodeJwt } from 'jose';

export function sessionRequestMetadata(c: Context): [string | undefined, string | undefined] {
  let address: string | undefined;
  // app.request() tests have no Node socket. Forwarded headers are deliberately
  // ignored until WORK-0031 defines the trusted proxy boundary.
  try { address = getConnInfo(c).remote.address; } catch { address = undefined; }
  return [address && isIP(address) ? address : undefined, c.req.header('user-agent')?.slice(0, 512)];
}
/** Only use with tokens minted by this server, never client-supplied JWTs. */
export function refreshCookieMaxAge(token: string, now = Math.floor(Date.now() / 1000)): number {
  const exp = decodeJwt(token).exp;
  return typeof exp === 'number' ? Math.max(0, exp - now) : 0;
}
