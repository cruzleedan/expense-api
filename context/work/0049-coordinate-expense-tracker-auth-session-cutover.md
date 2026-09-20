---
id: 0049
title: "Coordinate expense-tracker for the authentication-session cutover"
status: building
kind: fix
opened: 2026-09-16
decided: 2026-09-19
branch: fix/0049-auth-session-cutover
supersedes: ~
superseded-by: ~
---

# WORK-0049 — Coordinate expense-tracker for the authentication-session cutover

## Problem and evidence

WORK-0030's strict one-time refresh contains replay by revoking the family and
invalidates access on rotation. Read-only client inspection found a rollout gate:

- `expense-tracker/src/services/api.ts:88,210–228`: `refreshInFlight` deduplicates
  only one JavaScript instance/tab, not separate tabs sharing a refresh cookie.
- `expense-tracker/src/context/AuthContext.tsx:71–107` refreshes on each mount;
  concurrent tabs can submit the same parent. WORK-0030's PostgreSQL race test
  proves one success followed by committed family revocation.
- Cached bearer tokens are not handed off between tabs in the inspected auth
  code. Another tab's rotation invalidates them; late 401s trigger refresh
  without checking whether a newer shared access token already exists.
- The deletion page still requests credentials for deletion; the approved API
  now deliberately returns no-mutation 403 pending retention policy.
- No explicit identity-link endpoint usage was found in the inspected client.
  Production has Google configured but zero legacy identity bindings. Unknown
  provider subjects must explicitly link, never use matching-email autolinking.

These are source-level findings plus a demonstrated server race, not a claim of
reproduction against real users or the deployed frontend. No frontend files were
changed and no native/MCP end-to-end smoke tests ran.

## Decision

Accepted: bounded `expense-tracker` compatibility work before the API
cutover. Keep strict replay containment; do not add replay grace or restore
email linking as a workaround.

Select a tested same-origin cross-tab refresh coordinator with token handoff,
stale-401 handling, logout/expiry propagation, crashed-tab recovery and a safe
unsupported-environment fallback. Preserve same-tab single-flight and HttpOnly
cookies. The accepted implementation choice is recorded below.

Implementation choice: browser Web Locks serialize login, logout and refresh
across same-origin tabs; local storage publishes the replacement bearer and
updates peer tabs. Without Web Locks, a current bearer can be used but the
one-time refresh endpoint is not called: the user signs in again instead of
risking family-wide replay. Axios domain services share a retry interceptor
which checks the original account before replay. Fetch clients use the same
shared bearer; safe GET/HEAD reads recover a stale 401. Streaming and mutating
fetch calls do not gain an automatic 401 retry.

Add explicit own-account password/provider-proof linking wherever provider login
is exposed, or explicitly disable that UI pending linking. Replace erasure
promises with the truthful disabled-policy state. Never embed provider secrets
or bypass eligibility/role/step-up controls. Other repositories need separate
authority if compatibility inspection shows changes are necessary.
Align account-provisioning password guidance with the API's 12–128-character
creation policy, without rejecting historically weaker passwords at normal login.

## Definition of done

- [x] User explicitly authorizes frontend scope and accepted behavior.
- [x] Same-tab/multi-tab concurrent refresh performs one rotation and shares its
      new access token without normal-use family revocation.
- [x] Late Axios and safe fetch-read 401s retry a current shared token before
      rotating again;
      account-switch guards prevent mutation replay as another user.
- [ ] Logout, expiry, replay, disabled-user, role-version and crashed-coordinator
      cases clear shared auth state and preserve sign-in recovery.
- [x] StrictMode/remount and multi-page browser regressions run against WORK-0030
      on disposable fixtures, never production accounts/databases.
- [x] Deletion/configured-provider UX matches the approved API, with no erasure
      claim or implicit email linking.
- [ ] Frontend gates/deployment pass in an agreed order, then WORK-0030 SQL/API
      cutover and live smoke checks complete.
