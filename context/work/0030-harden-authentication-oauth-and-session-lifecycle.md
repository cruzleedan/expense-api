---
id: 0030
title: "Harden authentication, OAuth identity, and session lifecycle"
status: building
kind: fix
opened: 2026-09-14
decided: 2026-09-15
branch: fix/0030-auth-session-lifecycle
supersedes: 0003
superseded-by: ~
---

# WORK-0030 — Harden authentication, OAuth identity, and session lifecycle

| | |
|---|---|
| **Opened** | 2026-09-14 |
| **Status** | building |
| **Kind** | fix |
| **Supersedes** | WORK-0003 (lifecycle; two-token transports retained) |
| **Superseded by** | — |

## Problem

The original 2026-09-14 review found that the accepted token design in WORK-0003
needed corrective evolution. The refreshed baseline below distinguishes controls
already shipped since that inspection from the remaining work:

- access tokens without `roles_version` skip database checks for user existence,
  activity, and role invalidation;
- refresh verification, revocation, and replacement are separate operations, so
  concurrent refreshes can both succeed; no token family/reuse containment exists;
- concurrent-session enforcement is query/revoke/create rather than atomic;
- registration/OAuth user creation, default role assignment, and token creation
  can partially complete;
- OAuth auto-links an existing account by email without local reauthentication,
  Google flows do not consistently require verified email, and `(provider, id)`
  is a non-unique single slot on `users`;
- auth routes do not pass supported IP/user-agent metadata; refresh cookie age is
  hardcoded to seven days instead of using configured token expiry;
- public and administrator password rules disagree (12-character complexity vs
  8 characters);
- delete-account authenticates through normal login (creating a session), catches
  every delete error as “has reports,” and calls an incomplete anonymization that
  retains identifiers and credentials while claiming personal data was removed.

## Decision

Accepted: require versioned tokens and current-user validation, implement atomic
one-time refresh rotation with token families, normalize account creation and
session limits into transactions, and move external identities into a unique
`user_identities(provider, subject)` table. Account linking must require verified
provider identity plus explicit proof for an existing local account.

On 2026-09-15 the user explicitly approved PostgreSQL-backed token families as
the corrective successor to WORK-0003 and temporary closure of self-service
account deletion until retention is agreed. Preserve `jose`, bearer access,
HttpOnly web refresh cookies, mobile body refresh, closed registration, RBAC,
last-admin, and session-bound password step-up. No Passport/Redis adoption or
credential rotation is authorized. The retention decision is tracked separately
in WORK-0048 and remains proposed.

### Historical pre-approval baseline and preflight (2026-09-15)

The user requested committing all WORK-0045 changes and then moving to the next
work item. WORK-0045 was committed as `21b7557d2f87994320b3122af667861828c54cad`,
without a remote push. WORK-0030 is the next recommended security priority;
preflight is on `fix/0030-auth-session-lifecycle`. This item remains `proposed`
pending the accepted-design/retention decisions below; no authentication behavior
or production data has been changed for this item.

Already shipped, not work to repeat:

- WORK-0028 closed public registration and new-user OAuth provisioning. The
  inactive/unverified internal registration helper is still non-atomic, as is
  administrator user creation/default-role assignment.
- WORK-0029 validates current account existence/activity/verification for every
  access-token format and requires a positive role version for privilege-bearing
  tokens. Pure identity-only legacy compatibility remains; the original blanket
  account-check bypass is no longer present.
- WORK-0029's password reauthentication binds step-up to the current refresh
  session, with last-admin and atomic RBAC controls. Preserve these controls;
  rotation must not copy step-up assurance to a new token/session.
- WORK-0045 provides clean-container verification, actual PostgreSQL regression
  suites, conservative OpenAPI parity, and production/development advisory gates.

Remaining evidence in current code:

- `auth.service.ts` verifies a refresh row, updates usage, revokes it, loads the
  user, and mints replacement tokens using separate queries. Competing requests
  can both pass verification; failure can also leave a partially rotated session.
- Session-cap enforcement selects/revokes active rows before a separate token
  insert. It is not serialized with concurrent logins/refreshes, and no token
  family or replay-containment identifier exists.
