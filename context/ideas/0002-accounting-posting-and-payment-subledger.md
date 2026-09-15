---
id: IDEA-0002
title: "Accounting posting and payment subledger"
status: exploring
opened: 2026-09-14
promoted-to: ~
---

# IDEA-0002 — Accounting posting and payment subledger

## Opportunity

Reports currently have `posted` and `paid` labels but no accounting document,
journal batch, payable, payment instruction, or reversal model. Status fields
alone cannot prove what was booked or settled.

## Hypothesis

An append-only posting/payment subledger would let expense approval feed an ERP
or general ledger safely while preserving reconciliation and reversal history.

## Capability sketch

- Posting batch with balanced debit/credit distributions and accounting period.
- Immutable link from approved report snapshot to journal/export reference.
- Payable/reimbursement item with beneficiary and due/settlement currency.
- Payment batch, provider/bank reference, partial/failure/retry states.
- Reversal and correction documents rather than overwriting posted records.
- Export/import reconciliation with idempotency and SoD.

## Questions to shape

- Is expense-api the accounting subledger or an upstream feeder to another ERP?
- Which chart of accounts, dimensions, periods, and rounding rules apply?
- Who may post, release payment, reconcile, and reverse?
- Are partial payments, advances, and employee liabilities required?

## Promotion criteria

- [ ] Target accounting system and ownership boundary identified.
- [ ] Posting/payment state diagrams and journal examples approved by finance.
- [ ] Reversal, reconciliation, idempotency, and SoD rules agreed.
- [ ] Promoted in slices rather than one “ERP rewrite” item.

## Related records

- WORK-0032, WORK-0038, WORK-0042; IDEA-0004.

## Log

- 2026-09-14 exploring — captured from ERP architecture review.

---

> **For AI agents:** This idea is not authorization to implement.

