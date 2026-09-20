---
id: 0029
title: "Make RBAC, separation of duties, and step-up controls authoritative"
status: shipped
kind: fix
opened: 2026-09-14
decided: 2026-09-15
branch: fix/0029-atomic-rbac-controls
supersedes: ~
superseded-by: ~
---

# WORK-0029 — Make RBAC, separation of duties, and step-up controls authoritative

| | |
|---|---|
| **Opened** | 2026-09-14 |
| **Status** | shipped |
| **Kind** | fix |
| **Severity** | P1 security/control integrity |
| **Supersedes** | — |
| **Superseded by** | — |

## Problem

Role assignment/removal and `roles_version` invalidation are separate database
operations in both permission and user services. `deleteRole` relies on cascade
but does not increment affected users' versions. A crash can therefore revoke a
role while an old privileged JWT remains valid. Editing/deleting a permission
that is already assigned has the same invalidation requirement and is not
consistently tied to affected users.

SoD is also non-authoritative: role create/update routes do not call
`validateRolePermissionChange`; replacement validation unions old and new
permissions; role-set validation unions current and replacement roles; checks
run outside the mutation transaction. `permissions.requires_mfa` is stored but
never enforced, and nothing prevents removal of the final control-plane admin
(`src/services/permission.service.ts:481-558,704-880`).

## Decision

Accepted: route every role/permission administration mutation through one policy service and one
transaction. Lock affected users/roles, simulate the final effective permission
set, evaluate SoD, mutate assignments, and invalidate tokens atomically. Enforce
a last-admin invariant and step-up authentication for flagged permissions.

## Options considered

| Option | Pros | Cons | Chosen? |
|---|---|---|---|
| Transactional final-state policy evaluation | Correct for add/set/edit/delete | More locking and tests | ✓ |
| Keep preflight validators | Easy | Race-prone and semantically wrong for replacement | ✗ |
| Periodic SoD audit only | Detects drift | Does not prevent toxic access | supplemental |

## Consequences

**Positive:** token claims, role state, SoD, and administrator survivability agree.

**Negative / Trade-offs:** mutations may serialize on high-risk roles/users;
step-up requires an authentication ceremony and timestamped server-side evidence.

**Control decisions:** a successful password reauthentication grants the current
refresh-token session five minutes of server-side step-up assurance by default
(`STEP_UP_TTL_SECONDS`, maximum one hour). This is **password reauthentication,
not second-factor MFA**, despite the legacy `requires_mfa` column name. OAuth-only
sessions fail closed until an accepted external-identity step-up ceremony exists.
The system `super_admin` role is the sole preventive-SoD exemption because its
intentional catch-all grant necessarily contains every configured toxic pair;
assigning or removing it requires stepped-up `role.assign.admin` authority and
an audit event. There is no API bypass for the last-admin rule; recovery is an
audited operator procedure. The protected control-plane invariant is at least
one active, verified user with the active system `super_admin` role. RBAC audit
events are written in the same transaction as their mutation; the broader
ledger redesign remains WORK-0042. True MFA enrollment and external-provider
assurance need a separate accepted design; this item does not claim to implement
either. Account creation/default-role/first-session atomicity and the general
session lifecycle remain WORK-0030.

## Definition of done

- [x] Role and permission assign/add/remove/set/delete/edit operations are atomic
      with invalidation of every affected user's tokens.
- [x] SoD evaluates the exact post-mutation effective permission set.
- [x] Updating a role validates every assigned user's final permissions.
- [x] The final active super-admin/control-plane principal cannot be removed.
- [x] `requires_mfa` is enforced using recent session-bound password step-up
      evidence, not token metadata; second-factor MFA is explicitly out of scope.
- [x] Concurrency tests prove new token validation rejects stale privilege claims
      after a committed change, and waiting RBAC commands recheck actor versions.
- [x] Every RBAC mutation is included in its audit transaction; full audit-ledger
      redesign remains `WORK-0042`.

## Implementation and verification

The authoritative boundary is `src/services/rbac.service.ts`; routes under both
`/v1/roles` and `/v1/users` use it. Pure final-state, assurance-freshness, token-
version, and last-admin rules live in `src/policies/rbac.ts`.

RBAC changes take one transaction-scoped PostgreSQL advisory lock before actor,
role, permission, and affected-user locks. This deliberately serializes uncommon
administrative writes so concurrent changes cannot each approve an incompatible
final state. The actor's current account, effective permissions, token version,
and protected-permission assurance are checked inside that boundary, not just in
middleware. Permission changes and role deletions capture affected users before
cascading grant removal, then invalidate all of them in the same transaction.
Role edits check the role and every assigned user's combined final active grants.
Inactive grants can be cleaned up but cannot be newly assigned. System roles are
immutable through these APIs; core control-plane permissions cannot be deleted.

Account deactivation, generic `isActive: false` edits, and account deletion share
the RBAC lock and last-admin guard. Privilege-bearing access tokens must carry a
positive integer `roles_version`. Pure identity-only legacy tokens retain the
existing limited compatibility path; a full legacy cutover is WORK-0030.

`POST /v1/auth/step-up` requires a session-bound bearer access token and strict
`{"password":"<current-password>"}` input. Password verification, assurance
timestamp, and its audit event commit together. Permission middleware checks
current database flags and active-session assurance; RBAC mutation services
repeat that check in their transaction. Expired, revoked, cross-user, missing,
or future evidence fails closed. Critical permissions cannot have
`requires_mfa = false`, enforced by service validation and a matching SQL/Drizzle
check constraint. Rotating a refresh token does not transfer assurance.

