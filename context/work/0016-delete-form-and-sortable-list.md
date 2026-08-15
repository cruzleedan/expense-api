---
id: 0016
title: "Delete non-locked forms; make the forms list sortable"
status: building
kind: feature
opened: 2026-08-15
decided: 2026-08-15
branch: feature/0016-delete-form-and-sortable-list
supersedes: ~
superseded-by: ~
---

# WORK-0016 — Delete non-locked forms; make the forms list sortable

| | |
|---|---|
| **Opened** | 2026-08-15 |
| **Status** | building |
| **Kind** | feature |
| **Supersedes** | — |
| **Superseded by** | — |

> **Companion item:** expense-tracker `context/work/0018-delete-form-and-sortable-forms-list-ui.md`
> — the UI half (delete button, Type column, column sorting).

## Problem

Forms have no delete endpoint at all today — `deleteField` exists and
already guards `is_system_defined` fields, but the form-level equivalent
was never built (WORK-0010 only shipped create/get/list/publish). As the
form designer accumulates admin-created custom forms alongside the two
locked system ones, there's no way to remove one that's no longer needed.

Separately: `listForms()` already has generic sort support
(`buildOrderByClause`/`FORM_SORTABLE_FIELDS`, the same pattern used
elsewhere in this codebase) but the route hardcodes `sortOrder: 'asc'`
and never reads a `sortBy`/`sortOrder` query param at all — the
capability exists at the service layer, just never wired to the API.

## Decision

**`DELETE /v1/admin/forms/{formId}`** — mirrors `deleteField`'s existing
guard exactly, but checks `form_definitions.is_locked` instead of
`is_system_defined`: `is_locked = true` → 409 `ConflictError` ("Cannot
delete a locked system form"). No new cleanup logic needed — every child
table (`field_definitions` and everything that cascades from it:
`field_role_rules`, `field_platform_rules`, `field_validation_rules`,
`field_options`, `expense_line_field_values`, `expense_report_field_values`)
already has `ON DELETE CASCADE` back to `form_definitions`, so a single
`DELETE FROM form_definitions WHERE id = $1` is sufficient. Gated by the
existing `form.manage` permission, same as every other mutating
form-designer route.

**Sortable list:** `FormListQuerySchema` gains `sortBy` (enum of
`FORM_SORTABLE_FIELDS`' keys, now including `isLocked`, mapped to
`is_locked`) and `sortOrder` (`asc`/`desc`), passed through to
`listForms()` instead of the current hardcoded `'asc'`. No change to
`listForms()` itself — it already accepts and uses these via
`PaginationParams`.

## Options considered

Not applicable — both changes follow patterns already established and
proven elsewhere in this same file (`deleteField`'s lock-guard,
`buildOrderByClause`'s existing generic sort support). No independent
design choices to weigh.

## Consequences

**Positive:**
- Closes a real gap — the form designer's "create a form" flow finally has a matching "delete it if you don't need it" counterpart, for anything that isn't one of the two locked forms
- Sorting is a small, low-risk change — wiring existing capability, not building new capability

**Negative / Trade-offs accepted:**
- None identified

**Risks / Open questions:**
- None new

## Definition of done

- [x] `DELETE /v1/admin/forms/{formId}` — 409 for `is_locked = true`, 200 success otherwise, verified live: deleting a locked form (`expense_line`) returns 409 with a clear message; deleting a throwaway non-locked form returns 200 and a follow-up GET confirms 404 (actually gone)
- [x] `FormListQuerySchema` accepts `sortBy`/`sortOrder`; `FORM_SORTABLE_FIELDS` includes `isLocked`; verified live: `?sortBy=isLocked&sortOrder=desc` puts both system forms first, `?sortBy=name&sortOrder=asc` sorts alphabetically, and omitting `sortBy` entirely produces byte-identical output to before this change (same `'name ASC'` fallback)
- [x] `tsc --noEmit` clean

## Log

- 2026-08-15 proposed — requested directly by the user, alongside the
  expense-tracker UI companion, after user testing surfaced that leftover
  e2e test forms have no way to be cleaned up via the app itself.
- 2026-08-15 accepted, building — approved by user alongside the
  expense-tracker companion ("yes, approve both and proceed to
  implementation"). Implementation complete, verified live end-to-end as
  noted in Definition of done.

---

> **For AI agents:** Do NOT implement this work item unless status is
> `accepted` or `building`. If status is `proposed`, surface it to the user
> for a decision before writing any code. If status is `superseded`, follow
> the item in `superseded-by` instead — do NOT implement the pattern
> described here. If you are about to contradict an `accepted`, `building`,
> `shipped`, or `operating` item, stop and surface it to the user before
> proceeding.
