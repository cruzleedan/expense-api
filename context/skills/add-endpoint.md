---
name: add-endpoint
description: "Add a new API endpoint to expense-api following the OpenAPIHono + Zod pattern."
applies-to: expense-api
---

## When to invoke

Any time a new HTTP endpoint is needed in `expense-api`.

## Steps

### 1. Create the Zod schema (`src/schemas/`)

```typescript
// src/schemas/widget.ts
import { z } from '@hono/zod-openapi';

export const CreateWidgetSchema = z.object({
  name: z.string().min(1).max(100),
}).openapi('CreateWidget');

export const WidgetSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  createdAt: z.string().datetime(),
}).openapi('Widget');
```

### 2. Create (or extend) the route file (`src/routes/`)

```typescript
import { createRoute, z } from '@hono/zod-openapi';
import { OpenAPIHono } from '@hono/zod-openapi';
import { CreateWidgetSchema, WidgetSchema } from '../schemas/widget.js';
import { ErrorSchema } from '../schemas/common.js';

const router = new OpenAPIHono();

const createWidgetRoute = createRoute({
  method: 'post',
  path: '/widgets',
  tags: ['Widgets'],
  summary: 'Create a widget',
  description: 'Creates a new widget for the authenticated user.',
  security: [{ bearerAuth: [] }],
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

### 5. For admin endpoints — add permission middleware

```typescript
import { requirePermission } from '../middleware/permission.js';
router.use('/widgets/admin/*', requirePermission('widget:manage'));
```

## Checklist

- [ ] All local imports use `.js` extension
- [ ] Schema calls `.openapi('Name')`
- [ ] Route has: `tags`, `summary`, `description`, `security`, typed responses
- [ ] Handler uses `getUserId(c)` (not `c.get('userId')`)
- [ ] Service returns camelCase (not raw DB snake_case)
- [ ] SQL uses `$1, $2` parameterized queries (no string interpolation)
- [ ] Errors throw `AppError` subclasses (not generic `Error`)
- [ ] Admin routes have `requirePermission` middleware
