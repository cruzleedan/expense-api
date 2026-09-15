# Expense API architecture and control audit — 2026-09-14

## Purpose and status

This is a read-only architecture and defect review of the current `expense-api`
branch. It records observed behavior, proposed remediation, and longer-term ERP
opportunities. It does not accept any proposal or authorize implementation.

All new work items from this review are `proposed`. Per `context/work/0000-template.md`,
they must not be implemented until accepted or moved to building.

## Release assessment

The API should not be exposed to untrusted users until the following release
blockers are contained:

1. `WORK-0027`: caller-controlled receipt keys allow local path traversal and
   arbitrary file reads, with a writable-file deletion path.
2. `WORK-0028`: public registration plus authentication-only user/role routes
   permits self-service privilege escalation.
3. `WORK-0032`: the generic report update endpoint bypasses workflow and
   accounting lifecycle controls.
4. `WORK-0033`: approval eligibility is disconnected from configured workflow
   targets and skipped-step processing can approve before all required steps.

## Verification performed

- Reviewed application routes, services, schemas, PostgreSQL DDL, Drizzle
  schema, storage providers, scheduler, production Compose, and context records.
- `npm run build` completed successfully on 2026-09-14.
- Generated `/openapi.json` in-process: it returned no security schemes while
  operations referenced both `Bearer` and `bearerAuth`; its server URL already
  included `/v1` while generated paths also included `/v1`.
- Confirmed PostgreSQL `date - date` yields an integer; the duplicate detector's
  `EXTRACT(DAY FROM date - date)` expression is invalid.
- Inspected the installed production dependency tree and the production audit
  result. The audit reported 6 vulnerable packages: 1 critical, 3 high, and 2
  moderate.
- No application code was changed as part of the review.

## Complete finding register

