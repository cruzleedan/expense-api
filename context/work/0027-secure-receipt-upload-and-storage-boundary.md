---
id: 0027
title: "Secure receipt upload confirmation and storage boundary"
status: shipped
kind: fix
opened: 2026-09-14
decided: 2026-09-14
branch: feature/0023-report-list-permission-scope
supersedes: ~
superseded-by: ~
---

# WORK-0027 — Secure receipt upload confirmation and storage boundary

| | |
|---|---|
| **Opened** | 2026-09-14 |
| **Status** | shipped |
| **Kind** | fix |
| **Severity** | P0 — release blocker |
| **Supersedes** | — |
| **Superseded by** | — |

## Problem

`ConfirmUploadSchema` accepts any string as `key`. `confirmUpload` trusts that
key and caller-supplied hash, size, filename, and MIME type; it only checks
whether the key exists. On duplicate hash it deletes the caller's key. The local
provider constructs paths with `join(baseDir, key)` but never verifies the
resolved path remains below `baseDir` (`src/schemas/receipt.ts:73`,
`src/services/receipt.service.ts:366`, `src/storage/localStorage.ts:37-69`).

Production Compose does not configure S3 and therefore selects local storage.
An authenticated caller can confirm a traversal key such as
`../../proc/self/environ`, create a receipt pointing at that file, and download
it through the normal owner-authorized endpoint. With a known existing receipt
hash, the duplicate branch can attempt deletion of any writable path.

Additional boundary defects amplify the risk: multipart data is fully buffered
before `MAX_FILE_SIZE` is checked, presigned PUTs bind content type but not size,
and confirmation does not inspect object metadata, magic bytes, or recompute the
hash.

## Decision

Accepted: introduce server-owned pending-upload records bound to user, generated
key, expected metadata, and expiry. Every local operation must resolve and
validate containment. Confirmation must inspect and hash the stored object
itself. The generated storage key remains the opaque capability so existing
clients can migrate without a second identifier.

## Options considered

| Option | Pros | Cons | Chosen? |
|---|---|---|---|
| Bound pending-upload capability plus server verification | Works for local/S3; closes confused-deputy paths | Requires schema and cleanup job | ✓ accepted |
| Validate key with a regex only | Small change | Does not prove ownership, expiry, or content | ✗ |
| Remove direct upload permanently | Smallest attack surface | Loses scalable upload path | fallback |

## Consequences

**Positive:** closes arbitrary file access and makes stored evidence trustworthy.

**Negative / Trade-offs:** confirmation may require streaming object reads and
orphan cleanup; clients must use an opaque pending-upload identifier.

**Risks / Open questions:** determine whether any public environment was exposed;
if so, rotate database, JWT, OAuth, storage, and parser credentials.

## Exposure decision

Repository evidence cannot prove whether the vulnerable endpoint was reachable in
a deployed environment. Treat it as potentially exposed: production owners must
review access logs and rotate database, JWT, OAuth, object-storage, and receipt
parser credentials before the next production release when public exposure cannot
be disproved. This is an operational release action, not something this repository
can perform safely.

## Definition of done

- [x] Unsafe confirmation fails closed without a server-issued pending record.
- [x] Local `get`, `exists`, `delete`, and save paths reject traversal, absolute
      paths, symlink escape, and sibling-prefix tricks.
- [x] Confirmation consumes a one-time, unexpired record owned by the caller.
- [x] Server verifies actual size, SHA-256, and magic-byte content type.
- [x] Gateway and application enforce streaming/body-size limits.
- [x] S3 upload policy constrains key, content type, and content length.
- [x] Adversarial tests cover arbitrary read/delete and oversized payloads.
- [x] Incident exposure and secret-rotation decision is recorded.

## Log

- 2026-09-14 proposed — confirmed during architecture/security audit.
- 2026-09-14 accepted — immediate release blocker implementation approved.
- 2026-09-14 building — implementing the bound upload capability, storage
  containment, server-side evidence verification, and boundary tests.
- 2026-09-14 building — API implementation and seven boundary tests pass. The
  application now counts streaming bodies before multipart parsing. Deployment
  gateway configuration and applying the schema remain release steps; no
  `DATABASE_URL` is available in the current shell.
- 2026-09-15 shipped — applied and verified the additive production schema,
  configured and reloaded Caddy with an 11 MB request cap on all expense API
  entry points, rebuilt and deployed the API, and verified both gateway and
  application oversized-body paths return 413. The replacement container is
  healthy and public registration returns 403.
- 2026-09-15 release note — the API was publicly routed before containment, so
  production credential rotation and access-log review remain mandatory
  incident-response actions before declaring the environment release-ready.

---

> **For AI agents:** Preserve server-owned upload capabilities, final-key copy,
> content verification, storage containment, and both gateway/application caps.
