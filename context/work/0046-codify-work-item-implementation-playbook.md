---
id: 0046
title: "Codify the work-item implementation and verification playbook"
status: shipped
kind: infra
opened: 2026-09-15
decided: 2026-09-15
branch: feature/0023-report-list-permission-scope
supersedes: ~
superseded-by: ~
---

# WORK-0046 — Codify the work-item implementation and verification playbook

| | |
|---|---|
| **Opened** | 2026-09-15 |
| **Status** | shipped |
| **Kind** | infra |
| **Supersedes** | — |
| **Superseded by** | — |

## Problem

Release-blocker implementation repeatedly rediscovered approval scope, affected
layers, database deployment mechanics, d3 gateway topology, and verification
commands. The knowledge existed partly in conversation and partly in individual
work-item logs, which is not reliable memory for future sessions. Broad reads,
cumulative diffs, host dependency ownership, and unsafe assumptions about
replaying `schema.sql` also created avoidable time and token cost.

## Decision

Maintain one mandatory implementation playbook, a short reusable project skill,
and executable convention/schema/context/deployment checks. Work-item records
remain the source of item-specific decisions; the playbook contains only stable,
cross-item procedure.

## Options considered

| Option | Pros | Cons | Chosen? |
|---|---|---|---|
| Playbook + skill + executable checks | Durable and enforceable | Small maintenance cost | ✓ |
| Put all guidance in `AGENTS.md` | One file to discover | Bloats mandatory context and duplicates detail | ✗ |
| Rely on conversation memory | No repository changes | Lost across sessions; not testable | ✗ |

## Consequences

**Positive:** future work starts from an approved queue, follows one impact map,
and produces consistent evidence with less repeated discovery.

**Negative / Trade-offs:** checks intentionally cover deterministic local
conventions, not every architectural or production-safety concern. Full
versioned migrations and dependency gates remain in WORK-0043 and WORK-0045.

**Risks / Open questions:** keep the playbook concise and update it only when a
lesson changes repeated decisions. Do not turn transient production state into
permanent instructions.

## Definition of done

- [x] A project implementation playbook records the stable execution protocol.
- [x] `AGENTS.md` requires the playbook and lists the implementation skill.
- [x] Endpoint and migration skills incorporate the verified friction lessons.
- [x] CI runs project conventions, context, SQL/Drizzle table parity, build, and tests.
- [x] Safe database-change and deployment-verification helpers are documented and exercised.
- [x] Work-item logging distinguishes durable decisions, verification evidence,
      deployment state, and external operational gates.

## Implementation notes

- `npm run check` is the local and CI entry point for convention, context,
  SQL/Drizzle table-parity, shell-tooling, build, and test verification.
- The guarded database helper refuses non-bootstrap `schema.sql` replay and was
  exercised through the tooling gate. Full migration history remains explicitly
  deferred to WORK-0043.
- The deployment verifier was exercised against d3 and passed liveness, disabled
  registration, application body-limit, and Caddy body-limit probes. The rebuilt
  production container reached healthy state.
- The convention check found and corrected the remaining plain-`zod` OpenAPI
  import in `src/schemas/role.ts`.

## Log

- 2026-09-15 accepted — user approved all recommended durability and efficiency improvements.
- 2026-09-15 building — adding the playbook, reusable skill, checks, and CI wiring.
- 2026-09-15 shipped — `npm run check` passes with 35 schema tables and 29 tests;
  database safety refusal and live deployment verification both pass.

---

> **For AI agents:** Follow the linked playbook and skill. Do not revive the
> broader migration and dependency proposals that remain unapproved.
