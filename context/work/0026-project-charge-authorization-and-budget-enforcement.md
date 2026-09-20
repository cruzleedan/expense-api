---
id: 0026
title: "Project-based expense charging authorization and budget enforcement"
status: proposed
kind: feature
opened: 2026-08-19
decided: ~
branch: ~
supersedes: ~
superseded-by: ~
---

# WORK-0026 — Project-based expense charging authorization and budget enforcement

| | |
|---|---|
| **Opened** | 2026-08-19 |
| **Status** | proposed |
| **Kind** | feature |
| **Supersedes** | — |
| **Superseded by** | — |

## Problem

Surfaced while reviewing WORK-0024 (project-scoped report *visibility*)
against a real-world expectation: projects are generally visible
org-wide, an employee should be able to select the project their
expenses are charged to, and — if that project has an allocated budget
and the employee is authorized ("budgeted") against it — submitting the
report should charge the spend to the project.

None of that charging/authorization/budget-enforcement path exists
today. This is a distinct gap from WORK-0024, which only covers who can
*read* reports tagged to a project (via `owner_user_id`); it says
nothing about who may *tag* a report to a project in the first place or
whether budget is enforced.

Confirmed by reading the current implementation:

- `projectId` on `expense_reports`/`expense_lines`
  (`expenseReport.service.ts:123,183`, similarly `expenseLine.service.ts`)
  is accepted with **no service-level validation**: the foreign key rejects
  a nonexistent project at the database layer, but there is no domain-level
  existence error, no check it's `active` (vs. `on_hold`/`completed`/
  `cancelled`), and no check the caller has any relationship to it. Any
  employee can charge to any existing project UUID.
