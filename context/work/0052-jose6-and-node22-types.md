---
id: 0052
title: "Upgrade jose to v6; keep @types/node on the Node 22 runtime line"
status: shipped
kind: infra
opened: 2026-09-25
decided: 2026-09-25
branch: infra/0052-jose6-types-node26
supersedes: ~
superseded-by: ~
---

# WORK-0052 — Upgrade jose to v6; keep @types/node on the Node 22 runtime line

| | |
|---|---|
| **Opened** | 2026-09-25 |
| **Status** | shipped |
| **Kind** | infra |
| **Supersedes** | — |
| **Superseded by** | — |

## Problem

Dependabot PRs #31 (`jose` 5.10.0 → 6.2.12) and #29 (`@types/node`
22.19.9 → 26.6.1) both fail CI. Reproduced on current `main` in the Node 22
verification image, `npm run build` fails with one error per bump:

- `jose` 6: `src/services/auth.integration.test.ts` spreads
  `jose.decodeJwt(...)`, whose v6 return type is an unconstrained generic that
  TypeScript refuses to spread (TS2698).
- `@types/node` 26: `src/services/receiptParser.service.ts` passes a `Buffer`
  (now `Buffer<ArrayBufferLike>`) to `new Blob([...])`, which the newer lib
  types reject because the backing store could be a `SharedArrayBuffer`
  (TS2322).

The #29 failure hides a more important mismatch. The service runs on Node 22
everywhere: `engines`, both Dockerfile stages, and both CI jobs.
`@types/node` 26 describes Node 26's API. Adopting it would let code
typecheck against APIs that don't exist at runtime, so the type definitions
would stop protecting production.

## Decision

The user approved resolving both failing PRs on 2026-09-25.

- **`jose` 6.2.12:** adopt it. From the v6.0.0 release notes, the changes
  that touch this codebase:
  - `createRemoteJWKSet` now uses `fetch`. It's used for Google ID-token
    verification with no custom `agent` option, and Node 22 has `fetch`.
  - Key-type generics were removed, which is the source of the spread error.
  - ESM only; the project is already ESM.

  The service's own access/refresh tokens use HS256 with a `Uint8Array`
  secret, which is unaffected. Fix the one test typing. Behavior is covered
  by the existing session/auth tests and the PostgreSQL auth-lifecycle
  suites.
- **`@types/node`:** keep it on the runtime line. Update to the newest 22.x
  (22.20.4) instead of 26, and configure Dependabot to ignore `@types/node`
  semver-major updates, so the type definitions move with an intentional Node
  runtime upgrade instead of ahead of it. Close #29 unmerged, with this
  rationale.
- **The `Blob` typing** in the receipt parser needs no change: the TS2322 error
  appears only with the 26.x types, and the 22.x types accept the existing
  code (verified; see the Log).

## Options considered

| Option | Assessment |
|---|---|
| Merge #29 with a type cast | Rejected: silences the check and keeps types for a runtime that isn't deployed. |
| Upgrade the runtime to Node 26 | Out of scope: a platform change (images, CI, engines, production). |
| Keep types on 22.x and ignore majors in Dependabot | Chosen: the types match production, with no new suppression. |
| Merge #31 unchanged | Impossible: the build fails. The one test-typing fix is required. |

## Consequences

`jose` moves to its maintained major version. `@types/node` major versions now
follow deliberate runtime upgrades. When the service moves to a newer Node, that
work item must also move `@types/node`, and it can remove or adjust the
Dependabot ignore rule. No API contract, database, or deployment change.

## Definition of done

- [x] `jose` is on ^6.2.12 with the test typing fixed. A clean Node 22 `npm ci`
      and `npm run check` pass in the verification image.
- [x] `@types/node` is on the newest 22.x, and Dependabot ignores its
      semver-major updates.
- [x] The PostgreSQL integration suites, including auth/session lifecycle,
      pass.
- [x] The production image passes a fresh audit, and the OpenAPI contract is
      unchanged.
- [x] One PR replaces #29/#31. Both standalone PRs are closed unmerged, with
      the rationale.

## Log

- 2026-09-25 accepted — User asked to resolve the two failing Dependabot PRs
  after the passing ones (#27, #28, #30) were merged. Reproduced both failures
  on current `main` 6115754 in the verification image.
- 2026-09-25 building — Integration branch created from `main`; the jose v6
  release notes were reviewed against call sites.
- 2026-09-25 repository verification — `package.json`/`package-lock.json` were
  updated with `npm install --package-lock-only` in a `node:22-alpine`
  container, with `node_modules` masked, onto current `main` rather than
  merging the stale Dependabot branches, whose lockfiles predated #27/#28/#30.
  One test typing fix (`decodeJwt<jose.JWTPayload>`). The Dependabot
  `@types/node` semver-major ignore rule was added. In the `verification`
  image (clean `npm ci`, Node 22), `npm run check` passed with 0 failures, and
  `verify-openapi` was OK (114 paths, contract parity unchanged, so no
  baseline update). The receipt-parser `Blob` error doesn't occur with
  `@types/node` 22.20.4.
- 2026-09-25 PostgreSQL suites — the disposable `pgvector/pgvector:pg16`
  control database, per release-quality-gates: 21/21 passed, including the
  17-case WORK-0030 session/identity/account lifecycle suite that signs and
  verifies tokens with `jose` 6 and the RBAC stale-token suite. The container
  was stopped afterwards.
- 2026-09-25 production artifact — a fresh `npm audit --omit=dev
  --audit-level=high` of the built production image found 0 vulnerabilities.
  The embedded SBOM lists jose 6.2.12 (56 components). No deployment was
  requested or performed; the running d3 service is unchanged.
- 2026-09-25 shipped — PR #32 passed CI (verify, isolated PostgreSQL,
  production-image) and was merged as 348c3db. `main` CI passed on the merge.
  #31 and #29 were closed unmerged, with rationale comments, and their branches
  deleted. Deployment: none requested; the running d3 service still has the
  previous dependencies until its next image rebuild.
