---
id: 0033
title: "Correct workflow authorization, submission, and step execution"
status: shipped
kind: fix
opened: 2026-09-14
decided: 2026-09-14
branch: feature/0023-report-list-permission-scope
supersedes: ~
superseded-by: ~
---

# WORK-0033 — Correct workflow authorization, submission, and step execution

| | |
|---|---|
| **Opened** | 2026-09-14 |
| **Status** | shipped |
| **Kind** | fix |
| **Severity** | P0 financial-control release blocker |
| **Supersedes** | — |
| **Superseded by** | — |

## Problem

Workflow steps model `target_type` and `target_value`, but approval eligibility
does not evaluate either. `canApproveReport` blocks certain SoD patterns, logs a
non-manager, then allows any user who reached the permission-gated route
(`src/services/approval.service.ts:20-171`). `returnReport` does not call even
that eligibility function.

Eligibility is evaluated before the report row is locked, creating a race with
workflow/report changes. On approval, only `currentStep + 1` is examined; if that
one step should be skipped, the code marks the entire report approved even when
later required steps exist (`src/services/workflow.service.ts:288-380`).

Submission sums and counts all lines, including soft-deleted lines. An empty or
deleted-only report can pass one path, and the submitted total can differ from
the live total shown elsewhere. The workflow status/history endpoint fetches a
report by ID without checking caller ownership or view scope.

## Decision

Implement one transactional workflow command engine. Resolve the
current required step(s), derive eligible principals from the frozen workflow
snapshot and point-in-time org data, authorize the actor after locking, record
the action, advance over every optional/skipped step, and update report state and
audit atomically.

## Options considered

| Option | Pros | Cons | Chosen? |
|---|---|---|---|
| Transactional workflow command engine | One authoritative path | Moderate refactor | ✓ accepted |
| Patch each endpoint separately | Faster initial changes | Rules will drift again | ✗ |
| Permission-only approval | Simple | Configured targets remain decorative | ✗ |

## Consequences

**Positive:** configured approvers and required steps become enforceable controls.

**Negative / Trade-offs:** target resolution needs explicit behavior for vacant
manager roles, org changes, delegation, escalation, and multiple eligible actors.

**Risks / Open questions:** coordinate point-in-time organization semantics with
WORK-0025 and define quorum/delegation/escalation behavior.

## Definition of done

- [x] Every approve/reject/return action verifies the actor against the current
      snapshot step target after obtaining a report lock.
- [x] Role, relationship, hybrid, and system target types have tested semantics.
- [x] Step advancement skips zero or more steps and never bypasses a later required step.
- [x] Submission requires at least one active valid line and totals only active lines.
- [x] Workflow status/history enforces the same view-scope policy as report detail.
- [x] Commands reject duplicate/concurrent actions deterministically through row locks and expected versions.
- [x] Workflow action, history, report state, and audit commit atomically.
- [x] Tests cover unauthorized approver, return bypass, multi-skip, races, and deleted lines.

## Implementation notes

- Submission freezes eligible user IDs from active, verified accounts into the
  report snapshot. Role targets resolve role members; relationship targets
  support direct manager, manager chain, and department head; hybrid targets
  use the intersection. Human execution of system targets fails closed until a
  system executor exists.
- Approval, rejection, and return now acquire the report lock and verify state,
  expected version, frozen target, and separation-of-duties rules in the same
  transaction that writes history, report state, and audit.
- Pending-approval and expense-line visibility use the frozen current-step
  principals. Legacy snapshots without them fail closed and must be resubmitted.
- `npm test` passes 29 tests. Database-backed transaction tests were not run in
  this workspace because `DATABASE_URL` is not configured.

## Log

- 2026-09-14 proposed — confirmed during workflow execution audit.
- 2026-09-14 accepted — immediate release blocker approved for implementation.
- 2026-09-15 shipped — transactional target authorization, step progression,
  active-line submission validation, scoped status access, and regression tests completed.
- 2026-09-15 deployed — included in the healthy production replacement image;
  legacy in-flight snapshots remain deliberately fail-closed until resubmitted.

---

> **For AI agents:** Preserve frozen-principal, fail-closed legacy-snapshot, and
> post-lock authorization semantics when extending workflow execution.
