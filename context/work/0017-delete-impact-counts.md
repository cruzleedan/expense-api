---
id: 0017
title: "Value-count endpoints for field and form delete confirmation"
status: building
kind: feature
opened: 2026-08-15
decided: 2026-08-15
branch: feature/0017-delete-impact-counts
supersedes: ~
superseded-by: ~
---

# WORK-0017 — Value-count endpoints for field and form delete confirmation

| | |
|---|---|
| **Opened** | 2026-08-15 |
| **Status** | building |
| **Kind** | feature |
| **Supersedes** | — |
| **Superseded by** | — |

> **Companion item:** expense-tracker `context/work/0019-delete-confirmation-with-counts-ui.md`
> — the confirm-dialog UI that calls these endpoints.

## Problem

`deleteField()` (WORK-0010) and `deleteForm()` (WORK-0016) both have zero
awareness of `expense_line_field_values`/`expense_report_field_values`
(WORK-0015). Since those cascade on `field_id`/`form_id` via `ON DELETE
CASCADE`, deleting a custom field or a form today silently destroys every
stored value against it, with a generic "can't be undone" confirmation
that never mentions data is at stake. This became a live risk the moment
WORK-0016/0017 (tracker) made custom fields on `expense_line`/
`expense_report` actually fillable by real users — not a hypothetical.

## Decision

Two small, read-only, on-demand endpoints — not baked into the existing
list/detail responses, since those are fetched far more often than
deletes happen and shouldn't pay an aggregation cost on every load:

- **`GET /v1/admin/fields/{fieldId}/delete-impact`** → `{ valueCount:
  number }` — count of rows in whichever of
  `expense_line_field_values`/`expense_report_field_values` reference
  this `field_id` (only one will ever have matches, since a field belongs
  to one screen, but the query checks both rather than branching on
  `screenId` — simpler, and correct even if that assumption ever
  changes).
- **`GET /v1/admin/forms/{formId}/delete-impact`** → `{ fieldCount:
  number, valueCount: number }` — `fieldCount` is a simple `COUNT(*)` on
  `field_definitions WHERE form_id = $1`; `valueCount` is the same
  value-table query as above, summed across every field on the form.

Both gated by `form.manage` (the same permission that already gates the
delete actions themselves) — this is only useful information in service
of a delete decision, not a general-purpose read.

**Known-zero case, called out explicitly, not hidden:** only
`expense_line`/`expense_report` ever have rows in the value tables, and
both are locked (undeletable) — so `GET .../forms/{formId}/delete-impact`
on any form that's actually *possible* to call `DELETE` on today will
always return `valueCount: 0`. Building this now anyway because it's
cheap, keeps the confirmation UX consistent with the field-level one, and
stops being a trivial case the moment any future form type gets wired to
real data — see the tracker companion's Log for why this was still worth
doing rather than deferring until it matters.

## Options considered

| Option | Pros | Cons | Chosen? |
|---|---|---|---|
| On-demand `delete-impact` endpoints, fetched only when the delete icon is clicked | No cost on the much more frequent list/detail fetches | One extra round-trip before the confirm dialog can show real numbers | ✓ |
| Embed `valueCount`/`fieldCount` directly in the existing list/detail responses | No extra round-trip | Pays an aggregation query on every list page load and every form-detail fetch, for information almost never actually needed | ✗ |
| Two-phase `DELETE` (first call 409s with a count, `?force=true` actually deletes) | No new GET endpoint | Confirmation happens *after* a failed delete attempt instead of before the admin commits to clicking — worse UX ordering than showing the real number in the dialog up front | ✗ |

## Consequences

**Positive:**
- Closes a real, already-live data-loss risk on field deletion, and the form-level version proactively before it's ever actually triggerable
- Reuses the same shape/pattern for both entities — one mental model, not two

**Negative / Trade-offs accepted:**
- Two new small endpoints, mostly for a case (`forms/.../delete-impact`) that returns a constant `0` for everything currently deletable — accepted as intentional future-proofing, not scope creep, per the Decision section's reasoning

**Risks / Open questions:**
- None new

## Definition of done

- [x] `GET /v1/admin/fields/{fieldId}/delete-impact` returns an accurate `valueCount`, verified live: `0` before any values existed, `2` after creating two expense lines with a value in that field
- [x] `GET /v1/admin/forms/{formId}/delete-impact` returns accurate `fieldCount`/`valueCount`, verified live against `expense_line` (real non-zero counts) and a throwaway custom form (`{"fieldCount":1,"valueCount":0}`, confirming the known-zero case)
- [x] `tsc --noEmit` clean

## Log

- 2026-08-15 proposed — the field-level version was requested directly by
  the user after the assistant flagged the existing gap unprompted; the
  form-level version was requested in the same message, explicitly asking
  whether the same pattern made sense there too. Answered yes, with the
  two-number (field count + value count) refinement, before this document
  was written.
- 2026-08-15 accepted, building — approved by user alongside the
  expense-tracker companion. Implementation complete, verified live
  end-to-end as noted in Definition of done. Test artifacts (field, form,
  expense lines created for verification) cleaned up afterward via the
  same DELETE endpoints being tested.

---

> **For AI agents:** Do NOT implement this work item unless status is
> `accepted` or `building`. If status is `proposed`, surface it to the user
> for a decision before writing any code. If status is `superseded`, follow
> the item in `superseded-by` instead — do NOT implement the pattern
> described here. If you are about to contradict an `accepted`, `building`,
> `shipped`, or `operating` item, stop and surface it to the user before
> proceeding.
