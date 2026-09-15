---
title: Expense API dependency and release quality gates
updated: 2026-09-15
---

# Dependency and release quality gates

WORK-0045 established this procedure. Item-specific results and acceptance
criteria belong in their owning work-item logs, not this reusable reference.

## Verification authority

Use Node 22 (22.12+ for the OpenAPI validation tooling), `npm ci`, and the reviewed
lockfile. Do not test a dependency update against a stale/root-owned host
installation. The Docker `verification` target provides a clean install and the
same `npm run check` as CI:

```bash
docker build --target verification -t expense-api-verification .
```

For lockfile-only updates in a bind-mounted workspace, also isolate/mask
`node_modules`: npm may write its hidden lockfile even with `--package-lock-only`.
Never repair this by recursively changing ownership of unrelated host files.

`check` includes repository convention lint, TypeScript compilation, context and
35-table SQL/Drizzle coverage, migration-helper checks, database-free regression
tests, release-tooling tests, and generated OpenAPI validation/contract parity.
Convention lint is deliberately small; it is not a claim of comprehensive
ESLint/static security analysis. Database suites are separate required CI checks,
not evidence inferred from the default suite's skipped tests.

## Disposable PostgreSQL regression target

`npm run test:postgres` requires an explicitly supplied `TEST_DATABASE_URL` whose
database is exactly `expense_test_control`, and refuses it if public tables
exist. Never derive this URL from the application's `DATABASE_URL` or Compose
production environment. The control database must be disposable PostgreSQL 16
with pgvector and a test-only role permitted to create databases.

The runner creates a unique database per suite and drops only those names in its
own `finally` blocks. The original control database is never dropped. Each suite
also independently refuses populated databases. Required suites cover RBAC
transactions, the administrator catalog, and bootstrap/existing-data upgrades.
The upgrade suite uses the actual `db:apply-change` helper and reviewed WORK-0029
SQL, including failure rollback and repeated application, then the WORK-0047
operator migration. It does not introduce WORK-0043's migration framework.

For local verification without publishing a test database port:

```bash
docker run --rm -d --name expense-api-quality-test-postgres \
  -e POSTGRES_USER=expense_test -e POSTGRES_PASSWORD=expense_test \
  -e POSTGRES_DB=expense_test_control pgvector/pgvector:pg16
docker exec expense-api-quality-test-postgres \
  pg_isready -U expense_test -d expense_test_control
docker run --rm --network container:expense-api-quality-test-postgres \
  -e TEST_DATABASE_URL=postgresql://expense_test:expense_test@127.0.0.1:5432/expense_test_control \
  expense-api-verification npm run test:postgres
docker stop expense-api-quality-test-postgres
```

Wait for readiness before running the suite. Stop the named `--rm` container even
if tests fail; this removes only disposable fixtures. No production schema or
catalog migration is authorized by invoking this test procedure.

## Dependency updates and advisory exceptions

Keep related AWS packages on a reviewed compatible version family. Remove
confirmed unused libraries; do not apply `npm audit fix --force` or blindly
upgrade all major versions. Review lockfile changes, engine requirements,
release/advisory notes, and observable storage/auth/schema behavior. Dependabot
is configured for weekly npm and Actions proposals; it does not auto-merge them.
CI also runs weekly so new advisories are detected without a source change.

`npm run verify:security` fails on production high/critical findings and registry
errors. CI also audits the complete development graph at the high threshold.
Moderate/low findings remain visible and require triage; a green gate is
not a risk acceptance or a guarantee of exploitability/non-exploitability.
Development-tool findings must be tracked with exposure/mitigation and their
own remediation decision; do not put development servers on public interfaces.

No production advisory exceptions are currently automated. Any exception needs
explicit user approval, an advisory ID, affected versions, reachability evidence,
owner, compensating controls, expiry, and a linked work item. The gate must not
be bypassed with `|| true`, disabled audits, or lowered severity. Adding a scoped,
expiring exception mechanism itself requires a reviewed change; a note alone
cannot suppress CI.

