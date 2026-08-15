---
id: 0015
title: "Custom field value storage for expense lines & reports"
status: shipped
kind: feature
opened: 2026-08-15
decided: 2026-08-15
branch: feature/0015-custom-field-value-storage
supersedes: ~
superseded-by: ~
---

# WORK-0015 — Custom field value storage for expense lines & reports

| | |
|---|---|
| **Opened** | 2026-08-15 |
| **Status** | shipped |
| **Kind** | feature |
| **Supersedes** | — |
| **Superseded by** | — |

> **Depends on:** `context/work/0014-lock-system-forms-and-platform-rules.md`
> (the two forms and their fields have to exist first).
> **Companion item:** expense-tracker `context/work/0016-schema-driven-expense-forms.md`
> — the UI that actually collects and submits these values.

## Problem

The form designer lets an admin add a genuinely new field — say
`costCenter` on `expense_line` — but there is nowhere for a value typed
into that field to go. `expense_lines`/`expense_reports` are fixed,
migrated tables; a `field_definitions` row an admin creates through the
UI has no corresponding column and never will, by design (that's the
whole point of not needing a deploy to add a field). Without this, WORK-0014
lets you *define* a custom field but not *use* one.

## Decision

**`expense_line_field_values`** and **`expense_report_field_values`** —
two new tables (one per parent, not a single polymorphic table, matching
how `field_role_rules`/`field_validation_rules`/`field_options` are each
already scoped to `field_definitions` directly rather than sharing a
generic "entity_type" column anywhere else in this schema):

```
expense_line_field_values (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  expense_line_id UUID NOT NULL REFERENCES expense_lines(id) ON DELETE CASCADE,
  field_id UUID NOT NULL REFERENCES field_definitions(id) ON DELETE CASCADE,
  value TEXT,
  created_at, updated_at,
  UNIQUE (expense_line_id, field_id)
)
```

(`expense_report_field_values` identical, keyed on `expense_report_id`.)

Every value is stored as `TEXT` regardless of the field's `field_type` —
`decimal`/`toggle`/`date` values are stringified on write and parsed back
on read against the field's current `field_type`, the same "trust the
field definition, not the stored shape" posture `field_options`/
validation rules already take. A field's `field_type` can't change after
creation for non-system fields either (mirrors `SYSTEM_FIELD_LOCKED_KEYS`
already blocking this for system fields — extend that same lock to *all*
fields' `fieldType` once values might exist against it, not just system
ones), so a stored value's shape can't drift out from under it.

The `FK ... ON DELETE CASCADE` on `field_id` means deleting a
non-system custom field silently deletes every value ever recorded
against it. That's accepted, not an oversight — `deleteField` already
refuses to delete `is_system_defined` fields (WORK-0010), and a
non-system field an admin deletes was, by definition, never load-bearing
for anything else in this schema.