Focused policy and route/schema tests run in `npm run check`. The opt-in
`src/services/rbac.integration.test.ts` refuses a populated database, bootstraps
an empty disposable PostgreSQL instance, and verifies password reauthentication,
stale token and stale actor rejection, concurrent toxic role assignments, exact
replacement semantics, role-edit combined permissions, inactive-grant cleanup,
expired assurance, concurrent final-admin removal, final-admin deactivation,
assigned-permission invalidation, and mutation rollback on audit insertion
failure. It is intentionally skipped in the default database-free test run and
was run separately against disposable PostgreSQL 16 with pgvector.

The existing-database change is `src/db/changes/0029-rbac-step-up.sql`, applied
with `npm run db:apply-change` and transaction/`ON_ERROR_STOP`, never by replaying
bootstrap DDL. Preflight found 14 critical flags requiring normalization; the
change added nullable session evidence, made the flag non-null, normalized those
critical flags, and added the guarded check constraint.

## Remaining release and coordination gates

- Frontend/MCP clients need a reauthentication flow for `403 STEP_UP_REQUIRED`.
  Call step-up with the same access token, then retry before `expiresAt`; after
  token invalidation, refresh/sign in and establish assurance on the new session.
  No other project's client code was changed or its UX validated in this item.
- OAuth-only protected actions deliberately fail closed. True second-factor MFA
  and accepted external-provider step-up remain design work, not implemented
  features.
- At this item's deployment, the seeded `admin` role contained three configured
  toxic permission pairs and was not exempt; assignments failed closed. This
  catalog gate was resolved by [WORK-0047](0047-align-seeded-administrator-role-with-sod.md)
  on 2026-09-15 with a compliant allowlist and audited transactional migration.
- WORK-0027's public-exposure log review and production credential rotation
  remain mandatory incident-response gates. No credentials were rotated here.
- The four dependency findings present at this deployment were remediated by
  [WORK-0045](0045-remediate-dependencies-and-establish-release-quality-gates.md)
  on 2026-09-15: fresh production/development audits report zero vulnerabilities
  and the dependency-only API image is deployed. WORK-0045's infrastructure scope
  is shipped following the approved coverage transfer to still-proposed
  WORK-0034/0040/0041; incident and client gates above are not closed by that rollout.
- Health/smoke evidence establishes a running deployment, not sustained
  production operation or release readiness. In-flight non-RBAC requests that
  already passed authorization are not cancelled by a role change.

## Log

- 2026-09-14 proposed — confirmed during RBAC and SoD audit.
- 2026-09-15 accepted — authorized as the next security/control-integrity item.
- 2026-09-15 building — implementing serialized final-state policy evaluation,
  session-bound step-up assurance, last-admin protection, atomic invalidation,
  and transactional RBAC audit coverage.
- 2026-09-15 verified — `npm run check` passed: conventions, context, 35-table
  SQL/Drizzle parity, tooling, TypeScript build, and 35 tests; the one opt-in
  database integration test was skipped there and passed separately against an
  empty disposable PostgreSQL 16/pgvector database. `git diff --check` passed.
- 2026-09-15 schema applied — additive WORK-0029 SQL committed against
  `expense-api-postgres-1` / `expense_db`; verified session evidence column,
  validated critical-permission constraint, and zero unprotected critical flags.
  The initial production Compose deployment recreated the database dependency
  from the previous development configuration while retaining its named data
  volume; the database is healthy and no longer publishes the dev-only 5433 port.
  Subsequent API-only redeployments use `--no-deps`.
- 2026-09-15 deployed — built and replaced only `expense-api` using production
  Compose with `--no-deps`; final image is
  `sha256:9946b835aaa175c534cdceedadc60f301440687bf1849d5d6ddbc506145042d0`.
  API and PostgreSQL health checks passed; `/health` reports database, receipt
  parser, and Ollama healthy. The deployed OpenAPI contains the strict step-up
  contract and anonymous step-up requests return 401.
- 2026-09-15 smoke verified — `npm run verify:deployment` passed with the local
  Caddy gateway host: liveness 200, public registration 403, application cap
  413, and gateway cap 413. Project context verification passed. The shared
  context-template verifier still rejects this project's existing user-required
  ideas/reviews/README taxonomy; that known mismatch is recorded in
  `context/friction.md`, and no shared framework files were changed here.
- 2026-09-15 follow-up captured — live role-policy inspection confirmed three
  SoD conflicts in seeded `admin`; recorded WORK-0047 as proposed, without
  changing its grants. IDEA-0009 captures true MFA and OAuth assurance shaping.
- 2026-09-15 shipped — atomic RBAC policy controls, token invalidation,
  session-bound password step-up, and final-admin protection implemented,
  database-tested, schema-applied, deployed, and smoke-verified. Client
  coordination, incident actions, and dependency release gates remain open;
  changes are not committed yet.
- 2026-09-15 follow-up — WORK-0045 resolved the previously recorded dependency
  findings with a verified API-only rollout; remaining release gates updated.
- 2026-09-15 scope follow-up — WORK-0045 shipped its infrastructure scope after
  user-approved transfer of full matrix/money/sync/job coverage to proposed owners;
  this does not close the incident-response or client/provider-assurance gates.

---

> **For AI agents:** This item is shipped on `fix/0029-atomic-rbac-controls`.
> Do not interpret the remaining gates or follow-up proposals as implementation
> authorization. Password reauthentication is not true second-factor MFA.
