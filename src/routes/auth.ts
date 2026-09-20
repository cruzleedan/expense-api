import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import { randomBytes } from 'crypto';
import { setCookie, getCookie } from 'hono/cookie';
import {
  loginWithEmail,
  refreshTokens,
  logout,
  revokeAllTokens,
  getGoogleAuthUrl,
  getFacebookAuthUrl,
  exchangeGoogleCode,
  exchangeFacebookCode,
  verifyGoogleIdToken,
  verifyFacebookAccessToken,
  loginWithOAuth,
  establishSessionStepUp,
} from '../services/auth.service.js';
import { linkProviderIdentity } from '../services/identity.service.js';
import { sessionRequestMetadata, refreshCookieMaxAge } from '../utils/sessionRequest.js';
import { authMiddleware, getUser, getUserId } from '../middleware/auth.js';
import { authRateLimit } from '../middleware/rateLimit.js';
import { ForbiddenError, ValidationError } from '../types/index.js';
import {
  RegisterRequestSchema,
  LoginRequestSchema,
  RefreshRequestSchema,
  AuthResponseSchema,
  TokenResponseSchema,
  GoogleMobileLoginRequestSchema,
  FacebookMobileLoginRequestSchema,
  StepUpRequestSchema,
  StepUpResponseSchema,
  LinkGoogleIdentityRequestSchema,
  LinkFacebookIdentityRequestSchema,
  LinkedIdentityResponseSchema,
} from '../schemas/auth.js';
import { ErrorSchema, MessageSchema, AuthHeaderSchema } from '../schemas/common.js';

const authRouter = new OpenAPIHono();

// Apply stricter rate limiting to auth routes
authRouter.use('*', authRateLimit);

// Helper to set refresh token cookie
function setRefreshTokenCookie(c: Parameters<typeof setCookie>[0], token: string) {
  setCookie(c, 'refreshToken', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'Lax',
    maxAge: refreshCookieMaxAge(token),
    path: '/',
  });
}

