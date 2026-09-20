---
id: 0045
title: "Remediate dependencies and establish release quality gates"
status: shipped
kind: infra
opened: 2026-09-14
decided: 2026-09-15
branch: infra/0045-dependency-release-gates
supersedes: ~
superseded-by: ~
---

# WORK-0045 — Remediate dependencies and establish release quality gates

| | |
|---|---|
| **Opened** | 2026-09-14 |
| **Status** | shipped |
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

At that original inspection, the package had build/dev/start/db-init scripts but
no test, lint, migration verification, security scan, dependency-update automation,
or CI workflow. A successful TypeScript build therefore provided no assurance for
authorization, financial state, concurrency, generated OpenAPI, or deployment upgrades.

## Decision

Accepted: remove unused production dependencies, upgrade remaining packages to
patched current versions with compatibility tests, and add a risk-based CI/release
pipeline. Gate the shipped authorization/RBAC and workflow/report policies,
reviewed database upgrades, upload boundaries, generated OpenAPI contract, and
production artifact/dependency graph. On 2026-09-15 the user approved moving full
authorization-matrix, exact-money/owner-scoped sync-race, and multi-worker job
idempotency coverage to WORK-0040, WORK-0034, and WORK-0041 respectively. Those
requirements remain mandatory acceptance criteria in their owning items, not
completed infrastructure tests or implicitly approved behavior changes.

### Refreshed baseline and implementation order (2026-09-15)

The user approved this item after WORK-0047. At acceptance, the lockfile production
audit reported four findings (one critical, one high, two moderate): the AWS XML
builder/parser chain, Sharp, and YAML. Hono and the Node adapter minimum versions
were already raised by the immediate blockers. Tests, convention/context/schema
checks, and basic CI existed; both opt-in RBAC/catalog database suites were
still skipped by CI. The host installation is root-owned and stale, so clean
container installs are the verification authority.

Follow-up inspection traced the remaining four development-only findings to
unused `drizzle-kit` and its legacy esbuild loader. No Kit config, script, skill,
or documented workflow uses it; remove this unused CLI as dependency remediation,
retaining `drizzle-orm`, typed schemas, and the accepted SQL/Drizzle data model.
Do not adopt or preselect a new migration framework for WORK-0043.

Implement in order: remove unused Sharp/types and patch remaining chains;
extend existing CI with security and isolated PostgreSQL bootstrap/upgrade
regressions; validate generated OpenAPI and check compatibility; verify the
production image and document update/exception/SBOM/rollback policy. Do not
implement WORK-0030, WORK-0034, WORK-0040, WORK-0041, or WORK-0043 implicitly.
Record missing financial/sync/job coverage honestly instead of accepting known
defects merely to obtain a passing gate.

## Options considered

| Option | Pros | Cons | Chosen? |
|---|---|---|---|
| Focused upgrades plus automated gates | Sustainable | Initial test investment | ✓ accepted |
| Run audit manually before release | Small | Easy to skip; no behavior coverage | ✗ |
| Blind major-version upgrades | Fast patching | High regression risk | ✗ |

## Consequences

**Positive:** dependency exposure and regression risk become visible before release.

**Negative / Trade-offs:** CI and integration databases add execution time and maintenance.

**Risks / Open questions:** the implemented policy gates production/development
high and critical findings, accepts no automated exceptions, and records lower
severity findings for triage. Node 22 (22.12+ for validation tools), PostgreSQL
16/pgvector, and an unsigned npm CycloneDX inventory are the current verification
targets. Severity response-time ownership and signed/OS-scanned artifacts remain
future decisions. Broader ERP coverage is explicitly owned by still-proposed
WORK-0034, WORK-0040, and WORK-0041 following the approved scope transfer below.

## Implemented scope and evidence (2026-09-15)

Dependency remediation removes unused `sharp`, `@types/sharp`, and `drizzle-kit`,
retaining `drizzle-orm` and the accepted data-access model. The lockfile resolves
Hono 4.13.7, the Node adapter 1.19.17, AWS clients 3.1132.0/XML builder 3.972.40,
YAML 2.9.1, and tsx 4.23.13/esbuild 0.28.1. Fresh audits of both the production
image and complete development graph report **zero vulnerabilities at every
severity**. No exception, forced major upgrade, or new migration framework was
introduced.

Repository gates now include convention lint/typecheck, context/schema/tooling
checks, regression tests, structural OpenAPI validation, and a conservative
reviewed-contract snapshot. The unchanged baseline contains 112 paths and 164
schemas and exactly matches the preceding and newly deployed API contracts.
External schema references cannot trigger network/file resolution. Known
undefined bearer schemes, base-prefix issues, runtime authorization completeness,
and client-schema truth remain WORK-0040, not silently remediated by this gate.

