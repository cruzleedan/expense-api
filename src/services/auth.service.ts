import * as jose from 'jose';
import { query, transaction } from '../db/client.js';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';
import type { User, AuthTokens } from '../types/index.js';
import { UnauthorizedError, ConflictError, ValidationError } from '../types/index.js';
import { hashPassword, verifyPassword } from '../utils/password.js';
import { validatePasswordStrength } from '../policies/password.js';
import { googleIdentity, facebookIdentity } from '../policies/providerIdentity.js';
import { assignDefaultRole, isDuplicateEmail } from './accountProvisioning.service.js';
import { AUTH_VERSION } from '../policies/session.js';
import { lockSessionUser, assertSessionAccount, issueSessionInTransaction } from './session.service.js';
import { logAuditEvent } from './audit.service.js';
import { acquireRbacMutationLock, assertUserCanLoseControlPlaneEligibility } from './rbac.service.js';
export { generateAccessToken, generateTokens, verifyAccessToken, refreshTokens,
  logout, revokeAllTokens, revokeSession } from './session.service.js';

export interface StepUpResult {
  verifiedAt: Date;
  expiresAt: Date;
}

/** Bind a recent credential ceremony to the refresh-token session behind this access token. */
export async function establishSessionStepUp(
  userId: string,
  refreshTokenId: string | undefined,
  password: string
): Promise<StepUpResult> {
  if (!refreshTokenId) {
    throw new UnauthorizedError('This access token is not bound to an active session');
  }

  return transaction(async (client) => {
    const userResult = await client.query<{
      email: string;
      password_hash: string | null;
      is_active: boolean;
      is_verified: boolean;
    }>(
      `SELECT email, password_hash, is_active, is_verified
       FROM users
       WHERE id = $1
       FOR UPDATE`,
      [userId]
    );
    const user = userResult.rows[0];
    if (!user || !user.is_active || !user.is_verified) {
      throw new UnauthorizedError('Account is not active and verified');
    }
    if (!user.password_hash) {
      throw new UnauthorizedError(
        'Password step-up is unavailable for this account; sign in with an approved step-up method'
      );
    }
    if (!(await verifyPassword(password, user.password_hash))) {
      throw new UnauthorizedError('Invalid credentials');
    }

    const assuranceResult = await client.query<{ step_up_verified_at: Date }>(
      `UPDATE refresh_tokens
       SET step_up_verified_at = NOW()
       WHERE id = $1
         AND user_id = $2
         AND revoked_at IS NULL
         AND expires_at > NOW()
         AND auth_version = $3
       RETURNING step_up_verified_at`,
      [refreshTokenId, userId, AUTH_VERSION]
    );
    const assurance = assuranceResult.rows[0];
    if (!assurance) {
      throw new UnauthorizedError('The session is revoked or expired');
    }

    await logAuditEvent({
      actorId: userId,
      actorEmail: user.email,
      sessionId: refreshTokenId,
      action: 'authentication.step_up',
      actionCategory: 'authentication',
      resourceType: 'session',
      resourceId: refreshTokenId,
      metadata: { method: 'password', ttl_seconds: env.STEP_UP_TTL_SECONDS },
      client,
    });

    return {
      verifiedAt: assurance.step_up_verified_at,
      expiresAt: new Date(
        assurance.step_up_verified_at.getTime() + env.STEP_UP_TTL_SECONDS * 1000
      ),
    };
  });
}

export async function registerWithEmail(email: string, password: string, username?: string): Promise<{ user: User }> {
  validatePasswordStrength(password, email, username);
  const passwordHash = await hashPassword(password);
  try {
    return await transaction(async client => {
      const result = await client.query<User>(
        `INSERT INTO users(email, username, password_hash, roles_version, is_active, is_verified)
         VALUES ($1,$2,$3,1,false,false) RETURNING *`,
        [email, username || email.split('@')[0], passwordHash]);
      await assignDefaultRole(client, result.rows[0].id);
      return { user: result.rows[0] };
    });
  } catch (error) {
    if (isDuplicateEmail(error)) throw new ConflictError('Email already registered');
    throw error;
  }
}
export async function loginWithEmail(
  email: string, password: string, ipAddress?: string, userAgent?: string
): Promise<{ user: User; tokens: AuthTokens }> {
  const outcome = await transaction(async client => {
    const result = await client.query<User>('SELECT * FROM users WHERE email = $1 FOR UPDATE', [email]);
    const user = result.rows[0];
    if (!user) return { error: 'Invalid email or password', unknownAccount: true };
    assertSessionAccount(user);
    if (user.locked_until && user.locked_until.getTime() > Date.now()) {
      throw new UnauthorizedError('Account is locked due to too many failed login attempts');
    }
    if (!user.password_hash) throw new UnauthorizedError('Please login with your OAuth provider');
    if (!(await verifyPassword(password, user.password_hash))) {
      // Commit counters before raising an authentication error; the account lock
      // also prevents concurrent attempts from losing increments.
      const attempts = (user.locked_until ? 0 : user.failed_login_attempts || 0) + 1;
      await client.query('UPDATE users SET failed_login_attempts = $1, locked_until = $2 WHERE id = $3',
        [attempts, attempts >= 5 ? new Date(Date.now() + 15 * 60 * 1000) : null, user.id]);
      return { error: 'Invalid email or password', unknownAccount: false };
    }
    await client.query(`UPDATE users SET failed_login_attempts = 0, locked_until = NULL,
      last_login_at = clock_timestamp() WHERE id = $1`, [user.id]);
    return { user, tokens: await issueSessionInTransaction(client, user, ipAddress, userAgent) };
  });
  if ('error' in outcome) {
    if (outcome.unknownAccount) await new Promise(resolve => setTimeout(resolve, 500 + Math.random() * 500));
    throw new UnauthorizedError(outcome.error!);
  }
  return outcome;
}