- There is no concept of an employee being "budgeted" or authorized
  against a project anywhere in the schema — no `project_members` /
  per-employee allocation table. `project.assign` ("Assign expenses to
  projects", `schema.sql:1627`) is seeded as a permission but is never
  checked in any route or service.
- `projects.budget_amount` / `spent_amount` / `remaining_amount`
  (`schema.sql:60-66`) exist but are decorative. The only function that
  recomputes `spent_amount`, `updateProjectSpentAmount()`
  (`project.service.ts:315`), is **never called** from create, submit,
  or approval flows — project spend never actually rolls up.
- `canSubmitReport()` (`approval.service.ts:420`) checks only report
  ownership, status (`draft`/`returned`), and non-empty lines. No budget
  check exists, so submission isn't blocked even for a project that's
  already over budget, completed, or cancelled.

## Decision

Not yet decided — proposing the shape:

- Introduce an explicit authorization link between employees and
  projects for *charging* purposes (separate concern from WORK-0024's
  visibility grant, though it may reuse the same underlying membership
  table if one gets built). Options range from a lightweight
  "project must be `active`, no per-employee gate" to a full
  `project_members`/allocation table — see Options below.
- Validate `projectId` at report/line create-or-update time: project
  must exist, must be `active`, and (if per-employee authorization is
  adopted) caller must be authorized against it.
- Wire actual spend tracking into the submit/approve flow so
  `projects.spent_amount` reflects reality — decide at which
  transition (submit vs. final approval) spend counts against budget,
  since a submitted-but-not-yet-approved report arguably shouldn't
  reserve budget the same way an approved one does.
- Decide whether exceeding `remaining_amount` blocks submission
  (hard stop) or only warns/flags for the approver (soft gate) — this
  is a product decision, not just a technical one.

## Options considered

| Option | Pros | Cons | Chosen? |
|---|---|---|---|
| Project must simply be `active`; no per-employee authorization | Minimal, closes the "charging to a dead project" hole immediately | Doesn't address "employee is budgeted" — anyone can still charge to any active project | — |
| Add per-employee authorization (new table or reuse WORK-0024's future `project_members`) gating who may charge to a project | Matches the real-world expectation described; closes the authorization gap fully | New schema; needs coordination with WORK-0024 if that item adds `project_members` later | — |
| Enforce budget as a hard submit-time block when remaining budget is insufficient | Prevents overspend at the source | Rejects legitimate edge cases (e.g. reimbursable overage pending a budget increase) unless paired with an override path | — |
| Enforce budget as a soft flag surfaced to the approver, no hard block | Keeps human judgment in the loop for edge cases | Doesn't actually prevent overspend, just reports it | — |
| Leave as-is | No work | Project budgets remain purely decorative; any employee can charge any project regardless of status or budget | — |

## Consequences

**Positive (once implemented):**
- Project budgets become meaningful instead of decorative
- Closes an open authorization hole (any employee can currently charge
  to any project, including inactive/completed/cancelled ones)

**Negative / Trade-offs accepted:**
- Adds a validation/authorization step to report and line creation,
  which touches a hot path (`expenseReport.service.ts`,
  `expenseLine.service.ts`)
- If per-employee authorization is adopted, needs coordination with
  WORK-0024 to avoid two divergent "who belongs to this project" tables

**Risks / Open questions:**
- Whether "budgeted" means per-employee budget allocation, or simply
  "the project as a whole has remaining budget and the employee is an
  authorized member" — needs a product decision before design can be
  finalized
- Which lifecycle transition (submit vs. approve vs. payment) is the
  right point to count spend against budget
- Hard block vs. soft flag on insufficient remaining budget
- Reports and lines can specify different projects, while analytics uses the
  line project as an override (`COALESCE(el.project_id, er.project_id)`) and
  `updateProjectSpentAmount()` currently counts only `expense_lines.project_id`.
  Define one canonical effective-project rule before enforcing budgets.
- A hard budget cap must be enforced transactionally; a separate
  check-then-update can let concurrent submissions both pass against the same
  remaining balance. Decide whether this needs row locking, an atomic budget
  reservation, or another concurrency-safe mechanism.
- Rejection, return, deletion, amount edits, and project reassignment after
  submission can all release or move committed spend; every allowed lifecycle
  transition needs an explicit rollback/recalculation rule.
- Should coordinate with WORK-0024 (`project_members`/multi-owner is
  flagged there as a legitimate future need too) so the two items don't
  build parallel, inconsistent membership concepts

## Definition of done

- [ ] Decision made on: per-employee authorization vs. active-project-only;
      hard block vs. soft flag on budget; which lifecycle stage counts
      spend
- [ ] `projectId` validated on report/line create and update: project
      must exist and be `active`; caller must be authorized if
      per-employee gating is adopted
- [ ] Canonical effective-project behavior is defined for report defaults and
      line overrides and used consistently by authorization, analytics, and
      budget calculations
- [ ] `updateProjectSpentAmount()` (or equivalent) wired into the actual
      submit/approve flow so `spent_amount`/`remaining_amount` reflect
      real charged expenses
- [ ] Submission behavior for over-budget projects matches the decision
      (block or flag), verified live
- [ ] Concurrent submissions and spend-reversing lifecycle transitions are
      covered by tests so budget state cannot silently drift or oversubscribe
- [ ] `tsc --noEmit` clean

## Log

- 2026-08-19 proposed — surfaced while reviewing WORK-0024 against a
  real-world scenario (employee selects a visible project; submission
  charges to it if budgeted). Found the charging/authorization/budget-
  enforcement path doesn't exist independent of WORK-0024, which only
  covers report *visibility*. Opened as its own item since it's a
  distinct permission/enforcement dimension from WORK-0024's read-access
  scope.

---

> **For AI agents:** Do NOT implement this work item unless status is
> `accepted` or `building`. If status is `proposed`, surface it to the user
> for a decision before writing any code. If status is `superseded`, follow
> the item in `superseded-by` instead — do NOT implement the pattern
> described here. If you are about to contradict an `accepted`, `building`,
> `shipped`, or `operating` item, stop and surface it to the user before
> proceeding.
