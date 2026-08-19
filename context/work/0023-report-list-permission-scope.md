---
id: 0023
title: "Expense report list: explicit scope filter (own/team/department/all)"
status: building
kind: feature
opened: 2026-08-16
decided: 2026-08-16
branch: feature/0023-report-list-permission-scope
supersedes: ~
superseded-by: ~
---

# WORK-0023 — Expense report list: explicit scope filter (own/team/department/all)

| | |
|---|---|
| **Opened** | 2026-08-16 |
| **Status** | building |
| **Kind** | feature |
| **Supersedes** | — |
| **Superseded by** | — |

## Problem

Found while confirming, at the user's request, that expense reports/lines
shown to a logged-in user are actually scoped to that user and not leaking
other people's data. They aren't leaking — but along the way, a real
inconsistency turned up between the two report-reading paths:

- `GET /expense-reports/{id}` (single record) honors the full permission
  scope: `report.view.own` / `.team` / `.department` / `.all`, via
  `canAccessReport` (`approval.service.ts:177+`) — including a real,
  DB-backed check for the team case (`u.manager_id = $1`), not a stub.
- `GET /expense-reports` (list) does not. `listExpenseReports()` hardcodes
  `eq(expenseReports.userId, userId)` (`expenseReport.service.ts:238`) and
  never looks at the caller's permissions at all — the route handler
  doesn't even pass them in (`routes/expenseReports.ts:66-81`). The route's
  own `description` field says as much: "paginated list of expense reports
  **for the authenticated user**."

Net effect: a manager with `report.view.team` or finance with
`report.view.all` cannot browse their team's or the org's reports through
this endpoint at all — they'd only ever see a given report if they already
have its ID from somewhere else (e.g. the separate approval-pending
mechanism) and fetch it directly via the single-record route. This is a
functionality gap, not a security bug — nothing over-shares. But it likely
isn't the intended behavior for the roles that were explicitly given
broader view permissions in the first place; those permissions currently
do nothing for the primary way anyone browses reports.

(Checked the equivalent for expense lines while here: `listExpenseLines`
under a report is correctly scoped — report ownership verified first, with
a narrow, DB-checked bypass for an approver viewing lines on a report
pending their own approval. No parallel gap on the line side; this item is
report-list only.)

## Decision

Widen the existing `GET /expense-reports` endpoint — no separate
team-scoped endpoint — but do **not** auto-widen to the caller's broadest
permission by default. Add an explicit, client-controlled `scope` query
param instead:

