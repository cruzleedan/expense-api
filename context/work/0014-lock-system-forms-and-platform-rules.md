---
id: 0014
title: "Seed and lock the two system forms; add per-field platform availability"
status: shipped
kind: feature
opened: 2026-08-15
decided: 2026-08-15
branch: feature/0014-lock-system-forms-and-platform-rules
supersedes: ~
superseded-by: ~
---

# WORK-0014 — Seed and lock the two system forms; add per-field platform availability

| | |
|---|---|
| **Opened** | 2026-08-15 |
| **Status** | shipped |
| **Kind** | feature |
| **Supersedes** | — |
| **Superseded by** | — |

> **Companion item:** expense-tracker `context/work/0015-form-designer-locked-forms-and-platform-ui.md`
> — the designer UI's half of this (locked-form badge, platform checkboxes).
> Also a prerequisite for expense-tracker `context/work/0016-schema-driven-expense-forms.md`
> and this repo's own `context/work/0015-custom-field-value-storage.md`.

## Problem

WORK-0010/0011 built the form designer around "create as many forms as you
want, each identified by an arbitrary `screenId`." That's not actually the
product: there are exactly two real forms today — `expense_line` and
`expense_report` — and the whole point of this feature, per the user
clarifying it directly, is letting admins append **custom fields to those
two existing forms**, not author new screens from scratch. Nothing today
seeds those two forms; an admin has to create them by hand, free to typo
the `screenId` or diverge from what Flutter/MCP/web actually expect.

