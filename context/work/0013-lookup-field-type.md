---
id: 0013
title: "Split dropdown into static-only, add a lookup field type"
status: shipped
kind: fix
opened: 2026-08-15
decided: 2026-08-15
branch: feature/0013-lookup-field-type
supersedes: 0011
superseded-by: ~
---

# WORK-0013 — Split dropdown into static-only, add a lookup field type

| | |
|---|---|
| **Opened** | 2026-08-15 |
| **Status** | shipped |
| **Kind** | fix |
| **Supersedes** | 0011 |
| **Superseded by** | — |

> **Companion item:** expense-tracker `context/work/0014-lookup-field-type-editor.md`
> — the field editor's dropdown/lookup split on the designer side.

## Problem

`dropdown` fields have always secretly been two different things wearing
one `field_type`: a static admin-defined list (`field_options` rows) or a
client-resolved lookup (`options_source` set, e.g. `"local:category"`,
`field_options` empty). Every layer of WORK-0010/WORK-0011 has had to carry
a "don't conflate these" callout and a cross-field check (`if
options_source is set, reject field_options` and vice versa) because of it.

Raised while reviewing the now-superseded WORK-0011 (an `optionsSource`
allowlist): the allowlist was validating the *value* of a field that
shouldn't have existed on `dropdown` at all. The real fix is giving the
lookup case its own `field_type`, so `dropdown` becomes unambiguous —
always static, never calls anything — by construction, not by convention.

**Rejected the "one type per lookup source" version of this** (e.g.
`categoryLookup`, `employeeLookup`) in favor of one `lookup` type with a
source discriminator: the server's behavior is identical across every
lookup source (no `field_options`, client resolves it) — only the *client's
rendering* differs per source, which `field_type` being a DB `CHECK`
constraint isn't the right place to encode. One type per source would mean
a migration for every new lookup source the mobile team adds; a shared
`lookup` type with a `lookup_source` string keeps that as cheap as it is
today (an allowlist constant, no schema change) while still making
`dropdown` unambiguous, which was the actual goal.

## Decision

- `field_definitions.field_type` CHECK constraint gains `'lookup'`.
- `field_definitions.options_source` → renamed to `lookup_source`
  (`ALTER TABLE ... RENAME COLUMN`) — meaningful only when `field_type =
  'lookup'`; `NULL` for every other type, `dropdown` included. No longer
  optional-on-dropdown; the ambiguity is gone by construction, not by a
  cross-field check.
- Data migration (idempotent, safe on an empty table — nothing in
  production depends on this yet): `UPDATE field_definitions SET
  field_type = 'lookup' WHERE field_type = 'dropdown' AND options_source IS
  NOT NULL` (run before the rename, using the pre-rename column name).
- `KNOWN_OPTIONS_SOURCES`/`OptionsSourceSchema` (WORK-0011) become
  `KNOWN_LOOKUP_SOURCES`/`LookupSourceSchema` — same allowlist idea,
  rescoped to `lookup_source` on the new type. Still `['local:category']`
  today.
- Service-layer validation (`createField`/`updateField`, matching how
  system-defined-field locking is already enforced at the API layer, not
  as a DB `CHECK` — see WORK-0010): `field_type = 'lookup'` requires
  `lookupSource` set to a known value; every other type rejects
  `lookupSource` if provided.
- `replaceFieldOptions` actually gets *simpler*: its existing "field must
  be a dropdown" check now structurally also excludes lookup fields (they're
  a different type), so the separate "field has optionsSource set" check
  WORK-0010 added can be deleted outright — a dropdown can no longer have
  a lookup source to conflict with.
- `SYSTEM_FIELD_LOCKED_KEYS` (system-defined field protections) renames
  its `optionsSource` entry to `lookupSource` — same lock, same reasoning.

### The wire-contract compatibility problem, and how this avoids it

`categoryId` — a *shipped* field in WORK-0021's Flutter contract — is
exactly the case this migrates: `type: "dropdown"`, `optionsSource:
"local:category"`. Under this change it becomes `field_type: 'lookup'`
internally. But the Flutter client that's already live has no `lookup`
case in its `type` switch — emitting `"type": "lookup"` on the wire today
would break it.

**`GET /v1/ui-schemas/{screenId}` keeps emitting the exact same wire shape
it does today, regardless of the internal type change:** when assembling a
`lookup`-typed field for the client contract, serialize it as `type:
"dropdown"`, `optionsSource: <lookup_source>`, `options: null` — identical
to what a `dropdown`+`options_source` field produces today. A real
`dropdown`-typed field serializes as `type: "dropdown"`, `options:
[...]`, `optionsSource: null`, also identical to today. **Zero wire-format
change, zero Flutter changes required for this item.** The internal
model gets cleaner; the already-shipped contract doesn't move.

This compatibility shim is deliberately temporary — flagged as a new
Flutter follow-up (native `type: "lookup"` support, retiring the shim) for
whenever that work is picked up. Not itself part of this item, same as
every other Flutter follow-up in the original handoff doc.

## Options considered

