---
id: IDEA-0001
title: "Domain-oriented modular monolith with commands, unit of work, and outbox"
status: exploring
opened: 2026-09-14
promoted-to: ~
---

# IDEA-0001 — Domain-oriented modular monolith with commands, unit of work, and outbox

## Opportunity

The API is a reasonable single deployment, but business rules are split across
routes, raw SQL services, Drizzle services, middleware, and jobs. Cross-resource
operations frequently commit partially, and authorization/financial predicates
drift. The opportunity is to strengthen module boundaries without introducing
distributed services prematurely.

## Hypothesis

A modular monolith organized around Expense, Approval, Identity, Policy,
Evidence, Accounting, and Analytics domains would make controls testable while
retaining operational simplicity.

## Capability sketch

- Explicit commands and queries with authenticated actor/context.
- One unit-of-work abstraction usable by raw `pg` and Drizzle on the shared pool.
- Domain invariants and state machines isolated from HTTP DTOs.
- Transactional outbox for audit, derived data, notifications, and parser jobs.
- Read models for UI/analytics rather than mutable denormalized fields everywhere.
- Architecture tests preventing routes from bypassing application services.

## Questions to shape

- Which boundaries own report lines, receipts, workflow snapshots, and policies?
- Can the existing Drizzle/raw-SQL split be wrapped without a large rewrite?
- Which side effects require synchronous completion versus outbox delivery?
- What observability and idempotency contract should every command expose?

## Promotion criteria

- [ ] Two high-risk workflows are modeled end-to-end as a proof of design.
- [ ] Transaction API works with both current data-access styles.
- [ ] Module dependency rules and incremental migration plan are agreed.
- [ ] No microservice/message-broker dependency is assumed without a separate decision.

## Related records

- WORK-0002, WORK-0032, WORK-0033, WORK-0041, WORK-0042.

## Log

- 2026-09-14 exploring — captured from architecture audit.

---

> **For AI agents:** This idea is not authorization to implement.

