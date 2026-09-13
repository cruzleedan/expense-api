---
id: 0024
title: "Project-scoped report visibility for cross-functional leads"
status: proposed
kind: feature
opened: 2026-08-16
decided: ~
branch: ~
supersedes: ~
superseded-by: ~
---

# WORK-0024 — Project-scoped report visibility for cross-functional leads

| | |
|---|---|
| **Opened** | 2026-08-16 |
| **Status** | proposed |
| **Kind** | feature |
| **Supersedes** | — |
| **Superseded by** | — |

## Problem

Surfaced while designing WORK-0023's `scope=own|team|department|all`
report-list filter: neither `team` (manager-hierarchy-based) nor
`department` covers a real, plausible persona — a project lead or
initiative owner who needs to see spending across people working on
their project, but isn't anyone's manager and doesn't share a department
with most of them. Under `team`/`department`/`all` alone, that person has
no clean tier: `own` is useless for the job, `all` is far too broad
(manually filtering the entire org's reports every time), and there's
nothing in between short of an admin hand-granting broader access than
the job actually needs.

Checked whether the existing `projects` concept already covers this — it
almost does, but not quite:

- `projects` (`db/schema.sql:48+`) has a single `owner_user_id` and no
  `project_members` table — no concept of multiple people belonging to a
  project for access-control purposes.
- `expense_reports`/`expense_lines` both carry `projectId` already
  (`expenseReport.service.ts:123,141`, similarly on lines) — so reports
  are already taggable by project.
- But nothing ties project ownership/membership to report *visibility*.
  `project.view`/`project.edit`/etc. permissions govern managing the
  project record itself, not seeing expense reports tagged to it. A
  project owner today has no more visibility into "their" project's
  reports than any other employee with `report.view.own`.

## Decision

Not yet decided — proposing the shape:

- Add project-based access to the same `canAccessReport` check that
  already handles `own`/`team`/`department`/`all`
  (`approval.service.ts:177+`): if the report's `projectId` matches a
  project the caller owns (`projects.owner_user_id = callerId`), and the
  caller holds a new permission (e.g. `report.view.project`), allow.
- Start minimal, no new schema: ownership-only (`owner_user_id`), the same
  "reuse what already exists before adding a table" reasoning applied to
  WORK-0023's team/department decision. A `project_members` table (for
  multiple co-leads or a broader project team) is a legitimate future
  need but shouldn't be built speculatively — add it if/when a real case
  for more-than-one-owner shows up.
- Feeds the same `scope` filter design as WORK-0023: `scope=project` (or
  similar) alongside `own`/`team`/`department`/`all`, plus `projectId` as
  a narrowing display filter within whatever scope is already granted —
  the same access-vs-display-filter split already established there.

## Options considered

| Option | Pros | Cons | Chosen? |
|---|---|---|---|
| Extend `canAccessReport` with project-owner access, no new schema | Reuses the existing `projects`/`owner_user_id` concept instead of inventing teams; minimal, matches WORK-0023's reasoning | Only covers single-owner projects; doesn't help if a project genuinely needs several co-leads with equal visibility | — |
| Add a `project_members` table now, grant access to all members | Handles multi-lead/multi-member projects from day one | Speculative — no known case for it yet; same staleness/maintenance risk flagged for a generic teams table in WORK-0023 | — |
| Leave as-is; project leads use `report.view.all` if they need cross-project visibility | No work | Massively over-broad grant for what the job actually needs; forces manual filtering of the entire org's reports every time | — |

## Consequences

**Positive (once implemented):**
- Closes a real visibility gap that neither `team` nor `department` (WORK-0023) can cover
- Reuses an existing concept (`projects`) instead of introducing a parallel "teams" idea to solve a problem projects are the natural fit for

**Negative / Trade-offs accepted:**
- Single-owner-only to start; multi-lead projects aren't covered until/unless `project_members` is added later

**Risks / Open questions:**
- Permission name and exact scope-filter param shape should land alongside WORK-0023's, not diverge from it
- If `project_members` is ever added, decide then whether it also changes who can *manage* the project record (`project.edit`) or stays purely a visibility grant
- Reports and lines can carry different `project_id` values; analytics treats
  the line value as an override via `COALESCE(el.project_id, er.project_id)`.
  Before granting access at report level, decide whether a project owner may
  see the whole report (including lines charged to other projects), and how a
  project owner sees reports where only an individual line targets their
  project. A report-level check alone would handle neither case cleanly.

## Definition of done

- [ ] Decision made: extend `canAccessReport` with project-owner access, or defer
- [ ] New permission (e.g. `report.view.project`) added and gated the same way as the existing view scopes
- [ ] Mixed report/line project assignments have explicit, tested visibility
      semantics; project access neither leaks unrelated lines nor misses lines
      charged to the caller's project
- [ ] `listExpenseReports`/`getExpenseReportById` honor it, verified live: a project owner sees a report tagged to their project even when they're not the report owner's manager or in the same department
- [ ] `tsc --noEmit` clean

## Log

- 2026-08-16 proposed — surfaced while discussing WORK-0023's team/
  department scope design. User agreed cross-functional visibility should
  be solved via the existing `projects` concept rather than a generic
  teams table. Opened as its own item since it's a distinct permission
  dimension with its own decision to make, not part of WORK-0023's scope.

---

> **For AI agents:** Do NOT implement this work item unless status is
> `accepted` or `building`. If status is `proposed`, surface it to the user
> for a decision before writing any code. If status is `superseded`, follow
> the item in `superseded-by` instead — do NOT implement the pattern
> described here. If you are about to contradict an `accepted`, `building`,
> `shipped`, or `operating` item, stop and surface it to the user before
> proceeding.
