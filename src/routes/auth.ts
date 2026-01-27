import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import { randomBytes } from 'crypto';
import { setCookie, getCookie } from 'hono/cookie';
import {
  registerWithEmail,
  loginWithEmail,
  refreshTokens,
  logout,
  getGoogleAuthUrl,
  getFacebookAuthUrl,
  exchangeGoogleCode,
  exchangeFacebookCode,
  loginWithOAuth,
} from '../services/auth.service.js';
import { authRateLimit } from '../middleware/rateLimit.js';
import { ValidationError } from '../types/index.js';
import {
  RegisterRequestSchema,
  LoginRequestSchema,
  RefreshRequestSchema,
  AuthResponseSchema,
  TokenResponseSchema,
} from '../schemas/auth.js';
import { ErrorSchema, MessageSchema } from '../schemas/common.js';

const authRouter = new OpenAPIHono();

// Apply stricter rate limiting to auth routes
authRouter.use('*', authRateLimit);

// Helper to set refresh token cookie
function setRefreshTokenCookie(c: Parameters<typeof setCookie>[0], token: string) {
  setCookie(c, 'refreshToken', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'Lax',
    maxAge: 7 * 24 * 60 * 60,
    path: '/',
  });
}

// Register route
const registerRoute = createRoute({
  method: 'post',
  path: '/register',
  tags: ['Authentication'],
  summary: 'Register a new user',
  description: 'Register a new user with email and password',
  request: {
    body: {
      content: { 'application/json': { schema: RegisterRequestSchema } },
    },
  },
  responses: {
    201: {
      description: 'User registered successfully',
      content: { 'application/json': { schema: AuthResponseSchema } },
    },
    400: {
      description: 'Validation error',
      content: { 'application/json': { schema: ErrorSchema } },
    },
    409: {
      description: 'Email already registered',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
});

authRouter.openapi(registerRoute, async (c) => {
  const { email, password } = c.req.valid('json');
  const { user, tokens } = await registerWithEmail(email, password);

  setRefreshTokenCookie(c, tokens.refreshToken);

  return c.json({
    user: { id: user.id, email: user.email },
    accessToken: tokens.accessToken,
  }, 201);
});

// Login route
const loginRoute = createRoute({
  method: 'post',
  path: '/login',
  tags: ['Authentication'],
  summary: 'Login with email and password',
  description: 'Authenticate user and return access token',
  request: {
    body: {
      content: { 'application/json': { schema: LoginRequestSchema } },
    },
  },
  responses: {
    200: {
      description: 'Login successful',
      content: { 'application/json': { schema: AuthResponseSchema } },
    },
    401: {
      description: 'Invalid credentials',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
});

authRouter.openapi(loginRoute, async (c) => {
  const { email, password } = c.req.valid('json');
  const { user, tokens } = await loginWithEmail(email, password);

  setRefreshTokenCookie(c, tokens.refreshToken);

  return c.json({
    user: { id: user.id, email: user.email },
    accessToken: tokens.accessToken,
  }, 200);
});

// Refresh token route
const refreshRoute = createRoute({
  method: 'post',
  path: '/refresh',
  tags: ['Authentication'],
  summary: 'Refresh access token',
  description: 'Get a new access token using refresh token (from cookie or body)',
  request: {
    body: {
      content: { 'application/json': { schema: RefreshRequestSchema } },
      required: false,
    },
  },
  responses: {
    200: {
      description: 'Token refreshed',
      content: { 'application/json': { schema: TokenResponseSchema } },
    },
    401: {
      description: 'Invalid or expired refresh token',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
});

authRouter.openapi(refreshRoute, async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const bodyToken = body?.refreshToken;
  const refreshToken = bodyToken ?? getCookie(c, 'refreshToken');

  if (!refreshToken) {
    throw new ValidationError('Refresh token required');
  }

  const tokens = await refreshTokens(refreshToken);

  setRefreshTokenCookie(c, tokens.refreshToken);

  return c.json({ accessToken: tokens.accessToken }, 200);
});

// Logout route
const logoutRoute = createRoute({
  method: 'post',
  path: '/logout',
  tags: ['Authentication'],
  summary: 'Logout user',
  description: 'Invalidate refresh token and clear cookie',
  responses: {
    200: {
      description: 'Logged out successfully',
      content: { 'application/json': { schema: MessageSchema } },
    },
  },
});

authRouter.openapi(logoutRoute, async (c) => {
  const refreshToken = getCookie(c, 'refreshToken');

  if (refreshToken) {
    await logout(refreshToken);
  }

  setCookie(c, 'refreshToken', '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'Lax',
    maxAge: 0,
    path: '/',
  });

  return c.json({ message: 'Logged out successfully' }, 200);
});

// Google OAuth - initiate
const googleAuthRoute = createRoute({
  method: 'get',
  path: '/google',
  tags: ['Authentication'],
  summary: 'Initiate Google OAuth',
  description: 'Redirect to Google OAuth consent screen',
  responses: {
    302: {
      description: 'Redirect to Google',
    },
  },
});

authRouter.openapi(googleAuthRoute, (c) => {
  const state = randomBytes(16).toString('hex');

  setCookie(c, 'oauth_state', state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'Lax',
    maxAge: 600,
    path: '/',
  });

  const url = getGoogleAuthUrl(state);
  return c.redirect(url);
});

// Google OAuth - callback
const googleCallbackRoute = createRoute({
  method: 'get',
  path: '/google/callback',
  tags: ['Authentication'],
  summary: 'Google OAuth callback',
  description: 'Handle Google OAuth callback and return tokens',
  responses: {
    200: {
      description: 'OAuth successful',
      content: { 'application/json': { schema: AuthResponseSchema } },
    },
    400: {
      description: 'Invalid OAuth callback',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
});

authRouter.openapi(googleCallbackRoute, async (c) => {
  const code = c.req.query('code');
  const state = c.req.query('state');
  const storedState = getCookie(c, 'oauth_state');

  if (!code || !state || state !== storedState) {
    throw new ValidationError('Invalid OAuth callback');
  }

  setCookie(c, 'oauth_state', '', { maxAge: 0, path: '/' });

  const googleUser = await exchangeGoogleCode(code);
  const { user, tokens } = await loginWithOAuth('google', googleUser.id, googleUser.email);

  setRefreshTokenCookie(c, tokens.refreshToken);

  return c.json({
    user: { id: user.id, email: user.email },
    accessToken: tokens.accessToken,
  }, 200);
});

// Facebook OAuth - initiate
const facebookAuthRoute = createRoute({
  method: 'get',
  path: '/facebook',
  tags: ['Authentication'],
  summary: 'Initiate Facebook OAuth',
  description: 'Redirect to Facebook OAuth consent screen',
  responses: {
    302: {
      description: 'Redirect to Facebook',
    },
  },
});

authRouter.openapi(facebookAuthRoute, (c) => {
  const state = randomBytes(16).toString('hex');

  setCookie(c, 'oauth_state', state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'Lax',
    maxAge: 600,
    path: '/',
  });

  const url = getFacebookAuthUrl(state);
  return c.redirect(url);
});

// Facebook OAuth - callback
const facebookCallbackRoute = createRoute({
  method: 'get',
  path: '/facebook/callback',
  tags: ['Authentication'],
  summary: 'Facebook OAuth callback',
  description: 'Handle Facebook OAuth callback and return tokens',
  responses: {
    200: {
      description: 'OAuth successful',
      content: { 'application/json': { schema: AuthResponseSchema } },
    },
    400: {
      description: 'Invalid OAuth callback',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
});

authRouter.openapi(facebookCallbackRoute, async (c) => {
  const code = c.req.query('code');
  const state = c.req.query('state');
  const storedState = getCookie(c, 'oauth_state');

  if (!code || !state || state !== storedState) {
    throw new ValidationError('Invalid OAuth callback');
  }

  setCookie(c, 'oauth_state', '', { maxAge: 0, path: '/' });

  const facebookUser = await exchangeFacebookCode(code);
  const { user, tokens } = await loginWithOAuth('facebook', facebookUser.id, facebookUser.email);

  setRefreshTokenCookie(c, tokens.refreshToken);

  return c.json({
    user: { id: user.id, email: user.email },
    accessToken: tokens.accessToken,
  }, 200);
});

export { authRouter };