## OpenAPI contract review

The generated document is validated by Swagger Parser, with external network/
file references forbidden, and compared with `contracts/openapi.json`.
The snapshot gate is conservative: all contract changes, including additive
ones, require review and explicit baseline regeneration. It catches removals,
type/required-field changes, security changes, and server changes, but does not
classify semantic compatibility automatically. See `contracts/README.md`.

Structural validation does not prove runtime authorization, security-scheme
reference completeness, URL usability, or response-schema truth. WORK-0040 owns
the known undefined bearer-scheme/base-prefix defects and full role/resource
matrix. Do not present an unchanged snapshot as remediation of those defects.

## Production artifact, SBOM, and rollout

The production build prunes development dependencies, audits the production
graph, and embeds `/app/sbom.cdx.json` generated from the actual installed
dependencies using npm's CycloneDX output. Remove development declarations from
the production-only package metadata after pruning, then generate the inventory:
npm 10 otherwise reports missing development packages, while a pre-prune SBOM
can omit dependencies promoted by pruning. The source manifest is unchanged by
this packaging step. Verify exact inventory parity against the final image;
CI retains that SBOM for 30 days.
It is an npm dependency inventory, not an OS image vulnerability scan, signed
attestation, or verified SLSA provenance. The lockfile accompanies the image so
its graph can be independently audited.

Docker can cache an audit layer. Always run a fresh audit of the resulting image
before rollout, even if its build-time audit passed:

```bash
docker compose -f compose.prod.yaml config --quiet
docker compose -f compose.prod.yaml build expense-api
docker run --rm expense-api-expense-api npm audit --omit=dev --audit-level=high
docker compose -f compose.prod.yaml up -d --no-deps expense-api
```

Record the prior/new image identities and verify health, OpenAPI contract,
registration closure, and application/gateway body limits. Do not recreate
PostgreSQL or reload Caddy for a dependency-only change. Keep incident credential
rotation, log review, and client coordination gates distinct from deployment.

Rollback is image-only for this work; it has no production DDL/data migration.
Use a reviewed immutable prior image through an explicit Compose override, then
repeat health/smoke checks. Reverting to a vulnerable prior image requires an
explicit incident/risk decision; never restore toxic role grants or undo the
earlier control migrations as part of a dependency rollback.

## Coverage still owned by proposed fixes

The current gates cover shipped upload boundaries, report lifecycle/accounting
separation, workflow target/progression policies, account/role-version controls,
SoD/last-admin/step-up transactions, catalog repair, and reviewed upgrades.
They are not full ERP release assurance. Exact money/owner-scoped sync races
(WORK-0034), every route/role/resource authorization combination (WORK-0040),
multi-worker job idempotency (WORK-0041), and full historical migration upgrades
(WORK-0043) need their respective accepted behavior and regression coverage.
The user approved transferring the full matrix/money/sync/job coverage requirements
from WORK-0045 to WORK-0040/0034/0041 on 2026-09-15. Their unchecked acceptance
criteria require mandatory CI/release regressions when those items are accepted
and implemented. Closing the infrastructure scope is not proof that those tests
exist or that their behavior designs are approved. Historical migration coverage
remains WORK-0043; do not silently revive or implement any of these proposals.

## Primary tooling references

- [npm audit failure thresholds](https://docs.npmjs.com/cli/v10/commands/npm-audit/)
- [npm CycloneDX/SPDX SBOM generation](https://docs.npmjs.com/cli/v10/commands/npm-sbom/)
- [PostgreSQL service containers in GitHub Actions](https://docs.github.com/en/actions/tutorials/use-containerized-services/create-postgresql-service-containers)
- [Swagger Parser validation API](https://apidevtools.com/swagger-parser/swagger-parser.html)