CI adds separate PostgreSQL and production-image jobs, fresh production and
development advisory audits, weekly scanning, and 30-day SBOM artifact retention.
Dependabot proposes weekly npm/Actions changes without auto-merge. The clean
Docker verification target passed `npm run check`: 42 default tests (39 passed,
three opt-in database suites skipped), four release-tooling tests passed,
TypeScript/conventions/context/35-table parity/tooling/OpenAPI checks passed.
The three database suites also **passed separately** against isolated PostgreSQL
16/pgvector databases: RBAC transactions, administrator catalog compatibility,
and bootstrap/reviewed existing-data upgrades. Upgrade tests prove actual helper
rollback, repeat application, legacy critical-flag repair, session preservation,
and repeatable catalog repair. Runner refusal of application/missing URLs and a
populated disposable control database was verified; zero suite databases remained
after cleanup. Both temporary test database containers were stopped and removed.

The S3 compatibility regression uses the real patched SDK against a local signed
HTTP fixture: storage bytes, HEAD/delete, XML `NoSuchKey` translation, and
presigned URLs. No live AWS account or production test fixtures were used.
The production SBOM was independently compared with the actual pruned image:
exactly 56 distinct installed dependency name/version pairs, no development
tooling or Sharp. It is not a signed attestation or an OS vulnerability scan.

### Deployment and operating evidence

Production Compose validation passed. Only `expense-api` was recreated with
`--no-deps`; no production SQL/catalog change, PostgreSQL recreation, or Caddy
reload occurred. Image identities:

- Prior: `sha256:5e3da02d8d2b6495d36b35c98a090686d2adbc456aa780e54f71f84706f2eb6f`.
- Deployed: `sha256:d0ab8f9c0e5342e364be007f44197c36b23072b512816711b722f2c2123d5b1c`.

The database container identity remained
`421b7056a7cabe11a853afd3a0d849c257e9c2d5cfe152e288025e25e4105df5`.
Container health passed; `/health` reported database, receipt parser, and Ollama
healthy. `verify:deployment` passed through the actual Caddy host: liveness 200,
registration 403, application cap 413, and streaming gateway cap 413. Live OpenAPI
contract parity passed. Read-only production verification retained 80 admin
grants, the affected admin role version of 2, ten total role assignments, one
active verified super-admin, and one WORK-0047 operator audit event.

GitHub job definitions/YAML and their local equivalent checks are verified;
remote execution, Dependabot activation, and required branch-protection settings
are not evidenced or changed here. The user authorized committing this scope;
remote publication and CI activation remain pending, with no push requested.
Deployment/smoke checks do not establish sustained operation or
overall ERP release readiness. WORK-0027 incident-response gates and WORK-0029
client/provider-assurance coordination remain unchanged.

Project-local context verification and diff whitespace checks pass. The shared
context-template validator still rejects the existing user-required README/ideas/
reviews taxonomy, as already recorded in `context/friction.md`; no shared
framework change was made.

### Approved acceptance-criteria transfer (2026-09-15)

The original checklist includes full route/role/resource authorization coverage,
exact money rounding, owner-scoped sync race coverage, and multi-worker job
idempotency. The user approved moving those requirements to their existing
owning work items so this dependency/release-infrastructure scope can close.

| Transferred requirement | Owning work item | Completion evidence required there |
|---|---|---|
| Full route/action/role/resource authorization matrix | [WORK-0040](0040-central-authorization-matrix-and-openapi-contract.md) | Reviewed allowed/denied role/scope coverage enforced by CI/release checks |
| Exact-money rounding and owner-scoped sync races | [WORK-0034](0034-expense-line-financial-integrity-and-idempotency.md) | Accepted monetary semantics and isolated concurrency/retry regressions enforced by CI/release checks |
| Multi-worker job idempotency | [WORK-0041](0041-idempotent-background-jobs-and-derived-data.md) | Overlap/retry/crash/backfill and output-deduplication regressions enforced by CI/release checks |

Each owning item records the transfer, links back here, and retains its unmet
requirements as unchecked Definition-of-done entries. All three remain
`proposed`: this approval changes coverage ownership, not their business design,
implementation authority, or shipped status. No known behavior bug was accepted
into a green test. The current gates still do not establish full ERP release
readiness; incident-response/client coordination gates remain open separately.

## Definition of done

