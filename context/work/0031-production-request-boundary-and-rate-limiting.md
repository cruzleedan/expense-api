---
id: 0031
title: "Establish a production-safe request boundary and rate limiter"
status: proposed
kind: infra
opened: 2026-09-14
decided: ~
branch: ~
supersedes: ~
superseded-by: ~
---

# WORK-0031 — Establish a production-safe request boundary and rate limiter

| | |
|---|---|
| **Opened** | 2026-09-14 |
| **Status** | proposed |
| **Kind** | infra |
| **Supersedes** | — |
| **Superseded by** | — |

## Problem

All limiter instances share one module-level `Map` and the same `rate:<ip>` key.
`/v1/auth/*` is processed by the app limiter and the auth router limiter, so an
auth request increments twice and unrelated API calls consume the same auth
bucket. The first `X-Forwarded-For` value is trusted directly, missing addresses
collapse to `unknown`, and each API process has independent state
(`src/middleware/rateLimit.ts:10-76`, `src/app.ts:52-70`). Login lockout has a
separate lost-update race.

CORS uses `origin: '*'` with `credentials: true`, which is invalid for normal
browser credential requests. There is no application or documented edge request
body cap, and receipt handlers buffer multipart bodies before service validation.

## Decision

Proposed: define trusted proxy/origin configuration, impose edge and application
body/time limits, and use atomic, policy-namespaced rate counters shared by all
replicas. Select the shared mechanism explicitly; WORK-0006 rejected a blanket
Redis adoption, so this item must not reintroduce it without a new decision.

## Options considered

| Option | Pros | Cons | Chosen? |
|---|---|---|---|
| Edge limits plus shared atomic application counters | Defense in depth | Operational dependency/coordination | ✓ proposed |
| Keep process-local Map | Simple | Incorrect under replicas and restart | ✗ |
| Rely only on account lockout | No infrastructure | Does not protect endpoints/resources | ✗ |

## Consequences

**Positive:** reliable abuse control and working cross-origin cookie flows.

**Negative / Trade-offs:** proxy trust and counter availability become deployment
concerns; policies need endpoint, IP, account, and expensive-operation dimensions.

**Risks / Open questions:** choose gateway/shared-counter technology after
reviewing actual deployment topology; do not assume Redis.

## Definition of done

- [ ] Auth, general API, upload, and AI quotas have separate namespaces.
- [ ] Counters are atomic and consistent across replicas.
- [ ] Client identity derives only from a configured trusted proxy chain.
- [ ] Login failure increments are atomic.
- [ ] CORS is an explicit environment allowlist with credential tests.
- [ ] Edge/application size and timeout limits reject oversized bodies before buffering.
- [ ] Tests cover double-counting, spoofed forwarding headers, replicas, and restart.

## Log

- 2026-09-14 proposed — confirmed through static review and in-process limiter/CORS probes.

---

> **For AI agents:** Do NOT implement while this item is `proposed`.
