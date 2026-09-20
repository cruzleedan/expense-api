---
id: 0038
title: "Define canonical financial totals, statuses, and analytics scope"
status: proposed
kind: fix
opened: 2026-09-14
decided: ~
branch: ~
supersedes: ~
superseded-by: ~
---

# WORK-0038 — Define canonical financial totals, statuses, and analytics scope

| | |
|---|---|
| **Opened** | 2026-09-14 |
| **Status** | proposed |
| **Kind** | fix |
| **Supersedes** | — |
| **Superseded by** | — |

## Problem

Financial answers depend on the query path:

- live report totals exclude deleted lines, but submission totals include them;
- both materialized views include deleted lines/reports; the main view includes
  rejected/returned data because it excludes only `draft`;
- dashboard summaries do not filter deleted reports and omit `paid` from approved;
- semantic search and anomaly candidates omit deleted/status filters;
- project counts/category totals include deleted data and every lifecycle state;
- `updateProjectSpentAmount` excludes `paid`, is never called, and no service/job
  writes `spending_summaries`;
- the TypeScript report status union omits `paid` even though DDL/Zod include it;
- the nullable multi-column budget unique constraint permits duplicate logical
  “all” scopes under PostgreSQL NULL semantics.

Evidence includes `src/db/schema.sql:837-962`,
`src/services/analytics.service.ts:148-178`, and
`src/services/project.service.ts:314-376`.

## Decision

Proposed: publish a canonical metric dictionary defining active/deleted scope,
lifecycle inclusion, amount basis, currency, effective date, and ownership for
each operational and accounting measure. Implement shared query predicates or
versioned database views from that dictionary and reconcile/rebuild derived data.

## Options considered

| Option | Pros | Cons | Chosen? |
|---|---|---|---|
| Canonical semantic layer and versioned views | Consistent reports/AI | Requires metric governance | ✓ proposed |
| Patch missing filters independently | Fast | Semantics will drift again | ✗ |
| Count all historical records everywhere | Simple | Operational and accounting meanings differ | ✗ |

## Consequences

**Positive:** UI, approvals, budgets, AI, and management reporting agree.

**Negative / Trade-offs:** historical results may change during reconciliation;
metrics must distinguish submitted, approved, posted, paid, rejected, and deleted.

**Risks / Open questions:** decide authoritative total storage vs computation,
base/report/original currency, and whether soft-deleted financial records should
remain in a separately permissioned accounting history.

## Definition of done

- [ ] Metric dictionary defines every status/deletion/currency rule.
- [ ] One canonical active-line total drives display and submission snapshot.
- [ ] Materialized views, dashboard, semantic retrieval, anomaly input, and project
      summaries follow the dictionary.
- [ ] `paid` is included consistently in types and appropriate aggregates.
- [ ] Spending summaries/project spent values have an owned refresh/write process.
- [ ] Budget logical scope is uniquely constrained despite nullable dimensions.
- [ ] Reconciliation reports quantify changes before derived data is rebuilt.
- [ ] Golden-dataset tests prove all channels return the same expected totals.

## Log

- 2026-09-14 proposed — confirmed during financial/analytics consistency audit.

---

> **For AI agents:** Do NOT implement while this item is `proposed`.