- [x] MCP transport/reauthentication assessed separately in WORK-0050;
      no implicit cross-repository mutation or credential rotation.
- [ ] Native-client transport/reauthentication assessed separately.

## References

- [WORK-0030](0030-harden-authentication-oauth-and-session-lifecycle.md)
- [Session/client contract](../reference/auth-session-lifecycle.md)
- [WORK-0048 retention deferral](0048-account-retention-and-pseudonymization-policy.md)
- [WORK-0050 MCP compatibility](0050-coordinate-expense-mcp-auth-session-cutover.md)

## Log

- 2026-09-16 proposed — discovered during WORK-0030 implementation; API code
  verified, migration/restart held. No frontend implementation authority yet.
- 2026-09-19 cross-client review — MCP has a distinct in-flight access-token
  invalidation race, recorded in WORK-0050. Frontend scope remains unapproved.
- 2026-09-19 accepted/building — user approved WORK-0049 and WORK-0050 client
  implementation. Frontend work begins first; production cutover remains held.
- 2026-09-19 frontend repository verification — `fix/0049-auth-session-cutover`
  centralizes Axios auth, adds Web Locks/local-storage cross-tab coordination,
  fail-closed unsupported-browser fallback, shared account/role state and
  cache clearing. Eight isolated Chromium tests pass for multi-tab/StrictMode
  refresh, stale 401, logout/revocation propagation, unsupported locks, account
  switches and closed-tab lock recovery. A clean Node 22 container builds.
  Deletion/public signup now state the closed API policy; no provider-login UI
  was present to link implicitly. Administrator password guidance matches the
  12–128-character complexity and email-name exclusion policy. The repository's
  existing `npm run lint` fails before source inspection because it has no
  ESLint 9 configuration. Browser tests use mocked API responses, not yet a
  disposable WORK-0030 API/PostgreSQL fixture at this verification stage;
  production deployment is held.
- 2026-09-19 disposable integration — against the unchanged WORK-0030 candidate
  image and an unexposed, separately bootstrapped 36-table PostgreSQL fixture,
  two Chromium tabs performed one real refresh rotation, shared a valid bearer,
  and recovered a later server-invalidated access token via the real cookie.
  Additional safe-fetch read recovery and no-mutation-retry regression passed
  under mocked responses. The final current-source clean-container build and
  ten browser cases passed again, including the real-API case with its fixture
  flag; without that flag, nine mocked cases pass and one real case is skipped.
  The disposable API, test database/account and private network were removed;
  no production SQL, image or client container was changed. Vite development
  proxy no longer defaults to the live API when `API_URL` is unset.
- 2026-09-19 native-client assessment — workspace source search found no other
  expense-api refresh client, but the `flutter-dev` VM inventory lists a
  separate Expense Flutter app. Read-only SSH to the documented VM address was
  denied (`Permission denied (publickey,password)`), so its transport and
  reauthentication behavior remain unverified and cutover stays held.
- 2026-09-19 native source follow-up — after the three candidate branches were
  pushed, read-only inspection of the private `expense` Flutter repository's
  default-branch commit `56ba577` found a concrete cutover hazard.
  `lib/shared/data/services/remote/api_client.dart` serializes interceptor-
  triggered 401 refreshes with `_refreshCompleter`, but public
  `refreshSession()` calls `_doRefresh()` directly; biometric unlock calls that
  public method. Concurrent biometric and 401 refreshes can therefore send the
  same stored token twice, which WORK-0030 treats as replay and revokes the
  family. Late 401s also rotate without first checking a newer stored bearer,
  potentially invalidating an in-flight retry. The client does parse and store
  the rotated cookie, so transport is not the blocker. The VM working tree and
  released app version were not inspected. No Flutter code was changed; its
  compatibility fix, verification, and rollout need separate approval before
  the API cutover.
