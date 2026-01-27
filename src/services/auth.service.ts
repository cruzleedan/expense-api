import * as jose from 'jose';
import { createHash, randomBytes, scrypt, timingSafeEqual } from 'crypto';
import { promisify } from 'util';
import { query, db } from '../db/client.js';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';
import type { User, JwtPayload, JwtPayloadV3, AuthTokens } from '../types/index.js';
import { UnauthorizedError, ConflictError, ValidationError } from '../types/index.js';
import { getUserRoleNames, getUserPermissions } from './permission.service.js';

const scryptAsync = promisify(scrypt);

// JWT secret as Uint8Array for jose
const JWT_SECRET = new TextEncoder().encode(env.JWT_SECRET);

// Parse duration strings like '15m', '7d' to seconds
function parseDuration(duration: string): number {
  const match = duration.match(/^(\d+)([smhd])$/);
  if (!match) throw new Error(`Invalid duration: ${duration}`);

  const value = parseInt(match[1], 10);
  const unit = match[2];

  switch (unit) {
    case 's': return value;
    case 'm': return value * 60;
    case 'h': return value * 60 * 60;
    case 'd': return value * 60 * 60 * 24;
    default: throw new Error(`Invalid duration unit: ${unit}`);
  }
}

// Password hashing with scrypt
async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex');
  const derivedKey = (await scryptAsync(password, salt, 64)) as Buffer;
  return `${salt}:${derivedKey.toString('hex')}`;
}

async function verifyPassword(password: string, hash: string): Promise<boolean> {
  const [salt, key] = hash.split(':');
  const derivedKey = (await scryptAsync(password, salt, 64)) as Buffer;
  const keyBuffer = Buffer.from(key, 'hex');
  return timingSafeEqual(derivedKey, keyBuffer);
}