| Option | Pros | Cons | Chosen? |
|---|---|---|---|
| One `lookup` type, `lookup_source` discriminator | Server-side logic is source-agnostic, matching the server's actual indifference to which lookup it is; new sources stay a constant, not a migration | Client still needs a switch on `lookup_source` string internally — but it already needed that switch under the old `optionsSource` design too, no new cost | ✓ |
| One `field_type` per lookup source (`categoryLookup`, `employeeLookup`, ...) | Maximally explicit; no string-based client dispatch | Every new source is a `CHECK`-constraint migration; server-side code gains cases it has no actual behavioral reason to distinguish | ✗ |
| Read endpoint emits real `type: "lookup"` now, ship a Flutter update alongside | Wire format matches the internal model exactly, no shim | Breaks the currently-shipped Flutter client the moment this deploys, unless perfectly sequenced with a Flutter release — far riskier than a same-day backend/web pair | ✗ |
| Leave `dropdown` dual-mode, just add the WORK-0011 allowlist | Smaller change | Doesn't fix the actual problem — the ambiguity and cross-field checks remain, just with a validated string instead of an arbitrary one | ✗ (this was WORK-0011, now superseded) |

## Consequences

**Positive:**
- `dropdown` is unambiguous by construction; the "don't conflate these" callout and its cross-field validation disappear
- `replaceFieldOptions` loses a whole branch of validation logic it no longer needs
- Zero Flutter-side changes required to ship this — full wire backward compatibility via the read-endpoint shim
- New lookup sources stay as cheap to add as they are today (allowlist constant, no migration)

**Negative / Trade-offs accepted:**
- The read endpoint's `lookup` → `dropdown`-shaped serialization is a deliberate, temporary shim that needs a comment loud enough that nobody "cleans it up" by mistake before Flutter actually supports the real wire type
- Column rename (`options_source` → `lookup_source`) touches every layer again (schema, Drizzle, Zod, service) — a second pass over code that only just landed (WORK-0010) — acceptable now, while nothing in production depends on the old shape; would be much more expensive later

**Risks / Open questions:**
- Same open item as WORK-0011 had: no cross-repo enforcement that expense-api's and expense-tracker's copies of `KNOWN_LOOKUP_SOURCES` stay in sync — still a hand-maintained convention, not tooling
- Flutter follow-up (native `lookup` type, retiring the read-endpoint shim) is newly identified here, out of reach from this repo, tracked only as a note

## Definition of done

- [x] `field_type` CHECK constraint includes `'lookup'`; `options_source` renamed to `lookup_source` in `schema.sql` and `schema.ts`; data migration included as an idempotent `DO $$` block (checked column existence, safe to re-run, safe on a fresh DB) — applied to the dev DB and re-run to confirm idempotency
- [x] `KNOWN_LOOKUP_SOURCES`/`LookupSourceSchema` replace `KNOWN_OPTIONS_SOURCES`/`OptionsSourceSchema`
- [x] `createField`/`updateField` validate `lookupSource` is required-and-known for `field_type: 'lookup'`, rejected for every other type — value-correctness enforced by `LookupSourceSchema` at the Zod/request layer (unknown value → 400 automatically), required-ness enforced in the service (`assertLookupSourceMatchesType`, shared by create and update)
- [x] `replaceFieldOptions`'s now-redundant `options_source` conflict check removed; "must be a dropdown" check alone is sufficient
- [x] `SYSTEM_FIELD_LOCKED_KEYS` updated (`optionsSource` → `lookupSource`)
- [x] `GET /v1/ui-schemas/{screenId}` serializes `lookup`-typed fields exactly as `dropdown`+`optionsSource` on the wire — verified live: a `lookup` field with `local:category` and a real `dropdown` field with static options both published and fetched back; output matches the pre-existing wire shape exactly (`UiFieldTypeSchema` also narrows the OpenAPI-documented wire type so it can't advertise `'lookup'` as a value this endpoint would ever emit)
- [x] `tsc --noEmit` clean
- [x] Verified live end-to-end: lookup field with known source → 201; missing source → 400; unknown source → 400 (Zod enum rejection); setting `lookupSource` on a dropdown field → 400; static options on a dropdown → succeeds; static options on a lookup field → 400 ("not a dropdown field"); published read-endpoint output confirmed byte-for-byte matching the old wire shape for both field kinds

## Log

- 2026-08-15 proposed — opened after discussing the dropdown/lookup split
  with the user (exploratory question → recommendation → agreed) as a
  proper replacement for WORK-0011, not an addition to it. Design
  deliberately preserves the already-shipped WORK-0021 Flutter wire
  contract via a read-endpoint compatibility shim, so this ships without
  any Flutter-side change.
- 2026-08-15 accepted, building — approved by user alongside the
  expense-tracker companion (WORK-0014 there). Implementation complete,
  verified live end-to-end including the wire-compatibility shim (fetched
  the published read endpoint's actual output and confirmed it's
  byte-for-byte the same shape as before this change, for both a `lookup`
  and a real `dropdown` field).
- 2026-08-15 shipped — merged to `main` (PR #3), confirmed with
  `git merge-base --is-ancestor` against `origin/main` rather than trusting
  the PR's "Merged" label alone (worth doing every time, not just when a
  merge-order gap is suspected — see WORK-0013/0011 history in
  expense-tracker for what trusting the label alone missed once already).

---

> **For AI agents:** Do NOT implement this work item unless status is
> `accepted` or `building`. If status is `proposed`, surface it to the user
> for a decision before writing any code. If status is `superseded`, follow
> the item in `superseded-by` instead — do NOT implement the pattern
> described here. If you are about to contradict an `accepted`, `building`,
> `shipped`, or `operating` item, stop and surface it to the user before
> proceeding.
