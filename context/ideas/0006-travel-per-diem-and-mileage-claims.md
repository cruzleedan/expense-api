---
id: IDEA-0006
title: "Travel authorization, per-diem, and mileage claims"
status: exploring
opened: 2026-09-14
promoted-to: ~
---

# IDEA-0006 — Travel authorization, per-diem, and mileage claims

## Opportunity

Expense entry is generic, while many organizations distinguish travel requests,
cash advances, itinerary-linked claims, per-diem allowances, and mileage. Treating
them as ordinary merchant receipts cannot enforce policy or explain entitlement.

## Hypothesis

Typed travel/allowance claims tied to preauthorization would improve policy
automation and reduce manual calculation.

## Capability sketch

- Travel request with destination, purpose, itinerary, estimate, and approval.
- Advance issuance/liquidation linked to the final claim.
- Effective-dated per-diem tables by location/grade and meal deductions.
- Mileage claims with effective-dated rates, vehicle class, route/distance evidence.
- Link ordinary receipts/lines to travel authorization and allowance calculation.
- Exception workflow for overages, missing authorization, or late liquidation.

## Questions to shape

- Are travel preapproval, advances, per diem, and mileage all required?
- Which rate sources/jurisdictions and employee grades apply?
- What evidence is required for distance, itinerary, and deductions?
- How do cancellations, shared travel, and cross-currency settlement work?

## Promotion criteria

- [ ] Priority claim type and policy owner identified.
- [ ] Entitlement examples and exception rules approved.
- [ ] Effective-dated rate ownership/import process agreed.
- [ ] Relationship to generic expense/report workflows designed.

## Related records

- WORK-0033, WORK-0036; IDEA-0004.

## Log

- 2026-09-14 exploring — captured from ERP capability review.

---

> **For AI agents:** This idea is not authorization to implement.

