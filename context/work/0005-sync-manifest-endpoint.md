---
id: 0005
title: "Sync manifest endpoints for offline-first Flutter client"
status: proposed
kind: feature
opened: 2026-08-01
decided: ~
branch: ~
supersedes: ~
superseded-by: ~
---

# WORK-0005 — Sync manifest endpoints for offline-first Flutter client

| | |
|---|---|
| **Opened** | 2026-08-01 |
| **Status** | proposed |
| **Kind** | feature |
| **Supersedes** | — |
| **Superseded by** | — |

## Problem

The current incremental sync (`updatedSince`) can miss deletions if a device is
offline longer than the server's tombstone-retention window. A periodic
reconciliation pass — comparing local "synced" records against the server's
complete ID set — closes this gap. Fetching full record bodies just to compare
IDs is wasteful; a dedicated manifest endpoint returns only IDs cheaply.

## Decision

Add lightweight `sync-manifest` endpoints that return only record IDs (+ deletion
timestamps) so the Flutter client can reconcile local storage with the server
without downloading full record bodies.

### Endpoints

```
GET /v1/expense-reports/sync-manifest
GET /v1/expense-lines/sync-manifest
```

**Auth:** same bearer-token auth as existing endpoints; results scoped to the
authenticated user.

**Response:**

```json
{
  "data": [
    { "id": "uuid1", "deletedAt": null },
    { "id": "uuid3", "deletedAt": "2026-06-01T12:00:00Z" }
  ]
}
```

Maps directly to `SELECT id, deleted_at FROM ... WHERE user_id = $1`.

### Client reconciliation logic

1. Fetch manifest
2. Build `Set<String>` of all server-known IDs (active + tombstoned)
3. Delete any local record where `remote_id != null` AND `remote_id` is absent
   from the set entirely (server has no memory of it — it aged out of tombstones)

### Pagination

Not required for v1 — users with very large datasets are an edge case deferred
to v2. Add `limit`/`cursor` params if needed.

## Options considered

| Option | Pros | Cons | Chosen? |
|---|---|---|---|
| Dedicated sync-manifest endpoint (this design) | Cheap — IDs only, no full bodies | Two new endpoints to maintain; client needs a separate reconciliation cycle | ✓ |
| Full re-fetch with `updatedSince: null` | Simple, reuses existing endpoint | Downloads entire record bodies just for ID comparison; wasteful as datasets grow | ✗ |
| Server-push / WebSocket | Real-time | Overkill for this use case | ✗ |

## Consequences

**Positive:**
- Cheap reconciliation pass — no full record bodies transferred just to detect
  deletions

**Negative / Trade-offs accepted:**
- Two new endpoints to maintain
- Client must implement the reconciliation pass as a separate sync cycle

**Risks / Open questions:**
- What is the current tombstone-retention window? This determines how often the
  client must run a reconciliation pass to guarantee no ghosts.

## Definition of done

- [ ] `GET /v1/expense-reports/sync-manifest` implemented
- [ ] `GET /v1/expense-lines/sync-manifest` implemented
- [ ] Tombstone-retention window confirmed and documented
- [ ] Client reconciliation logic implemented against both endpoints

## Log

- 2026-08-01 proposed — migrated from RFC-0002 to this work item format

---

> **For AI agents:** Do NOT implement this work item unless status is
> `accepted` or `building`. If status is `proposed`, surface it to the user
> for a decision before writing any code. If status is `superseded`, follow
> the item in `superseded-by` instead — do NOT implement the pattern
> described here. If you are about to contradict an `accepted`, `building`,
> `shipped`, or `operating` item, stop and surface it to the user before
> proceeding.
