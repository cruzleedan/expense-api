# Expense API — Project Guide

Backend REST API for expense management.
**Stack:** TypeScript · Hono (OpenAPIHono) · PostgreSQL (raw SQL via `pg`) · JWT auth · Zod validation

## Directory Structure

```
src/
├── app.ts              # Middleware chain, route mounting
├── index.ts            # Server entry point
├── config/env.ts       # Env var validation (Zod schema)
├── db/client.ts        # query(), transaction(), pool config
├── db/schema.sql       # Full DB schema
├── middleware/          # auth, permission, errorHandler, camelCase, rateLimit
├── routes/             # OpenAPIHono route definitions
├── services/           # Business logic + raw SQL queries
├── schemas/            # Zod schemas with .openapi() registration
├── types/index.ts      # DB interfaces (snake_case), error classes, JWT types
├── utils/              # logger, pagination, caseTransform, hash
├── jobs/               # Cron jobs (node-cron)
└── storage/            # File storage abstraction (local/S3)
```

## Critical Rules

### ESM Imports — Always use `.js` extension

```typescript
import { query } from '../db/client.js';           // ✅
import { getUserById } from '../services/user.service.js'; // ✅
import { query } from '../db/client';              // ❌ will fail at runtime
```

### Named Exports Only — No default exports anywhere

```typescript
export { usersRouter };                 // ✅
export async function createUser() {}   // ✅
export default usersRouter;             // ❌ never
```

### Use `type` imports for type-only imports

```typescript
import type { MiddlewareHandler } from 'hono';     // ✅
import type { User } from '../types/index.js';     // ✅
```

---

## Route Pattern

Routes use `OpenAPIHono` + `createRoute`. Every route MUST have: `tags`, `summary`, `description`, `security`, and typed response schemas.

```typescript
import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import { authMiddleware, getUserId } from '../middleware/auth.js';
import { requirePermission } from '../middleware/permission.js';
import { CreateWidgetSchema, WidgetSchema } from '../schemas/widget.js';
import { ErrorSchema, AuthHeaderSchema } from '../schemas/common.js';

const widgetsRouter = new OpenAPIHono();
widgetsRouter.use('*', authMiddleware);

const security = [{ Bearer: [] }];

const createWidgetRoute = createRoute({
  method: 'post',
  path: '/',
  tags: ['Widgets'],                            // required
  summary: 'Create a widget',                   // required
  description: 'Creates a new widget resource', // required
  security,                                     // required for protected routes
  request: {
    headers: AuthHeaderSchema,
    body: { content: { 'application/json': { schema: CreateWidgetSchema } } },
  },
  responses: {
    201: {
      description: 'Widget created',
      content: { 'application/json': { schema: WidgetSchema } },
    },
    400: { description: 'Validation error', content: { 'application/json': { schema: ErrorSchema } } },
    401: { description: 'Unauthorized', content: { 'application/json': { schema: ErrorSchema } } },
  },
});

// Handler is thin — delegates to service
widgetsRouter.openapi(createWidgetRoute, async (c) => {
  const userId = getUserId(c);        // ✅ use helper
  const body = c.req.valid('json');
  const widget = await createWidget(userId, body);
  return c.json(widget, 201);
});

// Permission middleware applied per-route
widgetsRouter.use('/admin-only', requirePermission('widget.admin'));

export { widgetsRouter };
```

### Route DON'Ts

```typescript
const userId = c.get('userId');        // ❌ use getUserId(c) helper
// ❌ business logic in route handler — move to service
widgetsRouter.openapi(route, async (c) => {
  const result = await query('INSERT INTO widgets ...');
  return c.json(result.rows[0]);
});
// ❌ missing tags/summary/description/security on createRoute
// ❌ adding global middleware inside route files (put in app.ts)
```

---

## Service Pattern

File naming: `{resource}.service.ts`. Services contain all business logic and DB queries.

```typescript
import { query, transaction } from '../db/client.js';
import { NotFoundError, ConflictError } from '../types/index.js';

export interface CreateWidgetInput {
  name: string;
  description?: string;
}

// Returns camelCase (manually converted from snake_case DB result)
export async function createWidget(userId: string, input: CreateWidgetInput) {
  const existing = await query('SELECT id FROM widgets WHERE name = $1', [input.name]);
  if (existing.rows.length > 0) throw new ConflictError('Widget name already taken');

  const result = await query(
    `INSERT INTO widgets (user_id, name, description, created_at, updated_at)
     VALUES ($1, $2, $3, NOW(), NOW())
     RETURNING *`,
    [userId, input.name, input.description ?? null]
  );

  const row = result.rows[0];
  return {
    id: row.id,
    userId: row.user_id,            // ✅ snake→camel conversion
    name: row.name,
    description: row.description,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// Transaction example
export async function transferWidget(widgetId: string, newOwnerId: string) {
  await transaction(async (client) => {
    await client.query('UPDATE widgets SET user_id = $1 WHERE id = $2', [newOwnerId, widgetId]);
    await client.query(
      'INSERT INTO audit_logs (action, entity_type, entity_id) VALUES ($1, $2, $3)',
      ['transfer', 'widget', widgetId]
    );
  });
}
```

### Service DON'Ts

```typescript
return result.rows[0];              // ❌ returns snake_case — convert to camelCase
await query(`SELECT * FROM widgets WHERE name = '${name}'`); // ❌ SQL injection
import { PrismaClient } from '@prisma/client'; // ❌ no ORM — raw SQL only
const pool = new Pool({...});       // ❌ don't create connections — use query()/transaction()
throw new Error('Not found');       // ❌ use NotFoundError, ConflictError, etc.
```

