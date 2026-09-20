import { z } from '@hono/zod-openapi';

export const AuthUserSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
}).openapi('AuthUser');

export const RegisterRequestSchema = z.object({
  email: z.string().email().openapi({ example: 'user@example.com' }),
  password: z.string().min(12).max(128).openapi({ example: 'SecureP@ss123' }),
}).openapi('RegisterRequest');

export const LoginRequestSchema = z.object({
  email: z.string().email().openapi({ example: 'user@example.com' }),
  password: z.string().openapi({ example: 'securepassword123' }),
}).openapi('LoginRequest');

export const RefreshRequestSchema = z.object({
  refreshToken: z.string().min(1).max(8192).optional().openapi({ description: 'Optional if sent via cookie' }),
}).strict().openapi('RefreshRequest');

export const StepUpRequestSchema = z.object({
  password: z.string().min(1).max(128).openapi({ description: 'Current account password' }),
}).strict().openapi('StepUpRequest');

export const StepUpResponseSchema = z.object({
  verifiedAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
}).openapi('StepUpResponse');

export const GoogleMobileLoginRequestSchema = z.object({
  idToken: z.string().openapi({ description: 'Google ID token from native google_sign_in SDK' }),
}).openapi('GoogleMobileLoginRequest');

export const FacebookMobileLoginRequestSchema = z.object({
  accessToken: z.string().openapi({ description: 'Facebook access token from native flutter_facebook_auth SDK' }),
}).openapi('FacebookMobileLoginRequest');

export const AuthResponseSchema = z.object({
  user: AuthUserSchema,
  accessToken: z.string(),
}).openapi('AuthResponse');

export const TokenResponseSchema = z.object({
  accessToken: z.string(),
}).openapi('TokenResponse');

export const LinkGoogleIdentityRequestSchema = z.object({
  idToken: z.string().min(1).max(8192),
  password: z.string().min(1).max(128),
}).strict().openapi('LinkGoogleIdentityRequest');

export const LinkFacebookIdentityRequestSchema = z.object({
  accessToken: z.string().min(1).max(8192),
  password: z.string().min(1).max(128),
}).strict().openapi('LinkFacebookIdentityRequest');

export const LinkedIdentityResponseSchema = z.object({
  provider: z.enum(['google', 'facebook']), linked: z.boolean(),
}).openapi('LinkedIdentityResponse');
