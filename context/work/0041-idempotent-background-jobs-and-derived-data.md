---
id: 0041
title: "Run background jobs and derived-data refreshes idempotently"
status: proposed
kind: infra
opened: 2026-09-14
decided: ~
branch: ~
supersedes: ~
superseded-by: ~
---

# WORK-0041 — Run background jobs and derived-data refreshes idempotently

| | |
|---|---|
| **Opened** | 2026-09-14 |
| **Status** | proposed |
| **Kind** | infra |
| **Supersedes** | — |
| **Superseded by** | — |

## Problem

`registerJobs()` is called by every API process at startup. Each replica will run
hourly view refresh, six-hour anomaly detection, and daily LLM insight generation.
Generation uses check-then-insert without a unique idempotency constraint, so
overlap/retry can duplicate rows and inference costs.

`refreshMaterializedViews` catches its own error and returns successfully, causing
the scheduler to log “completed” after failure. It refreshes only
`mv_expense_analytics`, although another materialized view and refresh function
exist. Daily insights depend on `spending_summaries`, but no application writer
or aggregation job exists. `updateProjectSpentAmount` is defined but never called
(`src/jobs/scheduler.ts:13-59`, `src/services/insight.service.ts:202-230,497-505`).

## Decision

Proposed: separate job execution from HTTP process lifecycle and use a database
lease/advisory lock or another explicitly accepted scheduler. Every run and
business output must have stable idempotency keys, observable status, bounded
retries, and failure propagation. Give each derived table/view a named owner,
source semantics, refresh cadence, and reconciliation procedure.

## Options considered

| Option | Pros | Cons | Chosen? |
|---|---|---|---|
| Separate worker plus PostgreSQL lease | Fits current stack | Worker deployment required | ✓ proposed |
| Keep embedded cron with advisory lock | Smaller deployment change | Couples web/worker lifecycle | interim option |
| Add RabbitMQ from WORK-0006 | General queueing | Previously rejected/too broad | ✗ without new decision |

## Consequences

**Positive:** safe horizontal scaling and trustworthy derived data.

**Negative / Trade-offs:** deployments must run/monitor a worker and define retry,
dead-letter, and backfill operations.

**Risks / Open questions:** choose lease duration, missed-run recovery, view refresh
locking strategy, and whether expensive LLM work needs a durable queue later.

## Definition of done

- [ ] HTTP replicas never cause duplicate scheduled execution.
- [ ] Job lease/run records support retry, monitoring, and manual backfill.
- [ ] Insight/anomaly outputs have database-enforced idempotency keys.
- [ ] Refresh failures propagate and mark the run failed.
- [ ] All materialized views are refreshed according to an explicit plan.
- [ ] Spending summaries and project spent values have implemented, reconciled writers.
- [ ] Multi-worker, retry, crash, overlap, and backfill tests exist.
- [ ] Isolated multi-worker/overlap/retry/crash/backfill regressions prove scheduled
      execution and persisted insight/anomaly outputs remain idempotent, including
      failure propagation and recovery; these are mandatory CI/release checks,
      not optional skipped tests.

## Release coverage transferred from WORK-0045

On 2026-09-15 the user approved moving the multi-worker job-idempotency gate from
[WORK-0045](0045-remediate-dependencies-and-establish-release-quality-gates.md)
to this item. The unchecked tests/mandatory CI criteria above retain that
coverage; WORK-0045's passing infrastructure gates do not demonstrate safe
multi-replica jobs. Use the
[shared release-quality procedure](../reference/release-quality-gates.md) for
isolated PostgreSQL verification. This transfer approves coverage ownership only:
the item remains `proposed`, and scheduler/recovery/output semantics and any
worker deployment require explicit approval before implementation.

## Log

- 2026-09-14 proposed — confirmed during scheduler/derived-data audit.
- 2026-09-15 coverage transferred — user approved moving WORK-0045's multi-worker
  idempotency release gate here. Added unchecked mandatory CI/output-deduplication
  acceptance criteria; no job architecture or implementation implicitly approved.

---

> **For AI agents:** Do NOT implement while this item is `proposed`.
