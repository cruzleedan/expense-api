---
id: 0002
title: "Partial migration to Drizzle ORM for main expense domain services"
status: accepted
kind: infra
opened: 2026-08-01
decided: 2026-08-01
branch: ~
supersedes: ~
superseded-by: ~
---

# WORK-0002 — Partial migration to Drizzle ORM for main expense domain services

| | |
|---|---|
| **Opened** | 2026-08-01 |
| **Status** | accepted |
| **Kind** | infra |
| **Supersedes** | — |
| **Superseded by** | — |

## Problem

The expense-api was originally built with raw parameterized SQL via a `pg` pool
wrapper (`src/db/client.ts` — `query()`, `transaction()`). As the domain model
grew, the 4 most complex services — expense reports, lines, categories, and
policies — required heavily dynamic `WHERE` clauses, composable filters, and
type-safe joins. A full Drizzle ORM schema was written covering all tables
(`src/db/schema.ts`). Four services were migrated to use it; the rest
remain on raw SQL.

## Decision

Two data-access patterns coexist. **Do not unify without a work item superseding
this one.**

**Drizzle ORM** (`db` from `src/db/drizzle.ts`) — use for:
- `expenseReport.service.ts`
- `expenseLine.service.ts`
- `expenseCategory.service.ts`
- `expensePolicy.service.ts`
- `insight.service.ts` (mixed — uses both)

**Raw SQL** (`query()` from `src/db/client.ts`) — use for:
- Auth, user management, roles, permissions
- Approval, audit, workflow
- Analytics, admin analytics
- Receipts, projects
- AI/chat, LLM prompt templates

## Options considered

| Option | Pros | Cons | Chosen? |
|---|---|---|---|
| Migrate only the complex domain services | No disruption to stable auth/analytics; type-safe composable queries where needed | Two patterns in codebase | ✓ |
| Migrate everything to Drizzle | Consistent | High risk rewriting stable auth and analytics services | ✗ |
| Keep everything as raw SQL | Consistent | Dynamic multi-filter queries require unsafe string building | ✗ |

## Consequences

**Positive:**
- Drizzle's composable query builder handles dynamic `WHERE` conditions in expense
  services without string concatenation
- `schema.ts` (669 lines) provides TypeScript types for all tables regardless of
  which access method is used

**Negative / Trade-offs accepted:**
- New contributors must know which pattern to use in which service (see Decision above)
- The Drizzle schema (`schema.ts`) covers all tables but only some services use it
- `insight.service.ts` mixes both patterns — this is intentional for now

**Risks / Open questions:**
- None outstanding.

## Definition of done

- [x] Raw SQL pattern documented and in use for auth/analytics/supporting services
- [x] Drizzle pattern documented and in use for expense reports/lines/categories/policies
- [x] `schema.sql` remains source of truth for migrations (v5.0)

## Log

- 2026-08-01 accepted — decision made at project inception; migrated from
  ADR-0002 to this work item format

## Implementation Notes

**Raw SQL pattern** (auth, users, analytics, AI, and supporting services):
```typescript
import { query } from '../db/client.js';
const result = await query<User>('SELECT * FROM users WHERE id = $1', [userId]);
```

**Drizzle pattern** (expense reports, lines, categories, policies):
```typescript
import { db } from '../db/drizzle.js';
import { expenseReports } from '../db/schema.js';
import { eq, and, ilike, desc, count } from 'drizzle-orm';

const rows = await db.select()
  .from(expenseReports)
  .where(and(eq(expenseReports.userId, userId), ilike(expenseReports.title, `%${search}%`)))
  .orderBy(desc(expenseReports.createdAt));
```

**Key files:**
- `src/db/client.ts` — raw SQL pool, `query()`, `transaction()`
- `src/db/drizzle.ts` — Drizzle instance wired to the same `pg` pool
- `src/db/schema.ts` — Drizzle table definitions for all tables (source of TypeScript types)
- `src/db/schema.sql` — plain SQL DDL (source of truth for migrations; v5.0)

---

> **For AI agents:** Do NOT implement this work item unless status is
> `accepted` or `building`. If status is `proposed`, surface it to the user
> for a decision before writing any code. If status is `superseded`, follow
> the item in `superseded-by` instead — do NOT implement the pattern
> described here. If you are about to contradict an `accepted`, `building`,
> `shipped`, or `operating` item, stop and surface it to the user before
> proceeding.