**Endpoints:** values are read/written as part of the existing expense
line/report create and update routes, not a separate CRUD surface —
`POST`/`PUT /v1/expense-lines` (and the report equivalent) accept an
optional `customFields: { [fieldKey]: string | number | boolean }` object
alongside the existing typed body, validated against that screen's
currently-published `field_definitions` (unknown keys rejected the same
way `assertCategoryCodeExists` already rejects unknown category codes in
WORK-0012 — fail loud, don't silently drop). The existing
`GET /v1/expense-lines/{id}` (and list) response gains the same
`customFields` object, resolved by joining `expense_line_field_values` to
`field_definitions` for that field's key.

## Options considered

| Option | Pros | Cons | Chosen? |
|---|---|---|---|
| Two EAV-style values tables, one per parent | Matches the row-per-field pattern already used everywhere in this schema; real FK integrity — a deleted/renamed field can't silently orphan data under a stale key | Fetching "all custom values for one expense line" is a join, not a single-row read | ✓ |
| Single `custom_fields JSONB` column on `expense_lines`/`expense_reports` | One-row read, no join | No FK integrity to `field_definitions` — a deleted or renamed field leaves orphaned keys in old JSON blobs with nothing to validate against; breaks from the relational pattern this schema uses everywhere else | ✗ |
| One shared polymorphic values table (`entity_type`, `entity_id`) for both lines and reports | Less table duplication | No other table in this schema uses a polymorphic FK — every other per-entity extension (options, role rules, validation rules) is scoped to one parent type; would be the only exception | ✗ |

## Consequences

**Positive:**
- Closes the actual gap in WORK-0014 — fields can now be filled in, not just defined
- Deleting a custom field cleanly cascades its values; nothing needs manual cleanup

**Negative / Trade-offs accepted:**
- Reading an expense line with several custom fields now costs an extra join — acceptable at today's scale (a handful of custom fields per screen, not dozens), revisit if that changes
- `fieldType` immutability now needs enforcing for *every* field once it has values, not just system-defined ones — a small service-layer change beyond what WORK-0010 originally locked down

**Risks / Open questions:**
- `expense-mcp` (WORK-0009, building, separate repo) creates expense lines/reports via its own tool calls — those tools need to know about `customFields` too, or a report created via MCP silently can't carry the same custom data a web/mobile-created one can. Flagged for whoever owns that repo; out of reach from here, same class of note as the Flutter follow-ups in the mobile briefing.
- Bulk expense-line creation (WORK-0007) needs the same `customFields` handling added to stay consistent with the single-create path — not itself in scope here, but should be checked when this ships.

## Definition of done

- [x] `expense_line_field_values` / `expense_report_field_values` tables added to `schema.sql`/`schema.ts`
- [x] Create/update routes for expense lines and reports accept `customFields`, validated against that screen's published, non-system fields (unknown key **or system-field key** → 400) — covers both the report-nested and standalone expense-line create routes, since both call the same `createExpenseLine` service function
- [x] Read routes (single + list) include a resolved `customFields` object, for both expense lines and expense reports
- [ ] `fieldType` immutability extended to all fields once referenced by any stored value, not just `is_system_defined` ones — **not done**, deferred (see Log): would need a live "does any value row reference this field" check in `updateField`'s system-lock logic; skipped for this pass since no real admin has custom fields with live data yet, but this is a real gap before that becomes true
- [x] Verified live: added a custom `costCenter` text field, created a standalone expense line with `customFields: { costCenter: "CC-1234" }`, read it back, confirmed unknown keys AND system-field keys (e.g. `description`) are both rejected with 400, deleted the field, confirmed the value cascaded away while the line still loads normally
- [x] `tsc --noEmit` clean

## Log

- 2026-08-15 proposed — opened as the storage half of expense-tracker's
  planned schema-driven forms (`context/work/0016` there); the EAV-table
  design was the user's explicit choice over a JSONB column, made when
  asked directly.
- 2026-08-15 accepted, building — approved by user alongside the other
  three items in this round.
- 2026-08-15 building — implementation complete for the primary
  create/update/get/list paths on both expense lines and reports, verified
  live end-to-end including the delete-cascade. Explicitly **not** wired:
  bulk expense-line creation, the sync endpoints, and standalone-vs-nested
  create's `fieldType` immutability check — all already flagged as known
  gaps in this doc's Problem/Risks, not new discoveries. Branched from
  `main`, not stacked on the still-unmerged WORK-0014 branch — this item's
  new tables only reference `expense_lines`/`expense_reports`/
  `field_definitions`, none of which need WORK-0014's `is_locked`/
  `field_platform_rules` additions to function.
- 2026-08-15 shipped — merged to `main` (PR #6), confirmed with
  `git merge-base --is-ancestor` and a content grep for
  `expense_line_field_values` on `origin/main`, not just the PR's
  "Merged" label.

---

> **For AI agents:** Do NOT implement this work item unless status is
> `accepted` or `building`. If status is `proposed`, surface it to the user
> for a decision before writing any code. If status is `superseded`, follow
> the item in `superseded-by` instead — do NOT implement the pattern
> described here. If you are about to contradict an `accepted`, `building`,
> `shipped`, or `operating` item, stop and surface it to the user before
> proceeding.
