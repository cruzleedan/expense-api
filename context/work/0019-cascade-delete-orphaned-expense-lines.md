---
id: 0019
title: "Cascade-delete expense lines when their report is deleted"
status: shipped
kind: fix
opened: 2026-08-16
decided: 2026-08-16
branch: fix/0019-cascade-delete-orphaned-expense-lines
supersedes: ~
superseded-by: ~
---

# WORK-0019 — Cascade-delete expense lines when their report is deleted

| | |
|---|---|
| **Opened** | 2026-08-16 |
| **Status** | shipped |
| **Kind** | fix |
| **Supersedes** | — |
| **Superseded by** | — |

## Problem

`deleteExpenseReport()` in `expenseReport.service.ts` only sets
`deletedAt` on the `expense_reports` row — it never touches the report's
child `expense_lines`. `listExpenseReports()` correctly filters out
soft-deleted reports (`isNull(expenseReports.deletedAt)`), but the child
lines have their own, independent `deletedAt` and were never being
touched, so they survive as live, fully editable rows that reference a
`report_id` the owner can no longer see or reach through any report-based
view. There was also no guard preventing a report with lines from being
deleted in the first place.

Found while investigating a user report of a missing expense report: the
report they were told belongs to a given line (`report_id` on the line)
wasn't showing in their report list. The report itself was working exactly
as designed (soft-deleted, correctly excluded from the list) — the actual
bug was the orphaned line still pointing at it.

This wasn't a hypothetical edge case: a DB sweep at the time found **55
orphaned expense lines** across the database (going back to 2026-06-07),
left behind by every report deletion that ever happened on a non-empty
report, mostly via E2E test fixtures — but the code path is identical for
real user data.

## Decision

Cascade the soft-delete: `deleteExpenseReport()` now wraps both updates in
a single `db.transaction()` — the report gets `deletedAt`/`updatedAt`/
`version` bumped as before, and any of its `expense_lines` still having
`deletedAt IS NULL` get the same treatment in the same transaction, so a
deleted report can never again leave live lines behind.

Existing orphans backfilled with a one-off `UPDATE ... FROM` matching each
orphaned line's `deleted_at` to its parent report's `deleted_at` (not
`NOW()`, to keep the historical timestamp accurate) — 55 rows fixed,
verified zero orphans remain.

Chose cascade over blocking deletion when lines exist: expense lines
belong entirely to their report (no cross-report references), a report is
the unit a user thinks of as "this thing I'm deleting," and soft-delete
already makes the action non-destructive/reversible at the DB level if a
restore path is ever added. Blocking would add friction to what's
currently a one-click action for comparatively low benefit, given nothing
here is actually unrecoverable.

## Options considered

| Option | Pros | Cons | Chosen? |
|---|---|---|---|
| Cascade soft-delete lines in the same transaction as the report | No orphans possible; consistent with the report's own soft-delete pattern; no new user-facing friction | Deletes lines without a separate per-line confirmation | ✓ |
| Block deletion (409) if the report still has lines | Maximally safe against accidental data loss | Adds friction to every report deletion; requires a separate "remove all lines first" flow that doesn't otherwise exist | ✗ |
| Leave orphans as-is, only clean the DB one time | No code change | Bug recurs on the very next deletion of a non-empty report | ✗ |

## Consequences

**Positive:**
- Closes a real, silently-recurring data-integrity bug — 55 confirmed instances before the fix
- Report deletion is now atomic and leaves no orphaned child rows

**Negative / Trade-offs accepted:**
- No per-line confirmation before cascade — accepted per Decision above, since the report-level delete was already a one-click, no-confirmation action with no UI-level warning about line count

**Risks / Open questions:**
- None new

## Definition of done

- [x] `deleteExpenseReport()` cascades to `expense_lines` inside a single `db.transaction()`, verified live: created a report + line as `employee@test.local`, deleted the report, confirmed the line's `deletedAt` matches the report's `deletedAt` exactly
- [x] Existing 55 orphaned lines backfilled to match their report's `deletedAt`; verified `0` orphans remain via a join query
- [x] `tsc --noEmit` clean

## Log

- 2026-08-16 proposed, accepted, building — user reported a report missing
  from their list despite a real expense line pointing at it. Investigation
  found the report was correctly soft-deleted and correctly excluded from
  the list, but the line was orphaned — `deleteExpenseReport()` never
  cascaded. A DB-wide sweep found 55 existing orphans. Presented the user
  with delete-behavior options (cascade vs. block vs. leave existing data);
  user chose cascade going forward and requested the existing orphans be
  cleaned up too. Implemented and verified live the same session.
- 2026-08-16 shipped — merged to `main` (PR #12), confirmed with
  `git merge-base --is-ancestor` against `origin/main` and a content grep
  for the cascade-delete comment on `origin/main`'s
  `src/services/expenseReport.service.ts`, not just the PR's "Merged"
  label.

---

> **For AI agents:** Do NOT implement this work item unless status is
> `accepted` or `building`. If status is `proposed`, surface it to the user
> for a decision before writing any code. If status is `superseded`, follow
> the item in `superseded-by` instead — do NOT implement the pattern
> described here. If you are about to contradict an `accepted`, `building`,
> `shipped`, or `operating` item, stop and surface it to the user before
> proceeding.
