# Hono TypeScript Implementation Guide v3.0

## Document Information
- **Version:** 3.0
- **Date:** January 27, 2026
- **Related Document:** SRS v3.0
- **Technology Stack:** Hono, Node.js, TypeScript, PostgreSQL, JOSE, OpenAPIHono
- **Purpose:** Implementation guide specific to the Hono framework
- **Audience:** TypeScript developers, Backend engineers

---

## 1. Project Setup

### 1.1 Dependencies

```json
{
  "name": "expense-management-api",
  "version": "3.0.0",
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc",
    "start": "node dist/index.js",
    "test": "vitest",
    "migrate": "node-pg-migrate up",
    "lint": "eslint src --ext .ts"
  },
  "dependencies": {
    "hono": "^4.0.0",
    "@hono/zod-openapi": "^0.9.0",
    "jose": "^5.2.0",
    "zod": "^3.22.0",
    "pg": "^8.11.0",
    "bcrypt": "^5.1.1",
    "passport": "^0.7.0",
    "passport-google-oauth20": "^2.0.0",
    "passport-facebook": "^3.0.0",
    "@node-rs/argon2": "^1.7.0",
    "dotenv": "^16.4.0",
    "pino": "^8.17.0",
    "redis": "^4.6.0"
  },
  "devDependencies": {
    "@types/node": "^20.11.0",
    "@types/pg": "^8.10.0",
    "@types/bcrypt": "^5.0.2",
    "@types/passport": "^1.0.16",
    "@types/passport-google-oauth20": "^2.0.14",
    "@types/passport-facebook": "^3.0.3",
    "tsx": "^4.7.0",
    "typescript": "^5.3.0",
    "vitest": "^1.2.0",
    "eslint": "^8.56.0",
    "@typescript-eslint/eslint-plugin": "^6.19.0",
    "@typescript-eslint/parser": "^6.19.0",
    "node-pg-migrate": "^6.2.2"
  }
}
```

### 1.2 TypeScript Configuration

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "lib": ["ES2022"],
    "moduleResolution": "node",
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "**/*.test.ts"]
}
```

### 1.3 Environment Configuration

```env
# .env.example
NODE_ENV=development
PORT=3000

# Database
DATABASE_URL=postgresql://user:password@localhost:5432/expense_db
DATABASE_POOL_MIN=2
DATABASE_POOL_MAX=10

# JWT
JWT_SECRET=your-super-secret-key-change-in-production
JWT_ACCESS_EXPIRES_IN=900
JWT_REFRESH_EXPIRES_IN=604800

# Redis
REDIS_URL=redis://localhost:6379

# OAuth
GOOGLE_CLIENT_ID=your-google-client-id
GOOGLE_CLIENT_SECRET=your-google-client-secret
GOOGLE_CALLBACK_URL=http://localhost:3000/auth/google/callback

FACEBOOK_APP_ID=your-facebook-app-id
FACEBOOK_APP_SECRET=your-facebook-app-secret
FACEBOOK_CALLBACK_URL=http://localhost:3000/auth/facebook/callback

# Security
BCRYPT_ROUNDS=12
SESSION_CONCURRENT_LIMIT=5

# CORS
CORS_ORIGIN=http://localhost:5173
```

---

## 2. Database Setup (PostgreSQL)

### 2.1 Database Schema Migrations

Create `migrations/` directory and use node-pg-migrate:

```typescript
// migrations/1706342400000_initial_schema.ts
import { MigrationBuilder, ColumnDefinitions } from 'node-pg-migrate';

export const shorthands: ColumnDefinitions | undefined = undefined;

