---
id: 0047
title: "Align the seeded administrator role with separation-of-duties policy"
status: shipped
kind: fix
opened: 2026-09-15
decided: 2026-09-15
branch: fix/0047-sod-compliant-admin-catalog
supersedes: ~
superseded-by: ~
---

# WORK-0047 — Align the seeded administrator role with separation-of-duties policy

## Problem

The seeded system `admin` role uses a broad permission denylist that gives it
three combinations prohibited by the active SoD rules:

- `report.edit.all` + `report.approve` — Approval Fraud.
- `report.approve` + `report.post` — Financial Bypass.
- `audit.export` + `report.edit.all` — Evidence Tampering.

This was confirmed both in `src/db/schema.sql` and by read-only inspection of
the live role grants on 2026-09-15. The inconsistency predated WORK-0029; its
authoritative final-state enforcement now rejects assigning `admin` to an
ordinary user. It also rejects retaining conflicting access during a role-set
change. Existing assignments were not retroactively revoked, and system roles
cannot be edited through the API. The only accepted preventive-SoD exemption is
the active system `super_admin` role, not `admin`.

Severity: P1 control-policy/catalog consistency and administration usability.

## Decision

Accepted: use a compliant control-plane administrator capability set, replace
the seeded denylist with an explicit grant set, and migrate existing grants and
assigned-user access with policy simulation, token invalidation, and audit.
Report approval, posting/payment, and evidence administration follow the owners
and boundaries below.
Do not weaken SoD or extend the super-admin exemption to repair this implicitly.

### Approved capability boundary

| Responsibility | Owner / administrator boundary |
|---|---|
| Configuration, users, ordinary roles, permissions, forms, taxonomy, projects, and workflow definitions | `admin`, using explicit grants and existing step-up controls |
| Report support and audit/analytics inspection | `admin` may read/export; no report mutation or evidence archival |
| Expense submission and own-report edits | `employee`; not implicitly part of administration |
| Financial approval/rejection/return | `approver`; not `admin` |
| Posting, payment, correction, and financial export | `finance`; not `admin` |
| Audit evidence archival and compliance certification | Not delegated to `admin` in this item |
| Elevated-role assignment, impersonation, restore, emergency/workflow override | Retain the existing reserved boundary; not delegated to `admin` |

The migration only replaces `admin` grants; it does not silently add financial
roles to compensate for removed access. It simulates every affected user's
combined final active grants. Unrelated conflicting role combinations abort the
whole migration for explicit operator remediation. The active system
`super_admin` role remains the sole accepted preventive-SoD exemption.
WORK-0040's broader capability/delegation model remains a separate proposal.

## Options considered

| Option | Benefit | Trade-off |
|---|---|---|
| Compliant administrator allowlist | Explicit, testable scope | Requires business ownership and data migration |
| Split administration into narrower system roles | Stronger responsibility boundaries | More assignment and client coordination |
| Exempt ordinary administrators | Restores current broad access | Weakens preventive controls; requires an explicit risk decision |

## Resolved scope and deferred decisions

- Report/audit read and export remain; report execution, evidence archival, and
  compliance certification do not. The exact 80 grants are maintained in
  `src/policies/roleCatalog.ts`, with a parity test against bootstrap SQL.
- Ordinary role management remains; existing elevated-assignment and step-up
  controls are unchanged. A broader delegation ceiling is WORK-0040, not this fix.
- Existing assignments are preserved. Final combined access is simulated before
  any write; unrelated toxic combinations require explicit remediation. The
  actual production user had only `admin`, so no reassignment was necessary.
- The inspected frontend permission helper checks exact returned permission
  names, without an administrator bypass. MCP exchanges its stored API refresh
  token for fresh permissions on each call. Full client UX was not exercised;
  self-service users now need an explicit compatible `employee` assignment.

## Implementation and verification

The impact boundary is the strict operator CLI
`src/db/migrateAdminRoleCatalog.ts` →
`src/services/roleCatalog.service.ts` → shared RBAC advisory lock → locked system
roles/permissions and affected users → final-state SoD simulation → grant delta,
token-version increments, and the existing sensitive audit writer → one commit.
No HTTP route can invoke the migration or edit system grants. Assignment routes
continue to use WORK-0029's authoritative service.

The versioned allowlist is `WORK-0047:v1`. Bootstrap SQL initializes the same
catalog for an empty database. Existing databases use
`npm run db:migrate-admin-catalog -- --dry-run` (also the default), then an explicit
`--apply` with `RBAC_MIGRATION_OPERATOR`. This is seed/grant data, not a structural
change: SQL DDL and Drizzle tables are unchanged. An application-level operator
migration, rather than additive DDL SQL, reuses the established transaction,
policy checks, and audit writer without duplicating audit-ledger logic.
[README](../../README.md) contains the repeatable host/Compose commands.

The migration rejects a missing/replaced system catalog, missing allowlisted
permissions, absence of an active verified system super-admin, incompatible
ordinary system-role definitions, or conflicting combined permissions of any
affected user. Active system `super_admin` is the only user-level SoD exception.
It changes only administrator grants; retained grant attribution/timestamps and
all user-role assignments are preserved. Affected active and inactive users are
invalidated together. One sensitive `role.permissions.update` audit event records
before/after grants, database identity, operator/change label, and each invalidated
user's old/new role version; its ERP actor is null, not an impersonated account.
Audit failure rolls back every write. Unchanged reruns perform no grant, version,
or audit writes. Application RBAC writes serialize on the same advisory lock;
direct operator SQL must not modify RBAC concurrently.