// Register route
const registerRoute = createRoute({
  method: 'post',
  path: '/register',
  tags: ['Authentication'],
  summary: 'Register a new user',
  description: 'Public registration is disabled; accounts must be provisioned by an administrator',
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
    403: {
      description: 'Public registration is disabled',
      content: { 'application/json': { schema: ErrorSchema } },
    },
    409: {
      description: 'Email already registered',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
});

authRouter.openapi(registerRoute, async (c) => {
  c.req.valid('json');
  throw new ForbiddenError('Public registration is disabled; contact an administrator');
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
  const { user, tokens } = await loginWithEmail(email, password, ...sessionRequestMetadata(c));

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
    400: {
      description: 'Invalid refresh body or missing token',
      content: { 'application/json': { schema: ErrorSchema } },
    },
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
  const body = c.req.valid('json');
  const bodyToken = body?.refreshToken;
  const refreshToken = bodyToken ?? getCookie(c, 'refreshToken');

  if (!refreshToken) {
    throw new ValidationError('Refresh token required');
  }

  const tokens = await refreshTokens(refreshToken, ...sessionRequestMetadata(c));

  setRefreshTokenCookie(c, tokens.refreshToken);

  return c.json({ accessToken: tokens.accessToken }, 200);
});

// Logout route
const logoutRoute = createRoute({
  method: 'post',
  path: '/logout',
  tags: ['Authentication'],
  summary: 'Logout user',
  description: 'Revoke the session family and its access tokens, then clear the cookie; accepts cookie or body token',
  request: {
    body: { content: { 'application/json': { schema: RefreshRequestSchema } }, required: false },
  },
  responses: {
    400: {
      description: 'Invalid logout body',
      content: { 'application/json': { schema: ErrorSchema } },
    },
    200: {
      description: 'Logged out successfully',
      content: { 'application/json': { schema: MessageSchema } },
    },
  },
});

authRouter.openapi(logoutRoute, async (c) => {
  const refreshToken = c.req.valid('json')?.refreshToken ?? getCookie(c, 'refreshToken');

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

// Revoke all sessions route
const revokeAllSessionsRoute = createRoute({
  method: 'post',
  path: '/sessions/revoke-all',
  tags: ['Authentication'],
  summary: 'Revoke all sessions',
  description:
    'Revoke every refresh token issued to the authenticated user (all devices and integrations, ' +
    'including third-party access such as an MCP client). Access tokens are also invalidated; re-authentication is required.',
  security: [{ Bearer: [] }],
  request: {
    headers: AuthHeaderSchema,
  },
  responses: {
    200: {
      description: 'All sessions revoked',
      content: { 'application/json': { schema: MessageSchema } },
    },
    401: {
      description: 'Unauthorized',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
});

authRouter.use('/sessions/revoke-all', authMiddleware);

authRouter.openapi(revokeAllSessionsRoute, async (c) => {
  const userId = getUserId(c);
  await revokeAllTokens(userId);
  return c.json({ message: 'All sessions revoked' }, 200);
});

const stepUpRoute = createRoute({
  method: 'post',
  path: '/step-up',
  tags: ['Authentication'],
  summary: 'Establish recent step-up assurance',
  description:
    'Reauthenticate with the current password and bind short-lived step-up assurance to the current session; this is not second-factor MFA',
  security: [{ Bearer: [] }],
  request: {
    headers: AuthHeaderSchema,
    body: { content: { 'application/json': { schema: StepUpRequestSchema } } },
  },
  responses: {
    200: {
      description: 'Step-up assurance established',
      content: { 'application/json': { schema: StepUpResponseSchema } },
    },
    401: {
      description: 'Authentication or credential verification failed',
      content: { 'application/json': { schema: ErrorSchema } },
    },
    400: {
      description: 'Invalid request body',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
});

authRouter.use('/step-up', authMiddleware);
authRouter.openapi(stepUpRoute, async (c) => {
  const { password } = c.req.valid('json');
  const jwt = getUser(c);
  const result = await establishSessionStepUp(jwt.sub, jwt.refresh_token_id, password);
  return c.json({
    verifiedAt: result.verifiedAt.toISOString(),
    expiresAt: result.expiresAt.toISOString(),
  }, 200);
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

  setCookie(c, 'oauth_state_google', state, {
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
  const storedState = getCookie(c, 'oauth_state_google');

  if (!code || !state || state !== storedState) {
    throw new ValidationError('Invalid OAuth callback');
  }

  setCookie(c, 'oauth_state_google', '', { maxAge: 0, path: '/' });

  const googleUser = await exchangeGoogleCode(code);
  const { user, tokens } = await loginWithOAuth('google', googleUser.id, googleUser.email, ...sessionRequestMetadata(c));

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

  setCookie(c, 'oauth_state_facebook', state, {
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
  const storedState = getCookie(c, 'oauth_state_facebook');

  if (!code || !state || state !== storedState) {
    throw new ValidationError('Invalid OAuth callback');
  }

  setCookie(c, 'oauth_state_facebook', '', { maxAge: 0, path: '/' });

  const facebookUser = await exchangeFacebookCode(code);
  const { user, tokens } = await loginWithOAuth('facebook', facebookUser.id, facebookUser.email, ...sessionRequestMetadata(c));

  setRefreshTokenCookie(c, tokens.refreshToken);

  return c.json({
    user: { id: user.id, email: user.email },
    accessToken: tokens.accessToken,
  }, 200);
});

// Google mobile sign-in (native SDK ID token)
const googleMobileLoginRoute = createRoute({
  method: 'post',
  path: '/google/mobile',
  tags: ['Authentication'],
  summary: 'Sign in with Google (mobile)',
  description: 'Verify a Google ID token from a native SDK (e.g. google_sign_in) and return tokens',
  request: {
    body: {
      content: { 'application/json': { schema: GoogleMobileLoginRequestSchema } },
    },
  },
  responses: {
    200: {
      description: 'Sign-in successful',
      content: { 'application/json': { schema: AuthResponseSchema } },
    },
    400: {
      description: 'Invalid Google ID token',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
});

authRouter.openapi(googleMobileLoginRoute, async (c) => {
  const { idToken } = c.req.valid('json');

  const googleUser = await verifyGoogleIdToken(idToken);
  const { user, tokens } = await loginWithOAuth('google', googleUser.id, googleUser.email, ...sessionRequestMetadata(c));

  setRefreshTokenCookie(c, tokens.refreshToken);

  return c.json({
    user: { id: user.id, email: user.email },
    accessToken: tokens.accessToken,
  }, 200);
});

// Facebook mobile sign-in (native SDK access token)
const facebookMobileLoginRoute = createRoute({
  method: 'post',
  path: '/facebook/mobile',
  tags: ['Authentication'],
  summary: 'Sign in with Facebook (mobile)',
  description: 'Verify a Facebook access token from a native SDK (e.g. flutter_facebook_auth) and return tokens',
  request: {
    body: {
      content: { 'application/json': { schema: FacebookMobileLoginRequestSchema } },
    },
  },
  responses: {
    200: {
      description: 'Sign-in successful',
      content: { 'application/json': { schema: AuthResponseSchema } },
    },
    400: {
      description: 'Invalid Facebook access token',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
});

authRouter.openapi(facebookMobileLoginRoute, async (c) => {
  const { accessToken } = c.req.valid('json');

  const facebookUser = await verifyFacebookAccessToken(accessToken);
  const { user, tokens } = await loginWithOAuth('facebook', facebookUser.id, facebookUser.email, ...sessionRequestMetadata(c));

  setRefreshTokenCookie(c, tokens.refreshToken);

  return c.json({
    user: { id: user.id, email: user.email },
    accessToken: tokens.accessToken,
  }, 200);
});

// Explicit capability: link a verified provider subject to one's own account,
// requiring current session + password. No administrator capability or client userId.
const linkGoogleRoute = createRoute({
  method: 'post', path: '/identities/google', tags: ['Authentication'],
  summary: 'Link a Google identity to the current account',
  description: 'Requires an active session, current account password, and Google ID token with verified email; never links by email match',
  security: [{ Bearer: [] }],
  request: { headers: AuthHeaderSchema, body: { content: { 'application/json': { schema: LinkGoogleIdentityRequestSchema } } } },
  responses: {
    200: { description: 'Identity linked', content: { 'application/json': { schema: LinkedIdentityResponseSchema } } },
    400: { description: 'Invalid provider proof or request', content: { 'application/json': { schema: ErrorSchema } } },
    401: { description: 'Session or account password invalid', content: { 'application/json': { schema: ErrorSchema } } },
    409: { description: 'Identity belongs to another account', content: { 'application/json': { schema: ErrorSchema } } },
  },
});
authRouter.use('/identities/google', authMiddleware);
authRouter.openapi(linkGoogleRoute, async c => {
  const body = c.req.valid('json');
  const identity = await verifyGoogleIdToken(body.idToken);
  const actor = getUser(c);
  const result = await linkProviderIdentity({ ...actor, sub: getUserId(c) }, 'google', identity.id, body.password);
  return c.json(result, 200);
});
const linkFacebookRoute = createRoute({
  method: 'post', path: '/identities/facebook', tags: ['Authentication'],
  summary: 'Link a Facebook identity to the current account',
  description: 'Requires an active session, current account password, and valid app-bound Facebook subject token; Facebook email is never ownership proof',
  security: [{ Bearer: [] }],
  request: { headers: AuthHeaderSchema, body: { content: { 'application/json': { schema: LinkFacebookIdentityRequestSchema } } } },
  responses: {
    200: { description: 'Identity linked', content: { 'application/json': { schema: LinkedIdentityResponseSchema } } },
    400: { description: 'Invalid provider proof or request', content: { 'application/json': { schema: ErrorSchema } } },
    401: { description: 'Session or account password invalid', content: { 'application/json': { schema: ErrorSchema } } },
    409: { description: 'Identity belongs to another account', content: { 'application/json': { schema: ErrorSchema } } },
  },
});
authRouter.use('/identities/facebook', authMiddleware);
authRouter.openapi(linkFacebookRoute, async c => {
  const body = c.req.valid('json');
  const identity = await verifyFacebookAccessToken(body.accessToken);
  const actor = getUser(c);
  const result = await linkProviderIdentity({ ...actor, sub: getUserId(c) }, 'facebook', identity.id, body.password);
  return c.json(result, 200);
});

// Fail closed BEFORE body validation/authentication: no login, session minting,
// erasure, deactivation, or false pseudonymization claim (approved WORK-0048 deferral).
authRouter.use('/delete-account', async () => {
  throw new ForbiddenError('Self-service account deletion is disabled pending an approved retention policy; contact an administrator');
});
const deleteAccountRoute = createRoute({
  method: 'post', path: '/delete-account', tags: ['Authentication'],
  summary: 'Self-service account deletion is disabled',
  security: [],
  description: 'No account or financial data is changed; retention and pseudonymization policy is pending',
  responses: {
    403: { description: 'Self-service deletion disabled', content: { 'application/json': { schema: ErrorSchema } } },
  },
});
authRouter.openapi(deleteAccountRoute, async () => {
  throw new ForbiddenError('Self-service account deletion is disabled pending an approved retention policy');
});

export { authRouter };
