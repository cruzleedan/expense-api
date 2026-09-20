---
name: add-endpoint
description: "Add a new API endpoint to expense-api following the OpenAPIHono + Zod pattern."
applies-to: expense-api
---

## When to invoke

Any time a new HTTP endpoint is needed in `expense-api`.

If the endpoint is part of an accepted work item, read and follow
`context/reference/implementation-playbook.md` first.

## Steps

### 1. Create the Zod schema (`src/schemas/`)

```typescript
// src/schemas/widget.ts
import { z } from '@hono/zod-openapi';

export const CreateWidgetSchema = z.object({
  name: z.string().min(1).max(100),
}).strict().openapi('CreateWidget');

export const WidgetSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  createdAt: z.string().datetime(),
}).openapi('Widget');
```

Always import `z` from `@hono/zod-openapi`, never directly from `zod`. With the
currently pinned integration, attach `.openapi()` before `.superRefine()` or
another operation that returns `ZodEffects`.

### 2. Create (or extend) the route file (`src/routes/`)

```typescript
import { createRoute, z } from '@hono/zod-openapi';
import { OpenAPIHono } from '@hono/zod-openapi';
import { authMiddleware, getUserId } from '../middleware/auth.js';
import { requirePermission } from '../middleware/permission.js';
import { CreateWidgetSchema, WidgetSchema } from '../schemas/widget.js';
import { ErrorSchema } from '../schemas/common.js';

const router = new OpenAPIHono();
router.use('*', authMiddleware);

const createWidgetRoute = createRoute({
  method: 'post',
  path: '/widgets',
  tags: ['Widgets'],
  summary: 'Create a widget',
  description: 'Creates a new widget for the authenticated user.',
  security: [{ Bearer: [] }],
  middleware: [requirePermission('widget.create')] as const,
  request: {
    body: { content: { 'application/json': { schema: CreateWidgetSchema } } },
  },
  responses: {
    201: { content: { 'application/json': { schema: WidgetSchema } }, description: 'Created' },
    400: { content: { 'application/json': { schema: ErrorSchema } }, description: 'Validation error' },
    401: { content: { 'application/json': { schema: ErrorSchema } }, description: 'Unauthorized' },
  },
});

router.openapi(createWidgetRoute, async (c) => {
  const userId = getUserId(c);   // always use this helper
  const body = c.req.valid('json');
  const widget = await widgetService.create(userId, body);
  return c.json(widget, 201);
});

export { router as widgetRouter };
```

### 3. Write the service method (`src/services/`)

**Choose data access based on the service type** (see ADR-0002):
- Expense reports, lines, categories, policies → **Drizzle ORM** (`db` from `../db/drizzle.js`)
- Auth, users, analytics, workflow, AI/chat → **Raw SQL** (`query()` from `../db/client.js`)

```typescript
// Raw SQL pattern
import { query } from '../db/client.js';

export async function createWidget(userId: string, input: CreateWidgetInput) {
  const result = await query<Widget>(
    'INSERT INTO widgets (user_id, name) VALUES ($1, $2) RETURNING *',
    [userId, input.name]
  );
  return toCamelCase(result.rows[0]);  // always return camelCase
}
```

### 4. Register the router in `src/app.ts`

```typescript
import { widgetRouter } from './routes/widgets.js';
app.route('/v1', widgetRouter);
```

### 5. Define capability and resource scope

```typescript
import { requirePermission } from '../middleware/permission.js';
```

Declare permission middleware on the route and enforce ownership/team/
department resource scope in the service after loading the resource. A route
permission is not a substitute for resource authorization. Mutation schemas
must reject lifecycle, ownership, and server-derived fields they do not own.

### 6. Preserve transaction and concurrency boundaries

For state-changing financial or workflow commands, require `expectedVersion`,
lock the authoritative row, authorize against the locked state, and write the
resource, related records, history, and audit in one transaction.

### 7. Verify

Add focused schema/authorization tests, then run:

```bash
npm run check
git diff --check
```

## Checklist

- [ ] All local imports use `.js` extension
- [ ] Schema calls `.openapi('Name')`
- [ ] Schema imports `z` from `@hono/zod-openapi` and mutation input is strict
- [ ] Route has: `tags`, `summary`, `description`, `security`, typed responses
- [ ] Handler uses `getUserId(c)` (not `c.get('userId')`)
- [ ] Service returns camelCase (not raw DB snake_case)
- [ ] SQL uses `$1, $2` parameterized queries (no string interpolation)
- [ ] Errors throw `AppError` subclasses (not generic `Error`)
- [ ] Admin routes have `requirePermission` middleware
- [ ] Every protected route has an explicit capability and resource-scope policy
- [ ] Stateful commands use locking, expected versions, and one transaction where required
- [ ] Focused tests and `npm run check` pass
