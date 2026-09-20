---
id: IDEA-0004
title: "Multi-currency, tax, reimbursement, and settlement correctness"
status: exploring
opened: 2026-09-14
promoted-to: ~
---

# IDEA-0004 — Multi-currency, tax, reimbursement, and settlement correctness

## Opportunity

Lines and reports expose original amount/currency, exchange rate, tax, base total,
reimbursable flags, and reimbursement status, but their accounting relationships
and rounding sources are not defined. Current JavaScript number handling is not
sufficient for authoritative money.

## Hypothesis

A documented money/tax/settlement model would support international expenses and
produce reproducible reimbursement and posting amounts.

## Capability sketch

- ISO currency registry with minor units and decimal-string API contract.
- Transaction, report, entity-base, and settlement currency amounts.
- Dated rate source, quotation direction, precision, manual override approval.
- Tax-inclusive/exclusive breakdown, jurisdiction, recoverable/nonrecoverable tax.
- Reimbursement claim/liability/settlement states separated from report approval.
- Rounding adjustments and immutable calculation snapshots.

## Questions to shape

- Which rate provider/date (transaction, submission, posting, payment) governs?
- Is tax recovery/reporting in scope, and for which jurisdictions?
- Can employees be paid in a currency different from transaction/entity currency?
- How are refunds, credits, cash advances, and rounding differences represented?

## Promotion criteria

- [ ] Finance approves money, FX, rounding, tax, and reimbursement definitions.
- [ ] Worked examples cover normal, refund, cross-currency, and tax scenarios.
- [ ] Required reference data and rate-provider ownership are agreed.
- [ ] Compatibility/migration impact on existing numeric APIs is assessed.

## Related records

- WORK-0012, WORK-0034, WORK-0038; IDEA-0002.

## Log

- 2026-09-14 exploring — captured from financial-model review.

---

> **For AI agents:** This idea is not authorization to implement.