export async function up(pgm: MigrationBuilder): Promise<void> {
  // Enable extensions
  pgm.createExtension('pgcrypto', { ifNotExists: true });
  pgm.createExtension('uuid-ossp', { ifNotExists: true });

  // Users table
  pgm.createTable('users', {
    id: {
      type: 'uuid',
      primaryKey: true,
      default: pgm.func('gen_random_uuid()')
    },
    username: { type: 'varchar(255)', unique: true, notNull: true },
    email: { type: 'varchar(255)', unique: true, notNull: true },
    password_hash: { type: 'varchar(255)' },
    oauth_provider: { type: 'varchar(50)' },
    oauth_provider_id: { type: 'varchar(255)' },
    roles_version: { type: 'integer', notNull: true, default: 1 },
    is_active: { type: 'boolean', notNull: true, default: true },
    failed_login_attempts: { type: 'integer', notNull: true, default: 0 },
    locked_until: { type: 'timestamp' },
    last_login_at: { type: 'timestamp' },
    created_at: {
      type: 'timestamp',
      notNull: true,
      default: pgm.func('current_timestamp')
    },
    updated_at: {
      type: 'timestamp',
      notNull: true,
      default: pgm.func('current_timestamp')
    }
  });

  pgm.createIndex('users', 'email');
  pgm.createIndex('users', ['oauth_provider', 'oauth_provider_id']);

  // Refresh tokens table
  pgm.createTable('refresh_tokens', {
    id: {
      type: 'uuid',
      primaryKey: true,
      default: pgm.func('gen_random_uuid()')
    },
    user_id: {
      type: 'uuid',
      notNull: true,
      references: 'users',
      onDelete: 'CASCADE'
    },
    token_hash: { type: 'varchar(255)', unique: true, notNull: true },
    expires_at: { type: 'timestamp', notNull: true },
    revoked_at: { type: 'timestamp' },
    ip_address: { type: 'inet' },
    user_agent: { type: 'text' },
    last_used_at: { type: 'timestamp' },
    created_at: {
      type: 'timestamp',
      notNull: true,
      default: pgm.func('current_timestamp')
    }
  });

  pgm.createIndex('refresh_tokens', 'user_id');
  pgm.createIndex('refresh_tokens', 'token_hash');
  pgm.createIndex('refresh_tokens', 'expires_at');

  // Roles table
  pgm.createTable('roles', {
    id: {
      type: 'uuid',
      primaryKey: true,
      default: pgm.func('gen_random_uuid()')
    },
    name: { type: 'varchar(100)', unique: true, notNull: true },
    description: { type: 'text' },
    is_system: { type: 'boolean', notNull: true, default: false },
    created_at: {
      type: 'timestamp',
      notNull: true,
      default: pgm.func('current_timestamp')
    },
    updated_at: {
      type: 'timestamp',
      notNull: true,
      default: pgm.func('current_timestamp')
    }
  });

  // Permissions table
  pgm.createTable('permissions', {
    id: {
      type: 'uuid',
      primaryKey: true,
      default: pgm.func('gen_random_uuid()')
    },
    name: { type: 'varchar(255)', unique: true, notNull: true },
    description: { type: 'text' },
    category: { type: 'varchar(100)' },
    risk_level: { type: 'varchar(20)' },
    created_at: {
      type: 'timestamp',
      notNull: true,
      default: pgm.func('current_timestamp')
    }
  });

  // User roles (many-to-many)
  pgm.createTable('user_roles', {
    user_id: { type: 'uuid', notNull: true, references: 'users', onDelete: 'CASCADE' },
    role_id: { type: 'uuid', notNull: true, references: 'roles', onDelete: 'CASCADE' },
    assigned_at: {
      type: 'timestamp',
      notNull: true,
      default: pgm.func('current_timestamp')
    },
    assigned_by: { type: 'uuid', references: 'users' }
  });

  pgm.addConstraint('user_roles', 'user_roles_pkey', {
    primaryKey: ['user_id', 'role_id']
  });

  // Role permissions (many-to-many)
  pgm.createTable('role_permissions', {
    role_id: { type: 'uuid', notNull: true, references: 'roles', onDelete: 'CASCADE' },
    permission_id: { type: 'uuid', notNull: true, references: 'permissions', onDelete: 'CASCADE' },
    granted_at: {
      type: 'timestamp',
      notNull: true,
      default: pgm.func('current_timestamp')
    },
    granted_by: { type: 'uuid', references: 'users' }
  });

  pgm.addConstraint('role_permissions', 'role_permissions_pkey', {
    primaryKey: ['role_id', 'permission_id']
  });
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.dropTable('role_permissions');
  pgm.dropTable('user_roles');
  pgm.dropTable('permissions');
  pgm.dropTable('roles');
  pgm.dropTable('refresh_tokens');
  pgm.dropTable('users');
}
```

### 2.2 Database Connection Pool

```typescript
// src/db/pool.ts
import pg from 'pg';
import { config } from '../config';

const { Pool } = pg;

