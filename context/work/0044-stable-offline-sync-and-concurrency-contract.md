---
id: 0044
title: "Define a stable offline sync and optimistic-concurrency contract"
status: proposed
kind: feature
opened: 2026-09-14
decided: ~
branch: ~
supersedes: ~
superseded-by: ~
---

# WORK-0044 — Define a stable offline sync and optimistic-concurrency contract

| | |
|---|---|
| **Opened** | 2026-09-14 |
| **Status** | proposed |
| **Kind** | feature |
| **Supersedes** | — (candidate successor to WORK-0005) |
| **Superseded by** | — |

## Problem

Incremental lists use `updated_at > updatedSince`, order by mutable timestamps,
and paginate with page/offset. Concurrent writes shift pages; multiple records can
share a timestamp; strict `>` can miss equal-timestamp updates when the next poll
advances to that timestamp. There is no stable cursor/watermark or snapshot
boundary. Tombstones are returned, but retention and full-resync requirements are
not defined.

Records carry `version`, but update/delete requests do not require an expected
version, so offline edits overwrite newer server state. Client create IDs are
globally unique and globally queried rather than scoped to owner, causing
cross-user conflicts/data return. Create idempotency does not bind a key to a
request fingerprint.

## Decision

Proposed: use an opaque cursor over a server-assigned monotonic change sequence
or stable `(updated_at,id)` snapshot, with explicit upper watermark. Scope
idempotency to owner/device and bind it to command fingerprint. Require expected
version for mutations and return a structured non-retryable conflict containing
safe current state. Define tombstone retention and manifest/full-resync protocol.

## Options considered

| Option | Pros | Cons | Chosen? |
|---|---|---|---|
| Change-log sequence/cursor | Strongest ordering and deletion history | New table/write path | ✓ proposed |
| `(updated_at,id)` keyset with watermark | Smaller change | Clock/timestamp discipline needed | interim option |
| Timestamp plus offset | Existing | Loses/duplicates changes | ✗ |

## Consequences

**Positive:** mobile/MCP retries become deterministic and cross-user safe.

**Negative / Trade-offs:** clients must persist cursor, version, device/idempotency
identity, and handle conflicts explicitly.

**Risks / Open questions:** coordinate with consumers, define retention/storage
cost, conflict merge rules, and point-in-time authorization changes.

## Definition of done

- [ ] Cursor protocol cannot miss or duplicate committed changes across pages.
- [ ] An upper watermark gives each sync cycle a stable end.
- [ ] Tombstone retention and “cursor too old; full resync” behavior are specified.
- [ ] Update/delete requires expected version and returns structured 409 conflicts.
- [ ] Create idempotency is owner-scoped and request-fingerprint checked.
- [ ] Authorization changes cannot leave unauthorized cached data without remediation.
- [ ] Contract tests run against expense-tracker and expense-mcp scenarios.
- [ ] Concurrent-write, equal-timestamp, retry, crash, and stale-cursor tests exist.

## Log

- 2026-09-14 proposed — successor to the unimplemented sync proposal drafted during audit.

---

> **For AI agents:** Do NOT implement while this item is `proposed`. If accepted,
> reconcile and update WORK-0005 rather than silently implementing both contracts.
