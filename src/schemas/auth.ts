import { z } from '@hono/zod-openapi';

export const AuthUserSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
}).openapi('AuthUser');

export const RegisterRequestSchema = z.object({
  email: z.string().email().openapi({ example: 'user@example.com' }),
  password: z.string().min(8).openapi({ example: 'securepassword123' }),
}).openapi('RegisterRequest');

export const LoginRequestSchema = z.object({
  email: z.string().email().openapi({ example: 'user@example.com' }),
  password: z.string().openapi({ example: 'securepassword123' }),
}).openapi('LoginRequest');

export const RefreshRequestSchema = z.object({
  refreshToken: z.string().optional().openapi({ description: 'Optional if sent via cookie' }),
}).openapi('RefreshRequest');

export const AuthResponseSchema = z.object({
  user: AuthUserSchema,
  accessToken: z.string(),
}).openapi('AuthResponse');

export const TokenResponseSchema = z.object({
  accessToken: z.string(),
}).openapi('TokenResponse');