export const pool = new Pool({
  connectionString: config.database.url,
  min: config.database.poolMin,
  max: config.database.poolMax,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

pool.on('error', (err) => {
  console.error('Unexpected database error', err);
});

// Helper function for transactions
export async function withTransaction<T>(
  callback: (client: pg.PoolClient) => Promise<T>
): Promise<T> {
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
```

---

## 3. Authentication with JOSE

### 3.1 Token Service

```typescript
// src/services/token.service.ts
import * as jose from 'jose';
import { createHash } from 'crypto';
import { pool } from '../db/pool';
import { config } from '../config';

export interface TokenPayload {
  sub: string; // user_id
  username: string;
  email: string;
  roles: string[];
  rolesVersion: number;
  permissions: string[];
}

export class TokenService {
  private secret: Uint8Array;

  constructor() {
    this.secret = new TextEncoder().encode(config.jwt.secret);
  }

  async generateAccessToken(payload: TokenPayload): Promise<string> {
    const jwt = await new jose.SignJWT({
      username: payload.username,
      email: payload.email,
      roles: payload.roles,
      rolesVersion: payload.rolesVersion,
      permissions: payload.permissions,
    })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setIssuedAt()
      .setSubject(payload.sub)
      .setJti(crypto.randomUUID())
      .setExpirationTime(`${config.jwt.accessExpiresIn}s`)
      .sign(this.secret);

    return jwt;
  }

  async generateRefreshToken(
    userId: string,
    ipAddress: string,
    userAgent: string
  ): Promise<{ token: string; tokenId: string }> {
    const tokenId = crypto.randomUUID();
    const expiresIn = config.jwt.refreshExpiresIn;

    const token = await new jose.SignJWT({})
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setIssuedAt()
      .setSubject(userId)
      .setJti(tokenId)
      .setExpirationTime(`${expiresIn}s`)
      .sign(this.secret);

    // Store token hash in database
    const tokenHash = createHash('sha256').update(token).digest('hex');
    const expiresAt = new Date(Date.now() + expiresIn * 1000);

    await pool.query(
      `INSERT INTO refresh_tokens (id, user_id, token_hash, expires_at, ip_address, user_agent)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [tokenId, userId, tokenHash, expiresAt, ipAddress, userAgent]
    );

    return { token, tokenId };
  }

  async verifyAccessToken(token: string): Promise<jose.JWTPayload> {
    try {
      const { payload } = await jose.jwtVerify(token, this.secret);

      // Check roles version
      const result = await pool.query(
        'SELECT roles_version FROM users WHERE id = $1',
        [payload.sub]
      );

      if (result.rows.length === 0) {
        throw new Error('User not found');
      }

      if (result.rows[0].roles_version !== payload.rolesVersion) {
        throw new Error('Token roles version mismatch');
      }

      return payload;
    } catch (error) {
      if (error instanceof jose.errors.JWTExpired) {
        throw new Error('Token expired');
      }
      throw error;
    }
  }

  async verifyRefreshToken(token: string): Promise<string> {
    const { payload } = await jose.jwtVerify(token, this.secret);

    // Check if token exists and is not revoked
    const tokenHash = createHash('sha256').update(token).digest('hex');

    const result = await pool.query(
      `SELECT user_id, expires_at, revoked_at 
       FROM refresh_tokens 
       WHERE token_hash = $1`,
      [tokenHash]
    );

    if (result.rows.length === 0) {
      throw new Error('Invalid refresh token');
    }

    const tokenData = result.rows[0];

    if (tokenData.revoked_at) {
      throw new Error('Token has been revoked');
    }

    if (new Date(tokenData.expires_at) < new Date()) {
      throw new Error('Token expired');
    }

    // Update last used timestamp
    await pool.query(
      'UPDATE refresh_tokens SET last_used_at = NOW() WHERE token_hash = $1',
      [tokenHash]
    );

    return tokenData.user_id;
  }

  async revokeRefreshToken(tokenId: string): Promise<void> {
    await pool.query(
      'UPDATE refresh_tokens SET revoked_at = NOW() WHERE id = $1',
      [tokenId]
    );
  }

  async revokeAllUserTokens(userId: string): Promise<void> {
    await pool.query(
      'UPDATE refresh_tokens SET revoked_at = NOW() WHERE user_id = $1 AND revoked_at IS NULL',
      [userId]
    );
  }

  async cleanupExpiredTokens(): Promise<void> {
    await pool.query(
      'DELETE FROM refresh_tokens WHERE expires_at < NOW() - INTERVAL \'7 days\''
    );
  }
}
```

---

## 4. Hono App Setup with OpenAPIHono

### 4.1 Main Application

```typescript
// src/index.ts
import { OpenAPIHono } from '@hono/zod-openapi';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { prettyJSON } from 'hono/pretty-json';
import { config } from './config';
import { authMiddleware } from './middleware/auth';
import { errorHandler } from './middleware/error';
import { rateLimiter } from './middleware/rate-limit';

// Route imports
import authRoutes from './routes/auth.routes';
import reportRoutes from './routes/report.routes';
import roleRoutes from './routes/role.routes';
import userRoutes from './routes/user.routes';
import workflowRoutes from './routes/workflow.routes';

const app = new OpenAPIHono();

// Global middleware
app.use('*', logger());
app.use('*', prettyJSON());
app.use('*', cors({
  origin: config.cors.origin,
  credentials: true,
}));

// Rate limiting
app.use('*', rateLimiter);

// Health check
app.get('/health', (c) => {
  return c.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Routes
app.route('/auth', authRoutes);
app.route('/reports', reportRoutes);
app.route('/roles', roleRoutes);
app.route('/users', userRoutes);
app.route('/workflows', workflowRoutes);

// OpenAPI documentation
app.doc('/openapi.json', {
  openapi: '3.0.0',
  info: {
    version: '3.0.0',
    title: 'Expense Management API',
  },
});

// Error handler (must be last)
app.onError(errorHandler);

// 404 handler
app.notFound((c) => {
  return c.json({ error: 'Not Found' }, 404);
});

export default {
  port: config.port,
  fetch: app.fetch,
};
```

### 4.2 Configuration Management

```typescript
// src/config/index.ts
import { config as dotenvConfig } from 'dotenv';

dotenvConfig();

export const config = {
  env: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT || '3000', 10),
  
  database: {
    url: process.env.DATABASE_URL!,
    poolMin: parseInt(process.env.DATABASE_POOL_MIN || '2', 10),
    poolMax: parseInt(process.env.DATABASE_POOL_MAX || '10', 10),
  },
  
  jwt: {
    secret: process.env.JWT_SECRET!,
    accessExpiresIn: parseInt(process.env.JWT_ACCESS_EXPIRES_IN || '900', 10),
    refreshExpiresIn: parseInt(process.env.JWT_REFRESH_EXPIRES_IN || '604800', 10),
  },
  
  redis: {
    url: process.env.REDIS_URL || 'redis://localhost:6379',
  },
  
  oauth: {
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      callbackURL: process.env.GOOGLE_CALLBACK_URL!,
    },
    facebook: {
      appId: process.env.FACEBOOK_APP_ID!,
      appSecret: process.env.FACEBOOK_APP_SECRET!,
      callbackURL: process.env.FACEBOOK_CALLBACK_URL!,
    },
  },
  
  security: {
    bcryptRounds: parseInt(process.env.BCRYPT_ROUNDS || '12', 10),
    sessionConcurrentLimit: parseInt(process.env.SESSION_CONCURRENT_LIMIT || '5', 10),
  },
  
  cors: {
    origin: process.env.CORS_ORIGIN || 'http://localhost:5173',
  },
};

// Validate required config
const requiredEnvVars = [
  'DATABASE_URL',
  'JWT_SECRET',
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
  'FACEBOOK_APP_ID',
  'FACEBOOK_APP_SECRET',
];

for (const envVar of requiredEnvVars) {
  if (!process.env[envVar]) {
    throw new Error(`Missing required environment variable: ${envVar}`);
  }
}
```

---

## 5. Authentication Middleware

### 5.1 JWT Authentication Middleware

```typescript
// src/middleware/auth.ts
import { Context, Next } from 'hono';
import { TokenService } from '../services/token.service';
import { pool } from '../db/pool';

const tokenService = new TokenService();

export interface AuthUser {
  id: string;
  username: string;
  email: string;
  roles: string[];
  permissions: string[];
}

export async function authMiddleware(c: Context, next: Next) {
  const authHeader = c.req.header('Authorization');

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return c.json({ error: 'AUTHENTICATION_REQUIRED', message: 'No token provided' }, 401);
  }

  const token = authHeader.substring(7);

  try {
    const payload = await tokenService.verifyAccessToken(token);

    // Attach user to context
    c.set('user', {
      id: payload.sub!,
      username: payload.username as string,
      email: payload.email as string,
      roles: payload.roles as string[],
      permissions: payload.permissions as string[],
    } as AuthUser);

    await next();
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid token';
    
    if (message === 'Token roles version mismatch') {
      return c.json(
        { error: 'SESSION_REVOKED', message: 'Your permissions have been updated. Please log in again.' },
        401
      );
    }

    return c.json({ error: 'AUTHENTICATION_FAILED', message }, 401);
  }
}

// Permission checking middleware factory
export function requirePermission(...permissions: string[]) {
  return async (c: Context, next: Next) => {
    const user = c.get('user') as AuthUser | undefined;

    if (!user) {
      return c.json({ error: 'AUTHENTICATION_REQUIRED' }, 401);
    }

    const hasPermission = permissions.every(p => user.permissions.includes(p));

    if (!hasPermission) {
      return c.json(
        {
          error: 'INSUFFICIENT_PERMISSIONS',
          message: 'You do not have permission to perform this action',
          required: permissions,
        },
        403
      );
    }

    await next();
  };
}

// Role checking middleware factory
export function requireRole(...roles: string[]) {
  return async (c: Context, next: Next) => {
    const user = c.get('user') as AuthUser | undefined;

    if (!user) {
      return c.json({ error: 'AUTHENTICATION_REQUIRED' }, 401);
    }

    const hasRole = roles.some(r => user.roles.includes(r));

    if (!hasRole) {
      return c.json(
        {
          error: 'INSUFFICIENT_PERMISSIONS',
          message: 'You do not have the required role',
          required: roles,
        },
        403
      );
    }

    await next();
  };
}
```

---

## 6. Authentication Routes with OpenAPIHono

### 6.1 Authentication Schemas (Zod)

```typescript
// src/schemas/auth.schema.ts
import { z } from 'zod';
import { createRoute } from '@hono/zod-openapi';

export const RegisterSchema = z.object({
  username: z.string().min(3).max(50),
  email: z.string().email(),
  password: z.string().min(12).regex(
    /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])/,
    'Password must contain uppercase, lowercase, number, and special character'
  ),
});

export const LoginSchema = z.object({
  username: z.string(),
  password: z.string(),
});

export const TokenResponseSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  tokenType: z.literal('Bearer'),
  expiresIn: z.number(),
});

export const RefreshTokenSchema = z.object({
  refreshToken: z.string(),
});

// Route definitions for OpenAPI
export const registerRoute = createRoute({
  method: 'post',
  path: '/register',
  request: {
    body: {
      content: {
        'application/json': {
          schema: RegisterSchema,
        },
      },
    },
  },
  responses: {
    201: {
      content: {
        'application/json': {
          schema: TokenResponseSchema,
        },
      },
      description: 'User registered successfully',
    },
    400: {
      description: 'Validation error',
    },
    409: {
      description: 'User already exists',
    },
  },
  tags: ['Authentication'],
});

export const loginRoute = createRoute({
  method: 'post',
  path: '/login',
  request: {
    body: {
      content: {
        'application/json': {
          schema: LoginSchema,
        },
      },
    },
  },
  responses: {
    200: {
      content: {
        'application/json': {
          schema: TokenResponseSchema,
        },
      },
      description: 'Login successful',
    },
    401: {
      description: 'Invalid credentials',
    },
    423: {
      description: 'Account locked',
    },
  },
  tags: ['Authentication'],
});
```

### 6.2 Authentication Controller

```typescript
// src/controllers/auth.controller.ts
import { Context } from 'hono';
import { hash, compare } from '@node-rs/argon2';
import { pool, withTransaction } from '../db/pool';
import { TokenService } from '../services/token.service';
import { config } from '../config';

const tokenService = new TokenService();

export class AuthController {
  async register(c: Context) {
    const { username, email, password } = await c.req.json();

    // Check if user exists
    const existingUser = await pool.query(
      'SELECT id FROM users WHERE username = $1 OR email = $2',
      [username, email]
    );

    if (existingUser.rows.length > 0) {
      return c.json({ error: 'User already exists' }, 409);
    }

    // Hash password
    const passwordHash = await hash(password, {
      memoryCost: 19456,
      timeCost: 2,
      outputLen: 32,
      parallelism: 1,
    });

    // Create user
    const result = await withTransaction(async (client) => {
      const userResult = await client.query(
        `INSERT INTO users (username, email, password_hash) 
         VALUES ($1, $2, $3) 
         RETURNING id, username, email, roles_version`,
        [username, email, passwordHash]
      );

      const user = userResult.rows[0];

      // Assign default "Employee" role
      const roleResult = await client.query(
        'SELECT id FROM roles WHERE name = $1',
        ['employee']
      );

      if (roleResult.rows.length > 0) {
        await client.query(
          'INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2)',
          [user.id, roleResult.rows[0].id]
        );
      }

      return user;
    });

    // Generate tokens
    const user = result;
    const { roles, permissions } = await this.getUserRolesAndPermissions(user.id);

    const accessToken = await tokenService.generateAccessToken({
      sub: user.id,
      username: user.username,
      email: user.email,
      roles,
      rolesVersion: user.roles_version,
      permissions,
    });

    const { token: refreshToken } = await tokenService.generateRefreshToken(
      user.id,
      c.req.header('x-forwarded-for') || c.req.header('x-real-ip') || '',
      c.req.header('user-agent') || ''
    );

    return c.json(
      {
        accessToken,
        refreshToken,
        tokenType: 'Bearer',
        expiresIn: config.jwt.accessExpiresIn,
      },
      201
    );
  }

  async login(c: Context) {
    const { username, password } = await c.req.json();

    // Get user
    const result = await pool.query(
      `SELECT id, username, email, password_hash, roles_version, 
              failed_login_attempts, locked_until, is_active
       FROM users 
       WHERE username = $1 OR email = $1`,
      [username]
    );

    if (result.rows.length === 0) {
      // Prevent user enumeration - same error for invalid user/password
      await new Promise(resolve => setTimeout(resolve, 500 + Math.random() * 500));
      return c.json({ error: 'Invalid credentials' }, 401);
    }

    const user = result.rows[0];

    // Check if account is active
    if (!user.is_active) {
      return c.json({ error: 'Account is deactivated' }, 403);
    }

    // Check if account is locked
    if (user.locked_until && new Date(user.locked_until) > new Date()) {
      return c.json(
        {
          error: 'Account is locked',
          message: 'Too many failed login attempts. Please try again later.',
          lockedUntil: user.locked_until,
        },
        423
      );
    }

    // Verify password
    const isValidPassword = await compare(password, user.password_hash);

    if (!isValidPassword) {
      // Increment failed attempts
      const newAttempts = user.failed_login_attempts + 1;
      let lockedUntil = null;

      if (newAttempts >= 5) {
        // Lock account for 15 minutes
        lockedUntil = new Date(Date.now() + 15 * 60 * 1000);
      }

      await pool.query(
        'UPDATE users SET failed_login_attempts = $1, locked_until = $2 WHERE id = $3',
        [newAttempts, lockedUntil, user.id]
      );

      return c.json({ error: 'Invalid credentials' }, 401);
    }

    // Reset failed attempts
    await pool.query(
      'UPDATE users SET failed_login_attempts = 0, locked_until = NULL, last_login_at = NOW() WHERE id = $1',
      [user.id]
    );

    // Check concurrent session limit
    await this.enforceConcurrentSessionLimit(user.id);

    // Get roles and permissions
    const { roles, permissions } = await this.getUserRolesAndPermissions(user.id);

    // Generate tokens
    const accessToken = await tokenService.generateAccessToken({
      sub: user.id,
      username: user.username,
      email: user.email,
      roles,
      rolesVersion: user.roles_version,
      permissions,
    });

    const { token: refreshToken } = await tokenService.generateRefreshToken(
      user.id,
      c.req.header('x-forwarded-for') || c.req.header('x-real-ip') || '',
      c.req.header('user-agent') || ''
    );

    return c.json({
      accessToken,
      refreshToken,
      tokenType: 'Bearer',
      expiresIn: config.jwt.accessExpiresIn,
    });
  }

  async refresh(c: Context) {
    const { refreshToken } = await c.req.json();

    try {
      const userId = await tokenService.verifyRefreshToken(refreshToken);

      // Get user info
      const result = await pool.query(
        'SELECT username, email, roles_version FROM users WHERE id = $1',
        [userId]
      );

      if (result.rows.length === 0) {
        return c.json({ error: 'User not found' }, 404);
      }

      const user = result.rows[0];
      const { roles, permissions } = await this.getUserRolesAndPermissions(userId);

      // Generate new access token
      const accessToken = await tokenService.generateAccessToken({
        sub: userId,
        username: user.username,
        email: user.email,
        roles,
        rolesVersion: user.roles_version,
        permissions,
      });

      // Rotate refresh token
      const { token: newRefreshToken } = await tokenService.generateRefreshToken(
        userId,
        c.req.header('x-forwarded-for') || c.req.header('x-real-ip') || '',
        c.req.header('user-agent') || ''
      );

      // Revoke old refresh token
      const tokenHash = require('crypto').createHash('sha256').update(refreshToken).digest('hex');
      await pool.query(
        'UPDATE refresh_tokens SET revoked_at = NOW() WHERE token_hash = $1',
        [tokenHash]
      );

      return c.json({
        accessToken,
        refreshToken: newRefreshToken,
        tokenType: 'Bearer',
        expiresIn: config.jwt.accessExpiresIn,
      });
    } catch (error) {
      return c.json({ error: 'Invalid refresh token' }, 401);
    }
  }

  async logout(c: Context) {
    const { refreshToken } = await c.req.json();

    const tokenHash = require('crypto').createHash('sha256').update(refreshToken).digest('hex');
    await pool.query(
      'UPDATE refresh_tokens SET revoked_at = NOW() WHERE token_hash = $1',
      [tokenHash]
    );

    return c.json({ message: 'Logged out successfully' });
  }

  private async getUserRolesAndPermissions(userId: string) {
    const result = await pool.query(
      `SELECT DISTINCT r.name as role_name, p.name as permission_name
       FROM users u
       JOIN user_roles ur ON u.id = ur.user_id
       JOIN roles r ON ur.role_id = r.id
       LEFT JOIN role_permissions rp ON r.id = rp.role_id
       LEFT JOIN permissions p ON rp.permission_id = p.id
       WHERE u.id = $1`,
      [userId]
    );

    const roles = [...new Set(result.rows.map(r => r.role_name))];
    const permissions = [...new Set(result.rows.map(r => r.permission_name).filter(Boolean))];

    return { roles, permissions };
  }

  private async enforceConcurrentSessionLimit(userId: string) {
    const result = await pool.query(
      `SELECT id FROM refresh_tokens 
       WHERE user_id = $1 AND revoked_at IS NULL AND expires_at > NOW()
       ORDER BY created_at DESC`,
      [userId]
    );

    const activeTokens = result.rows;
    const limit = config.security.sessionConcurrentLimit;

    if (activeTokens.length >= limit) {
      // Revoke oldest tokens
      const tokensToRevoke = activeTokens.slice(limit - 1);
      const tokenIds = tokensToRevoke.map(t => t.id);

      await pool.query(
        'UPDATE refresh_tokens SET revoked_at = NOW() WHERE id = ANY($1)',
        [tokenIds]
      );
    }
  }
}
```

---

## 7. OAuth2 Integration

### 7.1 Google OAuth

```typescript
// src/services/oauth.service.ts
import { Context } from 'hono';
import { pool, withTransaction } from '../db/pool';
import { TokenService } from './token.service';
import { config } from '../config';

interface GoogleUserInfo {
  id: string;
  email: string;
  name: string;
  picture?: string;
}

interface FacebookUserInfo {
  id: string;
  email: string;
  name: string;
}

const tokenService = new TokenService();

export class OAuthService {
  async handleGoogleCallback(code: string, c: Context) {
    // Exchange code for tokens
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code,
        client_id: config.oauth.google.clientId,
        client_secret: config.oauth.google.clientSecret,
        redirect_uri: config.oauth.google.callbackURL,
        grant_type: 'authorization_code',
      }),
    });

    if (!tokenResponse.ok) {
      throw new Error('Failed to exchange code for token');
    }

    const { access_token } = await tokenResponse.json();

    // Get user info
    const userInfoResponse = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${access_token}` },
    });

    if (!userInfoResponse.ok) {
      throw new Error('Failed to get user info');
    }

    const userInfo: GoogleUserInfo = await userInfoResponse.json();

    // Find or create user
    const user = await this.findOrCreateOAuthUser(
      'google',
      userInfo.id,
      userInfo.email,
      userInfo.name
    );

    // Generate tokens
    const authController = new (await import('../controllers/auth.controller')).AuthController();
    const { roles, permissions } = await (authController as any).getUserRolesAndPermissions(user.id);

    const accessToken = await tokenService.generateAccessToken({
      sub: user.id,
      username: user.username,
      email: user.email,
      roles,
      rolesVersion: user.roles_version,
      permissions,
    });

    const { token: refreshToken } = await tokenService.generateRefreshToken(
      user.id,
      c.req.header('x-forwarded-for') || '',
      c.req.header('user-agent') || ''
    );

    return { accessToken, refreshToken };
  }

  async handleFacebookCallback(code: string, c: Context) {
    // Exchange code for tokens
    const tokenResponse = await fetch(
      `https://graph.facebook.com/v18.0/oauth/access_token?` +
      `client_id=${config.oauth.facebook.appId}&` +
      `client_secret=${config.oauth.facebook.appSecret}&` +
      `code=${code}&` +
      `redirect_uri=${encodeURIComponent(config.oauth.facebook.callbackURL)}`
    );

    if (!tokenResponse.ok) {
      throw new Error('Failed to exchange code for token');
    }

    const { access_token } = await tokenResponse.json();

    // Get user info
    const userInfoResponse = await fetch(
      `https://graph.facebook.com/me?fields=id,name,email&access_token=${access_token}`
    );

    if (!userInfoResponse.ok) {
      throw new Error('Failed to get user info');
    }

    const userInfo: FacebookUserInfo = await userInfoResponse.json();

    if (!userInfo.email) {
      throw new Error('Email not provided by Facebook');
    }

    // Find or create user
    const user = await this.findOrCreateOAuthUser(
      'facebook',
      userInfo.id,
      userInfo.email,
      userInfo.name
    );

    // Generate tokens
    const authController = new (await import('../controllers/auth.controller')).AuthController();
    const { roles, permissions } = await (authController as any).getUserRolesAndPermissions(user.id);

    const accessToken = await tokenService.generateAccessToken({
      sub: user.id,
      username: user.username,
      email: user.email,
      roles,
      rolesVersion: user.roles_version,
      permissions,
    });

    const { token: refreshToken } = await tokenService.generateRefreshToken(
      user.id,
      c.req.header('x-forwarded-for') || '',
      c.req.header('user-agent') || ''
    );

    return { accessToken, refreshToken };
  }

  private async findOrCreateOAuthUser(
    provider: string,
    providerId: string,
    email: string,
    name: string
  ) {
    return withTransaction(async (client) => {
      // Check if user exists with this OAuth provider
      let result = await client.query(
        'SELECT * FROM users WHERE oauth_provider = $1 AND oauth_provider_id = $2',
        [provider, providerId]
      );

      if (result.rows.length > 0) {
        return result.rows[0];
      }

      // Check if user exists with this email
      result = await client.query(
        'SELECT * FROM users WHERE email = $1',
        [email]
      );

      if (result.rows.length > 0) {
        // Link OAuth to existing account
        await client.query(
          'UPDATE users SET oauth_provider = $1, oauth_provider_id = $2 WHERE id = $3',
          [provider, providerId, result.rows[0].id]
        );
        return result.rows[0];
      }

      // Create new user
      const username = email.split('@')[0] + '_' + Math.random().toString(36).substring(7);
      
      const userResult = await client.query(
        `INSERT INTO users (username, email, oauth_provider, oauth_provider_id)
         VALUES ($1, $2, $3, $4)
         RETURNING *`,
        [username, email, provider, providerId]
      );

      const user = userResult.rows[0];

      // Assign default role
      const roleResult = await client.query(
        'SELECT id FROM roles WHERE name = $1',
        ['employee']
      );

      if (roleResult.rows.length > 0) {
        await client.query(
          'INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2)',
          [user.id, roleResult.rows[0].id]
        );
      }

      return user;
    });
  }
}
```

---

## 8. Rate Limiting

```typescript
// src/middleware/rate-limit.ts
import { Context, Next } from 'hono';
import { createClient } from 'redis';
import { config } from '../config';

const redis = createClient({ url: config.redis.url });
redis.connect();

export async function rateLimiter(c: Context, next: Next) {
  const identifier = c.get('user')?.id || c.req.header('x-forwarded-for') || c.req.header('x-real-ip') || 'unknown';
  const path = new URL(c.req.url).pathname;

  // Different limits for different endpoints
  let limit = 100;
  let window = 60; // seconds

  if (path.startsWith('/auth/')) {
    limit = 5;
    window = 900; // 15 minutes
  }

  const key = `rate_limit:${path}:${identifier}`;
  const now = Date.now();
  const windowStart = now - window * 1000;

  // Remove old entries
  await redis.zRemRangeByScore(key, 0, windowStart);

  // Count requests in window
  const count = await redis.zCard(key);

  if (count >= limit) {
    const oldest = await redis.zRange(key, 0, 0, { REV: false });
    const resetTime = oldest.length > 0 ? parseInt(oldest[0]) + window * 1000 : now + window * 1000;

    c.header('X-RateLimit-Limit', limit.toString());
    c.header('X-RateLimit-Remaining', '0');
    c.header('X-RateLimit-Reset', Math.floor(resetTime / 1000).toString());
    c.header('Retry-After', Math.ceil((resetTime - now) / 1000).toString());

    return c.json({ error: 'RATE_LIMIT_EXCEEDED', message: 'Too many requests' }, 429);
  }

  // Add current request
  await redis.zAdd(key, { score: now, value: now.toString() });
  await redis.expire(key, window);

  c.header('X-RateLimit-Limit', limit.toString());
  c.header('X-RateLimit-Remaining', (limit - count - 1).toString());
  c.header('X-RateLimit-Reset', Math.floor((now + window * 1000) / 1000).toString());

  await next();
}
```

---

## 9. Error Handling

```typescript
// src/middleware/error.ts
import { Context } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { ZodError } from 'zod';

export function errorHandler(err: Error, c: Context) {
  console.error('Error:', err);

  if (err instanceof HTTPException) {
    return err.getResponse();
  }

  if (err instanceof ZodError) {
    return c.json(
      {
        error: 'VALIDATION_ERROR',
        message: 'Invalid request data',
        details: err.errors,
      },
      400
    );
  }

  // Database errors
  if (err.message.includes('duplicate key')) {
    return c.json(
      {
        error: 'CONFLICT',
        message: 'Resource already exists',
      },
      409
    );
  }

  // Generic error
  return c.json(
    {
      error: 'INTERNAL_SERVER_ERROR',
      message: config.env === 'production' ? 'An error occurred' : err.message,
    },
    500
  );
}
```

---

## Appendices

### Appendix A: Complete Route Example

```typescript
// src/routes/auth.routes.ts
import { OpenAPIHono } from '@hono/zod-openapi';
import { AuthController } from '../controllers/auth.controller';
import { registerRoute, loginRoute } from '../schemas/auth.schema';

const auth = new OpenAPIHono();
const authController = new AuthController();

auth.openapi(registerRoute, (c) => authController.register(c));
auth.openapi(loginRoute, (c) => authController.login(c));

auth.post('/refresh', (c) => authController.refresh(c));
auth.post('/logout', (c) => authController.logout(c));

export default auth;
```

### Appendix B: Testing Example

```typescript
// tests/auth.test.ts
import { describe, it, expect } from 'vitest';
import app from '../src/index';

describe('Auth API', () => {
  it('should register a new user', async () => {
    const res = await app.request('/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'testuser',
        email: 'test@example.com',
        password: 'SecureP@ssw0rd123',
      }),
    });

    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data).toHaveProperty('accessToken');
    expect(data).toHaveProperty('refreshToken');
  });
});
```

---

**Document End**