| Area | Confirmed findings | Record |
|---|---|---|
| Receipt upload security | Unbound caller-supplied key; local traversal in get/delete/exists; client-trusted hash/size/MIME; duplicate branch deletes supplied key; no server content verification; presigned PUT lacks size binding; multipart buffered before size check | `WORK-0027` |
| Administrative bootstrap | Public registration creates active accounts; verification not required for login; core user CRUD and duplicate role-assignment routes require authentication only; a new user can enumerate roles and self-elevate | `WORK-0028` |
| RBAC/SoD | Non-atomic assignment and token invalidation; role deletion does not bump affected users; role permission edits bypass SoD; replacement validators use union semantics; no last-admin invariant; `requires_mfa` is not enforced | `WORK-0029` |
| Authentication/session | Legacy access tokens bypass current-user checks; refresh rotation and concurrent-session enforcement race; account creation/default role/session are non-atomic; OAuth auto-links by email and does not consistently require verified email; single non-unique OAuth identity slot; missing request metadata; cookie lifetime drift; password-policy drift; delete-account creates a session and overbroadly catches errors | `WORK-0030` |
| Edge controls | Global and auth rate limits share process-local keys and count auth twice; forwarded IP is trusted directly; no multi-replica coordination; wildcard credentialed CORS; no gateway/body limit | `WORK-0031` |
| Report lifecycle | Generic update writes status, totals, rejection/payment and FX fields; no transition matrix; no dedicated post/pay commands; soft-deleted reports remain directly addressable; create plus line attachment and custom-field mutations are not atomic; version is incremented but not checked | `WORK-0032` |
| Workflow | Step target type/value ignored; return does not run approval eligibility; eligibility checked before row lock; only the immediate skipped step is considered; skipped next step can prematurely finish; status/history endpoint lacks resource authorization; live/deleted line scope differs; empty/deleted-only reports can submit | `WORK-0033` |
| Expense lines | Amount optional/negative and tax may be negative; bulk insert omits user owner; receipt is validated after insert and failures can commit hidden rows; association errors are swallowed; soft-deleted lines are directly readable/mutable; idempotency key is globally scoped and can return another user's data; no owner/currency/amount invariants | `WORK-0034` |
| Receipt evidence | Nested report route does not bind uploads to `reportId`; “same report” association rule is not implemented; file and DB mutations are not one recoverable operation; evidence can be changed/deleted after approval/posting; association operations do not consistently enforce report state | `WORK-0035` |
| Policies | `/check` trusts caller-supplied department/roles; only a subset of rule types execute; receipt/approval/category/frequency/custom rules are inert; `hard_block` is not enforced on mutation or submission | `WORK-0036` |
| Dynamic forms | Client chooses role used for schema; only one role is evaluated; hidden/read-only/required/platform/validation/option rules are UI-only; hidden values can be returned and read-only values written; entity and custom values update separately; global key conversion mutates opaque JSONB | `WORK-0037` |
| Financial analytics | Deleted rows appear in materialized views, dashboard, semantic retrieval, project summaries, and anomaly inputs; status semantics omit `paid`; live and persisted totals disagree; nullable budget scope allows duplicate logical budgets | `WORK-0038` |
| AI/anomalies/insights | Duplicate SQL is invalid and compares across users; anomaly candidates include inappropriate states; global insight pin/dismiss mutates shared state; chat loads earliest history; chunks are reported as tokens; AI routes are auth-only despite permission registry; no user/org cost quota or concurrency limit | `WORK-0039` |
| API authorization/contracts | Admin analytics permissions are registered after handlers; several view/query routes do not enforce declared permissions; recursive team list and direct-only detail checks disagree; generated OpenAPI has zero security schemes, two names, and duplicated `/v1` base | `WORK-0040` |
| Jobs and derived data | Cron runs in every API replica; no lease/idempotency; view refresh swallows failures and refreshes only one view; `spending_summaries` has no writer; project spent updater is unused | `WORK-0041` |
| Audit trail | Only workflow paths emit audit events; most sensitive writes are uncovered; audit is post-commit; concurrent appends can fork the chain; nested change/metadata values are not reliably included in the hash; verifier does not recompute data hashes; no operational access/export route | `WORK-0042` |
| Database evolution | Production DDL runs only on empty volumes; schema is not repeatable; `CREATE ... IF NOT EXISTS` cannot evolve views; no version/checksum history; SQL and Drizzle constraints drift; financial, ownership, state, and time invariants are absent | `WORK-0043` |
| Offline sync | Timestamp-plus-offset pagination can miss/twice-return changes; strict `>` loses equal-timestamp changes; no stable cursor/watermark; version is not an update precondition; tombstone retention contract absent; client IDs are not owner-scoped | `WORK-0044` |
| Dependencies/quality | Vulnerable production packages; unused Sharp attack surface; no test/lint/CI scripts; no authorization, concurrency, migration, contract, or adversarial-upload release gates | `WORK-0045` |

## Architecture and ERP idea register

| Idea | Purpose |
|---|---|
| `IDEA-0001` | Domain-oriented modular monolith with commands, unit of work, and outbox |
| `IDEA-0002` | Accounting posting and payment subledger |
| `IDEA-0003` | Legal-entity/tenant boundary and point-in-time organization dimensions |
| `IDEA-0004` | Multi-currency, tax, reimbursement, and settlement correctness |
| `IDEA-0005` | Corporate-card ingestion and reconciliation |
| `IDEA-0006` | Travel, per-diem, and mileage claims |
| `IDEA-0007` | Budget commitments and project charge control |
| `IDEA-0008` | Evidence retention, legal hold, and compliance export |

## Suggested sequencing

1. Contain `0027`, `0028`, `0032`, and `0033` before public exposure.
2. Complete identity and authorization controls `0029`–`0031` and `0040`.
3. Correct financial aggregates and evidence integrity in `0034`–`0038`.
4. Make AI, jobs, audit, migrations, sync, and release gates trustworthy in
   `0039` and `0041`–`0045`.
5. Shape the idea records into accepted work only after business accounting,
   compliance, and deployment requirements are agreed.

