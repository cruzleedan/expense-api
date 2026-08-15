---
id: 0010
title: "Dynamic form designer — data model and API"
status: building
kind: feature
opened: 2026-08-15
decided: 2026-08-15
branch: feature/0010-dynamic-form-designer-api
supersedes: ~
superseded-by: ~
---

# WORK-0010 — Dynamic form designer — data model and API

| | |
|---|---|
| **Opened** | 2026-08-15 |
| **Status** | building |
| **Kind** | feature |
| **Supersedes** | — |
| **Superseded by** | — |

> **Companion item:** expense-tracker `context/work/0011-dynamic-form-designer-ui.md`
> (the screen-designer admin page that calls the endpoints below). Neither
> item is useful without the other, but this one has no dependency on
> expense-tracker shipping first — the read endpoint only needs the schema
> to exist.

## Problem

The Flutter app's server-driven UI (`expense` repo, WORK-0021, shipped
2026-08-15) ships one hardcoded schema — `assets/ui_schemas/expense_line.json`,
bundled into the app and cached locally, driving four fields on one screen.
There is no database-backed schema, no admin UI, and no server endpoint —
the client reads a static file. Product wants someone with the right
permission to edit field definitions (labels, required-ness, per-role
visibility, validation rules, dropdown options) without a store release.

A cross-team handoff doc proposed a normalized data model and API for this.
It was written without access to this repo and got two things wrong that
would have shipped incorrectly if built as drafted: it assumed the role
model was an open question (this repo already has full RBAC), and it
justified locking `categoryId`'s required-ness against the wrong column
(`category_code`, which has no FK constraint, instead of `category_id`,
which does). Both are corrected in the handoff doc and reflected below
before opening this item.

## Decision

Add six additive tables (five MVP, one phase 2) and ten endpoints, all
following this repo's existing conventions rather than the generic ones the
handoff doc used as placeholders.

**Tables** (`schema.sql` + `schema.ts`, in lockstep per
`context/skills/add-migration.md`; `UUID DEFAULT gen_random_uuid()` PKs,
`TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP` timestamps,
`VARCHAR + CHECK (col IN (...))` in place of native Postgres enums — matching
`expense_lines.reimbursement_status` style, not the doc's generic `enum`
labels):

- `form_definitions` — one row per screen (`screen_id`, `name`, `version`, `status: draft|published`)
- `field_definitions` — one row per field (`form_id` FK, `field_key`, `field_type`, `label`, `is_system_defined`, `sort_order`, `hint_text`, `helper_text`, `decimal_places`, `max_lines`, `options_source`)
- `field_role_rules` — `field_id` FK, **`role_id UUID REFERENCES roles(id)`** (not a free-text `role_code` — this repo already has `roles`/`permissions`/`role_permissions`), `state: required|hidden|read_only`, unique on `(field_id, role_id)`
- `field_validation_rules` — `field_id` FK, `rule_type` (min_length/max_length/email/required/number_gt/number_lt/number_gte/number_lte/number_eq/pattern), `rule_value`, `error_message`, `sort_order`
- `field_options` — `field_id` FK (shared table, not one table per dropdown field — see Options considered), `code`, `value`, `sort_order`, `is_active`, unique on `(field_id, code)`
- `field_conditional_rules` (**phase 2**) — `form_id` FK, `condition_field_id` FK, `condition_operator`, `condition_value`, `target_field_id` FK, `effect`

**Layout metadata (phase 2, deferred) — sketched now to avoid a breaking
change later.** Today `sort_order` is the only layout signal, and it's
sufficient for the one real consumer (Flutter, one field per row — a flat
order is all a stacked list needs). expense-tracker's own expense-line UI
(`CreateExpenseLineModal.tsx`, `ExpenseLinesTable.tsx`) does **not**
consume this schema today and isn't part of this item — but the intent is
for it to eventually, rendered as a table/grid (columns, not stacked
rows), which `sort_order` alone can't drive. Not building this now; sketched
so the eventual addition is purely additive:

- `field_groups` (new table) — `id`, `form_id` FK, `label`, `sort_order`. Sections, ordered independently of the fields inside them.
- `field_definitions.group_id` (new nullable FK → `field_groups.id`) — which section a field belongs to, if any. Null today for every existing field; grouping is opt-in.
- `field_definitions.layout_width` (new nullable `VARCHAR` + `CHECK IN ('full','half','third')`) — a column-span hint for grid/table renderers. Renderers that don't understand it (Flutter, today) ignore it and always render full-width, so this can't change existing behavior when added.
- `GET /v1/ui-schemas/{screenId}` gains an optional `?renderer=` param (e.g. `mobile` | `web_grid`), defaulting to whatever preserves exact current Flutter behavior when omitted — so the contract for existing callers doesn't change the day this param is introduced, only when a caller opts into it.

