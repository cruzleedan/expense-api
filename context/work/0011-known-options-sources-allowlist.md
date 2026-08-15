---
id: 0011
title: "Validate optionsSource against a known-values allowlist"
status: superseded
kind: fix
opened: 2026-08-15
decided: ~
branch: ~
supersedes: ~
superseded-by: 0013
---

# WORK-0011 — Validate optionsSource against a known-values allowlist

| | |
|---|---|
| **Opened** | 2026-08-15 |
| **Status** | proposed |
| **Kind** | fix |
| **Supersedes** | — |
| **Superseded by** | — |

> **Companion item:** expense-tracker `context/work/0013-options-source-select.md`
> — the field editor's free-text input needs to become a `Select` sourced
> from the same allowlist this item adds. Either item can land first; the
> API validation is useful on its own (rejects a bad value even if the
> designer UI still sends free text), and the frontend `Select` is useful
> on its own (better UX, though a hand-edited request could still bypass it).

## Problem

`field_definitions.options_source` (WORK-0010) is a free-text
`VARCHAR(100)` — `optionsSource` in the request/response — that tells the
Flutter client which of its own local data sources to resolve a dropdown's
options from (today, only `"local:category"` is understood client-side).
Nothing validates it against what the client actually supports: a typo in
the designer (`"local:catgory"`, `"Local:Category"`, anything) is accepted,
stored, and published without error. The failure only shows up later and
silently, client-side — the Flutter field just renders with no options,
with no error surfaced anywhere in the admin UI, the API response, or (as
far as this repo can tell) the client itself.

Flagged as an open risk in `context/work/0010-dynamic-form-designer-api.md`
and `context/work/0011-dynamic-form-designer-ui.md` (expense-tracker) at
the time; assessed afterward as worth fixing — it's cheap to close and the
failure mode is silent, which is the worst kind to leave open even at
today's small scale (one known value).

## Decision

Add a small hand-maintained allowlist of known `optionsSource` values and
validate against it at the Zod schema layer, so an unrecognized value is
rejected with a normal 400 at create/update time instead of being
persisted and failing silently downstream. Read endpoints (including
`GET /v1/ui-schemas/{screenId}`) are unaffected — validation only needs to
happen where a value can be written.

```typescript
// src/schemas/formDesigner.ts
export const KNOWN_OPTIONS_SOURCES = ['local:category'] as const;
export const OptionsSourceSchema = z.enum(KNOWN_OPTIONS_SOURCES);
```

Used in `CreateFieldRequestSchema.optionsSource` and
`UpdateFieldRequestSchema.optionsSource` (keeping the existing
`.nullable().optional()` on the update schema — clearing it back to
`null` must still work). No DB migration — the column stays
`VARCHAR(100)`; this is an application-layer allowlist, not a `CHECK`
constraint, because the valid set is expected to grow as the mobile team
adds more client-resolvable sources, and a plain constant is far cheaper
to extend than a migration.

This is a hand-maintained list, not a generated/shared package — same
convention as `RESOURCES`/`PERMISSIONS` in expense-tracker's
`constants/permissions.ts`, kept in sync with the Flutter client and
expense-tracker's own copy (companion item) by code review, not tooling.
Whoever adds a new client-resolvable source needs to update this list —
call that out in the PR description when it happens.

## Options considered

| Option | Pros | Cons | Chosen? |
|---|---|---|---|
| `z.enum()` allowlist at the schema layer | Rejects bad values with a normal validation 400; zero DB migration; trivial to extend | Hand-maintained, can drift from what Flutter actually supports if not updated together | ✓ |
| `CHECK` constraint in `schema.sql` | Enforced at the DB layer too | Requires a migration every time a source is added — the exact cost this table design already avoided for `field_options` (see WORK-0010, "why one shared options table") | ✗ |
| Leave free-text, document the risk | Zero effort | Leaves the silent-failure trap open — the reason this item exists | ✗ |

## Consequences

**Positive:**
- Closes a silent, hard-to-debug failure mode for a one-line schema change
- No migration, no behavior change for the one value in use today

**Negative / Trade-offs accepted:**
- The allowlist can drift from Flutter's actual supported sources if someone adds a client-side source and forgets to update this list (and expense-tracker's copy) — a process risk, not a technical one, same as any hand-maintained enum in this codebase

**Risks / Open questions:**
- None new — the underlying "who owns this list" question is the same one already logged as unresolved in WORK-0010's Risks

## Definition of done

- [ ] `KNOWN_OPTIONS_SOURCES` / `OptionsSourceSchema` added to `src/schemas/formDesigner.ts`
- [ ] `CreateFieldRequestSchema.optionsSource` and `UpdateFieldRequestSchema.optionsSource` use `OptionsSourceSchema` (update schema keeps `.nullable().optional()`)
- [ ] Verified: creating/updating a field with an unrecognized `optionsSource` value returns 400, not a stored bad value
- [ ] Verified: `"local:category"` and `null`/omitted still work exactly as before (no regression)

## Log

- 2026-08-15 proposed — opened as a follow-up after assessing the known
  gaps left open by WORK-0010/WORK-0011; judged worth fixing (cheap, closes
  a silent failure) rather than left deferred, unlike the other gaps
  assessed at the same time (no delete-form endpoint, Flutter asset
  migration path, layout metadata for a second schema consumer).
- 2026-08-15 superseded — while reviewing this item, realized `dropdown`
  fields conflating "static list" and "client-resolved lookup" via
  `optionsSource` was the wrong shape to be validating in the first place.
  `context/work/0013-lookup-field-type.md` splits them into distinct
  `field_type`s (`dropdown` stays static-only; a new `lookup` type carries
  the source), which subsumes this item's allowlist entirely — the
  allowlist idea survives, just scoped to `lookup_source` on the new type
  instead of `optionsSource` on `dropdown`. Not implemented as originally
  written.

---

> **For AI agents:** Do NOT implement this work item unless status is
> `accepted` or `building`. If status is `proposed`, surface it to the user
> for a decision before writing any code. If status is `superseded`, follow
> the item in `superseded-by` instead — do NOT implement the pattern
> described here. If you are about to contradict an `accepted`, `building`,
> `shipped`, or `operating` item, stop and surface it to the user before
> proceeding.
