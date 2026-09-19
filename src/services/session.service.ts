import * as jose from 'jose';
import { createHash, randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { query, transaction } from '../db/client.js';
import { env } from '../config/env.js';
import { UnauthorizedError, type User, type AuthTokens, type JwtPayloadV3 } from '../types/index.js';
import { AUTH_VERSION, MAX_SESSION_FAMILIES, durationSeconds, isSessionId } from '../policies/session.js';
import { canReceiveNormalTokens } from '../policies/accountAccess.js';
import { hasValidPrivilegeClaimsVersion } from '../policies/rbac.js';

const SECRET = new TextEncoder().encode(env.JWT_SECRET);
const tokenHash = (token: string) => createHash('sha256').update(token).digest('hex');
type Family = { family_id: string; family_created_at: Date };
type StoredToken = Family & { id: string; revoked_at: Date | null; rotated_at: Date | null; expires_at: Date };

// Global order: an account row, then its token rows. Never acquire the RBAC
// advisory lock after this account lock (RBAC writers use the opposite order).
export async function lockSessionUser(client: PoolClient, userId: string): Promise<User> {
  const result = await client.query<User>('SELECT * FROM users WHERE id = $1 FOR UPDATE', [userId]);
  if (!result.rows[0]) throw new UnauthorizedError('User not found');
  return result.rows[0];
}
export function assertSessionAccount(user: User): void {
  if (!canReceiveNormalTokens(user)) throw new UnauthorizedError('Account is not active and verified');
}
async function signAccess(client: PoolClient, user: User, tokenId: string): Promise<string> {
  assertSessionAccount(user);
  const roles = await client.query<{ name: string }>(
    `SELECT r.name FROM roles r JOIN user_roles ur ON ur.role_id = r.id
     WHERE ur.user_id = $1 AND r.is_active ORDER BY r.name`, [user.id]);
  const permissions = await client.query<{ name: string }>(
    `SELECT DISTINCT p.name FROM permissions p JOIN role_permissions rp ON rp.permission_id = p.id
     JOIN user_roles ur ON ur.role_id = rp.role_id JOIN roles r ON r.id = ur.role_id
     WHERE ur.user_id = $1 AND r.is_active ORDER BY p.name`, [user.id]);
  const now = Math.floor(Date.now() / 1000);
  return new jose.SignJWT({
    auth_version: AUTH_VERSION, jti: randomUUID(), sub: user.id, email: user.email,
    username: user.username, roles_version: user.roles_version,
    roles: roles.rows.map(r => r.name), permissions: permissions.rows.map(p => p.name),
    type: 'access', refresh_token_id: tokenId,
  }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt(now)
    .setExpirationTime(now + durationSeconds(env.JWT_ACCESS_EXPIRES_IN)).sign(SECRET);
}

/** Caller MUST hold the account row lock; login updates and token minting share this transaction. */
export async function issueSessionInTransaction(
  client: PoolClient, user: User, ipAddress?: string, userAgent?: string, family?: Family
): Promise<AuthTokens> {
  assertSessionAccount(user);
  if (!family) {
    // Account locking serializes login/rotation/logout, including cap enforcement.
    const oldest = await client.query<{ family_id: string }>(
      `SELECT family_id FROM refresh_tokens WHERE user_id = $1 AND revoked_at IS NULL
       AND expires_at > clock_timestamp() AND auth_version = $3
       ORDER BY family_created_at DESC, family_id DESC OFFSET $2`,
      [user.id, MAX_SESSION_FAMILIES - 1, AUTH_VERSION]);
    if (oldest.rows.length) await client.query(
      `UPDATE refresh_tokens SET revoked_at = COALESCE(revoked_at, clock_timestamp())
       WHERE user_id = $1 AND family_id = ANY($2::uuid[])`,
      [user.id, oldest.rows.map(row => row.family_id)]);
    const time = await client.query<{ time: Date }>('SELECT clock_timestamp() AS time');
    family = { family_id: randomUUID(), family_created_at: time.rows[0].time };
  }
  const id = randomUUID();
  const now = Math.floor(Date.now() / 1000);
  const exp = now + durationSeconds(env.JWT_REFRESH_EXPIRES_IN);
  const refreshToken = await new jose.SignJWT({
    auth_version: AUTH_VERSION, jti: id, sub: user.id, email: user.email,
    type: 'refresh', family_id: family.family_id,
  }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt(now).setExpirationTime(exp).sign(SECRET);
  await client.query(
    `INSERT INTO refresh_tokens(id, user_id, token_hash, expires_at, ip_address, user_agent,
      family_id, family_created_at, auth_version, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,clock_timestamp())`,
    [id, user.id, tokenHash(refreshToken), new Date(exp * 1000), ipAddress ?? null,
      userAgent ?? null, family.family_id, family.family_created_at, AUTH_VERSION]);
  return { refreshToken, accessToken: await signAccess(client, user, id) };
}

async function verifyProtocol(token: string, type: 'access' | 'refresh'): Promise<jose.JWTPayload> {
  try {
    let payload: jose.JWTPayload;
    try {
      ({ payload } = await jose.jwtVerify(token, SECRET, { algorithms: ['HS256'], requiredClaims: ['sub', 'jti', 'iat', 'exp'] }));
    } catch (error) {
      // jose verifies the signature before throwing JWTExpired. Expired refresh
      // ancestors are usable ONLY to contain replay/log out, never to mint tokens.
      if (type === 'refresh' && error instanceof jose.errors.JWTExpired) payload = error.payload;
      else throw error;
    }
    if (payload.type !== type || payload.auth_version !== AUTH_VERSION
      || !isSessionId(payload.sub) || !isSessionId(payload.jti)
      || typeof payload.iat !== 'number' || !Number.isFinite(payload.iat)
      || typeof payload.exp !== 'number' || !Number.isFinite(payload.exp)
      || (type === 'refresh' && !isSessionId(payload.family_id))
      || (type === 'access' && (!isSessionId(payload.refresh_token_id)
        || !hasValidPrivilegeClaimsVersion({ roles_version: payload.roles_version })
        || !Array.isArray(payload.roles) || !payload.roles.every(v => typeof v === 'string')
        || !Array.isArray(payload.permissions) || !payload.permissions.every(v => typeof v === 'string')))) {
      throw new UnauthorizedError('Unsupported token; please sign in again');
    }
    return payload;
  } catch (error) {
    if (error instanceof UnauthorizedError) throw error;
    throw new UnauthorizedError(error instanceof jose.errors.JWTExpired ? 'Token expired' : 'Invalid token');
  }
}

export async function generateTokens(
  user: Pick<User, 'id' | 'email' | 'username' | 'roles_version'>, ipAddress?: string, userAgent?: string
): Promise<AuthTokens> {
  return transaction(async client => issueSessionInTransaction(client,
    await lockSessionUser(client, user.id), ipAddress, userAgent));
}

/** Compatibility for internal callers, not for legacy/unbound bearer formats. */
export async function generateAccessToken(
  user: Pick<User, 'id' | 'email' | 'username' | 'roles_version'>, refreshTokenId?: string
): Promise<string> {
  if (!refreshTokenId) return (await generateTokens(user)).accessToken;
  return transaction(async client => {
    const current = await lockSessionUser(client, user.id);
    const session = await client.query(
      `SELECT id FROM refresh_tokens WHERE id = $1 AND user_id = $2
       AND revoked_at IS NULL AND expires_at > clock_timestamp() AND auth_version = $3 FOR UPDATE`,
      [refreshTokenId, user.id, AUTH_VERSION]);
    if (!session.rowCount) throw new UnauthorizedError('The session is revoked or expired');
    return signAccess(client, current, refreshTokenId);
  });
}

export async function verifyAccessToken(token: string): Promise<JwtPayloadV3> {
  const payload = await verifyProtocol(token, 'access');
  const result = await query<{ roles_version: number; is_active: boolean; is_verified: boolean; session_active: boolean }>(
    `SELECT u.roles_version, u.is_active, u.is_verified,
      (t.id IS NOT NULL AND t.auth_version = $3 AND t.revoked_at IS NULL AND t.expires_at > clock_timestamp()) AS session_active
     FROM users u LEFT JOIN refresh_tokens t ON t.user_id = u.id AND t.id = $2 WHERE u.id = $1`,
    [payload.sub, payload.refresh_token_id, AUTH_VERSION]);
  const user = result.rows[0];
  if (!user || !user.is_active || !user.is_verified) throw new UnauthorizedError('Account is not active and verified');
  if (user.roles_version !== payload.roles_version) {
    throw new UnauthorizedError('Session invalidated due to permission changes. Please re-authenticate.');
  }
  if (!user.session_active) throw new UnauthorizedError('The session is revoked or expired');
  return payload as unknown as JwtPayloadV3;
}

export async function refreshTokens(token: string, ipAddress?: string, userAgent?: string): Promise<AuthTokens> {
  const payload = await verifyProtocol(token, 'refresh');
  const result = await transaction(async client => {
    const user = await lockSessionUser(client, payload.sub!);
    const stored = await client.query<StoredToken>(
      `SELECT id, family_id, family_created_at, revoked_at, rotated_at, expires_at FROM refresh_tokens
       WHERE id = $1 AND user_id = $2 AND token_hash = $3 AND auth_version = $4 FOR UPDATE`,
      [payload.jti, user.id, tokenHash(token), AUTH_VERSION]);
    const row = stored.rows[0];
    if (!row || row.family_id !== payload.family_id) throw new UnauthorizedError('Invalid refresh token');
    if (row.rotated_at) {
      await client.query(`UPDATE refresh_tokens SET revoked_at = COALESCE(revoked_at, clock_timestamp())
        WHERE user_id = $1 AND family_id = $2`, [user.id, row.family_id]);
      // Returning commits containment. Throwing here would roll back revocation.
      return { replay: true as const };
    }
    if (row.revoked_at || row.expires_at.getTime() <= Date.now() || payload.exp! * 1000 <= Date.now()) {
      throw new UnauthorizedError('Token revoked or expired');
    }
    assertSessionAccount(user);
    await client.query(`UPDATE refresh_tokens SET revoked_at = clock_timestamp(),
      rotated_at = clock_timestamp(), last_used_at = clock_timestamp() WHERE id = $1`, [row.id]);
    return { tokens: await issueSessionInTransaction(client, user, ipAddress, userAgent, row) };
  });
  if ('replay' in result) throw new UnauthorizedError('Refresh token reuse detected; session family revoked. Please sign in again.');
  return result.tokens;
}

export async function logout(token: string): Promise<void> {
  // A previously rotated token can still log out its family, but an arbitrary
  // token/hash cannot select another account or family. Expired signed ancestors
  // also revoke their family; no expired token can mint a new session.
  let payload: jose.JWTPayload;
  try { payload = await verifyProtocol(token, 'refresh'); } catch (error) {
    if (error instanceof UnauthorizedError) return;
    throw error;
  }
  await transaction(async client => {
    const user = await client.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [payload.sub]);
    if (!user.rowCount) return; // Account deletion has already cascaded its tokens.
    await client.query(`UPDATE refresh_tokens SET revoked_at = COALESCE(revoked_at, clock_timestamp())
      WHERE user_id = $1 AND family_id IN (SELECT family_id FROM refresh_tokens
        WHERE id = $2 AND user_id = $1 AND token_hash = $3 AND family_id = $4)`,
      [payload.sub, payload.jti, tokenHash(token), payload.family_id]);
  });
}
export async function revokeAllTokens(userId: string): Promise<void> {
  await transaction(async client => {
    await lockSessionUser(client, userId);
    await client.query('UPDATE refresh_tokens SET revoked_at = clock_timestamp() WHERE user_id = $1 AND revoked_at IS NULL', [userId]);
  });
}
export async function revokeSession(userId: string, tokenId: string): Promise<boolean> {
  return transaction(async client => {
    await lockSessionUser(client, userId);
    const result = await client.query(`UPDATE refresh_tokens SET revoked_at = clock_timestamp()
      WHERE user_id = $1 AND revoked_at IS NULL AND family_id IN
        (SELECT family_id FROM refresh_tokens WHERE user_id = $1 AND id = $2) RETURNING id`, [userId, tokenId]);
    return !!result.rowCount;
  });
}
