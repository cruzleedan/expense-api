---
id: 0022
title: "Block expense line create/edit/delete once the parent report leaves draft"
status: building
kind: fix
opened: 2026-08-16
decided: 2026-08-16
branch: feature/0021-0022-category-line-authz
supersedes: ~
superseded-by: ~
---

# WORK-0022 — Block expense line create/edit/delete once the parent report leaves draft

| | |
|---|---|
| **Opened** | 2026-08-16 |
| **Status** | building |
| **Kind** | fix |
| **Supersedes** | — |
| **Superseded by** | — |

## Problem

`expense_reports.status` has eight states (`draft`, `submitted`, `pending`,
`approved`, `rejected`, `returned`, `posted`, `paid` —
`db/schema.sql:352`), but nothing in `expenseLine.service.ts` ever checks
it. `createExpenseLine`/`updateExpenseLine`/`deleteExpenseLine` only check
ownership (`verifyReportOwnership`/`getExpenseLineById` — see WORK-0021's
sibling investigation into what *is* checked) — never report status.
Confirmed by code search: no file under `src/services/` blocks a line
mutation based on report status; the only places `expense_lines` and
report status appear together are read-only aggregations (`SUM(amount)`,
`COUNT(*)` in `approval.service.ts:430,454` and `workflow.service.ts:215`
for totals), not gates.

Concretely: a report's owner can add, edit, or delete its expense lines
after the report has been `submitted`, is `pending` approval, has been
`approved`, or has even been `posted`/`paid` — silently changing figures
an approver already signed off on, or a report that's already been sent to
accounting.