---

## Schema Pattern

File naming: `{resource}.ts` in `src/schemas/`. All schemas MUST call `.openapi()`.

```typescript
import { z } from '@hono/zod-openapi';

export const WidgetSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  name: z.string(),
  createdAt: z.string().datetime(),
}).openapi('Widget');               // ✅ required — registers with OpenAPI

export const CreateWidgetSchema = z.object({
  name: z.string().min(1).max(255).openapi({ example: 'My Widget' }),
  description: z.string().max(2000).optional(),
}).openapi('CreateWidget');

// Query param transforms: string → number
export const ListQuerySchema = z.object({
  page: z.string().regex(/^\d+$/).transform(Number).pipe(z.number().int().positive()).default('1'),
  limit: z.string().regex(/^\d+$/).transform(Number).pipe(z.number().int().min(1).max(100)).default('20'),
  search: z.string().max(255).optional(),
});
```

Common schemas are in `src/schemas/common.ts`: `ErrorSchema`, `AuthHeaderSchema`, `UuidParamSchema`, `PaginationMetaSchema`, `MessageSchema`.

---

## Case Convention

| Layer | Convention | Example |
|-------|-----------|---------|
| DB columns | `snake_case` | `user_id`, `created_at` |
| TypeScript DB types (`src/types/`) | `snake_case` | `interface User { is_active: boolean }` |
| Service return values | `camelCase` | `{ userId, createdAt }` |
| API responses | `camelCase` | Automatic via `camelCaseResponse` middleware |
| Zod schemas | `camelCase` | `z.object({ userId: z.string() })` |

Services MUST manually convert snake→camel. The `camelCaseResponse` middleware also transforms, but services should return clean camelCase regardless.

---

## Error Handling

Always throw AppError subclasses from `src/types/index.ts`:

```typescript
throw new NotFoundError('Widget');                  // 404
throw new ConflictError('Email already registered');// 409
throw new ValidationError('Invalid date format');   // 400
throw new ForbiddenError('Insufficient permissions');// 403
throw new UnauthorizedError('Token expired');       // 401
```

These are caught by `errorHandler` middleware and returned as:
```json
{ "error": { "message": "Widget not found", "code": "NOT_FOUND" } }
```

---

## Auth & Permissions

```typescript
import { authMiddleware, getUserId } from '../middleware/auth.js';
import { requirePermission, requireAnyPermission, requireRole } from '../middleware/permission.js';

router.use('*', authMiddleware);                              // all routes need auth
router.use('/admin-action', requirePermission('widget.admin')); // ALL listed perms required
router.use('/view', requireAnyPermission('widget.view', 'widget.admin')); // ANY perm sufficient
router.use('/super', requireRole('admin'));                    // role-based
```

---

## Pagination

```typescript
import { paginate, getOffset, buildOrderByClause } from '../utils/pagination.js';

const offset = getOffset(params.page, params.limit);
const orderBy = buildOrderByClause(params.sortBy, params.sortOrder, SORTABLE_FIELDS);

const result = await query(`SELECT * FROM widgets ORDER BY ${orderBy} LIMIT $1 OFFSET $2`, [params.limit, offset]);
const countResult = await query('SELECT COUNT(*)::int AS count FROM widgets');

// In route handler:
return c.json(paginate(items, total, params), 200);
```

---

## Middleware Order (in app.ts)

```
secureHeaders → cors → honoLogger → errorHandler → camelCaseResponse → rateLimit → [route-specific: auth → permissions]
```

Don't add global middleware inside route files. Route-level middleware (`authMiddleware`, `requirePermission`) is applied within route files.

---

## Key Reference Files

| Pattern | File |
|---------|------|
| App setup & middleware | `src/app.ts` |
| Route example | `src/routes/users.ts` |
| Service example | `src/services/user.service.ts` |
| Schema example | `src/schemas/user.ts` |
| DB client | `src/db/client.ts` |
| Auth middleware | `src/middleware/auth.ts` |
| Permission middleware | `src/middleware/permission.ts` |
| Error classes | `src/types/index.ts` |
| Pagination utility | `src/utils/pagination.ts` |
| Env config | `src/config/env.ts` |
| Full DB schema | `src/db/schema.sql` |
| Logger | `src/utils/logger.ts` |

---

## Common Commands

```bash
npm run dev              # Start with hot reload (tsx watch)
npm run build            # Compile TypeScript
npm start                # Run compiled (production)

# Docker (from project root)
docker compose -f compose.dev.yaml up -d
docker compose logs -f expense-api

# Database
psql $DATABASE_URL -f src/db/schema.sql   # Apply schema
```

---

## Checklist for New Code

- [ ] All local imports have `.js` extension
- [ ] Named exports only (no `export default`)
- [ ] `type` keyword on type-only imports
- [ ] Routes have tags, summary, description, security, response schemas
- [ ] Route handlers are thin — logic is in services
- [ ] Services return camelCase (not raw snake_case DB rows)
- [ ] SQL uses parameterized queries ($1, $2)
- [ ] Errors use AppError subclasses (not generic Error)
- [ ] `getUserId(c)` helper used (not `c.get('userId')`)
- [ ] Admin endpoints have permission middleware
- [ ] Zod schemas call `.openapi('Name')`
- [ ] No `any` types
