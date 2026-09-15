---
id: 0040
title: "Centralize route authorization and repair the OpenAPI contract"
status: proposed
kind: fix
opened: 2026-09-14
decided: ~
branch: ~
supersedes: ~
superseded-by: ~
---

# WORK-0040 — Centralize route authorization and repair the OpenAPI contract

| | |
|---|---|
| **Opened** | 2026-09-14 |
| **Status** | proposed |
| **Kind** | fix |
| **Supersedes** | — |
| **Superseded by** | — |

## Problem

Authorization is applied inconsistently across route files. Admin analytics
registers permission middleware after each OpenAPI handler, so the handler may
short-circuit before the permission middleware runs. Chat, analytics, insights,
anomalies, receipt operations, and several project/policy/template reads are
authentication-only despite corresponding permissions in the registry.

WORK-0023's report list uses recursive descendants for `scope=team`, but
`canAccessReport` accepts only a direct manager. A manager can therefore list an
indirect report and then receive 403 when opening it.

The generated OpenAPI document currently contains zero `securitySchemes` while
operations reference both `Bearer` and `bearerAuth` (27 `bearerAuth` occurrences).
The documented server is `http://localhost:3000/v1` while generated paths already
begin with `/v1`, producing a duplicated base for generated clients.

## Decision

Proposed: maintain an explicit route/action/scope/permission matrix and expose
shared policy functions consumed by list, detail, nested resource, workflow, and
MCP paths. Attach middleware before handlers or in route definitions. Generate
OpenAPI from the same authorization declarations and validate it in CI.

## Options considered

| Option | Pros | Cons | Chosen? |
|---|---|---|---|
| Central policy matrix plus shared scope predicates | Prevents drift | Requires inventory and ownership | ✓ proposed |
| Continue per-route conventions | Local simplicity | Existing omissions/order bugs recur | ✗ |
| Document current behavior only | No code | Contract remains false | ✗ |

## Consequences

**Positive:** runtime, generated clients, frontend gates, and MCP share one access model.

**Negative / Trade-offs:** every new route must select an action/scope and tests
must prove both allowed and denied cases.

**Risks / Open questions:** define permissions for employee-owned receipt/AI
actions and whether broader report scope automatically grants nested-resource view.

## Definition of done

- [ ] Every route is present in a reviewed authorization matrix.
- [ ] Permission middleware executes before every protected handler.
- [ ] List/detail/nested/workflow scope resolves through one policy implementation.
- [ ] Recursive team detail behavior matches WORK-0023 list behavior.
- [ ] Generated OpenAPI defines exactly one bearer scheme used by all protected operations.
- [ ] Server URL and paths compose to one `/v1` prefix.
- [ ] CI rejects undefined security refs and missing route security metadata.
- [ ] Matrix tests cover anonymous and each standard role/scope, including denials.

## Log

- 2026-09-14 proposed — confirmed through route inventory and generated-spec probe.

---

> **For AI agents:** Do NOT implement while this item is `proposed`; coordinate
> the report-scope correction with building WORK-0023.
