---
id: 0006
title: "v3.0 enterprise upgrade spec (Passport/Redis/RabbitMQ auth+workflow stack) — rejected"
status: rejected
kind: feature
opened: 2026-02-06
decided: 2026-08-02
branch: ~
supersedes: ~
superseded-by: ~
---

# WORK-0006 — v3.0 enterprise upgrade spec — rejected

| | |
|---|---|
| **Opened** | 2026-02-06 |
| **Status** | rejected |
| **Kind** | feature |
| **Supersedes** | — |
| **Superseded by** | — |

## Problem

`enhancement_plan/` contained a large (~4,600 line, 6-file) speculative
"v3.0" specification package — an SRS, an implementation guide, a 4-week
roadmap, a permission registry, a security implementation guide, and a
workflow-configuration example library — proposing an enterprise-grade
overhaul of auth, RBAC, and approval workflows. It was committed as a single
batch on 2026-02-06 and never touched again.

## Decision

**Rejected as a package.** The spec's core technical choices do not match
what was actually built, and re-implementing it as written would mean
replacing working, already-decided infrastructure with a different stack
for no stated reason:

| Spec proposed | Actually built | Where |
|---|---|---|
| `passport` + `passport-google-oauth20` + `passport-facebook` for OAuth | Custom OAuth handling, no Passport dependency | `package.json` has no `passport*` packages |
| `bcrypt` for password hashing | `crypto.scrypt` (see `expense-api` seed/auth code) | `package.json` has no `bcrypt` dependency at runtime scope matching the spec's usage |
| `redis` for session/rate-limit caching | No Redis — rate limiting and sessions handled without an external cache | No `redis` client wired into `src/` |
| RabbitMQ / AWS SQS for background jobs | `node-cron` | `package.json`, `src/jobs/` |
| `jsonwebtoken`-style JWT (implied by Passport-based auth) | `jose` — see WORK-0003 | `context/work/0003-jwt-bearer-plus-httponly-cookie.md` |
| A new RBAC permission registry (`resource.action.scope` strings) | A working `role_id`/`permission_id` relational model already exists | `src/types/index.ts`, `role_permissions` table |
| A new workflow/approval engine | A working workflow service already exists, built independently of this spec | `src/routes/workflow.ts`, `src/services/workflow.service.ts`, `src/schemas/workflow.ts` |

The domain concerns (RBAC, approval workflows, audit logging) are
legitimate and partially already addressed by the real, independently-built
`workflow.service.ts` and permission tables — but this spec's *specific*
technical design was never adopted, and the two systems were never
reconciled. Nothing in the current codebase should be assumed to follow
this document.

## Options considered

Not applicable — this record exists to reject and explain, not to choose
between options going forward. If RBAC/workflow enhancements are wanted in
the future, a fresh work item should start from the *current* implementation
(`workflow.service.ts`, the existing permission tables), not from this spec.

## Consequences

**Positive:**
- Removes ~4,600 lines of contradictory speculative planning from the repo
  that could mislead a future agent into reimplementing a different stack
- The real permission/workflow implementation is now easier to find as the
  single source of truth, with no competing document claiming to describe it

**Negative / Trade-offs accepted:**
- Some genuinely useful domain thinking in the SRS (compliance mapping,
  separation-of-duties rules, workflow versioning) is lost from easy
  reference — recoverable from git history at the deleted path if ever
  needed (commit `2026-02-06`, path `enhancement_plan/`)

**Risks / Open questions:**
- If any part of the real `workflow.service.ts` was actually influenced by
  this spec's domain modeling (as opposed to its tech stack), that lineage
  is not documented anywhere. Not investigated further — out of scope for a
  documentation consolidation pass.

## Definition of done

Not applicable — this is a rejection record, not a build.

## Log

- 2026-02-06 proposed — original `enhancement_plan/` files committed as a
  batch (reconstructed date, not a real proposal event in this framework)
- 2026-08-02 rejected — spec's technical choices (Passport/bcrypt/Redis/
  RabbitMQ) confirmed to contradict the real implementation
  (jose/scrypt/no-cache/node-cron) during framework consolidation; files
  deleted from `enhancement_plan/` per "Consolidating Loose Documents"

---

> **For AI agents:** Do NOT implement this work item — it is `rejected`.
> Do not reintroduce Passport, bcrypt, Redis, or RabbitMQ into this project
> without a new work item that explicitly supersedes WORK-0002 and WORK-0003
> first. If asked to add RBAC or workflow features, start from
> `src/services/workflow.service.ts` and the existing permission tables, not
> from any surviving copy of this spec.
