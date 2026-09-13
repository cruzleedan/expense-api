---
id: 0025
title: "SPIKE: point-in-time accuracy for team/department-scoped report views"
status: proposed
kind: spike
opened: 2026-08-16
decided: ~
branch: ~
supersedes: ~
superseded-by: ~
---

# WORK-0025 — SPIKE: point-in-time accuracy for team/department-scoped report views

| | |
|---|---|
| **Opened** | 2026-08-16 |
| **Status** | proposed |
| **Kind** | spike |
| **Supersedes** | — |
| **Superseded by** | — |

## Problem

WORK-0023's `team`/`department` scopes (and WORK-0024's project-owner
scope) are all derived from *current* state — `users.manager_id`,
`users.department_id`, `projects.owner_user_id` — not from what that
state was at the time a given report was submitted or approved. Concrete
failure mode: filter "Bob's team, Q1 reports" today, get one answer;
someone moves teams in Q2; filter the exact same "Bob's team, Q1 reports"
in Q3, get a *different* answer for a historical period that shouldn't
change. Same issue applies to department moves and project ownership
transfers.

This matters more here than it would in most apps, because this system
is money/accounting-adjacent — "who was on whose team when this expense
was incurred, submitted, or approved" is the kind of fact an audit or
accounting review can reasonably expect to be stable and reconstructable,
not something that silently drifts as the org chart changes.

Checked whether this is already solved by existing infrastructure: it
isn't. `audit_logs` (`db/schema.sql:585+`) exists and has a generic
before/after `changes` JSONB column already used elsewhere (report
approvals, etc.), but `user.service.ts`'s update path never writes to it
— `manager_id`/`department_id` changes on a user are not currently
logged anywhere. There is no way, today, to answer "what was this
person's manager as of March 1st" at all, from any existing table.

## Decision

Not yet decided — this is a spike, scoped to investigate and propose,
not to ship a fix. Questions to answer before a real work item can be
written:

- **Where does "point in time" actually need to anchor?** Report
  submission date, approval date, or the expense's own transaction date
  can all differ from each other and from "now" — which one(s) actually
  matter for audit purposes here needs a real answer, not an assumption.
- **Are historical attribution and access authorization separate?** Current
  org state may need to decide who can open a report today, while historical
  state decides how that report is grouped for audit and analytics. Using a
  former manager relationship as today's authorization could preserve access
  after a reorg, while using only historical relationships could keep a new
  manager from the records they now need. The spike must define these as
  separate concerns or explicitly justify coupling them.
- **What's the right storage shape for historical org state?**
  Candidate approaches to weigh, not pre-decided:
  - Start writing `manager_id`/`department_id` changes to the existing
    `audit_logs` table (reuses existing infrastructure, but reconstructing
    "state as of date X" from an event log requires replaying changes
    rather than a direct point-in-time lookup — fine for occasional audit
    queries, likely too slow for a filter applied on every report list).
  - A dedicated temporal/effective-dated table
    (`user_org_history`: `user_id`, `manager_id`, `department_id`,
    `effective_from`, `effective_to`) — direct point-in-time lookups,
    more schema and write-path work.
  - Snapshot the relevant org fields directly onto `expense_reports` at
    submission time (denormalized, but then "team" for a historical
    report is a stored fact, not a derived query at all — cheapest to
    query later, but only covers reports going forward from when this
    ships; nothing retroactive for existing rows).
- **Retroactive backfill:** is there any way to reconstruct historical
  `manager_id`/`department_id` for reports that already exist, or is the
  honest answer "unknown before this ships, and that's an accepted gap"?
  Worth stating plainly either way rather than implying more precision
  than actually exists.
- **Scope check:** does this need to solve the general case (any
  historical query, any point in time) or just the narrower "don't let a
  reorg retroactively change an already-submitted report's team
  attribution" case? The narrower version (snapshot at submission time)
  is meaningfully cheaper than a fully general temporal model and may be
  all that's actually needed.

## Options considered

Not applicable in the usual sense — a spike's output is the options
analysis and a recommendation, not a chosen option. The candidates listed
under Decision above are what the spike should evaluate, not commit to.

## Consequences

**Positive (of doing the spike):**
- Turns a vague "this could be a problem" into a scoped, evidence-based
  recommendation before committing engineering time to any particular
  fix
- Forces an explicit answer on what "point in time" means for this system
  (submission vs. approval vs. transaction date), which affects WORK-0023/
  WORK-0024's design even if this spike's fix ships later

**Negative / Trade-offs accepted:**
- Spike work doesn't ship user-facing value directly; the real fix is a
  follow-up item once this lands

**Risks / Open questions:**
- If the answer turns out to require a fully general temporal model,
  that's real, ongoing schema/write-path complexity across every place
  `manager_id`/`department_id`/`owner_user_id` can change — worth being
  honest about that cost in the spike's writeup, not soft-pedaling it to
  make a simpler answer look sufficient when it isn't

## Definition of done

- [ ] "Point in time" anchor decided (submission / approval / transaction date, or a documented reason more than one is needed)
- [ ] Historical attribution is explicitly separated from present-day access
      authorization, or coupling them is justified with the intended reorg
      behavior documented
- [ ] Storage-shape recommendation written up with trade-offs (audit-log replay vs. temporal table vs. submission-time snapshot), not just picked silently
- [ ] Explicit answer on retroactive backfill feasibility for existing reports — even if the answer is "not possible, here's why"
- [ ] Recommendation handed back to the user as a real work item (or folded into WORK-0023/WORK-0024 if small enough), not left as spike output only

## Log

- 2026-08-16 proposed — user flagged this while discussing WORK-0023's
  team/department design: since this system is money/accounting-adjacent,
  historical facts about who was on whose team need to stay accurate even
  after later reorgs, and asked for this to be investigated properly
  rather than assumed away. Confirmed existing `audit_logs` infrastructure
  doesn't currently cover `manager_id`/`department_id` changes at all, so
  the honest starting state is "this data doesn't exist yet in any form,"
  not "it exists somewhere and just needs a better query."

---

> **For AI agents:** Do NOT implement this work item unless status is
> `accepted` or `building`. If status is `proposed`, surface it to the user
> for a decision before writing any code. If status is `superseded`, follow
> the item in `superseded-by` instead — do NOT implement the pattern
> described here. If you are about to contradict an `accepted`, `building`,
> `shipped`, or `operating` item, stop and surface it to the user before
> proceeding.