- `scope=own` (default, current behavior) | `team` | `department` | `all`.
- The caller must actually hold the matching permission
  (`report.view.team`/`.department`/`.all`) or the request is **rejected
  with `403`**, not silently clamped down to a narrower scope. A rejection
  tells the frontend it shouldn't have offered that filter option in the
  first place — the UI should be gating these choices by permission the
  same way the mobile client already gates category mutation UI (the
  expense repo's WORK-0025 — a different item, different repo, from this
  file's own WORK-0025 spike below), not discovering the boundary via a
  failed request.
- No filter param → identical to today's behavior for every caller,
  including `.all`-permission users. Nothing changes by default; broader
  access is opt-in per request, not automatic. Keeps the default response
  shape and size predictable regardless of who's asking.
- Rationale for explicit-filter over auto-widen (full reasoning given to
  the user separately): a manager viewing their own submitted reports and
  a manager reviewing their team's reports are different mental models —
  merging them into one always-broadest list buries "mine" inside
  "everyone's." An explicit filter also generalizes cleanly to picking a
  *specific* team when a caller oversees more than one, which auto-widen
  doesn't handle without building the same filter UI on top of it anyway.

**"Team" mapping — resolved.** `department` stays exactly as
`canAccessReport` already implements it: the caller's own
`department_id`, no picker needed (a caller only has one department).
`team` goes **recursive**, not just direct reports: the caller's full
descendant set under `manager_id` (direct + indirect), computed via a
`WITH RECURSIVE` walk, so a senior manager whose direct reports are
themselves managers correctly sees everyone under them, spanning
departments automatically. No new schema, no explicit "teams" table —
reasoning (given to the user in full, summarized here):

- Reuses `manager_id`, already the load-bearing relationship for
  approvals — one source of truth, not two. A separate teams table would
  need its own roster-maintenance process and can silently drift from the
  real reporting structure (a new hire is automatically "on the team" the
  moment they're hired under hierarchy; under an explicit roster, only if
  someone remembers to add them).
- Handles "a manager managing teams across departments" for free, since
  indirect reports can sit in any department.
- Cannot represent people who work together but share no manager chain
  (e.g. a cross-functional project group) — deliberately not solved here.
  That gap is real but belongs to a different, already-existing concept
  in this schema (`projects`), not a generic teams table — see
  `WORK-0024`, opened separately for exactly this.
- If recursive-CTE performance ever becomes a measured problem at a scale
  this app doesn't have today, the fix is a materialized closure table
  (manager → all-descendants, refreshed like the existing
  `refreshMaterializedViews` job), not a change of data model.

**Also flagged and split off, not part of this item's scope:** hierarchy-
(and project-ownership-) derived scopes reflect *current* org state, not
state as of when a report was submitted. Whether that's an acceptable gap
or needs point-in-time accuracy (this system is money/accounting-
adjacent) is being investigated separately — see `WORK-0025` (spike).

## Options considered

| Option | Pros | Cons | Chosen? |
|---|---|---|---|
| Widen `listExpenseReports` with an explicit `scope` query param, reject if unauthorized | Frontend controls what's shown, matches the "my reports vs. team" mental-model split; generalizes to picking a specific team; safe/predictable default (no param = today's behavior) | One more query param to document and validate; server must reject cleanly rather than clamp | ✓ |
| Auto-widen to the caller's broadest permitted scope, no param | Simplest server change; reuses `getReportViewScope` precedence logic that already exists for another purpose | Always mixes "mine" with "team's" for any privileged user, with no way to see just their own through this endpoint; doesn't handle "pick a specific team" without an additional filter layer anyway | ✗ |
| Leave list as-is; team/department/all browsing stays single-record-only | No change needed | Permissions like `report.view.team`/`.all` are effectively dead for the main way anyone would browse reports | ✗ |
| Add a separate endpoint (e.g. `/expense-reports/team`) instead of widening the existing one | Keeps "my reports" and "team reports" as explicitly different calls | Duplicates pagination/sort/search logic; two endpoints to keep in sync going forward; user explicitly prefers a filter over a second endpoint | ✗ |

## Consequences

**Positive (once implemented):**
- Closes the inconsistency between single-record and list access for the same resource
- Makes `report.view.team`/`.department`/`.all` actually usable for their evident intended purpose
- Frontend (mobile and web) gets a natural, permission-gateable filter UI instead of an implicit, always-broadest response
- Default behavior (no `scope` param) is unchanged for every existing caller — no migration risk for current clients

**Negative / Trade-offs accepted:**
- One more query param to validate and document; the reject-vs-clamp behavior needs a clear error body so clients can distinguish "you're not allowed to ask for this" from other 403s

**Risks / Open questions:**
- Recursive-CTE query cost is unmeasured — expected negligible at this app's scale, with a documented fallback (materialized closure table) if that ever changes. Not blocking implementation.
- Does the mobile client (or web client) currently assume `GET /expense-reports` is always own-only? Should be unaffected since the default is unchanged, but worth a quick check before shipping, not assumed safe here.
- Point-in-time accuracy for `team`/`department` scopes is explicitly out of scope for this item — see `WORK-0025`.

## Definition of done

- [x] Shape decided: widen existing endpoint with an explicit `scope` query param, not a separate endpoint (see Decision)
- [x] "Team" mapping resolved: recursive `manager_id` hierarchy (direct + indirect reports), `department` stays as `canAccessReport` already implements it — no picker, no new schema
- [x] `listExpenseReports` accepts `scope=own|team|department|all`, rejects with `403` if the caller lacks the matching permission, defaults to `own` when omitted
- [x] `team` scope implemented via `WITH RECURSIVE` over `manager_id`, not just direct reports
- [x] Verified live: a manager with `report.view.team` gets both a direct and an indirect subordinate's report with `scope=team`, gets `403` requesting `scope=all` without that permission, and gets today's own-only behavior with no param at all
- [x] Confirmed existing callers (no `scope` param) see no change in behavior
- [x] `tsc --noEmit` clean