// JWT token generation - V3.0 with roles and permissions
export async function generateAccessToken(
  user: Pick<User, 'id' | 'email' | 'username' | 'roles_version'>,
  refreshTokenId?: string
): Promise<string> {
  // Fetch user's roles and permissions
  const roles = await getUserRoleNames(user.id);
  const permissions = await getUserPermissions(user.id);

  const payload: Omit<JwtPayloadV3, 'iat' | 'exp'> = {
    jti: randomBytes(16).toString('hex'),
    sub: user.id,
    email: user.email,
    username: user.username,
    roles,
    roles_version: user.roles_version,
    permissions,
    type: 'access',
    refresh_token_id: refreshTokenId,
  };

  return new jose.SignJWT(payload as unknown as jose.JWTPayload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(env.JWT_ACCESS_EXPIRES_IN)
    .sign(JWT_SECRET);
}

// Legacy access token generation (for backward compatibility during migration)
export async function generateAccessTokenLegacy(user: Pick<User, 'id' | 'email'>): Promise<string> {
  const payload: Omit<JwtPayload, 'iat' | 'exp'> = {
    sub: user.id,
    email: user.email,
    type: 'access',
  };

  return new jose.SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(env.JWT_ACCESS_EXPIRES_IN)
    .sign(JWT_SECRET);
}

export async function generateRefreshToken(
  user: Pick<User, 'id' | 'email'>,
  ipAddress?: string,
  userAgent?: string
): Promise<{ token: string; tokenId: string }> {
  const tokenId = randomBytes(16).toString('hex');

  const payload: Omit<JwtPayload, 'iat' | 'exp'> & { jti: string } = {
    jti: tokenId,
    sub: user.id,
    email: user.email,
    type: 'refresh',
  };

  const token = await new jose.SignJWT(payload as unknown as jose.JWTPayload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(env.JWT_REFRESH_EXPIRES_IN)
    .sign(JWT_SECRET);

  // Store hashed refresh token in database with additional tracking info
  const tokenHash = createHash('sha256').update(token).digest('hex');
  const expiresAt = new Date(Date.now() + parseDuration(env.JWT_REFRESH_EXPIRES_IN) * 1000);

  await query(
    `INSERT INTO refresh_tokens (id, user_id, token_hash, expires_at, ip_address, user_agent)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [tokenId, user.id, tokenHash, expiresAt, ipAddress || null, userAgent || null]
  );

  return { token, tokenId };
}

export async function verifyAccessToken(token: string): Promise<JwtPayloadV3> {
  try {
    const { payload } = await jose.jwtVerify(token, JWT_SECRET);

    if (payload.type !== 'access') {
      throw new UnauthorizedError('Invalid token type');
    }

    // For v3 tokens, validate roles_version against database
    if (payload.roles_version !== undefined) {
      const result = await query<{ roles_version: number; is_active: boolean }>(
        'SELECT roles_version, is_active FROM users WHERE id = $1',
        [payload.sub]
      );

      if (result.rows.length === 0) {
        throw new UnauthorizedError('User not found');
      }

      const user = result.rows[0];

      if (!user.is_active) {
        throw new UnauthorizedError('User account is deactivated');
      }

      // Check if roles have changed since token was issued
      if (user.roles_version !== payload.roles_version) {
        throw new UnauthorizedError('Session invalidated due to permission changes. Please re-authenticate.');
      }
    }

    return payload as unknown as JwtPayloadV3;
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      throw error;
    }
    if (error instanceof jose.errors.JWTExpired) {
      throw new UnauthorizedError('Token expired');
    }
    throw new UnauthorizedError('Invalid token');
  }
}

// Legacy verify function for backward compatibility
export async function verifyAccessTokenLegacy(token: string): Promise<JwtPayload> {
  try {
    const { payload } = await jose.jwtVerify(token, JWT_SECRET);

    if (payload.type !== 'access') {
      throw new UnauthorizedError('Invalid token type');
    }

    return payload as unknown as JwtPayload;
  } catch (error) {
    if (error instanceof jose.errors.JWTExpired) {
      throw new UnauthorizedError('Token expired');
    }
    throw new UnauthorizedError('Invalid token');
  }
}

export async function verifyRefreshToken(token: string): Promise<JwtPayload> {
  try {
    const { payload } = await jose.jwtVerify(token, JWT_SECRET);

    if (payload.type !== 'refresh') {
      throw new UnauthorizedError('Invalid token type');
    }

    // Check if token exists in database (not revoked)
    const tokenHash = createHash('sha256').update(token).digest('hex');
    const result = await query<{ id: string; revoked_at: Date | null }>(
      `SELECT id, revoked_at FROM refresh_tokens
       WHERE token_hash = $1 AND expires_at > NOW()`,
      [tokenHash]
    );

    if (result.rows.length === 0) {
      throw new UnauthorizedError('Token revoked or expired');
    }

    if (result.rows[0].revoked_at !== null) {
      throw new UnauthorizedError('Token has been revoked');
    }

    // Update last_used_at timestamp
    await query(
      'UPDATE refresh_tokens SET last_used_at = NOW() WHERE token_hash = $1',
      [tokenHash]
    );

    return payload as unknown as JwtPayload;
  } catch (error) {
    if (error instanceof UnauthorizedError) throw error;
    if (error instanceof jose.errors.JWTExpired) {
      throw new UnauthorizedError('Token expired');
    }
    throw new UnauthorizedError('Invalid token');
  }
}

// Generate both tokens (V3.0 with roles and permissions)
export async function generateTokens(
  user: Pick<User, 'id' | 'email' | 'username' | 'roles_version'>,
  ipAddress?: string,
  userAgent?: string
): Promise<AuthTokens> {
  // Generate refresh token first to get the tokenId
  const { token: refreshToken, tokenId } = await generateRefreshToken(user, ipAddress, userAgent);

  // Generate access token with reference to refresh token
  const accessToken = await generateAccessToken(user, tokenId);

  return { accessToken, refreshToken };
}

// Generate tokens for legacy (non-v3) compatibility
export async function generateTokensLegacy(user: Pick<User, 'id' | 'email'>): Promise<AuthTokens> {
  const accessToken = await generateAccessTokenLegacy(user);
  const { token: refreshToken } = await generateRefreshToken(user);

  return { accessToken, refreshToken };
}

// Password validation (v3.0 requirements: 12+ chars, uppercase, lowercase, number, special char)
function validatePasswordStrength(password: string): void {
  if (password.length < 12) {
    throw new ValidationError('Password must be at least 12 characters');
  }
  if (!/[a-z]/.test(password)) {
    throw new ValidationError('Password must contain at least one lowercase letter');
  }
  if (!/[A-Z]/.test(password)) {
    throw new ValidationError('Password must contain at least one uppercase letter');
  }
  if (!/\d/.test(password)) {
    throw new ValidationError('Password must contain at least one number');
  }
  if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)) {
    throw new ValidationError('Password must contain at least one special character');
  }
}

// User registration with email/password
export async function registerWithEmail(
  email: string,
  password: string,
  username?: string,
  ipAddress?: string,
  userAgent?: string
): Promise<{ user: User; tokens: AuthTokens }> {
  // Check if user exists
  const existing = await query<User>('SELECT id FROM users WHERE email = $1', [email]);
  if (existing.rows.length > 0) {
    throw new ConflictError('Email already registered');
  }

  // Validate password strength (v3.0 requirements)
  validatePasswordStrength(password);

  // Check if password contains email/username
  const emailLocalPart = email.split('@')[0].toLowerCase();
  if (password.toLowerCase().includes(emailLocalPart)) {
    throw new ValidationError('Password cannot contain your email address');
  }
  if (username && password.toLowerCase().includes(username.toLowerCase())) {
    throw new ValidationError('Password cannot contain your username');
  }

  const passwordHash = await hashPassword(password);

  // Generate username from email if not provided
  const generatedUsername = username || email.split('@')[0];

  const result = await query<User>(
    `INSERT INTO users (email, username, password_hash, roles_version, is_active)
     VALUES ($1, $2, $3, 1, true)
     RETURNING id, email, username, password_hash, oauth_provider, oauth_id,
               roles_version, is_active, failed_login_attempts, locked_until,
               last_login_at, department_id, manager_id, cost_center,
               created_at, updated_at`,
    [email, generatedUsername, passwordHash]
  );

  const user = result.rows[0];

  // Assign default 'employee' role
  await assignDefaultRole(user.id);

  // Refetch user to get updated roles_version if changed
  const tokens = await generateTokens(user, ipAddress, userAgent);

  logger.info('User registered with email', { userId: user.id, email });

  return { user, tokens };
}

// Assign default employee role to new users
async function assignDefaultRole(userId: string): Promise<void> {
  const roleResult = await query<{ id: string }>(
    `SELECT id FROM roles WHERE name = 'employee' AND is_active = true`
  );

  if (roleResult.rows.length > 0) {
    await query(
      `INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [userId, roleResult.rows[0].id]
    );
  }
}

// Account lockout constants
const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_DURATION_MS = 15 * 60 * 1000; // 15 minutes

// User login with email/password (v3.0 with account lockout)
export async function loginWithEmail(
  email: string,
  password: string,
  ipAddress?: string,
  userAgent?: string
): Promise<{ user: User; tokens: AuthTokens }> {
  const result = await query<User>(
    `SELECT id, email, username, password_hash, oauth_provider, oauth_id,
            roles_version, is_active, failed_login_attempts, locked_until,
            last_login_at, department_id, manager_id, cost_center,
            created_at, updated_at
     FROM users WHERE email = $1`,
    [email]
  );

  if (result.rows.length === 0) {
    // Prevent timing attacks - add delay for non-existent users
    await new Promise(resolve => setTimeout(resolve, 500 + Math.random() * 500));
    throw new UnauthorizedError('Invalid email or password');
  }

  const user = result.rows[0];

  // Check if account is active
  if (!user.is_active) {
    throw new UnauthorizedError('Account is deactivated. Please contact support.');
  }

  // Check if account is locked
  if (user.locked_until && new Date(user.locked_until) > new Date()) {
    const remainingMs = new Date(user.locked_until).getTime() - Date.now();
    const remainingMins = Math.ceil(remainingMs / 60000);
    throw new UnauthorizedError(
      `Account is locked due to too many failed login attempts. Try again in ${remainingMins} minute(s).`
    );
  }

  if (!user.password_hash) {
    throw new UnauthorizedError('Please login with your OAuth provider');
  }

  const validPassword = await verifyPassword(password, user.password_hash);
  if (!validPassword) {
    // Increment failed login attempts
    const newAttempts = (user.failed_login_attempts || 0) + 1;
    let lockedUntil: Date | null = null;

    if (newAttempts >= MAX_FAILED_ATTEMPTS) {
      lockedUntil = new Date(Date.now() + LOCKOUT_DURATION_MS);
      logger.warn('Account locked due to failed login attempts', {
        userId: user.id,
        email,
        attempts: newAttempts,
        lockedUntil,
      });
    }

    await query(
      `UPDATE users SET failed_login_attempts = $1, locked_until = $2 WHERE id = $3`,
      [newAttempts, lockedUntil, user.id]
    );

    throw new UnauthorizedError('Invalid email or password');
  }

  // Successful login - reset failed attempts and update last login
  await query(
    `UPDATE users SET
       failed_login_attempts = 0,
       locked_until = NULL,
       last_login_at = NOW()
     WHERE id = $1`,
    [user.id]
  );

  // Enforce concurrent session limit (v3.0 security feature)
  await enforceConcurrentSessionLimit(user.id);

  const tokens = await generateTokens(user, ipAddress, userAgent);

  logger.info('User logged in with email', { userId: user.id });

  return { user, tokens };
}

// Enforce maximum concurrent sessions per user
const MAX_CONCURRENT_SESSIONS = 5;

async function enforceConcurrentSessionLimit(userId: string): Promise<void> {
  const result = await query<{ id: string }>(
    `SELECT id FROM refresh_tokens
     WHERE user_id = $1 AND revoked_at IS NULL AND expires_at > NOW()
     ORDER BY created_at DESC`,
    [userId]
  );

  const activeTokens = result.rows;

  if (activeTokens.length >= MAX_CONCURRENT_SESSIONS) {
    // Revoke oldest tokens to stay within limit
    const tokensToRevoke = activeTokens.slice(MAX_CONCURRENT_SESSIONS - 1);
    const tokenIds = tokensToRevoke.map(t => t.id);

    if (tokenIds.length > 0) {
      await query(
        `UPDATE refresh_tokens SET revoked_at = NOW() WHERE id = ANY($1)`,
        [tokenIds]
      );
      logger.info('Revoked old sessions due to concurrent session limit', {
        userId,
        revokedCount: tokenIds.length,
      });
    }
  }
}

// OAuth login/registration (v3.0 with full user data)
export async function loginWithOAuth(
  provider: 'google' | 'facebook',
  oauthId: string,
  email: string,
  ipAddress?: string,
  userAgent?: string
): Promise<{ user: User; tokens: AuthTokens }> {
  // Check for existing OAuth user
  let result = await query<User>(
    `SELECT id, email, username, password_hash, oauth_provider, oauth_id,
            roles_version, is_active, failed_login_attempts, locked_until,
            last_login_at, department_id, manager_id, cost_center,
            created_at, updated_at
     FROM users WHERE oauth_provider = $1 AND oauth_id = $2`,
    [provider, oauthId]
  );

  let user: User;
  let isNewUser = false;

  if (result.rows.length > 0) {
    user = result.rows[0];

    // Check if account is active
    if (!user.is_active) {
      throw new UnauthorizedError('Account is deactivated. Please contact support.');
    }

    // Update last login
    await query('UPDATE users SET last_login_at = NOW() WHERE id = $1', [user.id]);

    logger.info('OAuth user logged in', { userId: user.id, provider });
  } else {
    // Check if email exists (link accounts or create new)
    result = await query<User>(
      `SELECT id, email, username, password_hash, oauth_provider, oauth_id,
              roles_version, is_active, failed_login_attempts, locked_until,
              last_login_at, department_id, manager_id, cost_center,
              created_at, updated_at
       FROM users WHERE email = $1`,
      [email]
    );

    if (result.rows.length > 0) {
      // Link OAuth to existing account
      user = result.rows[0];

      if (!user.is_active) {
        throw new UnauthorizedError('Account is deactivated. Please contact support.');
      }

      await query(
        'UPDATE users SET oauth_provider = $1, oauth_id = $2, last_login_at = NOW() WHERE id = $3',
        [provider, oauthId, user.id]
      );
      user.oauth_provider = provider;
      user.oauth_id = oauthId;
      logger.info('OAuth linked to existing user', { userId: user.id, provider });
    } else {
      // Create new user
      const username = email.split('@')[0] + '_' + randomBytes(4).toString('hex');

      result = await query<User>(
        `INSERT INTO users (email, username, oauth_provider, oauth_id, roles_version, is_active, last_login_at)
         VALUES ($1, $2, $3, $4, 1, true, NOW())
         RETURNING id, email, username, password_hash, oauth_provider, oauth_id,
                   roles_version, is_active, failed_login_attempts, locked_until,
                   last_login_at, department_id, manager_id, cost_center,
                   created_at, updated_at`,
        [email, username, provider, oauthId]
      );
      user = result.rows[0];
      isNewUser = true;
      logger.info('New OAuth user created', { userId: user.id, provider });
    }
  }

  // Assign default role for new users
  if (isNewUser) {
    await assignDefaultRole(user.id);
  }

  // Enforce concurrent session limit
  await enforceConcurrentSessionLimit(user.id);

  const tokens = await generateTokens(user, ipAddress, userAgent);

  return { user, tokens };
}

// Refresh tokens (v3.0 with rotation and IP/user agent tracking)
export async function refreshTokens(
  refreshToken: string,
  ipAddress?: string,
  userAgent?: string
): Promise<AuthTokens> {
  const payload = await verifyRefreshToken(refreshToken);

  // Revoke old refresh token (rotation) - use revoked_at instead of delete for audit trail
  const tokenHash = createHash('sha256').update(refreshToken).digest('hex');
  await query(
    'UPDATE refresh_tokens SET revoked_at = NOW() WHERE token_hash = $1',
    [tokenHash]
  );

  // Get user with full v3 data
  const result = await query<User>(
    `SELECT id, email, username, password_hash, oauth_provider, oauth_id,
            roles_version, is_active, failed_login_attempts, locked_until,
            last_login_at, department_id, manager_id, cost_center,
            created_at, updated_at
     FROM users WHERE id = $1`,
    [payload.sub]
  );

  if (result.rows.length === 0) {
    throw new UnauthorizedError('User not found');
  }

  const user = result.rows[0];

  if (!user.is_active) {
    throw new UnauthorizedError('User account is deactivated');
  }

  return generateTokens(user, ipAddress, userAgent);
}

// Logout (revoke refresh token)
export async function logout(refreshToken: string): Promise<void> {
  const tokenHash = createHash('sha256').update(refreshToken).digest('hex');
  await query(
    'UPDATE refresh_tokens SET revoked_at = NOW() WHERE token_hash = $1',
    [tokenHash]
  );
  logger.debug('Refresh token revoked');
}

// Revoke all refresh tokens for a user
export async function revokeAllTokens(userId: string): Promise<void> {
  await query(
    'UPDATE refresh_tokens SET revoked_at = NOW() WHERE user_id = $1 AND revoked_at IS NULL',
    [userId]
  );
  logger.info('All refresh tokens revoked', { userId });
}

// Get user by ID (v3.0 with full data)
export async function getUserById(userId: string): Promise<User | null> {
  const result = await query<User>(
    `SELECT id, email, username, password_hash, oauth_provider, oauth_id,
            roles_version, is_active, failed_login_attempts, locked_until,
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
     WHERE user_id = $1 AND revoked_at IS NULL AND expires_at > NOW()
     ORDER BY created_at DESC`,
    [userId]
  );
  return result.rows;
}

// Revoke a specific session by token ID (v3.0)
export async function revokeSession(userId: string, tokenId: string): Promise<boolean> {
  const result = await query(
    `UPDATE refresh_tokens SET revoked_at = NOW()
     WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL
     RETURNING id`,
    [tokenId, userId]
  );
  return result.rowCount !== null && result.rowCount > 0;
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
  await query(
    `UPDATE users SET is_active = false WHERE id = $1`,
    [userId]
  );
  // Also revoke all tokens
  await revokeAllTokens(userId);
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
    scope: 'email profile',
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

  const tokenData = await tokenResponse.json() as { access_token: string };

  // Get user info
  const userResponse = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
    headers: { Authorization: `Bearer ${tokenData.access_token}` },
  });

  if (!userResponse.ok) {
    throw new UnauthorizedError('Failed to get Google user info');
  }

  const userData = await userResponse.json() as { id: string; email: string };

  return { id: userData.id, email: userData.email };
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

  // Get user info
  const userResponse = await fetch(
    `https://graph.facebook.com/me?fields=id,email&access_token=${tokenData.access_token}`
  );

  if (!userResponse.ok) {
    throw new UnauthorizedError('Failed to get Facebook user info');
  }

  const userData = await userResponse.json() as { id: string; email: string };

  if (!userData.email) {
    throw new ValidationError('Email not provided by Facebook');
  }

  return { id: userData.id, email: userData.email };
}
