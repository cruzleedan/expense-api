# Sync Manifest Endpoint — Spec for Backend

## Why

Incremental sync (`updatedSince`) catches deletions ("tombstones") made on other
clients (e.g. the web app) as long as the device syncs within the server's
tombstone-retention window. A device that's offline longer than that window —
or that does a full resync (`updatedSince` omitted) — can permanently miss a
deletion: the record simply lingers as a "ghost" in local storage forever,
since the tombstone has already aged out by the time the device catches up.

To close this gap, the client needs an occasional **reconciliation pass**: pull
the complete set of remote record IDs (active + deleted) and locally delete any
"synced" record (`remote_id != null`) that's absent from that set entirely —
i.e. the server has no memory of it at all, active or tombstoned.

Doing this with the existing full-fetch endpoints (`getReports`,
`getAllLinesForSync` with `updatedSince: null`) works, but downloads entire
record bodies just to extract IDs — wasteful for periodic reconciliation,
especially as datasets grow. A dedicated lightweight manifest endpoint avoids
that cost.

## Proposed endpoints

```
GET /v1/expense-reports/sync-manifest
GET /v1/expense-lines/sync-manifest
```

**Auth**: same bearer-token auth as existing endpoints; results scoped to the
authenticated user (mirrors `getReports` / `getAllLinesForSync`).

**Query params**: none required for v1. (See Pagination note below.)

**Response shape** — flat list with `deletedAt`, mirroring the existing
tombstone convention used elsewhere in the API:

```json
{
  "data": [
    { "id": "uuid1", "deletedAt": null },
    { "id": "uuid3", "deletedAt": "2026-06-01T12:00:00Z" }
  ]
}
```

This shape maps directly onto a cheap `SELECT id, deleted_at FROM ... WHERE
user_id = ?` and lets the client build one `Set<String>` of "all IDs the server
knows about" (active or tombstoned) without extra branching.

An equally acceptable alternative, if more natural for your ORM/schema:

```json
{
  "data": {
    "activeIds": ["uuid1", "uuid2"],
    "deletedIds": ["uuid3"]
  }
}
```

Either works client-side — pick whichever maps more directly onto your existing
queries.

**Scope for `expense-lines`**: across *all* of the user's reports (same scope
as `getAllLinesForSync`), not per-report — reconciliation needs the full local
line set checked in one pass.

## Pagination

If a single user could realistically have >5,000–10,000 records, paginate like
the existing list endpoints (`page`/`limit` + `pagination: { hasNext }`).
Otherwise a flat unpaginated list keeps the client simpler. For an expense
tracker this is probably unnecessary, but defer to actual data-volume
expectations.

## How the client will use it

1. Fetch the manifest (paginating if needed) → build `Set<String> remoteIds`
   containing every ID the server has ever issued for this user (active +
   tombstoned).
2. Locally:
   ```sql
   DELETE FROM expense_report
   WHERE remote_id IS NOT NULL AND remote_id NOT IN (<remoteIds>)

   DELETE FROM expense_line
   WHERE remote_id IS NOT NULL AND remote_id NOT IN (<remoteIds>)
   ```
3. Anything with a `remote_id` that's missing from the manifest entirely —
   neither active nor tombstoned — is a record the server has fully forgotten
   (e.g. a hard-deleted/pruned tombstone). Purging it locally brings the device
   back in sync without waiting on the incremental-pull tombstone window.

This pass would run occasionally (not on every sync — e.g. daily, or on
explicit user-triggered "full resync"), bounded by the lightweight payload size
this endpoint provides.
