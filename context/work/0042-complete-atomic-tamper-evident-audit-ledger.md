---
id: 0042
title: "Complete the atomic tamper-evident audit ledger"
status: proposed
kind: fix
opened: 2026-09-14
decided: ~
branch: ~
supersedes: ~
superseded-by: ~
---

# WORK-0042 — Complete the atomic tamper-evident audit ledger

| | |
|---|---|
| **Opened** | 2026-09-14 |
| **Status** | proposed |
| **Kind** | fix |
| **Supersedes** | — |
| **Superseded by** | — |

## Problem

Only workflow service calls `logAuditEvent`; user/role/permission, report/line,
receipt, policy, form, project, authentication, posting, and payment operations
have little or no coverage. Workflow logs are emitted after the business
transaction commits, so audit failure cannot roll back or reliably reconcile the
action.

Chain append reads the latest row without locking, computes a hash, and inserts.
Concurrent writers can reference the same predecessor and fork the alleged
single chain. Ordering by timestamp is not a stable chain order. The
`JSON.stringify` replacer lists only top-level names, which can exclude nested
keys inside `changes` and `metadata`. Verification trusts stored `data_hash`
instead of recomputing it from event content, so changed event fields may remain
“verified” (`src/services/audit.service.ts:34-176,309-390`). Audit query/export
services exist but no reviewed, permissioned operational route was found.

## Decision

Proposed: define a canonical audit envelope and required event catalog. Write the
business mutation and an audit/outbox event in the same database transaction.
Serialize canonically, append under serialization or use independently signed
events/Merkle batches, recompute content hashes during verification, and make
audit storage append-only to the application role.

## Options considered

| Option | Pros | Cons | Chosen? |
|---|---|---|---|
| Transactional outbox plus canonical signed events | Atomic and exportable | Dispatcher/verification work | ✓ proposed |
| Repair global hash chain only | Familiar | Serialization bottleneck and fragile global ordering | possible subset |
| Ordinary mutable audit rows | Simple | Not tamper-evident | ✗ |

## Consequences

**Positive:** sensitive actions have complete, verifiable evidence.

**Negative / Trade-offs:** audit payload minimization, PII retention, key
management, and export permissions require governance.

**Risks / Open questions:** choose hash/signature design, external anchoring need,
retention per event class, and who can view unredacted audit data.

## Definition of done

- [ ] A required event catalog covers all security and financial commands.
- [ ] Business mutation and audit/outbox event commit atomically.
- [ ] Canonical serialization includes all nested values deterministically.
- [ ] Concurrent appends cannot create an undetected fork.
- [ ] Integrity verification recomputes content and linkage/signature hashes.
- [ ] Application role cannot update/delete committed audit events.
- [ ] Permissioned query/export and scheduled integrity verification are operational.
- [ ] Coverage, tamper, concurrency, missing-dispatch, and retention tests exist.

## Log

- 2026-09-14 proposed — confirmed during compliance/audit review.

---

> **For AI agents:** Do NOT implement while this item is `proposed`.