- [x] Unused Sharp is removed or upgraded; Hono/node-server/AWS XML/YAML chains are patched.
- [x] Audit has no unaccepted production critical/high findings.
- [x] Test and lint/typecheck scripts are configured in CI on every change; remote execution awaits push.
- [x] Shipped workflow/report policy, account/RBAC/catalog, and anonymous route-family regressions are configured release gates.
- [x] PostgreSQL empty/upgrade migration tests are configured release gates for reviewed WORK-0029/0047 upgrades.
- [x] Shipped upload traversal/symlink, stream/declared-size, and signature-content tests are configured release gates.
- [x] Generated OpenAPI is structurally validated and conservatively rejects all unreviewed contract changes.
- [x] Dependency update, advisory exception, SBOM, and rollback policy are documented.
- [x] User-approved full authorization/money/sync/job coverage transfer is recorded with bidirectional links and unchecked CI/release criteria in WORK-0040/0034/0041.

## References

- [Repeatable release-quality procedure](../reference/release-quality-gates.md)
- [OpenAPI baseline review](../../contracts/README.md)
- [WORK-0034 — exact money and sync](0034-expense-line-financial-integrity-and-idempotency.md)
- [WORK-0040 — authorization and OpenAPI](0040-central-authorization-matrix-and-openapi-contract.md)
- [WORK-0041 — scheduled jobs](0041-idempotent-background-jobs-and-derived-data.md)
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
- 2026-09-15 accepted — user approved dependency remediation and expanded release
  gates as the next work item; refreshed baseline and ordered scope above.
- 2026-09-15 building — implementing on `infra/0045-dependency-release-gates`,
  using clean containers rather than the stale root-owned host installation.
- 2026-09-15 dependency verified — production and complete development audits
  both report zero findings. Real SDK/tsx-loader compatibility, default tests,
  four release-tooling tests, and all three opt-in PostgreSQL suites passed.
- 2026-09-15 artifact verified — corrected npm 10 post-prune SBOM metadata handling;
  exact 56-component inventory parity and fresh production-image audit passed.
- 2026-09-15 deployed — API-only dependency image rollout passed health, Caddy
  smoke limits/registration closure, and unchanged live OpenAPI parity; production
  PostgreSQL identity, catalog, assignments, and previous operator audit preserved.
- 2026-09-15 acceptance pending — dependency/CI/artifact core implemented and
  deployed; full authorization matrix and money/sync/job gates remain unchecked
  pending an explicit scope decision. Do not mark this item shipped yet.
- 2026-09-15 final verified — repository gates passed again after documentation
  updates. Docker's cached test-image export failed with a missing parent snapshot;
  a non-destructive `--no-cache` rebuild passed and exported successfully. No
  shared Docker pruning or production restart was used for recovery. Local context
  and diff checks passed; the known shared-validator taxonomy mismatch persists.
- 2026-09-15 scope amended — user approved moving the remaining full matrix,
  exact-money/owner-scoped sync-race, and multi-worker idempotency acceptance gates
  to WORK-0040, WORK-0034, and WORK-0041. Updated the infrastructure checklist and
  preserved those unchecked mandatory release criteria in the proposed owners.
- 2026-09-15 closure verified — `npm run check` passed in the clean verification
  image with current context mounted read-only: 39 default tests passed, three
  previously verified database suites skipped, four release-tooling tests passed,
  and OpenAPI/TypeScript/conventions/context/schema/tooling checks passed. Fresh
  production and complete development audits each reported zero vulnerabilities;
  gateway liveness/registration/application/streaming-limit smoke checks passed.
  Scope-transfer checks verified the complete revised checklist, valid local
  references, bidirectional owner links, and unchanged proposed owner statuses.
  No redeployment, production write, or new database fixture was needed.
- 2026-09-15 shipped — dependency remediation and release-quality infrastructure
  implemented, verified, and deployed; user-approved full matrix/money/sync/job
  requirements retained as unchecked mandatory CI criteria in WORK-0040/0034/0041.
  Changes remain uncommitted/unpushed; remote CI activation, incident actions,
  client coordination, and sustained operating status are not asserted.
- 2026-09-15 commit authorized — user requested committing all current expense-api
  changes before moving to the next item. The verified dependency/quality-gate
  implementation and approved coverage transfers are included together; remote
  publication/CI execution remain pending because no push was requested.

---

> **For AI agents:** This infrastructure item is shipped under the approved scope
> transfer above. WORK-0034/0040/0041 remain proposed; neither this closure nor the
> passing infrastructure gates authorize their implementation, prove full ERP
> release readiness, or authorize credential rotation.