- Existing-account OAuth login still links by matching email and overwrites the
  single provider/subject slot without explicit local-account proof. New-account
  provisioning is blocked, but this existing-account linking risk remains.
- Auth routes omit supported IP/user-agent arguments. The cookie helper still
  uses a fixed seven-day age, irrespective of `JWT_REFRESH_EXPIRES_IN`.
- `/auth/delete-account` calls normal login, creating/possibly evicting sessions
  before deletion. Its catch-all treats last-admin, database, and other errors
  as report-retention conflicts and returns an unsupported personal-data-removal
  claim while credentials/identifiers remain.

Proposed ordered implementation after the decisions are approved:

1. Correct the WORK-0003 lifecycle decision while preserving `jose`, bearer access
   tokens, HttpOnly web refresh cookies, and the existing mobile body transport.
   Use the existing PostgreSQL token ledger, not Passport/Redis from WORK-0006.
2. Implement and test atomic refresh-token families/reuse containment, deterministic
   five-session eviction, current-account/version validation, and issuance
   rollback. Lock order must remain compatible with WORK-0029 administrative writes.
3. Migrate external identities with uniqueness/collision preflight, remove implicit
   email linking, and enforce verified provider identity plus explicit existing-
   account proof. Do not reopen registration or auto-provision users.
4. Unify password-creation/reset policy, account/default-role transactions,
   metadata/cookie expiry, and isolated concurrent refresh/OAuth/disabled-user tests.
   Do not trust arbitrary forwarding headers; proxy-trust work remains WORK-0031.
5. Complete account deletion only under an agreed retention/pseudonymization
   decision; otherwise fail closed without destructive deletion or false erasure
   claims and explicitly transfer that unfinished criterion with user approval.

Decisions to resolve before implementation:

- WORK-0003 is still accepted and claims no server-side session store. Approve
  its corrective lifecycle evolution to PostgreSQL-backed refresh-token families,
  retaining the two-token transports, rather than silently contradicting it.
- Agree which identity/credential/audit/financial data may be erased or retained.
  Recommended interim scope: disable self-service account deletion and keep the
  retention/pseudonymization implementation pending a separate approved decision.
  This would amend the current deletion Definition-of-done criterion; it is not
  implicitly accepted by selecting the next work item.

## Related records

- [WORK-0003 — token transport and existing lifecycle decision](0003-jwt-bearer-plus-httponly-cookie.md)
- [WORK-0028 — closed bootstrap and administrator provisioning](0028-lock-down-account-bootstrap-and-user-administration.md)
- [WORK-0029 — role versions, step-up, and last-admin invariants](0029-atomic-rbac-sod-and-step-up-controls.md)
- [WORK-0031 — trusted proxy/request boundary](0031-production-request-boundary-and-rate-limiting.md)
- [WORK-0045 — committed release-quality infrastructure](0045-remediate-dependencies-and-establish-release-quality-gates.md)
- [Repeatable verification and disposable PostgreSQL procedure](../reference/release-quality-gates.md)
- [Session behavior, migration and client contract](../reference/auth-session-lifecycle.md)
- [WORK-0048 — proposed retention-policy decision](0048-account-retention-and-pseudonymization-policy.md)
- [WORK-0049 — proposed frontend compatibility/cutover gate](0049-coordinate-expense-tracker-auth-session-cutover.md)
- [WORK-0050 — proposed MCP compatibility/cutover gate](0050-coordinate-expense-mcp-auth-session-cutover.md)

## Options considered

| Option | Pros | Cons | Chosen? |
|---|---|---|---|
| Correct current JWT/cookie design | Fits current stack and retained WORK-0003 transports | Requires migration and client coordination | ✓ accepted |
| Adopt Passport/session stack from WORK-0006 | Large ecosystem | Previously rejected; unnecessary | ✗ |
| Accept refresh races until expiry | No work | Replay and session-limit controls remain false assurances | ✗ |

## Consequences

**Positive:** predictable revocation, safe identity linking, accurate session data.

**Negative / Trade-offs:** existing legacy tokens must be expired through a
controlled cutover; clients may need refresh-error recovery.

