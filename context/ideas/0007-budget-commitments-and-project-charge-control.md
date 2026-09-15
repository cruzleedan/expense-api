---
id: IDEA-0007
title: "Budget commitments and project charge control"
status: exploring
opened: 2026-09-14
promoted-to: ~
---

# IDEA-0007 — Budget commitments and project charge control

## Opportunity

Budgets/projects currently store spent values and metadata, but there is no
authoritative reservation/commitment lifecycle. A check at approval time alone
can overcommit when multiple reports proceed concurrently, and project IDs do not
prove the employee is authorized to charge the project.

## Hypothesis

Available-budget calculation with transactional reservations and project charge
authorization would prevent overspend and provide meaningful forecasts.

## Capability sketch

- Effective-dated budget versions by entity/cost center/project/category/period.
- Actual, committed, reserved, available, forecast, and tolerance amounts.
- Reservation at submission/approval with release on return/reject/withdraw.
- Conversion from commitment to actual at posting.
- Project membership/charge authorization and accountable owner approval.
- Transfer/supplement workflow and immutable budget adjustment history.

## Questions to shape

- At which state is budget reserved, and can approval exceed with escalation?
- Which dimension wins when report and line project/category differ?
- How are FX, tax, cancelled claims, year-end carryover, and reallocations handled?
- Is the API authoritative or synchronized with a planning/ERP system?

## Promotion criteria

- [ ] WORK-0026 decisions on project authorization/enforcement are resolved.
- [ ] Finance defines budget dimensions, lifecycle, tolerance, and source system.
- [ ] Concurrent reservation and reconciliation examples are approved.
- [ ] Migration from current `spent_amount` fields is planned.

## Related records

- WORK-0024, WORK-0026, WORK-0038, WORK-0041; IDEA-0002.

## Log

- 2026-09-14 exploring — captured from budget-control review.

---

> **For AI agents:** This idea is not authorization to implement.

