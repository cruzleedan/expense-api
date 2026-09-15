---
id: 0039
title: "Secure and correct AI, insight, and anomaly features"
status: proposed
kind: fix
opened: 2026-09-14
decided: ~
branch: ~
supersedes: ~
superseded-by: ~
---

# WORK-0039 — Secure and correct AI, insight, and anomaly features

| | |
|---|---|
| **Opened** | 2026-09-14 |
| **Status** | proposed |
| **Kind** | fix |
| **Supersedes** | — |
| **Superseded by** | — |

## Problem

The duplicate detector applies `EXTRACT(DAY FROM a.transaction_date -
b.transaction_date)`. PostgreSQL `date - date` yields an integer, so the query
fails. It also joins every line to every other matching merchant/amount without
same-user/currency/status/deletion constraints; if corrected syntactically as-is,
it can create cross-user false positives and expose another user's line ID in
anomaly context (`src/services/insight.service.ts:433-492`). General anomaly
candidates include deleted and inappropriate report states.

Pinning or dismissing a global insight updates the shared insight row, affecting
every user. Chat history orders ascending before `LIMIT`, so the model receives
the earliest messages instead of the most recent. `tokensUsed` increments once
per streamed network chunk, not model tokens. Chat/analytics/insight/anomaly
routes require authentication only although the permission registry contains
specific query, trend, insight, and review permissions. Any registered user can
select a model and consume unbounded inference work.

## Decision

Proposed: correct and bound detection queries by owner, currency, state, deletion,
and deterministic pair identity; store per-user insight state separately; fix
recent-history selection and actual usage accounting; enforce the route matrix
from WORK-0040 plus per-user/org cost, concurrency, and model allowlists.

## Options considered

| Option | Pros | Cons | Chosen? |
|---|---|---|---|
| Deterministic SQL candidates plus governed LLM enrichment | Testable and bounded | Requires metric/queue work | ✓ proposed |
| Let the LLM detect everything | Flexible | Costly, nondeterministic, unsafe scope | ✗ |
| Disable AI features | Removes cost/risk | Loses product capability | containment option |

## Consequences

**Positive:** anomaly and usage analytics become credible and tenant-safe.

**Negative / Trade-offs:** quotas/model allowlists need administration and clear
user error behavior; historic token metrics may be unrecoverable.

**Risks / Open questions:** choose anomaly review ownership (employee vs finance),
retention of prompts/responses, PII redaction, and acceptable model/data boundaries.

## Definition of done

- [ ] Duplicate query executes and compares only eligible lines for the same user,
      currency, normalized merchant, and bounded date window.
- [ ] Candidate pair uniqueness prevents duplicate anomaly records.
- [ ] Deleted/draft/rejected scope follows WORK-0038 semantics.
- [ ] Global insight content is immutable; pin/dismiss/read state is per user.
- [ ] Chat supplies the most recent N exchanges in chronological order.
- [ ] Token/usage data comes from model metadata or is named as an estimate.
- [ ] Route permissions, model allowlist, cost quota, and concurrency cap are enforced.
- [ ] Cross-user isolation, prompt retention, quota, and deterministic SQL tests exist.

## Log

- 2026-09-14 proposed — confirmed during AI/analytics audit and PostgreSQL expression check.

---

> **For AI agents:** Do NOT implement while this item is `proposed`.
