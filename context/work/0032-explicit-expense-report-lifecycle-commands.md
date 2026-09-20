---
id: 0032
title: "Replace generic report mutation with explicit lifecycle commands"
status: shipped
kind: fix
opened: 2026-09-14
decided: 2026-09-14
branch: feature/0023-report-list-permission-scope
supersedes: ~
superseded-by: ~
---

# WORK-0032 — Replace generic report mutation with explicit lifecycle commands

| | |
|---|---|
| **Opened** | 2026-09-14 |
| **Status** | shipped |
| **Kind** | fix |
| **Severity** | P0 financial-control release blocker |
| **Supersedes** | — |
| **Superseded by** | — |

## Problem

`UpdateExpenseReportSchema` exposes `status`, totals, rejection reason, payment
fields, exchange rate, and base total. `updateExpenseReport` copies them directly
after view/access authorization, without checking an allowed transition or a
field-specific permission (`src/schemas/expenseReport.ts:75-97`,
`src/services/expenseReport.service.ts:386-431`). The endpoint can therefore
bypass submit/approve/reject/post/pay duties and rewrite financial results.

Direct reads/updates do not exclude soft-deleted reports. `version` increments
but clients do not provide an expected version, so concurrent writes silently
overwrite. Report creation, optional orphan-line attachment, and custom-field
storage are separate operations and can leave partial aggregates.

## Decision

Accepted: keep generic edit only for draft/returned descriptive fields and expose
explicit domain commands for submit, withdraw, approve, reject, return, revise,
post, pay, and approved-report correction. Each command must enforce permission,
resource scope, source state, expected version, invariants, immutable snapshots,
and audit in one transaction.

## Options considered

| Option | Pros | Cons | Chosen? |
|---|---|---|---|
| Explicit command endpoints/state machine | Auditable and ERP-aligned | More endpoints/domain code | ✓ accepted |
| Add field checks to generic PUT | Smaller | State logic remains scattered/easy to bypass | ✗ |
| Database trigger only | Protects transitions | Cannot express all actor/permission rules alone | supplemental |

## Consequences

**Positive:** lifecycle metadata becomes evidence rather than caller-controlled data.

**Negative / Trade-offs:** clients must migrate away from setting status/payment
fields through PUT; corrections require a formal reversal/reopen workflow.

**Risks / Open questions:** define accounting meaning of `approved`, `posted`,
and `paid`, plus who may reopen and whether posting can ever be reversed.

## Transition table

| Command | Permission | Actor scope | Source | Target | Principal side effects |
|---|---|---|---|---|---|
| edit | `report.edit.*` | owner/team/all | draft, returned | unchanged | descriptive/custom fields; version increment |
| submit | `report.submit` | owner | draft, returned | submitted | total snapshot, workflow snapshot, submitted timestamp |
| withdraw | `report.withdraw` | owner | submitted, pending | draft | clear workflow/lifecycle state |
| approve | `report.approve` | current approver | submitted, pending | next step or approved | approval history, approval timestamp |
| reject | `report.reject` | current approver | submitted, pending | rejected | immutable reason/history |
| return | `report.return` | current approver | submitted, pending | returned | immutable reason/history and restart policy |
| revise | `report.submit` | owner | rejected | draft | clear workflow state, preserve history |
| correct | `report.correct` | non-owner controller | approved | returned | correction reason/history; clear approval state |
| post | `report.post` | non-owner finance | approved | posted | unique posting reference, actor, timestamp |
| pay | `report.pay` | non-owner finance distinct from poster | posted | paid | unique payment reference, actor, timestamp |

All commands require the current `expectedVersion`, lock the active report row,
write their history/audit evidence in the same transaction, and increment the
version once.

## Definition of done

- [x] Generic update rejects status, derived totals, approval, posting, and payment fields.
- [x] A documented transition table defines actor, permission, source/target, and side effects.
- [x] Dedicated post/pay commands store accounting batch/payment references and enforce SoD.
- [x] Every command locks the report and checks expected version.
- [x] Soft-deleted reports cannot be read or mutated through normal endpoints.
- [x] Report, line attachment, custom values, approval history, and audit changes are atomic.
- [x] Status/timestamp/payment/total invariants exist in service and database layers.
- [x] Transition, bypass, stale-version, and concurrent-command tests exist.

## Log

- 2026-09-14 proposed — confirmed during lifecycle and financial-control audit.
- 2026-09-14 accepted — immediate release blocker implementation approved.
- 2026-09-14 building — narrowing generic edits, adding optimistic concurrency,
  and implementing explicit accounting commands and invariants.
- 2026-09-14 shipped — explicit versioned commands, accounting references and
  SoD, strict generic-edit schemas, database constraints, atomic custom/line
  writes, and lifecycle regression tests implemented; 20 tests pass. Applying
  the checked-in additive schema remains a deployment step.
- 2026-09-15 deployed — additive report columns, indexes, checks, permissions,
  and grants applied and verified in production before the replacement API image
  was started.

---

> **For AI agents:** This item is shipped. New lifecycle states must be added to
> the central transition matrix and database invariants before exposure.