/** The caller supplies a cryptographically verified provider subject, never a client profile. */
export async function loginWithOAuth(
  provider: 'google' | 'facebook', oauthId: string, _email: string, ipAddress?: string, userAgent?: string
): Promise<{ user: User; tokens: AuthTokens }> {
  return transaction(async client => {
    const identity = await client.query<{ user_id: string }>(
      'SELECT user_id FROM user_identities WHERE provider = $1 AND subject = $2', [provider, oauthId]);
    if (!identity.rows[0]) throw new UnauthorizedError(
      'Provider identity is not linked; sign in with your existing account and explicitly link it');
    const user = await lockSessionUser(client, identity.rows[0].user_id);
    assertSessionAccount(user);
    await client.query('UPDATE users SET last_login_at = clock_timestamp() WHERE id = $1', [user.id]);
    return { user, tokens: await issueSessionInTransaction(client, user, ipAddress, userAgent) };
  });
}

// Get user by ID (v3.0 with full data)
export async function getUserById(userId: string): Promise<User | null> {
  const result = await query<User>(
    `SELECT id, email, username, password_hash, oauth_provider, oauth_id,
            roles_version, is_active, is_verified, failed_login_attempts, locked_until,
            last_login_at, department_id, manager_id, cost_center,
            created_at, updated_at
     FROM users WHERE id = $1`,
    [userId]
  );
  return result.rows[0] ?? null;
}

// Get user's active sessions (v3.0)
export async function getUserSessions(userId: string): Promise<Array<{
  id: string;
  ip_address: string | null;
  user_agent: string | null;
  created_at: Date;
  last_used_at: Date | null;
  expires_at: Date;
}>> {
  const result = await query<{
    id: string;
    ip_address: string | null;
    user_agent: string | null;
    created_at: Date;
    last_used_at: Date | null;
    expires_at: Date;
  }>(
    `SELECT id, ip_address, user_agent, created_at, last_used_at, expires_at
     FROM refresh_tokens
     WHERE user_id = $1 AND revoked_at IS NULL AND expires_at > NOW() AND auth_version = $2
     ORDER BY created_at DESC`,
    [userId, AUTH_VERSION]
  );
  return result.rows;
}

// Unlock a locked account (admin function)
export async function unlockAccount(userId: string): Promise<void> {
  await query(
    `UPDATE users SET failed_login_attempts = 0, locked_until = NULL WHERE id = $1`,
    [userId]
  );
  logger.info('Account unlocked', { userId });
}

// Deactivate a user account (admin function)
export async function deactivateAccount(userId: string): Promise<void> {
  await transaction(async (client) => {
    await acquireRbacMutationLock(client);
    await assertUserCanLoseControlPlaneEligibility(client, userId, false);
    await client.query('UPDATE users SET is_active = false WHERE id = $1', [userId]);
    await client.query(
      'UPDATE refresh_tokens SET revoked_at = NOW() WHERE user_id = $1 AND revoked_at IS NULL',
      [userId]
    );
  });
  logger.info('Account deactivated', { userId });
}

// Reactivate a user account (admin function)
export async function reactivateAccount(userId: string): Promise<void> {
  await query(
    `UPDATE users SET is_active = true, failed_login_attempts = 0, locked_until = NULL WHERE id = $1`,
    [userId]
  );
  logger.info('Account reactivated', { userId });
}

// OAuth URL generators
export function getGoogleAuthUrl(state: string): string {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_REDIRECT_URI) {
    throw new ValidationError('Google OAuth not configured');
  }

  const params = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    redirect_uri: env.GOOGLE_REDIRECT_URI,
    response_type: 'code',
    scope: 'openid email profile',
    state,
  });

  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

export function getFacebookAuthUrl(state: string): string {
  if (!env.FACEBOOK_CLIENT_ID || !env.FACEBOOK_REDIRECT_URI) {
    throw new ValidationError('Facebook OAuth not configured');
  }

  const params = new URLSearchParams({
    client_id: env.FACEBOOK_CLIENT_ID,
    redirect_uri: env.FACEBOOK_REDIRECT_URI,
    response_type: 'code',
    scope: 'email',
    state,
  });

  return `https://www.facebook.com/v18.0/dialog/oauth?${params}`;
}

