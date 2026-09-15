---
id: 0037
title: "Enforce dynamic-form rules and preserve opaque JSON contracts"
status: proposed
kind: fix
opened: 2026-09-14
decided: ~
branch: ~
supersedes: ~
superseded-by: ~
---

# WORK-0037 — Enforce dynamic-form rules and preserve opaque JSON contracts

| | |
|---|---|
| **Opened** | 2026-09-14 |
| **Status** | proposed |
| **Kind** | fix |
| **Supersedes** | — |
| **Superseded by** | — |

## Problem

The UI schema route accepts a caller-controlled `role` query and applies rules
for only one role, although users may have multiple roles. Platform is also
client-supplied. Hidden/read-only/required/validation/dropdown rules shape UI
metadata but expense report/line write services do not enforce them. Custom-field
reads return stored values without role visibility filtering, so hidden values
can leak and read-only fields can be changed through direct API calls.

Custom values are deleted/reinserted separately from the entity mutation, making
partial writes possible. The global response middleware recursively camel-cases
all objects, including opaque JSONB. Policy `rule_config.max_amount`, workflow
conditions, parser output, and other user/domain keys can change on response and
fail a round trip (`src/middleware/camelCase.ts:7-21`,
`src/utils/caseTransform.ts:45-61`).

## Decision

Proposed: compile the published form into a server-side access/validation policy
using authenticated effective roles and trusted channel identity. Apply it to
reads and writes, and update entity/custom values in one unit of work. Replace
recursive global key rewriting with explicit DTO mapping; treat JSONB payloads as
opaque unless their schema explicitly defines key conversion.

## Options considered

| Option | Pros | Cons | Chosen? |
|---|---|---|---|
| Shared compiled form policy for UI and API | One source of truth | Cache/invalidation complexity | ✓ proposed |
| Keep rules presentation-only | Simple | Misleading security and validation model | ✗ |
| Continue recursive camel casing with exclusions | Smaller | Exclusion list will remain fragile | ✗ |

## Consequences

**Positive:** dynamic forms become real authorization/validation controls and
opaque data round-trips safely.

**Negative / Trade-offs:** multi-role conflict precedence and trusted channel
semantics must be explicitly decided.

**Risks / Open questions:** decide deny/allow precedence, system-field required
behavior, historical form versions, and MCP/mobile/web channel identification.

## Definition of done

- [ ] UI schema derives roles from authentication, supports effective multi-role rules,
      and does not trust a role query parameter.
- [ ] Hidden fields are omitted from reads and rejected/ignored by writes by policy.
- [ ] Read-only, required, validation, option, and platform rules are server-enforced.
- [ ] Form version used for validation is recorded where historical evidence requires it.
- [ ] Entity and custom-field values commit atomically.
- [ ] Response mapping preserves arbitrary JSONB keys byte-for-key.
- [ ] Tests cover role conflicts, direct API bypass, hidden-value disclosure,
      invalid options, partial failure, and JSON round trips.

## Log

- 2026-09-14 proposed — confirmed during dynamic-form and response-contract audit.

---

> **For AI agents:** Do NOT implement while this item is `proposed`.