**Risks / Open questions:** client refresh/cutover coordination (WORK-0049 and
WORK-0050), real-provider smoke tests and earlier incident gates remain separate. Google
email verification is enforced; Facebook email is never ownership proof.
Cookie/body transport is retained; legal retention is deferred to WORK-0048.

## Definition of done

- [ ] Legacy access tokens are rejected after a documented production cutover
      (implemented/tested locally; live migration and restart held for WORK-0049
      and WORK-0050).
- [x] Refresh is atomic and replay revokes the relevant token family.
- [x] Session cap is enforced atomically and has deterministic eviction semantics.
- [x] OAuth subject identity is unique per provider and multiple identities can link.
- [x] Provider email verification and explicit existing-account linking are enforced.
- [x] Account creation, default role, and first session cannot partially commit.
- [x] IP/user-agent and cookie expiry match trusted request/config data.
- [x] One password policy is reused by every password-creation/reset path.
- [x] Self-service deletion fails closed without login/session/deletion/anonymization
      side effects or false erasure claims; retention/pseudonymization remains WORK-0048.
- [x] Concurrent refresh, OAuth collision, disabled-user, and deletion tests exist.

Checked boxes above describe verified implementation, not production behavior.
Google requires verified email. Facebook email is deliberately excluded from all
ownership decisions: app-bound subject possession plus current local password
authorizes linking. OAuth-only linking/recovery is unavailable without an approved
alternative proof ceremony. See the session reference for the explicit policy.

## Log

- 2026-09-14 proposed — corrective successor drafted during architecture audit.
- 2026-09-15 preflight — selected as next security priority after the WORK-0045
  commit; refreshed already-shipped controls and remaining race/linking/deletion
  evidence. Proposed ordered scope and surfaced accepted WORK-0003 evolution and
  retention/interim-deletion decisions before implementation; status stays proposed.
- 2026-09-15 accepted — user approved PostgreSQL-backed lifecycle evolution and
  temporary self-service deletion closure pending an agreed retention policy.
- 2026-09-15 building — implementing on `fix/0030-auth-session-lifecycle`;
  additive schema, auth cutover, identity proof, and isolated regression coverage.
- 2026-09-16 implemented — shared transactional session/provisioning/password
  modules, version-2 bearer/refresh format and ledger marker, serialized five-
  family cap, rotation/replay/logout/revoke-all, unique audited provider linking,
  verified Google claims and app/subject/expiry-bound Facebook proof, socket-only
  metadata, JWT-derived cookie lifetime and pre-validation deletion closure.
  Legacy rows remain version 1 history and never consume/list current sessions.
- 2026-09-16 repository verified — clean Node 22 containers passed `npm run check`:
  57 default tests (52 pass, five DB suites explicitly skipped), four tooling
  tests, 36-table SQL/Drizzle coverage and reviewed OpenAPI parity (114 paths).
  All five isolated PostgreSQL suites passed separately: RBAC, catalog,
  historical upgrades, auth lifecycle (16 subtests plus parent), and WORK-0030
  upgrade. Tests cover refresh and identity collisions, expiry/replay, legacy
  rejection, deterministic cap, disabled users, bookkeeping/signing/role/audit
  rollback, transport/cookie metadata and no-mutation deletion.
- 2026-09-16 artifact verified — production candidate
  `expense-api-work0030-production:latest`, image identity
  `sha256:3057e079f187e98b2f1b1245ba98ef7be16f819cdc732671a1cc9f643229d5d3`;
  verification image `expense-api-work0030-verification:latest`, identity
  `sha256:c4b946ab2ce16e9722ca0ff86a5ab0ebd07d519ef2f61880673cb4ba3d9ad6d5`.
  Fresh production/development audits reported zero vulnerabilities; embedded
  CycloneDX SBOM exactly matched 56 installed production dependencies.
- 2026-09-16 production preflight only — confirmed d3 and `expense_db`, 35 tables,
  nine users, 2,226 refresh rows, zero ambiguous identities/hash duplicates,
  zero legacy OAuth bindings, one eligible super administrator and one WORK-0047
  operator audit. PostgreSQL container identity remains
  `421b7056a7cabe11a853afd3a0d849c257e9c2d5cfe152e288025e25e4105df5`.
  No production DDL, account writes or API restart occurred.
