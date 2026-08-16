---
id: 0021
title: "Permission gate for expense category create/edit/delete"
status: building
kind: feature
opened: 2026-08-16
decided: 2026-08-16
branch: feature/0021-0022-category-line-authz
supersedes: ~
superseded-by: ~
---

# WORK-0021 — Permission gate for expense category create/edit/delete

| | |
|---|---|
| **Opened** | 2026-08-16 |
| **Status** | building |
| **Kind** | feature |
| **Supersedes** | — |
| **Superseded by** | — |

## Problem

`expense_categories` is authorization-free below the level of "has a valid
bearer token." `expenseCategoriesRouter.use('*', authMiddleware)` is the
only gate on the router (`src/routes/expenseCategories.ts:22`) — there is
no `requirePermission`/`requireRole`, and the service layer never takes a
`userId` or checks ownership at all (`src/services/expenseCategory.service.ts`,
all of `createExpenseCategory`/`updateExpenseCategory`/`deleteExpenseCategory`).

This is inconsistent with every other resource in this API. Expense lines
check `line.userId === userId` (or the parent report's owner) before any
write (`expenseLine.service.ts:241-266`). Expense reports go further,
checking ownership plus role-scoped permissions (`report.view.own` /
`.team` / `.department` / `.all`, mirrored for edit/delete) via
`canAccessReport` (`approval.service.ts:177+`). Categories have neither —
today, any authenticated user, in any role, can create, rename, or delete
*any* category, account-wide.

Found while answering the Flutter team's question about whether sync
pushes go through the same authorization as any other request (they do —
there's no separate sync path) and auditing what "the same authorization"
actually amounts to per resource. Categories are the one resource where
the honest answer was "none."

## Decision

**Admin-managed taxonomy, chosen by the user 2026-08-16** — explicitly for
granular, data-driven control over who can manage the shared category list
across all users, rather than leaving it open or tying it to per-record
ownership.

Using this codebase's existing permission-registry pattern (`permissions`
table + `role_permissions`, `requirePermission()` middleware, same as
`report.*`): add `category.create`, `category.edit`, `category.delete` to
the `permissions` table (`category` group, `medium` risk — shared
reference data every report/analytics view depends on, but not as
sensitive as `role.*`/`system.*`). Proposed default grants — `finance`,
`admin`, `super_admin` — but the entire point of this approach is that the
exact role set is a `role_permissions` data change, not a code change, so
it can be tuned later without touching this implementation.
`category.view` (or just the existing `authMiddleware`-only gate) stays
open to every authenticated role, matching today's read behavior — nothing
changes for `GET /expense-categories`.

**This directly changes what WORK-0025 (the mobile team's offline category
sync) can ship as designed** — see Consequences and the note added to the
companion client-plan artifact for the practical impact and the
recommended mitigation (client-side permission check before showing the
create/edit/delete UI at all, not just handling the `403` after the fact).

**Implementation discovery:** `category.create`/`category.view`/
`category.edit`/`category.delete` already existed in the `permissions`
table (`db/schema.sql:1616-1620`) — defined, but never granted to any role
and never wired to the router. `admin` already had all four automatically,
via the existing denylist-based seeding (`admin` gets every permission not
explicitly excluded — `db/schema.sql:1753-1766`); `super_admin` already
had them via its catch-all (`db/schema.sql:1768-1772`). Only `finance`
needed an explicit grant. So the actual implementation was smaller than
planned: no new `permissions` rows, just one `role_permissions` grant for
`finance` plus wiring `requirePermission()` into the three mutating
routes. `category.view` stays wired to bare `authMiddleware` only (not
`requirePermission('category.view')`), per the Decision above — gating it
would have required granting `category.view` to every other role first,
which is unnecessary churn for a permission this item deliberately leaves
open to everyone.

## Options considered

| Option | Pros | Cons | Chosen? |
|---|---|---|---|
| Admin-managed taxonomy (`category.create`/`.edit`/`.delete`, granted by role) | Matches how a shared taxonomy is usually governed; prevents accidental/malicious sprawl of near-duplicate categories; role grants are data, not code — genuinely granular and adjustable later | Breaks WORK-0025's mobile create-on-device flow for any non-privileged user; that plan needs to react to this, not the other way around | ✓ |
| Open create, gated mutate-existing (`category.edit.all`/`.delete.all`, ownership tracked) | Compatible with WORK-0025 as originally designed; closes the actual "any user can delete anyone's category" gap | Needs a new `ownerId` column + migration; "own" is a strange concept for what's meant to be shared reference data; doesn't give the granular, org-wide control the user wants | ✗ |
| Leave as-is | No work | Already-shipped WORK-0020 improved the *data-integrity* story (conflicts, safe delete) but did nothing about the *authorization* gap — any user can still rename/delete categories relied on by every other user's reports | ✗ |

## Consequences

**Positive (once implemented):**
- Closes the one resource in this API with no authorization boundary below "logged in"
- Consistent authorization model across categories/lines/reports for both direct API use and mobile sync pushes (which use the same endpoints, per the investigation that surfaced this)
- Role grants are data (`role_permissions` rows), not code — the user gets exactly the granular, adjustable control over who manages the taxonomy that motivated this choice, without needing another deploy to change who's allowed

**Negative / Trade-offs accepted:**
- Breaks WORK-0025 (mobile offline category sync) as currently designed for any user without `category.create`/`.edit`/`.delete` — a regular employee's on-device category creation can no longer reach the server. The mobile plan needs to change: either hide the create/rename/delete UI for users lacking the permission (the JWT already carries `permissions`, so this is a client-side check against data already available, not a new API call), or repurpose it into a "suggest a category" flow that's reviewed by someone with the permission — not decided here, mobile team's call
- Regular employees keep full read access (`GET /expense-categories`) — nothing changes for browsing/selecting a category on an expense line, offline or online

**Risks / Open questions:**
- Exact role grant list (`finance`/`admin`/`super_admin` proposed) is a starting point, not final — confirm before implementation if a narrower or different set is wanted; this is exactly the kind of thing this approach makes cheap to change later
- WORK-0025 needs to decide its own mitigation (hide UI vs. suggestion flow) before this ships, so a mobile release doesn't go out assuming the old any-user-can-create behavior

## Definition of done

- [x] `category.create`, `category.edit`, `category.delete` granted to `finance` (`admin`/`super_admin` already had them — see Implementation discovery above)
- [x] `expenseCategoriesRouter` gated: `POST`/`PUT`/`DELETE` behind `requirePermission('category.create'/'category.edit'/'category.delete')`; list/get routes unchanged
- [x] Verified live: `employee@test.local` (no grant) gets `403 {"code":"FORBIDDEN"}` on create; `finance@test.local` gets `201`; `employee@test.local` still gets `200` on `GET /expense-categories` — read access confirmed unaffected
- [ ] Mobile team (WORK-0025) confirms their mitigation (hide UI vs. suggestion flow) before this ships — hard dependency, not just a notification. Client-plan artifact already updated with the impact and recommendation; awaiting their response.
- [x] `tsc --noEmit` clean

## Log

- 2026-08-16 proposed — found while answering the Flutter team's question
  about whether sync pushes go through record-level permission checks.
  Lines and reports do; categories don't at all. Opened as its own item
  rather than folding into WORK-0020, since WORK-0020 was a data-integrity
  fix, not an authorization one, and this one has a real design decision
  to make (see Decision) rather than being purely mechanical.
- 2026-08-16 accepted — user chose admin-managed taxonomy (Option 1)
  explicitly for granular, data-driven control over who manages the
  category list across all users. Impact on WORK-0025 assessed and
  reported back: mobile create/edit/delete of categories will 403 for any
  user without the new permissions; read/browse (`GET`) is unaffected.
  Recommended the mobile team check permissions client-side (already in
  the JWT) before showing create/edit/delete UI, rather than only
  discovering the block after a failed sync push.
- 2026-08-16 building — user asked to start implementation alongside
  WORK-0022. Discovered `category.create`/`.view`/`.edit`/`.delete`
  already existed in the permissions registry, unused, and `admin`/
  `super_admin` already had them automatically via existing seeding logic
  — only `finance` needed a grant. Wired `requirePermission()` into the
  three mutating routes. Live-verified: `employee@test.local` blocked with
  a clean `403` on create, `finance@test.local` succeeds, reads unaffected
  for everyone. Companion client-plan artifact already carries the impact
  and recommendation for WORK-0025; that team's response is the one
  remaining open item before this ships.

---

> **For AI agents:** Do NOT implement this work item unless status is
> `accepted` or `building`. If status is `proposed`, surface it to the user
> for a decision before writing any code. If status is `superseded`, follow
> the item in `superseded-by` instead — do NOT implement the pattern
> described here. If you are about to contradict an `accepted`, `building`,
> `shipped`, or `operating` item, stop and surface it to the user before
> proceeding.