Found while auditing what authorization/business-state checks a queued
mobile sync operation would actually hit (see WORK-0025, the Flutter
team's offline category/expense sync). This makes the offline case worse
than the online one: a line edit queued locally *before* a report was
submitted can sit in the device's outbox and land *after* submission or
approval once the device reconnects, changing an already-approved report
without anyone re-reviewing it. The bug exists independent of sync, but
sync is what makes "edited before, applied after" a routine occurrence
instead of a rare race.

## Decision

Implemented as proposed, with both open sub-decisions resolved during
implementation (user approved the overall direction and deferred these to
implementation time — see Log):

- Added `assertReportEditable(reportId)` / `assertEditableStatus(status)`
  in `expenseLine.service.ts`, using an **allowlist** (`draft`, `returned`
  are editable) rather than a denylist of locked statuses — a future
  status added to `expense_reports.status`'s `CHECK` constraint is locked
  by default, not silently editable.
- Called from `createExpenseLine` (when attaching to a report, reusing the
  report row `verifyReportOwnership` already fetches — no extra query),
  `updateExpenseLine` (both for the line's *current* report and, if the
  request reassigns `reportId`, the *target* report), `deleteExpenseLine`,
  and `bulkCreateExpenseLines` (same code path as single-create, would
  otherwise have been an obvious bypass around the whole fix).
- **Exception path: none.** No permission bypasses this lock. Reasoning:
  the lock is a hard business-state boundary (a report already
  signed off, posted, or paid), and the correct way to edit its lines is
  to move the report itself back to an editable state first (e.g. via the
  existing `report.return` action) — not a special "edit anyway"
  permission that risks becoming an unaudited backdoor around approvals.
  Revisit if a real workflow need for finance/admin override surfaces.
- **Error shape: `ConflictError` (`409`), not `ForbiddenError` (`403`).**
  This matches how this codebase already uses `409` elsewhere in this
  same review (category delete-in-use, WORK-0020) for "the request is
  valid and you're allowed to make it, but the record's current state
  won't permit it" — keeping `403` reserved for identity/ownership
  failures (a genuinely different failure class) and giving the mobile
  team one consistent status code to key their non-retryable-conflict
  handling off of, rather than two.

## Options considered

| Option | Pros | Cons | Chosen? |
|---|---|---|---|
| Block line mutation when report status is outside `draft`/`returned`, no exception path, `409` | Matches user's mental model ("once submitted, it's locked"); closes the sync-reordering hole directly; one consistent non-retryable status code across this and WORK-0020 | Any legitimate post-submission correction must go through reopening the report first — no fast path | ✓ |
| Same, but with a `report.edit.all`-style bypass for finance/admin | Gives elevated roles a direct correction path | No existing evidence this is actually needed; a bypass around an approval boundary is exactly the kind of thing that should be deliberately added later if asked for, not assumed now | ✗ |
| Leave line mutation open, rely on `report.edit.own`/`.all` scoping only | No new check needed | Doesn't fix the actual problem — ownership was never the gap here, status was | ✗ |
| Reject the mobile sync push specifically (client-side pre-check before enqueueing), leave server unchanged | No backend change | Doesn't protect the direct API/web path at all, and a client-side-only check is trivially bypassed; the server has to be the one that's actually safe | ✗ |

## Consequences

**Positive (once implemented):**
- Closes a real correctness gap that predates and is independent of the mobile sync work, but is made much more likely to trigger by it
- Matches user expectation that an approved/posted report's figures are stable

**Negative / Trade-offs accepted:**
- Adds a new `409` failure mode that the mobile sync queue (and the web app) need to handle distinctly from a data conflict, and distinctly from a `403` — a queued edit against a report that got submitted/approved while offline shouldn't be silently retried or silently dropped; the user needs to see it
- No correction path for finance/admin short of reopening the report — accepted deliberately, see Decision

**Risks / Open questions:**
- None outstanding — both prior open questions resolved during implementation (see Decision)

## Definition of done

- [x] Exception path decided: none — see Decision
- [x] Error shape decided: `409 ConflictError`, matching WORK-0020's convention
- [x] `createExpenseLine`/`updateExpenseLine`/`deleteExpenseLine`/`bulkCreateExpenseLines` reject mutations when the parent report's status is outside `draft`/`returned` — verified live: edit succeeds while `draft`, submit succeeds, then edit/create/delete on the same line all return `409` while `submitted`; edit succeeds again after moving the report to `returned`
- [ ] Mobile team (WORK-0025) notified of the finalized error shape so their sync queue can surface it distinctly rather than retrying or silently dropping it — not yet communicated, since this wasn't in scope for the last client-plan artifact update (that covered categories/WORK-0021 only)
- [x] `tsc --noEmit` clean

## Log

- 2026-08-16 proposed — found while auditing what a queued mobile sync
  push actually gets checked against, alongside the categories
  authorization gap (WORK-0021). Confirmed via code search that no report-
  status check exists anywhere in the expense-line mutation path — only
  read-only aggregations reference report status near expense lines.
  Opened as its own item since it's a genuinely separate bug (business-
  state lock, not authorization) with its own decision to make about the
  exception path and error shape.
- 2026-08-16 accepted — user approved the proposed direction as-is. The
  two sub-decisions flagged above (elevated-permission exception path,
  and `403` vs. a distinct locked-state error shape) are still open and
  should be resolved when implementation starts, not before — they don't
  block moving this to `accepted`.
- 2026-08-16 building — user asked to start implementation alongside
  WORK-0021. Resolved both open sub-decisions (no exception path; `409`
  not `403`, see Decision) and implemented `assertReportEditable`/
  `assertEditableStatus` in `expenseLine.service.ts`, wired into all four
  mutation entry points including `bulkCreateExpenseLines` (not originally
  listed in the DoD, added since it shares the exact same code path and
  would otherwise have been a bypass). Live-verified the full lifecycle:
  create+edit while `draft` succeed, submit succeeds, edit/create/delete
  all correctly `409` while `submitted`, edit succeeds again once the
  report is moved to `returned`. All QA data cleaned up afterward.

---

> **For AI agents:** Do NOT implement this work item unless status is
> `accepted` or `building`. If status is `proposed`, surface it to the user
> for a decision before writing any code. If status is `superseded`, follow
> the item in `superseded-by` instead — do NOT implement the pattern
> described here. If you are about to contradict an `accepted`, `building`,
> `shipped`, or `operating` item, stop and surface it to the user before
> proceeding.
