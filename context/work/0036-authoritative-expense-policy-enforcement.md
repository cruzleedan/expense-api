---
id: 0036
title: "Make expense policy evaluation authoritative"
status: proposed
kind: feature
opened: 2026-09-14
decided: ~
branch: ~
supersedes: ~
superseded-by: ~
---

# WORK-0036 — Make expense policy evaluation authoritative

| | |
|---|---|
| **Opened** | 2026-09-14 |
| **Status** | proposed |
| **Kind** | feature |
| **Supersedes** | — |
| **Superseded by** | — |

## Problem

Policies are represented as enforcement controls, including `hard_block`, but
the only evaluation entry point is an advisory `/check` route. Its caller
supplies department and roles, rather than the server deriving them from the
authenticated user/report. Line creation and report submission do not call it.

The switch implements `max_amount`, `time_limit`, and merchant restriction only.
`requires_receipt` is empty; `requires_approval`, category restriction,
frequency limit, and custom rules have no cases
(`src/services/expensePolicy.service.ts:224-302`). A hard-block policy therefore
does not block the underlying financial command.

## Decision

Proposed: define a versioned policy contract and a deterministic server-side
evaluator invoked by relevant line/report commands. Derive identity/org/report
context server-side. Freeze applicable policy versions and results at submission;
warnings require acknowledgement, hard blocks prevent transition, and approval
requirements feed workflow selection.

## Options considered

| Option | Pros | Cons | Chosen? |
|---|---|---|---|
| Typed/versioned policy engine in command path | Auditable and deterministic | Rule migration/design work | ✓ proposed |
| Continue advisory checks | Flexible UI | No actual control | ✗ |
| Execute arbitrary custom code/JSON expressions | Powerful | Security and determinism risk | ✗ initially |

## Consequences

**Positive:** policy metadata matches real business behavior.

**Negative / Trade-offs:** policies need validation, effective dating, test cases,
currency semantics, override governance, and backward-compatible versioning.

**Risks / Open questions:** define expense vs report evaluation time, warning
acknowledgement, exception approval, FX conversion, and historical re-evaluation.

## Definition of done

- [ ] Every advertised rule type has a typed schema and deterministic evaluator.
- [ ] Caller cannot forge roles, department, ownership, receipt, or history context.
- [ ] Line/save/submit commands invoke the appropriate evaluations.
- [ ] `hard_block`, warning, receipt, and approval outcomes have enforced semantics.
- [ ] Policy version and result snapshot is retained with the submitted report.
- [ ] Overrides require explicit permission, reason, approval, and audit.
- [ ] Unit fixtures and end-to-end bypass tests cover every rule type.

## Log

- 2026-09-14 proposed — confirmed during policy-control audit.

---

> **For AI agents:** Do NOT implement while this item is `proposed`.