Explicitly **not** designing per-renderer field visibility (a field shown
in a detail form but hidden as a grid column, or vice versa) as part of
this sketch — that's the same shape as `field_role_rules` but keyed on
renderer instead of role, and is a big enough feature to deserve its own
work item once web actually starts consuming this schema, not a footnote
here.

**Endpoints** — nine admin CRUD routes under `/v1/admin/forms` and
`/v1/admin/fields` (`createRoute()` + `OpenAPIHono`, Zod schemas in
`src/schemas/`, same shape as `src/routes/roles.ts`), gated by new
`form.view` / `form.manage` / `form.publish` permissions via
`requirePermission()` — following the existing dotted `resource.action`
convention, not a role-name check. `src/routes/adminAnalytics.ts` is the
existing precedent for this wiring.

Plus one client-facing read endpoint, `GET /v1/ui-schemas/{screenId}?role={role}`,
that assembles the published form + fields + role-resolved state +
validation rules + options into the exact JSON shape WORK-0021's Flutter
client already parses (`screenId`, `version`, `fields[]` with bare `key`,
not `fieldKey`). **Corrected during implementation:** the earlier draft of
this item said the endpoint needed to "bypass" `src/middleware/camelCase.ts`
— checked `keysToCamel()`/`snakeToCamel()` directly and they're a no-op on
strings with no underscore, so an already-camelCase key like `key` or
`hintText` passes through unchanged. The actual fix is simpler than
bypassing anything: hand-build the response object with the target key
names (`key: field.field_key`, not a spread of the raw DB row), and let the
existing global middleware run over it as normal — it's harmless once the
object is already in the right shape. Verified end-to-end (see
Implementation Notes). Fields in the `hidden` state for the requesting role
are dropped from the array entirely, not sent with a hidden flag, since the
Flutter client has no concept of a hidden field yet.

## Options considered

