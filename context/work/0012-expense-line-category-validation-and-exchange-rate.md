---
id: 0012
title: "Expense line category-code validation, exchangeRate, and transactionDate wire fix"
status: building
kind: fix
opened: 2026-08-15
decided: 2026-08-15
branch: fix/expense-line-response-validation
supersedes: ~
superseded-by: ~
---

# WORK-0012 — Expense line category-code validation, exchangeRate, and transactionDate wire fix

| | |
|---|---|
| **Opened** | 2026-08-15 |
| **Status** | building |
| **Kind** | fix |
| **Supersedes** | — |
| **Superseded by** | — |

## Problem

Found as uncommitted, unverified work already sitting in the working tree
(not written by this session) touching `expenseLines.ts`/`expenseLine.service.ts`/
`expenseLine.ts` (schema) and `expenseReport.ts` (schema). Reviewed before
committing, per the same discipline applied to the rest of this session's
work. It bundles three real, independent fixes:

1. **No validation that `categoryCode` refers to a real category.**
   `expense_lines.category_code` has no FK (`category_id` is the actual
   enforced foreign key — see expense-tracker's companion PR, "Stop
   category dropdowns from writing a category id as categoryCode",
   discovered from the same underlying gap). A typo'd or garbage code was
   silently accepted and stored.
2. **`exchangeRate` existed as a DB column and on `expense_reports`'
   API surface, but not on expense lines' — even though `expense_lines.exchange_rate`
   already existed in the schema, unused.**
3. **Wire-contract mismatch:** the documented/OpenAPI field is
   `transactionDate`, but Drizzle's internal field name for that column is
   `expenseDate` (`db/schema.ts`: `expenseDate: date('transaction_date')`).
   Responses were being built with `as any`, casting past the mismatch
   silently — clients received `expenseDate` where the docs promised
   `transactionDate`.

**A fourth, more serious problem was introduced by the incomplete fix for
#3, found during review, not part of the original working-tree state's
intent:** the fix added a `serializeLine()` helper that runs
`ExpenseLineSchema.parse()` on every response to correctly rename the
field — but `ExpenseLineSchema` declared `amount`/`taxAmount`/`taxRate`/
`exchangeRate`/etc. as `z.number()` and `createdAt`/`updatedAt` as
`z.string().datetime()`. Drizzle/`pg` return `NUMERIC`/`DECIMAL` columns as
strings and timestamps as non-strict-ISO strings, so **every** create/read/
update on `/expense-lines` started throwing a validation error on its own
successful response. Verified live: a valid create was persisted to the DB
correctly but the API returned `HTTP 400` for it. This would have shipped
completely broken if committed as found.

## Decision

Kept the three real fixes; fixed the response-validation gap that broke
them, using the pattern this codebase already established for exactly this
problem in `schemas/expenseReport.ts` (`numericField = z.coerce.number()`,
`datetimeField = z.string().transform(v => new Date(v).toISOString())`) —
copied into `schemas/expenseLine.ts`'s `ExpenseLineSchema`, applied only to
the **response** schema, not `CreateExpenseLineSchema`/
`UpdateExpenseLineSchema`/`BulkCreateExpenseLineItemSchema` (those
correctly keep plain `z.number()` — a client should send real JSON
numbers, not something that needs coercing).

Also included from the original working-tree diff, verified compatible:
`CreateExpenseReportSchema`'s optional fields (`description`, `projectId`,
`tags`, `exchangeRate`, etc.) now accept explicit `null`, not just
omission (`.nullable().optional()`), matching how `UpdateExpenseReportSchema`
already worked.

## Options considered

Not applicable for the category-validation/exchangeRate/transactionDate
work — that was found already-decided in the working tree, not designed
fresh in this session. For the response-validation break specifically:

| Option | Pros | Cons | Chosen? |
|---|---|---|---|
| Copy `expenseReport.ts`'s existing `numericField`/`datetimeField` coercion pattern into `expenseLine.ts` | Matches established precedent exactly; minimal, localized change | Duplicates the helper rather than sharing it | ✓ |
| Fix the shared Drizzle `num()` helper (`db/schema.ts`) to coerce at the ORM layer | Fixes it everywhere at once | Touches every table using `num()` (projects, budgets, workflow_assignments, expense_reports, ...) — most of which were never audited as part of this review; too large a blast radius for what was scoped as a response-shape bug | ✗ |
| Drop `ExpenseLineSchema.parse()`, go back to `as any` | Zero risk of this specific failure mode | Loses response validation entirely, including the correctness this fix was trying to add (the `transactionDate` rename) | ✗ |

## Consequences

**Positive:**
- Category codes are now validated before being persisted, closing the same data-integrity gap the expense-tracker companion fix closes from the frontend side
- `exchangeRate` is now settable/readable on expense lines, matching reports
- API responses now actually match their documented OpenAPI schema for expense lines (previously silently didn't, via `as any`)
- The response-validation break that would have shipped completely broken (every write/read returning 400) was caught and fixed before merge, not after

**Negative / Trade-offs accepted:**
- `numericField`/`datetimeField` now exist as separate, duplicated definitions in both `expenseReport.ts` and `expenseLine.ts` rather than a shared helper — flagged as a future cleanup, not done here (see Options considered)
- Existing clients that were relying on `categoryCode` accepting any string (including garbage) will now get a 400 for previously-silently-accepted bad codes — the correct behavior, but technically a breaking change for anyone depending on the old permissiveness

**Risks / Open questions:**
- The shared `num()` Drizzle helper (`db/schema.ts`) still lies about its runtime type (`.$type<number>()` with no actual transform) for every other table that uses it — this fix only addresses expense lines. Worth a dedicated audit of every route that returns Drizzle-sourced decimal fields through a schema declaring `z.number()` without coercion; not done as part of this item, scope was expense lines only

## Definition of done

- [x] `assertCategoryCodeExists()` validates `categoryCode` on create/update/bulk-create — verified live: unknown code → 400; real code → succeeds
- [x] `exchangeRate` field on expense lines: schema, service input types, insert/update logic, DB column already existed — verified live: round-trips correctly
- [x] `transactionDate` correctly returned (not `expenseDate`) on all six `expenseLines.ts` response call sites — verified live
- [x] `ExpenseLineSchema` response validation fixed (`numericField`/`datetimeField` coercion) — verified live across create, get-single, get-list, update, and bulk-create; all return real numbers and valid ISO datetimes, no false 400s
- [x] `tsc --noEmit` clean
- [ ] No automated test suite exists in this repo to add a regression test to (confirmed — no `*.test.ts`/`*.spec.ts` files anywhere); relying on this document + live verification notes as the record

## Log

- 2026-08-15 building — found as uncommitted work already in the working
  tree; reviewed for correctness before committing (per this session's
  practice of not committing unreviewed pre-existing changes as-is).
  Found and confirmed a severe defect via live testing (successful writes
  returning HTTP 400) before it could ship. Fixed by applying this repo's
  own existing `numericField`/`datetimeField` pattern from
  `expenseReport.ts`. Re-verified live across all affected endpoints
  (create, get, list, update, bulk-create) after the fix — all correct.

---

> **For AI agents:** Do NOT implement this work item unless status is
> `accepted` or `building`. If status is `proposed`, surface it to the user
> for a decision before writing any code. If status is `superseded`, follow
> the item in `superseded-by` instead — do NOT implement the pattern
> described here. If you are about to contradict an `accepted`, `building`,
> `shipped`, or `operating` item, stop and surface it to the user before
> proceeding.
