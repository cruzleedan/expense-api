---
title: Authentication session lifecycle and client cutover
updated: 2026-09-19
---

# Authentication sessions

WORK-0030 supersedes WORK-0003's stateless-session claim. Bearer access JWTs,
`jose`, and HttpOnly refresh cookies remain; PostgreSQL is authoritative for
account eligibility, role version, active sessions, rotation and revocation.
Public registration remains disabled. No Passport, Redis or second-factor MFA.

This describes the implemented candidate. Production cutover status belongs in
WORK-0030; it is held pending WORK-0049 frontend and WORK-0050 MCP client
compatibility, not deployed yet.

## Client behavior and compatibility

- Deployment is an explicit `auth_version=2` cutover. All older access **and**
  refresh tokens are rejected; users/integrations must sign in again. There is
  no unversioned fallback. Access JWTs require a current positive role version
  and a refresh-row ID owned by the active, verified account.
  Ledger defaults remain version 1 for old-image compatibility; new minting
  explicitly writes version 2. Legacy rows are retained but never counted/listed
  as active or accepted by current access tokens.
- Access tokens require that refresh row to remain active and unexpired.
  Rotation, logout, eviction, replay containment and revoke-all invalidate them
  immediately on the next authentication check.
- Refresh accepts the existing cookie or JSON `refreshToken` body; an explicit
  body token takes precedence. Invalid JSON/types/unknown fields are rejected,
  not silently replaced with the cookie. Logout now accepts either transport.
- Successful responses still return `accessToken` and set `refreshToken` via
  cookie, not a new refresh-token response body. Native/integration clients
  using body-token transport must capture the rotated cookie.
- Clients must single-flight refresh across concurrent consumers and replace
  stored tokens atomically. Reusing a rotated token, including an expired signed
  ancestor of a live descendant, revokes the entire family and requires sign-in.
  There is no replay grace window.
- A serialized refresh exchange alone is insufficient if another consumer can
  rotate while the first consumer's API request is in flight: that rotation
  invalidates the first access token. The WORK-0050 MCP candidate holds its
  per-user lock through the downstream call and reuses a JWT only until 30
  seconds before expiry. Real disposable API smoke passed; service deployment
  and full host/client reconnection remain unverified.
- The WORK-0049 frontend candidate coordinates same-origin cookie rotation with
  Web Locks, publishes the bearer through local storage, and recovers stale
  Axios and safe fetch-read 401s only for the same account. Without Web Locks,
  automatic refresh is disabled and sign-in remains available. A disposable
  real-API browser fixture passed; deployment and native-client checks remain.
- The cap is five active families per account. A new login retains the four
  newest existing families and evicts the rest: original creation time
  descending, then family UUID descending. Rotation does not renew family age
  or consume a sixth slot. Account locking serializes login/rotation/revocation;
  a unique partial index allows only one non-revoked row per family.
- Step-up belongs to the current refresh row and is never copied on rotation.
  Repeat password step-up on the new session before protected actions.

Cookie expiry derives from minted JWT expiry, not a hardcoded seven days.
HttpOnly/Secure-in-production/Lax/path settings are retained. JWT durations must
be positive bounded `s/m/h/d` values. Production Compose passes both durations
and `GOOGLE_MOBILE_CLIENT_IDS` explicitly. IP metadata uses the Node socket peer
only; bounded user-agent is descriptive, not authorization proof. Caddy's peer
is not claimed to be the end-user IP; trusted proxies remain WORK-0031.

## Provider identities and linking

The unique identity is `(provider, subject)`, not email. `user_identities`
supports multiple identities without overwriting legacy user columns. Only an
already-linked subject can log in; unknown subjects never link by email or
create accounts.

`POST /v1/auth/identities/google` accepts only `{idToken, password}`;
`POST /v1/auth/identities/facebook` accepts only `{accessToken, password}`.
Both require the current bearer session and password for **that same account**.
The transaction locks/rechecks account eligibility, role version and session,
then commits the unique binding and audit together. Another owner gets 409;
repeating one's own binding is idempotent.

Google requires RS256, Google issuer, configured audience/presenter, stable
subject and boolean `email_verified=true`. Web login requests OpenID scope and
verifies its ID token for the web client; native/link tokens accept the configured
web client plus `GOOGLE_MOBILE_CLIENT_IDS`. Configure every additional native
audience/presenter explicitly; an unknown presenter is never implicitly trusted.
Google/Facebook web state cookies are provider-specific.

Facebook requires a valid app-bound debug result, unexpired token and matching
debug/profile subject. Facebook email presence is **not** verification and is
never ownership proof or a replacement local email. Linking is authorized by
provider subject possession **and** current local password, not Facebook email.
OAuth-only accounts without passwords cannot add identities through this flow;
recovery/provider-only step-up require a separately approved design.

Administrator provisioning and pending registration share the 12–128-character
complexity/identity-exclusion policy. Existing hashes remain compatible; login
does not apply new password-strength rules. Account and required active employee
role commit together. Provisioning deliberately does not sign in; first/later
login bookkeeping and both tokens form a separate atomic transaction.

`POST /v1/auth/delete-account` returns 403 before validation or credential/DB
access. No login, eviction, deletion, deactivation or anonymization claim.
WORK-0048 is a **proposed** retention-policy spike, not erasure authority.
Administrative controls and last-super-admin protection remain unchanged.

## Reviewed migration and rollout

1. Verify complete, unique legacy provider/subject ownership and unique refresh
   hashes. SQL aborts on ambiguity; resolve ownership explicitly, never by email.
2. Apply only `src/db/changes/0030-session-families-and-identities.sql` through
   `db:apply-change` (`ON_ERROR_STOP`, one transaction). It adds families/indexes
   and backfills identities, without bootstrap replay, grants, revocation,
   deletion or role-version changes. Reapplication is safe.
3. Verify schema/ownership and unchanged users/RBAC/audit. Deploy only the API
   after repository and all disposable PostgreSQL suites pass **and** WORK-0049
   and WORK-0050 client compatibility gates are met. Do not recreate PostgreSQL
   or change Caddy/Cloudflare.
4. Verify health, boundaries, disabled deletion and contract; coordinate clients'
   sign-in/single-flight recovery. Real-provider/client smoke tests require
   configured apps and account holders, separately from local fixture tests.

No destructive down migration: retain additive schema/data during recovery.
The older image restores unsafe linking/deletion/refresh and may accept tokens
rejected by this cutover: **no automatic rollback to it**. An emergency older
image needs explicit incident/risk approval; prefer a reviewed forward fix with
closures preserved. Earlier incident credential/log-review gates remain separate.

## Repeatable verification and implementation lessons

`npm run check` includes database-free policy, signature, schema, route and
contract regressions. Required `test:postgres` uses separate disposable databases
for RBAC, catalog, existing upgrades, auth transactions/races and this additive
upgrade. Never infer DB coverage from skipped default suites or use production.

For errors following security writes (replay containment, failed-login counter),
return an outcome from the transaction, **commit**, then raise the public error.
Throwing inside would undo the control. Conversely, signing/role/audit failures
must roll back every successful-flow write. Preserve account-before-token
locking; never take RBAC's global lock after an account lock. Shared session,
provisioning and password modules keep mechanics out of routes and avoid cycles.

Primary references: [OAuth rotation/replay containment](https://www.rfc-editor.org/rfc/rfc9700.html#section-4.14.2),
[Google OpenID claims](https://developers.google.com/identity/openid-connect/openid-connect),
[jose signature-before-claim validation](https://github.com/panva/jose/blob/v5.9.6/src/jwt/verify.ts).