Separately, WORK-0010 explicitly flagged and deferred this: *"per-renderer
field visibility... is a big enough feature to deserve its own work item
once web actually starts consuming this schema."* That trigger has now
happened — expense-tracker's own `context/work/0016` (this item's other
companion) makes the web app a second real consumer of `GET
/v1/ui-schemas/{screenId}` alongside Flutter, and `expense-mcp`
(`context/work/0009` in this repo, `status: building`) is a third. Not
every admin-added field belongs on every surface (e.g. an internal
`auditNote` field that only the web app's finance view should see), so
per-field platform visibility is needed now, not hypothetically.

## Decision

**Seeding, not a new mechanism.** `expense_line` and `expense_report` are
created via the same idempotent `INSERT ... ON CONFLICT (screen_id) DO
NOTHING` pattern already used for permission seeding, added to
`schema.sql`/`schema.ts`, with `status = 'published'` from the start (they
represent what's already live today, not a draft) and their current
real fields inserted as `is_system_defined = true` rows, field-for-field
matching what `CreateExpenseLineModal.tsx`/the expense-report equivalent
actually render today — verified by diffing against that UI, not
reconstructed from the raw `expense_lines` DB schema (which has many
internal/analytics columns — `anomalyScore`, `clientId`, `version`, etc. —
that were never user-facing form fields and must NOT be seeded as fields).

**`form_definitions.is_locked BOOLEAN NOT NULL DEFAULT false`**, set `true`
for these two seeded rows. Neither `updateForm` nor `deleteForm` exist as
API endpoints today (checked — there is no way to rename, retarget, or
delete a form at all currently), so this column has no enforcement code to
write yet. It's added now anyway, cheaply, so whoever eventually builds a
delete-form endpoint has an existing, documented flag to check rather than
needing a second migration — the same reasoning already applied to
`is_system_defined` at the field level in WORK-0010.

**`field_platform_rules`** — new table, deliberately shaped like
`field_role_rules`: `field_id` FK, `platform VARCHAR CHECK IN ('mobile',
'web', 'mcp')`, unique on `(field_id, platform)`. A row's mere existence
means "hidden on this platform" — there is no `state` column, unlike role
rules, because platform visibility only has one deviation to express
(unlike role rules, which also need `required`/`read_only`). **Absence of
any row for a field = visible on all platforms** — the same
absence-is-default convention `field_role_rules` already established, so
"all" (the requested default) costs zero rows rather than needing an
explicit sentinel value.

New endpoint `PUT /v1/admin/fields/{fieldId}/platforms`, mirroring
`replace`-semantics already used for role rules/options — body is the
full desired hidden-set (e.g. `{ "hiddenOn": ["mcp"] }`), replacing
existing rows for that field, not diffing.

`GET /v1/ui-schemas/{screenId}` gains an optional `?platform=mobile|web|mcp`
param, parallel to the existing `?role=`. When present, a field with a
matching hidden-rule is dropped from the response — reusing the exact
"drop, don't flag" handling already in `getUiSchema` for role-hidden
fields, not a new code path. **Omitting the param changes nothing** — the
existing Flutter caller, which doesn't send it, is unaffected until it
opts in, same wire-compatibility discipline as WORK-0013's `lookup` shim.

## Options considered

| Option | Pros | Cons | Chosen? |
|---|---|---|---|
| `field_platform_rules` row-per-(field, platform), presence = hidden | Mirrors `field_role_rules` exactly; supports any subset of platforms per field (e.g. web+mobile, not mcp) without new enum values | One more table | ✓ |
| Single `available_platforms` enum/array column on `field_definitions` | Simpler schema, matches the literal "dropdown" framing of the original ask | Can't cleanly express partial combinations without either a comma-string hack or a real array column with its own query complexity; doesn't reuse the pattern already proven for role rules | ✗ |
| Seed the two forms as `draft`, require a manual first publish | Extra safety valve before anything goes live | These seeded fields represent what's *already* live in production today (via the bundled Flutter asset) — there's nothing new to review before "publishing" a state that's already true | ✗ |

## Consequences

**Positive:**
- The form designer stops being "create arbitrary screens" and becomes what it was actually meant to be — the one place to extend the two forms that exist
- Unblocks both `expense-mcp` and expense-tracker's own upcoming schema-driven forms (`context/work/0016` there) from over-exposing fields meant for a different surface
- `is_locked` costs nothing today and saves a migration later

**Negative / Trade-offs accepted:**
- The seed data must be hand-verified field-for-field against the real current UI — a data-entry-error risk if done carelessly; called out explicitly in Definition of done
- `field_platform_rules` is a fourth per-field rule table (after role rules, validation rules, options) — more surface area, accepted because it reuses an already-understood pattern rather than inventing a new one

**Risks / Open questions:**
- `expense-mcp` (WORK-0009, still building, separate repo) isn't consulted here — whoever finishes that server needs to know a `platform=mcp` value now exists and decide whether/how its tools should pass it
- Depends on this repo's own companion `context/work/0015-custom-field-value-storage.md` for the seeded system fields' *values* to round-trip anywhere meaningful once expense-tracker's forms become schema-driven — that item is what actually stores what a user types into a custom field

## Definition of done

- [x] `form_definitions.is_locked` column added; `expense_line`/`expense_report` seeded idempotently in `schema.sql`/`schema.ts`, `status = 'published'`, `is_locked = true`
- [x] Seeded fields verified 1:1 against the real current UI (`CreateExpenseLineModal.tsx`, `ExpenseLinesTable.tsx`, `ReportHeader.tsx`/`useReportActions.ts`) — description/amount/transactionDate/categoryCode/currency for expense_line, title/description/reportDate for expense_report
- [x] `field_platform_rules` table + `PUT /v1/admin/fields/{fieldId}/platforms`
- [x] `GET /v1/ui-schemas/{screenId}` accepts `?platform=`, drops hidden fields, verified live that omitting the param reproduces today's exact output byte-for-byte
- [x] `tsc --noEmit` clean; no test runner exists in this repo (verified live against the dev DB/API instead, matching this repo's established convention)

## Log

- 2026-08-15 proposed — opened after the user clarified the form designer's
  actual purpose (extend two fixed forms, not author arbitrary ones) and
  approved, via direct questions, both a rule-table platform model and
  making expense-tracker's own forms schema-driven as a same-round goal.
- 2026-08-15 accepted, building — approved by user alongside the other
  three items in this round (0015 here, and 0015/0016 in expense-tracker).
- 2026-08-15 building — implementation complete, verified live end-to-end:
  seeded `expense_line`/`expense_report` (deleted and re-seeded once after
  discovering an earlier ad-hoc test had already created an unlocked
  `expense_line` with different, non-matching fields); hid `currency` from
  `mcp` via the new endpoint and confirmed `?platform=mcp` drops it while
  `?platform=web` and no-param both keep it; confirmed `getFormDetail`
  returns `platformRules` per field. Confirmed live that `categoryCode` and
  the report's `description` come back `required: true` per the
  already-shipped WORK-0010 derivation logic, matching the known gap
  flagged in this doc's Problem/seed-comment — not fixed here, tracked for
  expense-tracker WORK-0016.
- 2026-08-15 shipped — merged to `main` (PR #5), confirmed with
  `git merge-base --is-ancestor` against `origin/main` and a content grep
  for `is_locked`/`field_platform_rules`/`expense_line_field_values` on
  `origin/main`'s `schema.sql`, not just the PR's "Merged" label.

---

> **For AI agents:** Do NOT implement this work item unless status is
> `accepted` or `building`. If status is `proposed`, surface it to the user
> for a decision before writing any code. If status is `superseded`, follow
> the item in `superseded-by` instead — do NOT implement the pattern
> described here. If you are about to contradict an `accepted`, `building`,
> `shipped`, or `operating` item, stop and surface it to the user before
> proceeding.
