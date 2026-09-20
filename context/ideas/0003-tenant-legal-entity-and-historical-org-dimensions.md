---
id: IDEA-0003
title: "Tenant, legal-entity, and historical organization dimensions"
status: exploring
opened: 2026-09-14
promoted-to: ~
---

# IDEA-0003 — Tenant, legal-entity, and historical organization dimensions

## Opportunity

Current ownership is mostly user-based and organization scope is derived from
today's department/manager relationships. ERP controls often require hard tenant
and legal-entity isolation plus “as submitted/approved/posted” organization,
cost-center, manager, and project dimensions.

## Hypothesis

Explicit tenant/entity keys and effective-dated organizational assignments would
prevent accidental cross-organization data access and preserve historically
correct approval/reporting context.

## Capability sketch

- Mandatory tenant and legal-entity ownership on transactional/master data.
- Effective-dated user/department/manager/cost-center assignments.
- Submission/posting snapshots with entity and organizational dimensions.
- Tenant-aware unique keys, idempotency, storage prefixes, jobs, and audit.
- Database row-level protection considered as defense in depth.

## Questions to shape

- Is this single-company software, multi-company within one owner, or SaaS?
- Which data is global reference data versus tenant/entity specific?
- Which currency, tax jurisdiction, period, and retention policy belongs to entity?
- How are reorganizations and employee transfers approved/backdated?

## Promotion criteria

- [ ] Tenancy/legal-entity business model decided.
- [ ] Point-in-time query and snapshot requirements resolved through WORK-0025.
- [ ] Migration/backfill and cross-tenant security tests designed.
- [ ] Operational ownership for tenant provisioning/offboarding identified.

## Related records

- WORK-0024, WORK-0025, WORK-0040, WORK-0043.

## Log

- 2026-09-14 exploring — captured from ERP scope review.

---

> **For AI agents:** This idea is not authorization to implement.

