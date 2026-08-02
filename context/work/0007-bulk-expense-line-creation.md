---
id: 0007
title: "Bulk expense line creation with receipt auto-association"
status: accepted
kind: feature
opened: 2026-02-03
decided: 2026-02-03
branch: ~
supersedes: ~
superseded-by: ~
---

# WORK-0007 — Bulk expense line creation with receipt auto-association

| | |
|---|---|
| **Opened** | 2026-02-03 |
| **Status** | accepted |
| **Kind** | feature |
| **Supersedes** | — |
| **Superseded by** | — |

## Problem

The frontend's ICR receipt-parsing workflow (see `expense-tracker`
`context/work/0010-expense-line-icr.md`) needed a way to create multiple
expense lines in a single request, optionally auto-associating each with
the receipt it was parsed from, rather than one API call per line.

## Decision

Added `POST /v1/expense-reports/:reportId/lines/bulk`, accepting an array of
line objects (each with an optional `receiptId` for auto-association),
returning `{ created, failed }` with per-index error reporting for partial
failures. Uses transaction semantics so a batch partially succeeds rather
than all-or-nothing failing on one bad row.

## Options considered

| Option | Pros | Cons | Chosen? |
|---|---|---|---|
| Single bulk endpoint with partial-success semantics (this design) | One request for the whole ICR-confirmed batch; clear per-line error reporting | More complex handler than a simple create loop | ✓ |
| Client makes N individual `POST /lines` calls | Simplest backend | N round trips; no atomicity; awkward partial-failure UX for a receipt-confirmation flow | ✗ |
| All-or-nothing transaction (reject whole batch on any invalid line) | Simpler transaction semantics | One bad line (e.g. a typo'd amount) blocks the whole batch the user otherwise wants to commit | ✗ |

## Consequences

**Positive:**
- Matches the ICR confirmation-modal UX (see `expense-tracker` WORK-0003 /
  WORK-0010) where a user reviews several parsed lines and commits them together
- Partial success means one bad line doesn't block the rest

**Negative / Trade-offs accepted:**
- Batch size should be capped (recommended 100 lines/request) to bound
  transaction size — verify this limit is actually enforced if this becomes
  load-bearing; not confirmed as part of this migration

**Risks / Open questions:**
- Verified against `expense-tracker`'s actual code (2026-08-02): the API
  client method (`createBulkExpenseLines`) and a mutation hook
  (`createBulkLines` in `useExpenseLines.ts`) exist and correctly target
  this endpoint — but neither is called anywhere. The ICR confirmation
  modal (`ParsedReceiptConfirmationModal.tsx` via `ReportDetailPage.tsx`)
  stages parsed rows into the local table
  (`expenseLinesRef.current?.addRows(...)`) instead, with an explicit code
  comment: "Add rows to the local expense lines table (not to server) —
  User must click Save to persist changes." So this endpoint is unused —
  the actual save path goes through the pre-existing single-line create
  flow, not bulk. `expense-tracker`
  `context/work/0010-expense-line-icr.md` is still `status: proposed` and
  its Definition of done doesn't yet reflect this partial-build state. Not
  resolved here; flagging for whoever picks up WORK-0010 next in
  `expense-tracker`.

## Definition of done

- [x] `POST /v1/expense-reports/:reportId/lines/bulk` implemented (`src/routes/expenseLines.ts`)
- [x] `bulkCreateExpenseLines` service function implemented
- [x] Partial-success response shape (`created`/`failed` arrays)
- [ ] Batch size cap enforced — not verified as part of this migration

## Log

- 2026-02-03 accepted — migrated from loose `enhancement_plan/icr_enhancement.md`
  to this work item during framework consolidation (2026-08-02); confirmed
  already implemented in `src/routes/expenseLines.ts` at migration time

## Implementation Notes

Route and handler: `src/routes/expenseLines.ts` (`bulkCreateLineRoute`,
`bulkCreateLineHandler`). Service: `bulkCreateExpenseLines` in the expense
line service. The original planning doc also proposed a receipt re-parse
endpoint (`GET /v1/receipts/:id/parse`) and thumbnail generation — neither
was confirmed as implemented during this migration; if still wanted, they
need their own work item rather than being assumed done.

---

> **For AI agents:** Do NOT implement this work item unless status is
> `accepted` or `building`. If status is `proposed`, surface it to the user
> for a decision before writing any code. If status is `superseded`, follow
> the item in `superseded-by` instead — do NOT implement the pattern
> described here. If you are about to contradict an `accepted`, `building`,
> `shipped`, or `operating` item, stop and surface it to the user before
> proceeding.
