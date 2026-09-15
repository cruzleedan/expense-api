---
id: 0034
title: "Enforce expense-line financial integrity, ownership, and idempotency"
status: proposed
kind: fix
opened: 2026-09-14
decided: ~
branch: ~
supersedes: ~
superseded-by: ~
---

# WORK-0034 — Enforce expense-line financial integrity, ownership, and idempotency

| | |
|---|---|
| **Opened** | 2026-09-14 |
| **Status** | proposed |
| **Kind** | fix |
| **Supersedes** | — |
| **Superseded by** | — |

## Problem

Single-create permits an omitted or negative amount, update permits negative
amount/tax, and the database only defaults amount to zero. Validation differs
from bulk create, which requires amount greater than zero. JavaScript numbers are
used at the boundary for decimal currency values.

Bulk create inserts a line before validating its optional receipt. For missing or
foreign receipts it records failure and continues, leaving a committed line that
is absent from `created`. It also omits `userId` from inserted rows; the DDL allows
null ownership. Association exceptions are swallowed and the line is reported
created (`src/services/expenseLine.service.ts:636-763`).

`getExpenseLineById` does not filter `deletedAt`, so deleted records remain
readable and can be updated/deleted again. Idempotent create looks up `clientId`
globally and returns the first match without owner validation. The unique index
is also global; another user can choose the same ID and receive the existing
report/line. No database invariant guarantees a line owner matches its report
owner.

## Decision

Proposed: define one line command/validation pipeline used by single, bulk, sync,
and parser-created lines. Use exact decimal inputs, owner-scoped idempotency,
validate all references before mutation, and establish explicit all-or-nothing
or accurately reported partial-success semantics.

## Options considered

| Option | Pros | Cons | Chosen? |
|---|---|---|---|
| Shared validator plus per-item savepoints | Accurate partial success | More transaction handling | ✓ proposed |
| Entire batch atomic | Simplest financial result | One bad item rejects all | viable decision needed |
| Keep swallowed per-item errors | Backward compatible | Creates invisible committed data | ✗ |

## Consequences

**Positive:** all ingestion paths produce the same valid financial record.

**Negative / Trade-offs:** stricter amount/tax semantics may require credit-note
or adjustment document types instead of negative ordinary lines.

**Risks / Open questions:** decide whether zero/negative claims are ever valid and
how to represent refunds, credits, tips, and tax-inclusive values.

## Definition of done

- [ ] Amount, tax, rate, currency, date, and reimbursement invariants are shared
      by single, bulk, update, sync, and parser ingestion.
- [ ] Monetary input uses decimal strings/minor units and never binary float math.
- [ ] Bulk failures cannot commit unreported lines; every created line has `user_id`.
- [ ] Receipt validation occurs before insert or is rolled back with that item.
- [ ] Soft-deleted lines are excluded from normal read/update/delete paths.
- [ ] Client IDs are unique and queried by `(user_id, client_id)`.
- [ ] Database constraints enforce non-null owner and report-owner consistency.
- [ ] Tests cover foreign client IDs, ghost rows, association errors, negatives,
      rounding, duplicate retries, and concurrent submissions.

## Log

- 2026-09-14 proposed — confirmed during line and offline-idempotency audit.

---

> **For AI agents:** Do NOT implement while this item is `proposed`.