- 2026-09-16 cutover held — read-only expense-tracker inspection found only
  per-tab refresh single-flight; shared-cookie concurrent tabs can trip the new
  containment and retain stale bearer tokens. WORK-0049 records proposed client
  coordination/UX fixes requiring explicit frontend authority. Status stays
  building, not shipped/deployed/release-ready. Production continues running
  pre-WORK-0030 image `sha256:d0ab8f9c0e5342e364be007f44197c36b23072b512816711b722f2c2123d5b1c`.
  Retention WORK-0048, provider/client smoke tests, native/MCP reauthentication,
  and earlier credential/log-review gates remain separate; no other proposal
  was implemented. No WORK-0030 commit or push performed.
- 2026-09-16 final staging — rebuilt candidate after final source cleanup:
  `expense-api-work0030-production:latest` now identifies
  `sha256:2dbe6fb5c2d805d12cbc134e8c40bb85be645e8b4c14d1122788c44e483b96b7`.
  Fresh audit/SBOM parity and actual production-artifact contract/deletion/link-
  authentication probes passed using fake test configuration, without listeners
  or live account access. Current-source `npm run check` passed again after docs.
  To avoid an accidental unready Compose rollout, the default production tag was
  rebuilt from committed WORK-0045 source (`21b7557`), image identity
  `sha256:d6c04d4b65057c7cf2250cccc8cba693b9cc4bc30d6f0760f9baa0adb5a772fa`;
  this did not restart or roll back the live container. Rebuild the candidate
  from reviewed source after client readiness before any authorized cutover.
  Shared context validation still rejects only the previously documented
  README/ideas/reviews taxonomy; project-local context validation passes.
- 2026-09-16 handoff — disposable PostgreSQL container/fixtures cleaned up;
  live API liveness remains 200 and API/PostgreSQL container identities are
  unchanged. Requesting explicit WORK-0049 frontend authority before proceeding
  to production SQL/API cutover. Repository changes remain uncommitted.
- 2026-09-19 MCP review — read-only inspection found that expense-mcp refreshes
  on every tool call and releases its per-user rotation lock before the API
  request. WORK-0030's immediate access invalidation can turn overlapping calls
  into spurious 401s. Proposed WORK-0050 records the separate MCP compatibility
  gate; neither client repository was changed or approved for implementation.
- 2026-09-19 client compatibility implementation — user approved WORK-0049 and
  WORK-0050. Separate frontend and MCP branches now pass clean builds,
  deterministic multi-tab/concurrent-tool regressions and real browser/MCP
  smoke tests against the unchanged WORK-0030 candidate on disposable
  PostgreSQL. The test containers/database/network were removed. Production
  still runs the earlier API image and unchanged PostgreSQL. Cutover remains
  held for the uninspected Flutter Expense client on `flutter-dev` (read-only
  SSH denied), frontend lint configuration/deployment ordering, full client
  and provider smoke checks, and earlier incident gates. No production DDL or
  restart and no WORK-0030/client commit or push occurred.
- 2026-09-19 clean API verification — a fresh Node 22 container installed the
  repository's locked dependencies and passed `npm run check`, including
  generated OpenAPI structural/contract parity. The host's earlier
  `verify:openapi` failure was caused by an incomplete local `node_modules`
  missing `@apidevtools/swagger-parser`, not by a contract failure. This does
  not clear the separate client, production and incident gates above.
- 2026-09-19 push and deployment decision — the WORK-0030, WORK-0049 and
  WORK-0050 branches were pushed to their respective origins. Read-only review
  of the Flutter `expense` repository at `56ba577` found uncoordinated direct
  biometric and interceptor refresh paths; strict one-time rotation can turn
  concurrent use into family revocation. WORK-0049 records the source evidence.
  The native build actually installed on devices remains unknown, and frontend
  lint, full client/provider smoke and earlier incident gates remain open.
  Production SQL/API/frontend deployment was not started; the live image and
  database remain on their pre-cutover versions. Status stays building.

---

> **For AI agents:** This item is building under the explicit successor/interim
> deletion approval above. WORK-0048 retention and adjacent proposals are not
> implementation authority; preserve shipped bootstrap/RBAC/step-up controls.
