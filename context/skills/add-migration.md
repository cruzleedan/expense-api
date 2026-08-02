---
name: add-migration
description: "Add a new database migration to expense-api, updating both the SQL DDL and Drizzle schema."
applies-to: expense-api
---

## When to invoke

Any time the PostgreSQL schema needs to change (new table, new column, new index,
altered constraint).

## Background

Two schema files must stay in sync (see ADR-0002):
- `src/db/schema.sql` — plain SQL DDL, the source of truth for the database
- `src/db/schema.ts` — Drizzle table definitions (covers all tables; provides TypeScript types)

Both must be updated whenever the schema changes.

## Steps

### 1. Edit `src/db/schema.sql`

Add the new table or column. Follow the existing patterns:
- Use `IF NOT EXISTS` on `CREATE TABLE`
- Foreign keys reference `users(id)` or the parent table's primary key
- Add `created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()` and `updated_at` to new tables
- Add relevant indexes after the table definition

```sql
-- Example: new table
CREATE TABLE IF NOT EXISTS widgets (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        VARCHAR(100) NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_widgets_user_id ON widgets(user_id);
```

### 2. Update `src/db/schema.ts` (Drizzle)

Add the corresponding Drizzle table export:

```typescript
export const widgets = pgTable('widgets', {
  id:        uuid('id').primaryKey().defaultRandom(),
  userId:    uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  name:      varchar('name', { length: 100 }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
```

Even if the new table won't use Drizzle for queries, add it to `schema.ts` — it
provides TypeScript type inference for the whole codebase.

### 3. Apply the migration

```bash
# From the expense-api project directory
psql $DATABASE_URL -f src/db/schema.sql
```

For production (via Docker):
```bash
docker exec expense-api psql $DATABASE_URL -f /app/src/db/schema.sql
```

### 4. Verify

```bash
psql $DATABASE_URL -c "\d widgets"   # confirm table structure
psql $DATABASE_URL -c "\di"          # confirm indexes
```

### 5. Write an ADR if the change is architecturally significant

Significant = new table, change to auth/billing data model, new indexing strategy,
added pgvector extension. Routine = adding a nullable column, adding an index for
performance.

## Checklist

- [ ] `schema.sql` updated with `IF NOT EXISTS` guards
- [ ] `schema.ts` updated with matching Drizzle table definition
- [ ] Migration applied and verified in dev environment
- [ ] No breaking changes to existing columns without a migration plan
- [ ] ADR written if the change is architecturally significant