| Option | Pros | Cons | Chosen? |
|---|---|---|---|
| One shared `field_options` table, indexed on `field_id` | Fixed schema regardless of field count; no per-env drift risk; fits this repo's hand-maintained migration process; joins are exactly as fast as a dedicated table | None found | ✓ |
| One dedicated options table per dropdown field | — | `CREATE TABLE` + migration on every new dropdown field; this repo has no tooling for runtime schema creation | ✗ |
| `field_role_rules.role_id` as a real FK to `roles.id` | Reuses existing RBAC directly; referential integrity; matches how every other privileged resource in this repo is scoped | None found | ✓ |
| `field_role_rules.role_code` as free-text varchar (handoff doc's original draft) | — | No referential integrity; duplicates a role model that already exists as a real table | ✗ |
| Server-side hidden-field filtering in the read endpoint | Ships correctly even before the Flutter client understands a `hidden` state | Flutter still can't do per-role `read_only` without its own follow-up (tracked separately, out of scope here) | ✓ |
| Send all fields with a `hidden: true` flag, let the client filter | Simpler backend | Flutter's `FieldRenderer` has no concept of this flag today — would render fields it shouldn't | ✗ |

## Consequences

**Positive:**
- Unlocks admin-configurable expense-line forms without a Flutter store release, the entire point of WORK-0021's server-driven UI approach
- Reuses existing RBAC, admin-route, and migration conventions directly — no new infrastructure
- Six additive tables; nothing in `expense_lines`/`expense_reports`/`expense_categories` changes

**Negative / Trade-offs accepted:**
- Five (six with phase 2) new hand-maintained tables add real weight to the dual `schema.sql`/`schema.ts` migration process
- The read endpoint still hand-builds its response object (rather than spreading raw DB rows) — not because the camelCase middleware needed bypassing (it doesn't, see Decision), but because the DB's `field_key` must become the client's `key`, not `fieldKey`, which no automatic transform does. Commented at the point of implementation so a future refactor doesn't "simplify" it into a raw-row spread and silently break Flutter
- New `form.*` permissions need seeding into the `permissions` table and assigning to whichever roles should manage forms — not yet decided which roles that is (see Risks)

**Risks / Open questions:**
- ~~Which existing roles get `form.manage`/`form.publish` by default~~ — resolved during implementation: `admin`'s seed grant is a denylist (`NOT IN (...)`), not an allowlist, so new `form.*` permissions flow to it automatically; `super_admin` gets everything unconditionally. No extra seed rows were needed. Verified against the dev DB: both roles carry all three `form.*` permissions after applying the migration.
- `optionsSource` values (today only `"local:category"`) have no shared source of truth between this repo, expense-tracker, and the Flutter client — a typo'd source string would fail silently client-side. Recommend a small shared enum, but not designed as part of this item
- Migration path for the Flutter-bundled `assets/ui_schemas/expense_line.json` fallback once this is live — a Flutter/build-process question, explicitly out of scope for this item
- Confirmed intent (2026-08-15): expense-tracker will eventually consume this schema too, rendered as a table/grid rather than Flutter's stacked list. `sort_order` alone won't express column width, section grouping, or per-renderer visibility for that — see the Layout metadata sketch above. Deferred, not blocking MVP; revisit when web actually starts building against it, not before

## Definition of done

- [x] All five MVP tables added to `schema.sql` and `schema.ts` in house style (UUID PKs, `CHECK` constraint enums, FK to `roles.id` on `field_role_rules`) — applied to the dev DB and verified with `\d` against each table
- [x] `form.view` / `form.manage` / `form.publish` permissions seeded — verified `admin` and `super_admin` both carry all three automatically (see Risks)
- [x] Ten designer CRUD endpoints implemented under `/v1/admin/forms` and `/v1/admin/fields`, gated by the new permissions (nine from the original list, plus `POST /v1/admin/forms` — see Implementation Notes) — a non-admin (`employee`) token verified 403 against `GET /v1/admin/forms`
- [x] System-defined field protections enforced at the API layer: `PUT /v1/admin/fields/{fieldId}` rejects edits to `fieldType`/`decimalPlaces`/`maxLines`/`optionsSource` on system-defined fields (409); `field_key`/`is_system_defined` aren't accepted in the request body at all so can't be changed via this endpoint regardless; role-rules endpoint rejects a `required` state targeting a system-defined field (409); validation-rules endpoint rejects any rules at all on a system-defined field (409); `DELETE` rejects with 409 if `is_system_defined` — all five cases exercised against the running dev server, see Implementation Notes
- [x] `GET /v1/ui-schemas/{screenId}?role={role}` implemented, hand-serialized (see the corrected Decision text — not a camelCase bypass), verified against WORK-0021's contract shape for a live `expense_line`-shaped form: bare `key`, `options: null` vs an array, `isEnabled`, required-ness derivation all checked by hand against curl output
- [x] Hidden-for-role fields dropped from the read response array, not flagged — verified: a field with a `hidden` role rule for `employee` is absent from that role's response
- [ ] Existing Flutter `expense_line` form verified unbroken end-to-end against the new read endpoint before merge — **not done**, requires the actual Flutter client, out of reach from this repo; the response shape was checked by hand against the documented contract instead. Flag this specifically before shipping.
- [x] `field_conditional_rules` table and its resolution step explicitly deferred to phase 2, not built in this pass
- [x] `field_groups` table, `field_definitions.group_id`/`layout_width`, and the read endpoint's `?renderer=` param explicitly deferred — not built in this pass, sketched only so the eventual addition is non-breaking

## Log

- 2026-08-15 proposed — opened from the cross-team "Dynamic Form Designer"
  handoff doc after auditing its design against this repo's actual schema,
  RBAC, and route conventions. Two corrections made to the source doc before
  drafting this item: `field_role_rules.role_code` → `role_id` FK (RBAC
  already exists, doc had flagged this as an open question), and the
  `categoryId` lock justification corrected from `category_code` (no FK) to
  `category_id` (the real FK) — see the handoff doc's inline
  `[corrected]` markers for detail.
- 2026-08-15 — added a deferred layout-metadata sketch (`field_groups`,
  `layout_width`, `?renderer=` param) after confirming with the user that
  expense-tracker is intended to become a second schema consumer,
  eventually rendering these forms as a table/grid rather than Flutter's
  stacked list. `sort_order` alone doesn't support that; the sketch exists
  so adding it later is additive, not a breaking change to the contract.
  Not part of this item's MVP scope.
- 2026-08-15 accepted — approved by user; moving straight to building since
  implementation starts immediately with this item (backend first,
  expense-tracker WORK-0011 to follow once these endpoints exist).
- 2026-08-15 building — implementation started. `branch` left `~`: `main`
  in this repo already has unrelated uncommitted changes (expense-line
  bulk-create/ICR work in progress) at the time this item started, so no
  branch was cut automatically to avoid bundling unrelated in-progress work
  — left for the user to branch/commit deliberately.
- 2026-08-15 — implementation complete and verified end-to-end against the
  running dev server (schema applied to the real dev DB, not just typechecked).
  Two corrections made along the way, beyond the ones already in the Decision
  text above: (1) the "bypass camelCase.ts" framing was wrong — checked
  `keysToCamel()` and it's a no-op on already-camelCase keys, so the fix is
  just building the response object with the right key names, not evading
  middleware; (2) discovered mid-implementation that the original endpoint
  list (copied from the handoff doc) had no way to create a *new*
  `form_definitions` row at all — added `POST /v1/admin/forms`, not in the
  original nine. See Implementation Notes for what was actually built and
  the interpretive calls made where the spec was ambiguous (required-ness
  derivation for system-defined fields, the locked-field set on `PUT
  /fields/{fieldId}`, the `isEnabled` wire field name).

## Implementation Notes

**Files:** `src/db/schema.sql` / `schema.ts` (5 tables + indexes + 3 seeded
permissions), `src/schemas/formDesigner.ts`, `src/services/formDesigner.service.ts`,
`src/routes/formDesigner.ts` (admin CRUD, mounted at `/v1/admin`),
`src/routes/uiSchemas.ts` (read endpoint, mounted at `/v1/ui-schemas`),
`src/app.ts` (wiring + rate limit + OpenAPI tags).

**Decisions the spec didn't make explicitly, resolved during implementation:**

- **Required-ness for system-defined fields isn't a column anywhere** — the
  data model only has required-ness via `field_role_rules.state = 'required'`,
  and that state is explicitly disallowed for system-defined fields (see data
  model callout). So a system-defined field's `required` in the read response
  is hardcoded `true` by default (matching WORK-0021's current hardcoded
  `categoryId` behavior) and flips to `false` only when a `read_only` role rule
  applies — an input you can't edit can't sensibly be "required". User-defined
  fields have no such default: `required` is `true` only when an explicit
  `required` role rule exists for the requesting role, `false` otherwise.
- **`isEnabled` as the read-only wire field name** — not specified in "the
  client contract today" table (that table predates this feature). Named it
  `isEnabled` because the handoff doc's own Flutter-follow-up section says
  "every d3_ui input already supports `isEnabled: false`" — reusing that exact
  name means Flutter follow-up #2 is purely wiring, not also a naming
  decision.
- **Locked-field set on `PUT /fields/{fieldId}`** — the doc says only
  "label/hintText/helperText" are editable on a system-defined field, but
  expense-tracker's WORK-0011 separately says system-defined fields must
  still support drag-to-reorder in the field list. Resolved by treating
  `sortOrder` as always editable (pure display order, doesn't touch field
  behavior) alongside label/hint/helper, and keeping `fieldType`/
  `decimalPlaces`/`maxLines`/`optionsSource` as the actual locked set.
  `fieldKey` and `isSystemDefined` aren't in the update request schema at
  all, so they're structurally unchangeable, not just rejected.
- **`options: null` vs `[]`** — fixed during testing: a field only gets a
  populated `options` array when it's a `dropdown` with no `optionsSource`
  and has `field_options` rows. Every other case (non-dropdown fields,
  `optionsSource`-backed dropdowns) reports `null`, matching the contract's
  example shape rather than leaking an empty array.
- **`POST /v1/admin/forms`** — added because there was no way to create a
  form at all otherwise; the original endpoint list assumed forms already
  exist. `screenId` is validated as lowercase snake_case (matches the
  client's existing `screenId` values like `expense_line`).

**Verified against the running dev server** (not just typechecked): created
a form, a user-defined field, and a system-defined field (seeded directly —
there's no API to create a system-defined field, by design); confirmed all
five system-defined lock paths return 409 with the expected message; set
role rules and validation rules on a user-defined field and confirmed they
show up correctly in the assembled read response; confirmed a `hidden` role
rule drops a field from that role's response entirely; confirmed `admin`
and `super_admin` tokens carry the three new `form.*` permissions
automatically and an `employee` token gets a 403 on admin routes but a 200
on the read endpoint; confirmed the read endpoint 404s before publish and
for an unknown `screenId`. Test data was created and deleted directly
against the dev DB — nothing persisted from this verification pass.

**Known gap:** everything above was checked against the documented contract
by hand, not against the actual Flutter client (out of reach from this
repo) — see the unchecked Definition of done item.

---

> **For AI agents:** Do NOT implement this work item unless status is
> `accepted` or `building`. If status is `proposed`, surface it to the user
> for a decision before writing any code. If status is `superseded`, follow
> the item in `superseded-by` instead — do NOT implement the pattern
> described here. If you are about to contradict an `accepted`, `building`,
> `shipped`, or `operating` item, stop and surface it to the user before
> proceeding.
