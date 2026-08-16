---
id: 0020
title: "Category name uniqueness + safe conflict responses for offline/multi-device sync"
status: building
kind: feature
opened: 2026-08-16
decided: 2026-08-16
branch: feature/0020-category-conflict-handling
supersedes: ~
superseded-by: ~
---

# WORK-0020 — Category name uniqueness + safe conflict responses for offline/multi-device sync

| | |
|---|---|
| **Opened** | 2026-08-16 |
| **Status** | building |
| **Kind** | feature |
| **Supersedes** | — |
| **Superseded by** | — |

## Problem

The Flutter mobile client is designing offline-first sync for expense
categories (their WORK-0025, "Category Sync") — create/rename/delete
locally, queue a push, reconcile on collision, the same pattern already
used for expense lines and reports. Reviewing their design against this
repo's actual behavior (not the client team's assumptions) surfaced three
gaps that block their plan as designed:

1. **`name` has no uniqueness enforcement at all.** `expense_categories.name`
   is `varchar(100) notNull` with no unique constraint
   (`db/schema.ts:407`), and neither `createExpenseCategory` nor
   `updateExpenseCategory` check for a name conflict — only `code` is
   checked (`expenseCategory.service.ts:34-43, 125-134`). Two devices
   creating "Travel" concurrently both succeed with `201`, producing two
   permanent duplicate rows. The mobile client's reconciliation design
   (detect a duplicate-create response, re-point local references at the
   server's existing row) has nothing to react to for name collisions —
   there is no conflict response to catch.

2. **The existing `code` uniqueness check is TOCTOU.** Both create and
   update do a `SELECT` for an existing `code`, then a separate `INSERT`/
   `UPDATE` (`expenseCategory.service.ts:34-43, 125-134`). Two concurrent
   requests can both pass the `SELECT` before either commits, so the `code`
   column's DB-level `.unique()` constraint (`db/schema.ts:408`) is what
   actually stops the second write — but nothing catches that Postgres
   `23505` unique-violation error and converts it to a `ConflictError`.
   It falls through to the generic handler in `errorHandler.ts:64-77` and
   comes back as an undifferentiated `500 INTERNAL_ERROR`, not the `409`
   a client would need to detect and reconcile against.

3. **Delete doesn't check for in-use categories, only child categories.**
   `deleteExpenseCategory` checks for child categories via `parentId`
   before deleting (`expenseCategory.service.ts:162-169`), but
   `expense_lines.categoryId` also has an FK to `expense_categories.id`
   with no `onDelete` clause (default `RESTRICT`,
   `db/schema.ts:440`) — it's never checked. Deleting a category still
   referenced by any expense line hits the same unhandled-Postgres-error
   path as #2 and returns a bare `500` instead of the clean `409` a
   sync client (or the web UI) could act on.

All three matter together: the mobile team's whole sync design assumes
"the server tells us clearly when something collides" — right now it
sometimes doesn't tell them at all (#1), and sometimes tells them via an
opaque `500` that looks identical to a real server fault (#2, #3).

## Decision

Implemented and verified live against the dev DB/API (2026-08-16):

- Added a case-insensitive, trim-insensitive unique index on
  `expense_categories.name` (`lower(trim(name))` — matches the client's
  own stage-1 local dedup check exactly, so what the client considers "the
  same category" and what the server now enforces are the same rule).
- `createExpenseCategory`/`updateExpenseCategory` keep their pre-check
  `SELECT`s (fast, clear error on the common non-concurrent case) but now
  also wrap the insert/update in a `try/catch` keyed on the Postgres
  unique-violation error (`23505`) plus the specific constraint name
  (`expense_categories_code_key` vs `expense_categories_name_unique_ci`),
  converting either into the same `ConflictError` (`409`) the pre-check
  path already produced. Closes the TOCTOU gap for both columns, not just
  the new one — verified live by deliberately racing past the pre-check
  (see Definition of done).
- Rename (`PUT`) collisions are covered by the same `name` check, not just
  create — this was flagged as a gap in the client plan and is fixed by
  the same code path, not a separate one.
- `deleteExpenseCategory` now counts `expense_lines` referencing the
  category *before* attempting delete and returns `409` if any exist.
  Important correction made during live verification: the count must
  **not** filter out soft-deleted lines. A soft delete only sets
  `deletedAt` — it does not null out `categoryId` — so the FK's `RESTRICT`
  is still physically live regardless of a line's soft-delete state.
  Filtering by `isNull(deletedAt)` was tried first, verified live to let a
  soft-deleted line's category pass the check, and then still hit the
  same raw `500` on the actual `DELETE`. Fixed by counting all referencing
  rows regardless of `deletedAt`.

## Options considered

| Option | Pros | Cons | Chosen? |
|---|---|---|---|
| DB-level unique index on `lower(name)` + catch `23505` at the service layer | Correct under real concurrency (not just a pre-check race); single source of truth; matches how `code` is already partially enforced | Requires a migration; need to decide what happens to *existing* duplicate names already in the table before the constraint can be added | ✓ |
| Service-layer `SELECT`-then-check only (no DB constraint) | No migration | Same TOCTOU gap that already affects `code` today — doesn't actually fix the race, just adds a second copy of the same bug | ✗ |
| Leave `name` unconstrained; tell mobile client to poll/dedupe client-side after the fact | No backend change | Pushes an inherently server-side consistency problem onto every client; every client (web, mobile) would need to reimplement dedup independently | ✗ |
| Explicit `expense_lines` usage check before delete | Clean, catchable `409`; mirrors existing child-category check | One more query per delete | ✓ |
| Leave delete as-is, let FK `RESTRICT` surface as `500` | No code change | Indistinguishable from a real server error to any client; the web app's own `checkUsage()` call (`categoryApi.ts:142-154`) already tries to defend against exactly this and can't, because the endpoint it calls doesn't exist either | ✗ |

## Consequences

**Positive:**
- Gives the mobile sync design (and the web client, which has the same
  latent gap) an actual, catchable conflict signal for both name and code
  collisions.
- Closes a real correctness gap: duplicate category names can currently
  accumulate silently with no way to detect them after the fact.
- Delete failures become debuggable/actionable (`409` with a reason)
  instead of opaque `500`s.

**Negative / Trade-offs accepted:**
- Case-insensitive uniqueness on `name` is a product decision, not just a
  technical one (e.g., does "Travel" and "TRAVEL — Q1" count as a
  collision? current implementation is exact-match-after-trim/lowercase
  only, same as the mobile client's own stage-1 local check).
- `expense_lines.categoryId` is currently dead API surface — no
  create/update path on `/expense-lines` accepts or sets it today (only
  `categoryCode`/`category` are settable). Discovered while trying to
  exercise the new delete-in-use check live; had to set `category_id`
  directly via SQL to reach the code path at all. Not fixed here — flagged
  as a separate, pre-existing gap, out of scope for this item.

**Risks / Open questions:**
- Confirmed `expense_categories` has no `accountId`/`userId` column —
  uniqueness is correctly global in scope, matching current reality.
- Should `PUT` reject a rename that collides with a soft-deleted-in-future
  category once/if soft-delete is added? Out of scope here since delete
  is currently hard; flag again if soft-delete for categories is proposed
  later.
- Not yet committed/pushed — implemented and verified live against the
  dev container and dev DB only. `context/work/` items and code are
  changed in the working tree on `main`; needs an explicit decision on
  branching/commit/PR before this can move to `shipped`.

## Definition of done

- [x] Migration adds a case-insensitive unique index on `expense_categories.name` — applied live to dev DB as `expense_categories_name_unique_ci` on `lower(trim(name))`
- [x] Existing duplicate names — confirmed zero in dev data before applying the index; no backfill needed
- [x] `createExpenseCategory`/`updateExpenseCategory` return `409 Conflict` for both `name` and `code` collisions, including the concurrent/race case — verified live: pre-check path (duplicate name/code via normal request) and the DB-constraint path both return `409`, not `500`; also verified a `PUT` rename into an existing name returns `409`
- [x] `deleteExpenseCategory` returns `409 Conflict` when the category is referenced by any `expense_lines.categoryId` (soft-deleted lines included, per the FK correction above) — verified live end-to-end, including the soft-delete edge case that initially slipped through as a `500` before the fix
- [x] `tsc --noEmit` clean
- [ ] Mobile team (WORK-0025) and web team notified of the finalized conflict response shape so both can build their reconciliation logic against it
- [ ] Committed, pushed, and merged to `main`

## Log

- 2026-08-16 proposed — found while reviewing the Flutter client's
  "Category Sync" design (their WORK-0025) against this repo's actual
  behavior. Their reconciliation design assumed the server would reject
  duplicate-name creates; it doesn't. Also found two related unhandled-500
  paths (concurrent `code` collision, delete of an in-use category) that
  block the same effort and share the same root cause (no clean conflict
  response). Bundled as one item since a client-facing conflict-response
  contract should be designed once, not three times.
- 2026-08-16 accepted, building — user asked to start the server-side
  work while the mobile team builds their piece in parallel. Checked dev
  data for existing duplicate names before adding the constraint (none
  found — no backfill needed). Implemented the unique index, the
  concurrency-safe `409` conversion for both `code` and `name` (create and
  update), and the delete in-use check. Live-verified all paths against
  the running `expense-api` dev container: duplicate name (exact and
  case/whitespace-variant), duplicate code, rename-into-existing-name,
  clean delete of an unused category, and delete of an in-use category.
  The delete-in-use test caught a real bug in the first version of the
  check (filtering out soft-deleted lines let a still-FK-referenced
  category through to a raw `500`) — fixed and re-verified live. All test
  data cleaned up from the dev DB afterward; category count confirmed
  back to its original 18 rows.

---

> **For AI agents:** Do NOT implement this work item unless status is
> `accepted` or `building`. If status is `proposed`, surface it to the user
> for a decision before writing any code. If status is `superseded`, follow
> the item in `superseded-by` instead — do NOT implement the pattern
> described here. If you are about to contradict an `accepted`, `building`,
> `shipped`, or `operating` item, stop and surface it to the user before
> proceeding.