Verification includes:

- Allowlist uniqueness, excluded financial/reserved actions, exact bootstrap
  parity, and seeded SoD checks.
- An opt-in, empty-database-only PostgreSQL 16/pgvector integration test: actual
  bootstrap grants, all five ordinary seeded roles, the explicit super-admin
  exception, legacy/future grants, dry-run non-mutation, refusal guards, unrelated
  combined conflicts, audit-failure rollback, two concurrent applies with one
  audit/version increment, inactive users, unaffected users, and stale-token
  rejection followed by fresh compliant claims.
- Both assignment API aliases accept compatible `admin` combinations and reject
  `admin` + `approver` + `finance`. Administrator role detail preserves the
  camelCase/OpenAPI response schema and returns exactly the new catalog.
- WORK-0029's database integration suite also passed separately against a fresh
  disposable database. CLI invalid-mode and unlabeled-apply checks exited 1
  before opening a database connection. Both temporary test containers were
  stopped and removed; no production test fixtures were created.

## Remaining release and coordination gates

- Affected users must refresh/sign in after invalidation. Administrators who
  submit expenses need an explicitly authorized, compatible employee role;
  removed approval/finance access must not be silently restored. No other
  repository's code was changed and no real-user frontend/MCP login was tested.
- WORK-0029's client step-up UX, OAuth-only protected-action restrictions, and
  true MFA/provider-assurance design remain unchanged. In-flight non-RBAC
  requests that already passed authorization are not cancelled by invalidation.
- WORK-0040's complete authorization/OpenAPI contract and delegation-capability
  model remain proposed; this catalog change does not prove all routes enforce
  a central matrix or prevent every form of permission delegation.
- WORK-0027's production credential rotation and public-exposure access-log
  review remain mandatory incident-response gates; neither was performed here.
- WORK-0045 and WORK-0030 remain proposed. The new production image build reports
  four dependency vulnerabilities (two moderate, one high, one critical),
  unchanged from WORK-0029. This fix does not remediate or accept that risk.
- Project-local context verification passes. The previously recorded shared
  validator taxonomy mismatch remains; no framework expansion is part of this
  work. Health/smoke checks demonstrate a running deployment, not sustained
  operation or release readiness.

## Definition of done

- [x] Approved administrator capability matrix and responsibility owners exist.
- [x] Bootstrap grants and existing-database migration match that matrix.
- [x] Ordinary seeded roles individually satisfy active SoD rules; the explicit
      super-admin exception is tested and documented.
- [x] Existing affected users are simulated, remediated, audited, and invalidated
      transactionally, preserving the final-admin invariant.
- [x] Role assignment and replacement tests cover seeded administrator roles,
      combined-role conflicts, and client compatibility.
- [x] Deployment evidence and outstanding coordination gates are recorded.

## Related records

- [WORK-0029](0029-atomic-rbac-sod-and-step-up-controls.md) — authoritative policy
  enforcement; this follow-up does not undo its accepted controls.
- [WORK-0040](0040-central-authorization-matrix-and-openapi-contract.md) — broader
  capability and client-contract alignment, still a separate proposal.

## Log

- 2026-09-15 proposed — captured the seeded administrator/SoD mismatch during
  WORK-0029 final verification; no grant changes or retroactive revocations made.
- 2026-09-15 accepted — user approved the explicit administrator allowlist,
  separate financial responsibilities, atomic audited migration/invalidation,
  and seeded/combined-role regression coverage.
- 2026-09-15 building — implementing the catalog boundary and operator migration
  on `fix/0047-sod-compliant-admin-catalog`; WORK-0045 and WORK-0030 are not in scope.
- 2026-09-15 verified — `npm run check` passed: conventions, context, 35-table
  SQL/Drizzle parity, tooling, TypeScript build, and 37 tests; both opt-in database
  suites were skipped in the default run and passed separately on fresh
  PostgreSQL 16/pgvector databases. Diff whitespace checks passed.
- 2026-09-15 data applied — reviewed production dry-run then applied
  `WORK-0047:v1` to `expense-api-postgres-1` / `expense_db` as `expense_user`, with
  label `user-approved WORK-0047 deployment`. Administrator grants changed
  111 → 80; the one affected user's role version changed 1 → 2. All six role
  assignment counts were unchanged; one active verified super-admin remained.
  Verified zero ordinary seeded-role SoD violations and one sensitive operator
  audit with 111/80 before/after grants and one invalidated user. A subsequent
  dry-run returned `changed: false`. No bootstrap replay or DDL changes occurred.
- 2026-09-15 deployed — built production image
  `sha256:5e3da02d8d2b6495d36b35c98a090686d2adbc456aa780e54f71f84706f2eb6f`,
  then redeployed only `expense-api` using production Compose with `--no-deps`;
  PostgreSQL was not recreated. Container health passed; `/health` reported
  database, receipt parser, and Ollama healthy. Role detail and both assignment
  aliases remained in generated OpenAPI. `verify:deployment` passed liveness 200,
  registration 403, application cap 413, and the Caddy streaming cap 413.
- 2026-09-15 shipped — compliant administrator catalog, audited atomic data
  migration, API regressions, deployment evidence, and outstanding gates recorded.

---

> **For AI agents:** This item is shipped with the capability boundary above.
> Do not add an administrator SoD bypass or silently grant replacement financial roles.