// Exchange OAuth code for tokens
export async function exchangeGoogleCode(code: string): Promise<{ id: string; email: string }> {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET || !env.GOOGLE_REDIRECT_URI) {
    throw new ValidationError('Google OAuth not configured');
  }

  // Exchange code for token
  const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      redirect_uri: env.GOOGLE_REDIRECT_URI,
      grant_type: 'authorization_code',
    }),
  });

  if (!tokenResponse.ok) {
    throw new UnauthorizedError('Failed to exchange Google code');
  }

  const tokenData = await tokenResponse.json() as { id_token?: string };
  if (!tokenData.id_token) throw new UnauthorizedError('Google did not return an ID token');
  return verifyGoogleTokenForAudiences(tokenData.id_token, [env.GOOGLE_CLIENT_ID]);
}

export async function exchangeFacebookCode(code: string): Promise<{ id: string; email: string }> {
  if (!env.FACEBOOK_CLIENT_ID || !env.FACEBOOK_CLIENT_SECRET || !env.FACEBOOK_REDIRECT_URI) {
    throw new ValidationError('Facebook OAuth not configured');
  }

  // Exchange code for token
  const tokenParams = new URLSearchParams({
    code,
    client_id: env.FACEBOOK_CLIENT_ID,
    client_secret: env.FACEBOOK_CLIENT_SECRET,
    redirect_uri: env.FACEBOOK_REDIRECT_URI,
  });

  const tokenResponse = await fetch(`https://graph.facebook.com/v18.0/oauth/access_token?${tokenParams}`);

  if (!tokenResponse.ok) {
    throw new UnauthorizedError('Failed to exchange Facebook code');
  }

  const tokenData = await tokenResponse.json() as { access_token: string };

  if (typeof tokenData.access_token !== 'string' || !tokenData.access_token) {
    throw new UnauthorizedError('Facebook did not return an access token');
  }
  return verifyFacebookAccessToken(tokenData.access_token);
}

// Google JWKS for verifying ID tokens from native (mobile) sign-in
const GOOGLE_JWKS = jose.createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));

// Verify a Google ID token obtained from a native SDK (e.g. google_sign_in)
export async function verifyGoogleIdToken(
  idToken: string, keySet: jose.JWTVerifyGetKey = GOOGLE_JWKS
): Promise<{ id: string; email: string }> {
  const allowedAudiences = [...new Set([env.GOOGLE_CLIENT_ID, ...(env.GOOGLE_MOBILE_CLIENT_IDS || '').split(',')]
    .map(id => id?.trim()).filter((id): id is string => Boolean(id)))];

  if (allowedAudiences.length === 0) {
    throw new ValidationError('Google token sign-in not configured');
  }

  return verifyGoogleTokenForAudiences(idToken, allowedAudiences, keySet);
}

export async function verifyGoogleTokenForAudiences(
  idToken: string, allowedAudiences: string[], keySet: jose.JWTVerifyGetKey = GOOGLE_JWKS
): Promise<{ id: string; email: string }> {
  let payload: jose.JWTPayload;
  try {
    const result = await jose.jwtVerify(idToken, keySet, {
      issuer: ['https://accounts.google.com', 'accounts.google.com'],
      audience: allowedAudiences,
      algorithms: ['RS256'],
      requiredClaims: ['sub', 'aud', 'iss', 'iat', 'exp'],
    });
    payload = result.payload;
  } catch (error) {
    logger.warn('Google ID token verification failed', { error: error instanceof Error ? error.message : error });
    throw new ValidationError('Invalid Google ID token');
  }

  return googleIdentity(payload, allowedAudiences);
}

// Verify a Facebook access token obtained from a native SDK (e.g. flutter_facebook_auth)
export async function verifyFacebookAccessToken(accessToken: string): Promise<{ id: string; email: string }> {
  if (!env.FACEBOOK_CLIENT_ID || !env.FACEBOOK_CLIENT_SECRET) {
    throw new ValidationError('Facebook mobile sign-in not configured');
  }

  // Confirm the token is valid and was issued for this app
  const appAccessToken = `${env.FACEBOOK_CLIENT_ID}|${env.FACEBOOK_CLIENT_SECRET}`;
  const debugParams = new URLSearchParams({
    input_token: accessToken,
    access_token: appAccessToken,
  });

  const debugResponse = await fetch(`https://graph.facebook.com/debug_token?${debugParams}`);

  if (!debugResponse.ok) {
    throw new ValidationError('Invalid Facebook access token');
  }

  const debugData = await debugResponse.json() as {
    data?: { is_valid: boolean; app_id: string; user_id: string; expires_at: number; data_access_expires_at?: number };
  };

  if (!debugData.data?.is_valid || debugData.data.app_id !== env.FACEBOOK_CLIENT_ID) {
    throw new ValidationError('Invalid Facebook access token');
  }

  // Fetch profile using the provided user access token
  const userResponse = await fetch(
    `https://graph.facebook.com/me?fields=id,email&access_token=${accessToken}`
  );

  if (!userResponse.ok) {
    throw new ValidationError('Invalid Facebook access token');
  }

  const userData = await userResponse.json() as { id: string; email?: string };

  return facebookIdentity(debugData.data, userData, env.FACEBOOK_CLIENT_ID);
}