## Log

- 2026-08-16 proposed — found while confirming, at the user's request, that
  report/line reads are properly scoped per user. They are (no leak found)
  — but list and single-record access for reports turned out to be
  inconsistently scoped. Opened as its own item since it's a genuine,
  separate gap, not part of WORK-0021/0022's scope.
- 2026-08-16 accepted — user was leaning toward not adding a separate
  team-scoped endpoint, preferring a frontend-driven filter (own vs. a
  specific team, for mobile and web both) instead of the server always
  auto-widening to the caller's broadest permission. Gave a UX
  recommendation agreeing with that direction and expanding on why
  (separates "my reports" from "team I'm reviewing" as distinct mental
  models; generalizes to picking a specific team; safer default). User
  confirmed. Recorded as the accepted shape; the specific team/department
  param mapping is still open and needs an answer before implementation.
- 2026-08-16 accepted — resolved the team/department mapping. Walked the
  user through recursive-hierarchy vs. an explicit teams table
  (maintainability/scalability/performance trade-offs), and separately
  through the UX cost of hierarchy's blind spot (cross-functional groups
  with no shared manager). User agreed on recursive hierarchy for `team`,
  and asked for the cross-functional gap and the point-in-time-accuracy
  concern (this system is money/accounting-adjacent) each to become their
  own item rather than be absorbed here. Opened `WORK-0024` (project-
  scoped visibility, covers the cross-functional case via the existing
  `projects` concept) and `WORK-0025` (spike — point-in-time accuracy;
  confirmed while opening it that `audit_logs` doesn't currently capture
  `manager_id`/`department_id` changes at all, so that data doesn't exist
  in any form yet). This item's own DoD is otherwise fully decided and
  ready for implementation.
- 2026-08-19 implemented — added `scope` query param to
  `ExpenseReportListQuerySchema` (`schemas/expenseReport.ts`), a
  `buildScopeCondition` helper in `expenseReport.service.ts` (own/team/
  department/all, rejecting with `ForbiddenError` → 403 for team/
  department/all when the caller lacks the matching `report.view.*`
  permission), and a recursive `WITH RECURSIVE subordinates` query for
  `team` (direct + indirect reports, depth-capped at 20 as a cycle
  guard). Route handler now passes JWT permissions through, matching the
  existing single-record (`getExpenseReportById`) pattern. `tsc --noEmit`
  clean. Verified live against the running dev container
  (`docker exec expense-api-postgres-1` + `curl` against
  `localhost:3002/v1/expense-reports`): default (no `scope`) unchanged
  own-only for `employee@test.local`; `scope=team` for `manager@test.local`
  returned both direct reports' reports, and — after temporarily
  reparenting `employee2@test.local` under `employee@test.local` to
  create an indirect-report case, then reverting — still included the
  indirect report's expenses, confirming the recursive walk; `scope=all`
  for `finance@test.local` matched the DB's true non-deleted report
  count (17); `scope=department` for `admin@test.local` returned 0
  against their real department (no reports currently tagged to it) and
  6 after temporarily pointing their `department_id` at a department
  with matching reports (then reverted); `scope=team`/`all`/`department`
  for `employee@test.local` (lacks all three permissions) each correctly
  403'd. All temporary DB edits used for verification were reverted
  after testing.

---

> **For AI agents:** Do NOT implement this work item unless status is
> `accepted` or `building`. If status is `proposed`, surface it to the user
> for a decision before writing any code. If status is `superseded`, follow
> the item in `superseded-by` instead — do NOT implement the pattern
> described here. If you are about to contradict an `accepted`, `building`,
> `shipped`, or `operating` item, stop and surface it to the user before
> proceeding.
