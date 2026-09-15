---
id: 0045
title: "Remediate dependencies and establish release quality gates"
status: proposed
kind: infra
opened: 2026-09-14
decided: ~
branch: ~
supersedes: ~
superseded-by: ~
---

# WORK-0045 — Remediate dependencies and establish release quality gates

| | |
|---|---|
| **Opened** | 2026-09-14 |
| **Status** | proposed |
| **Kind** | infra |
| **Supersedes** | — |
| **Superseded by** | — |

## Problem

On 2026-09-14, `npm audit --omit=dev` reported six vulnerable production
packages (one critical, three high, two moderate). Installed versions included
Hono 4.11.8, `@hono/node-server` 1.19.9, Sharp 0.33.5,
`fast-xml-parser` 5.3.4, and YAML 2.8.2. Hono, the Node adapter, Sharp, and the AWS
XML dependency chain have applicable advisories. Static-serving advisories may
not be reachable because this app does not use `serveStatic`, but upgrades are
still required. Sharp appears unused in `src`, so removal is preferable if
confirmed.

The package has build/dev/start/db-init scripts but no test, lint, migration
verification, security scan, dependency-update automation, or CI workflow. A
successful TypeScript build therefore provides no assurance for authorization,
financial state, concurrency, generated OpenAPI, or deployment upgrades.

## Decision

Proposed: remove unused production dependencies, upgrade remaining packages to
patched current versions with compatibility tests, and add a risk-based CI/release
pipeline. Treat authorization matrix, state transitions, database migrations,
upload adversarial cases, exact money, and job idempotency as release gates.

## Options considered

| Option | Pros | Cons | Chosen? |
|---|---|---|---|
| Focused upgrades plus automated gates | Sustainable | Initial test investment | ✓ proposed |
| Run audit manually before release | Small | Easy to skip; no behavior coverage | ✗ |
| Blind major-version upgrades | Fast patching | High regression risk | ✗ |

## Consequences

**Positive:** dependency exposure and regression risk become visible before release.

**Negative / Trade-offs:** CI and integration databases add execution time and maintenance.

**Risks / Open questions:** define severity SLA/exceptions, supported Node/Postgres
versions, and whether deployment artifacts require SBOM/signing.

## Definition of done

- [ ] Unused Sharp is removed or upgraded; Hono/node-server/AWS XML/YAML chains are patched.
- [ ] Audit has no unaccepted production critical/high findings.
- [ ] Test and lint/typecheck scripts run in CI on every change.
- [ ] Authorization matrix and workflow/report transition tests are release gates.
- [ ] PostgreSQL empty/upgrade migration tests are release gates.
- [ ] Upload traversal/size/content, money rounding, sync race, and job idempotency tests exist.
- [ ] Generated OpenAPI is validated and checked for breaking changes.
- [ ] Dependency update, advisory exception, SBOM, and rollback policy are documented.

## References

- Hono CORS advisory: <https://github.com/advisories/GHSA-88fw-hqm2-52qc>
- Hono Node server advisories: <https://github.com/advisories/GHSA-wc8c-qw6v-h7f6>,
  <https://github.com/advisories/GHSA-92pp-h63x-v22m>, and
  <https://github.com/advisories/GHSA-frvp-7c67-39w9>
- Fast XML Parser advisories include
  <https://github.com/advisories/GHSA-m7jm-9gc2-mpf2> and
  <https://github.com/advisories/GHSA-gh4j-gqv2-49f6>
- Sharp advisories: <https://github.com/advisories/GHSA-f88m-g3jw-g9cj>
  and <https://github.com/advisories/GHSA-rgj7-g3m4-5g8c>
- YAML advisory: <https://github.com/advisories/GHSA-48c2-rrv3-qjmp>

## Log

- 2026-09-14 proposed — dependency tree/audit and quality-gate gap recorded.

---

> **For AI agents:** Do NOT implement while this item is `proposed`.
