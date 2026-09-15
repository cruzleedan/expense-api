---
title: Expense API Work-Item Implementation Playbook
updated: 2026-09-15
---

# Expense API work-item implementation playbook

This is the maintained procedure for implementing accepted work in
`expense-api`. WORK-0046 records why it exists. Item-specific business decisions
belong in `context/work/`; this file contains repeated implementation mechanics.

## 1. Establish authority and scope

Before editing:

1. Read the workspace and project `AGENTS.md`, this playbook, the relevant
   README, `context/RELEASING.md`, and every related work item.
2. Inspect Git status. Preserve unrelated and pre-existing changes.
3. Build an ordered implementation queue from explicit approval and current
   work-item status. `proposed`, `superseded`, and rejected items are not part of
   the queue unless the user explicitly changes their status or direction.
4. Record acceptance/building state before implementation. Do not infer that a
   severity label approves adjacent work.

If the request involves d3, Caddy, Docker topology, or a live deployment, first
read `d3-homelab/AGENTS.md` and
`d3-homelab/context/reference/homelab.md`.

## 2. Create one impact map

Trace each changed command once:

```text
route → request schema → permission/resource policy → service/transaction
      → SQL + Drizzle schema → audit/side effects → deployment boundary
```

Use `rg` for call sites and narrowly read only relevant ranges. Batch independent
read-only inspections. Avoid whole-repository dumps and cumulative diffs when a
path-scoped or work-item-scoped view answers the question.

Resolve these questions before editing:

- Which actor, permission, resource scope, source state, and expected version
  authorize the command?
- Which writes must commit atomically, including history and audit?
- Which derived values must be calculated by the server?
- Which soft-delete, ownership, idempotency, and concurrency invariants apply?
- Does the change require both `src/db/schema.sql` and `src/db/schema.ts`?
- Is deployment or another repository actually authorized by the request?

## 3. Implement at the narrowest authoritative boundary

- Put pure authorization, lifecycle, and financial invariants in policy/helper
  functions that can be tested without PostgreSQL.
- Keep route handlers thin and mutation schemas strict. Import `z` from
  `@hono/zod-openapi`; call `.openapi()` before refinements that produce a
  `ZodEffects` value with the currently pinned integration.
- Lock mutable financial/workflow records before authorization that depends on
  their state. Check `expectedVersion`, then perform state, history, audit, and
  related writes in one transaction.
- Fail closed for unsafe legacy data. Document the recovery or migration path.
- Update SQL DDL and Drizzle definitions together. `schema.sql` is bootstrap
  DDL, not a repeatable migration for an existing database.

For dependency changes, check `node_modules` ownership before using the host
installation. Prefer `npm ci` in a clean container or CI environment when the
host tree is stale or owned by another user.

For repeatable dependency/lockfile updates, clean-container verification,
disposable PostgreSQL suites, OpenAPI baseline review, and production audit/SBOM
checks, use [release quality gates](release-quality-gates.md). That procedure
records npm's hidden-lockfile bind-mount and post-prune SBOM pitfalls; do not
rediscover or bypass them with host ownership changes or stale build-layer audits.

## 4. Verify incrementally

Use the cheapest useful feedback first:

1. Run focused tests for the changed policy/schema/helper.
2. Run `npm run build` after each coherent cross-file change.
3. Run `npm run check` once the work item is coherent.
4. Review a path-scoped diff, then `git diff --check`.

Tests should verify observable invariants rather than implementation wording.
Keep background timers unreferenced, and close database pools opened by tests.
When no database is configured, use query seams for deterministic SQL behavior
and state clearly which database integration tests were not run.

## 5. Apply database changes safely

Follow `context/skills/add-migration.md`. Never replay the full bootstrap schema
against a populated database. Preflight existing data, apply only reviewed
additive SQL with `ON_ERROR_STOP` and a transaction, then verify columns,
constraints, indexes, permissions, and grants using read-only queries.

Use `npm run db:apply-change -- <sql-file>` for a reviewed additive SQL file.
The helper deliberately refuses `src/db/schema.sql`; `--bootstrap` is allowed
only for an empty database. Full versioned migration history remains WORK-0043.

## 6. Separate completion stages

Do not collapse these states into “done”:

| Stage | Required evidence |
|---|---|
| Implemented | Focused behavior exists and compiles |
| Repository verified | `npm run check` and diff checks pass |
| Schema applied | Target database objects and grants verified |
| Deployed | Intended image/config replaced in the authorized environment |
| Operating | Health and smoke checks pass after deployment |
| Release-ready | Incident, credential, dependency, or external coordination gates are closed |

For d3, validate configuration before reload and use
`npm run verify:deployment`. A gateway streaming cap must be tested with an
actual oversized body; a forged `Content-Length` alone may wait for bytes.

## 7. Leave durable evidence

Before moving a work item to `shipped`:

- Check every Definition-of-done box truthfully.
- Append dated log entries for verification, schema application, and deployment.
- Record external release gates explicitly instead of presenting them as code
  completion.
- Run `npm run verify:context` and the workspace context verifier when available.
- Prefer one authorized commit per work item. If commits are not authorized,
  keep changes reviewable with work-item/path-scoped diffs.

Store only stable decisions and repeatable procedures here. Branch position,
container IDs, current health, credentials, temporary URLs, and one-off command
output belong in the work-item log or operational handoff, never this reference.
