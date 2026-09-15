---
id: 0035
title: "Preserve receipt evidence and enforce aggregate-safe associations"
status: proposed
kind: fix
opened: 2026-09-14
decided: ~
branch: ~
supersedes: ~
superseded-by: ~
---

# WORK-0035 — Preserve receipt evidence and enforce aggregate-safe associations

| | |
|---|---|
| **Opened** | 2026-09-14 |
| **Status** | proposed |
| **Kind** | fix |
| **Supersedes** | — |
| **Superseded by** | — |

## Problem

The nested route `/expense-reports/:reportId/receipts` extracts `reportId` only
for list. Upload, upload-URL, and confirmation handlers ignore it and accept an
optional line ID instead, so a request under report A can create an unassociated
receipt or associate it to a line in report B. The association route claims all
lines must be from one report, but the service verifies only user ownership
(`src/routes/receipts.ts:104-170,536-645`,
`src/services/receipt.service.ts:217-245`).

Storage and database changes are not a recoverable unit: save can succeed before
DB insert, file deletion occurs before DB deletion, association and ICR updates
are separate commits, and failure leaves orphaned files/rows or missing evidence.
Owners can delete or change associations after approval/posting, weakening the
evidence behind an approval hash.

## Decision

Proposed: treat receipts as evidence within the report aggregate. Bind nested
commands to their route report, validate every association against one report
and editable state, and freeze evidence at submission. Coordinate storage using
a staged upload state plus transactional metadata/outbox cleanup; never pretend
filesystem/object-store changes share a database transaction.

## Options considered

| Option | Pros | Cons | Chosen? |
|---|---|---|---|
| Staged evidence lifecycle with compensating cleanup | Recoverable across stores | More states/jobs | ✓ proposed |
| Store receipt bytes in PostgreSQL | True DB transaction | DB growth and serving cost | ✗ for now |
| Best-effort file/row ordering | Small | Permanent inconsistency remains | ✗ |

## Consequences

**Positive:** an approver can rely on the evidence snapshot they reviewed.

**Negative / Trade-offs:** corrections after submission require return/reopen or
superseding evidence rather than destructive replacement.

**Risks / Open questions:** choose retention duration, duplicate scope, redaction,
legal hold, malware scanning, and whether receipts may support multiple reports.

## Definition of done

- [ ] Every nested receipt command verifies and uses route `reportId`.
- [ ] Receipt associations enforce same owner, same report, active records, and report state.
- [ ] Submission snapshots receipt hashes and association set.
- [ ] Approved/posted/paid evidence is immutable; correction is append/supersede.
- [ ] Upload/delete/ICR failure states are recoverable and orphan cleanup is idempotent.
- [ ] List and association reads exclude deleted lines/reports consistently.
- [ ] Tests cover cross-report association, ignored route ID, storage/DB failures,
      duplicate content, and post-submission deletion.

## Log

- 2026-09-14 proposed — confirmed during receipt aggregate/evidence audit.

---

> **For AI agents:** Do NOT implement while this item is `proposed`.
