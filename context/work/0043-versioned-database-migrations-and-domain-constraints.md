---
id: 0043
title: "Adopt versioned migrations and enforce domain invariants in PostgreSQL"
status: proposed
kind: migration
opened: 2026-09-14
decided: ~
branch: ~
supersedes: ~
superseded-by: ~
---

# WORK-0043 — Adopt versioned migrations and enforce domain invariants in PostgreSQL

| | |
|---|---|
| **Opened** | 2026-09-14 |
| **Status** | proposed |
| **Kind** | migration |
| **Supersedes** | — |
| **Superseded by** | — |

## Problem

Production mounts `schema.sql` into `/docker-entrypoint-initdb.d`; PostgreSQL runs
it only when initializing an empty data volume. Existing deployments receive no
upgrade. `db:init` replays schema and seed files, but schema is not repeatable:
some `ALTER TABLE ... ADD CONSTRAINT` statements are unconditional, while
`CREATE MATERIALIZED VIEW IF NOT EXISTS` silently preserves obsolete definitions.
There is no migration version/checksum table, upgrade ordering, rollback/forward
repair process, or CI upgrade test.

DDL and Drizzle definitions also drift in nullability/constraints. The database
does not enforce nonnegative financial amounts, valid period order, coherent
status timestamps, normalized currencies, report/line owner equality, evidence
association boundaries, or unique nullable budget scope.

## Decision

Proposed: keep a generated/current schema snapshot for new environments but make
numbered, checksummed, forward-only migrations the deployment authority. Use
expand/backfill/validate/contract steps. Add database constraints for invariants
that must hold regardless of API path, with reconciliation before validation.

## Options considered

| Option | Pros | Cons | Chosen? |
|---|---|---|---|
| SQL migrations plus schema snapshot | Explicit and stack-neutral | Process/tooling work | ✓ proposed |
| Continue editing one schema.sql | Simple locally | Cannot upgrade safely | ✗ |
| Adopt a new ORM migration stack | Automation | Unnecessary migration of data layer | ✗ initially |

## Consequences

**Positive:** predictable upgrades and database-level protection for all clients.

**Negative / Trade-offs:** invalid existing data must be audited/backfilled;
destructive contraction becomes a later release step.

**Risks / Open questions:** select migration runner/checksum policy, deployment
locking, rollback expectations, and source-of-truth generation between SQL/Drizzle.

## Definition of done

- [ ] Migration history/checksum and deployment lock exist.
- [ ] CI migrates both an empty database and a supported prior-version snapshot.
- [ ] Schema snapshot is reproducibly generated/validated from migrations.
- [ ] View changes use replace/drop-create migrations, not `IF NOT EXISTS` drift.
- [ ] SQL and Drizzle nullability/types/foreign keys are checked for parity.
- [ ] Agreed financial, ownership, lifecycle, currency, time, budget, and evidence
      invariants are enforced after reconciliation.
- [ ] Expand/backfill/contract and failure-recovery runbooks are documented.

## Log

- 2026-09-14 proposed — confirmed during deployment/schema audit.

---

> **For AI agents:** Do NOT implement while this item is `proposed`; when accepted,
> update `context/skills/add-migration.md` to the chosen workflow.
