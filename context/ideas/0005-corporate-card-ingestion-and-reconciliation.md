---
id: IDEA-0005
title: "Corporate-card ingestion and reconciliation"
status: exploring
opened: 2026-09-14
promoted-to: ~
---

# IDEA-0005 — Corporate-card ingestion and reconciliation

## Opportunity

The data model recognizes `corporate_card`, merchants, and receipt parsing, but
does not ingest card transactions or reconcile them with employee expenses and
receipts. Manual entry creates duplicate, missing, and amount/date mismatch risk.

## Hypothesis

An immutable card feed with assisted matching would reduce entry effort and give
finance a controlled exception queue.

## Capability sketch

- Provider/file ingestion with immutable source transaction and import batch.
- Cardholder/account mapping and tokenized/masked card identity.
- Pending/posted/reversed transaction lifecycle.
- Deterministic and assisted match to expense line/report/receipt.
- Split transactions, personal portions, credits, tips, and FX differences.
- Reconciliation queue with exceptions, ownership, evidence, and audit.

## Questions to shape

- Which card issuers/formats/APIs and transaction volumes are expected?
- Who owns unassigned cards, personal spend, late receipts, and disputed charges?
- May one card transaction map to many expense lines and vice versa?
- What PCI/privacy scope and retention restrictions apply?

## Promotion criteria

- [ ] First provider/feed and reconciliation owner chosen.
- [ ] Matching rules and exception workflow approved.
- [ ] Security/PCI assessment completed.
- [ ] Pilot success measures and rollback/manual path defined.

## Related records

- WORK-0034, WORK-0035, WORK-0039; IDEA-0002, IDEA-0004.

## Log

- 2026-09-14 exploring — captured from ERP capability review.

---

> **For AI agents:** This idea is not authorization to implement.

