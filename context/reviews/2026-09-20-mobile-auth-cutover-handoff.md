# Expense authentication cutover — mobile developer handoff (2026-09-20)

## Purpose and release status

This handoff asks the Flutter `expense` developer to assess the mobile app
against the implemented, **not yet deployed** authentication changes in
[WORK-0030](../work/0030-harden-authentication-oauth-and-session-lifecycle.md),
[WORK-0049](../work/0049-coordinate-expense-tracker-auth-session-cutover.md),
and [WORK-0050](../work/0050-coordinate-expense-mcp-auth-session-cutover.md).
It describes candidate code, not the current production API. The three
candidate branches were pushed, but the production SQL/API and web rollout was
held after a native refresh race was found. Confirm the current deployment and
the Flutter build actually installed on devices before testing or planning the
cutover. No Flutter code was changed in this work.

The detailed server contract and rollout constraints are in
[auth-session-lifecycle.md](../reference/auth-session-lifecycle.md).

## What changed across the repositories

| Repository/work item | Implemented change | Mobile implication |
|---|---|---|
| `expense-api` / WORK-0030 | PostgreSQL-backed version-2 access/refresh sessions, atomic one-time refresh, replay containment, five-session cap, current-account/role/session checks, unique provider identities and explicit linking, consistent password creation policy, and fail-closed self-service deletion. An additive SQL migration and regression tests accompany the API code. | Old tokens require a fresh sign-in. A refresh token must never be submitted twice; rotation immediately invalidates its previous access token. Provider sign-in only works for an explicitly linked subject. |
| `expense-tracker` / WORK-0049 | Browser tabs coordinate login/logout/refresh with Web Locks, hand off the latest bearer through local storage, recover stale 401s for the same account, and stop advertising public registration or erasure. | Browser Web Locks/local storage are **not** a mobile implementation recipe; Flutter needs equivalent coordination for every refresh entry point. |
| `expense-mcp` / WORK-0050 | Each user's API token exchange and downstream API call share one lock; a current access JWT is cached until shortly before expiry. Failed/uncertain mutations are not automatically replayed. | Guarding only the refresh HTTP call is insufficient if another consumer can rotate before an in-flight request authenticates. |

The API and both clients passed clean builds and isolated browser/MCP tests
against a disposable WORK-0030 API/PostgreSQL fixture. This is **not** evidence
that the Flutter app or real provider login works with the new server. The
frontend's pre-existing ESLint-9 configuration gap, full provider/client smoke,
and other recorded release gates remain open.

## Candidate API contract relevant to Flutter

All paths below are relative to `/v1`. Email login and the existing native
Google/Facebook endpoints still return `{ "user": { "id", "email" },
"accessToken": "..." }` and a `Set-Cookie: refreshToken=...` header. The
refresh token is **not** in the JSON response.

| Operation | Candidate behavior |
|---|---|
| `POST /auth/login` | Existing `{email,password}` request. Creates a new version-2 session and sets the refresh cookie. Existing passwords remain valid; the new strength policy applies to password **creation/reset**, not ordinary login. |
| `POST /auth/google/mobile` / `POST /auth/facebook/mobile` | Existing native `{idToken}` / `{accessToken}` request shapes. The verified provider subject must already be linked to an account. Unknown subjects do not create accounts or link by matching email. Both responses use the same access-token body and refresh cookie as email login. |
| `POST /auth/refresh` | Accepts either the existing `refreshToken` cookie or JSON `{ "refreshToken": "..." }`; an explicit body token wins. Returns only `{ "accessToken": "..." }` in JSON and a **new** `refreshToken` cookie. An invalid body is rejected rather than falling back to a cookie. |
| `POST /auth/logout` | Accepts cookie or optional JSON refresh token, revokes that session family, clears the cookie, and invalidates its access token. |
| `POST /auth/sessions/revoke-all` | Requires the current bearer; revokes all the account's device/integration sessions and their access tokens. Every client must sign in again. |
| `POST /auth/identities/google` / `POST /auth/identities/facebook` | New explicit linking endpoints. Require current bearer **and current account password** plus `{idToken,password}` or `{accessToken,password}` respectively. They link the verified subject to that same account; a subject owned by another account gets 409. |
| `POST /auth/delete-account` / `POST /auth/register` | Self-service deletion and public registration remain closed (403). Deletion does not authenticate, remove, deactivate, or anonymize an account. Do not promise erasure or collect deletion credentials in the app. |

The refresh cookie is HttpOnly, SameSite=Lax, path `/`, Secure in production,
with `Max-Age` based on the configured refresh-token expiry (rather than a
hardcoded seven days). Native code may continue sending its stored token as a
`Cookie` header, or use the JSON-body transport, but **must capture and replace
the rotated token from each successful `Set-Cookie` response**. Do not expect a
refresh token in JSON. API errors use the normal `{ "error": { "message",
"code" } }` envelope; distinguish authentication failures from validation,
authorization, conflict, and transient transport failures.

Version-2 access tokens are accepted only while their issuing refresh row is
active and the user remains active, verified, and at the current roles version.
Rotation, logout, eviction, replay containment, permission changes, and
revoke-all can invalidate a bearer before its JWT expiry. Refresh is strictly
single-use: replaying an already rotated token revokes the whole family and
requires sign-in. There is **no replay grace window**. A new login keeps at
most five active session families, evicting the oldest when necessary.
Password step-up assurance is bound to one refresh row and is not carried
through rotation; protected actions may require step-up again.

Google ID tokens must have a verified email and an explicitly configured
audience/presenter (`GOOGLE_CLIENT_ID` or `GOOGLE_MOBILE_CLIENT_IDS`). Facebook
tokens must be valid for the configured app and resolve to the same provider
subject; Facebook email is not account-ownership proof. An OAuth-only account
without a local password cannot use the new linking endpoints until a separate
recovery/proof design is approved.

## Flutter source review: concrete compatibility work

Read-only review of the private Flutter `expense` repository at default-branch
commit `56ba577` on 2026-09-19 found the following. The `flutter-dev` VM working
tree and released mobile binary were **not** inspected; recheck them before
assuming these lines match the installed app.

1. `lib/shared/data/services/remote/api_client.dart` single-flights only
   interceptor-triggered 401 refreshes through `_refreshCompleter`.
   `refreshSession()` calls `_doRefresh()` directly, and both biometric unlock
   screens call `refreshSession()`. A biometric refresh and a 401 refresh can
   therefore read and submit the same stored token. Under WORK-0030, the
   second submission is replay and revokes the family. Route **every** refresh
   entry point through one coordinator, including biometric unlock, startup,
   background sync, and interceptor recovery.
2. A late 401 currently starts another refresh even if secure storage already
   contains a newer access token. Compare the bearer on the failed request
   with the latest stored bearer first; reuse the newer one for an appropriate
   retry. Prevent another rotation from invalidating an in-flight request, or
   make its safe recovery explicit. Do not blindly replay an uncertain write.
3. `_doRefresh()` writes the new access token before the rotated refresh token,
   and accepts a successful response even if the new cookie is absent. Review
   token-pair persistence and failure behavior so a crash/partial write cannot
   leave an old refresh token that is later replayed. Treat a missing rotated
   cookie as a failed exchange rather than keeping the old refresh token.
   Never automatically retry the same refresh token after a timeout with an
   unknown server outcome; offer a sign-in recovery path.
4. `_doRefresh()` clears both tokens for **every** exception, including
   transient transport errors. Decide the offline-first UX deliberately:
   queued local expense data should remain intact, and retry logic must not
   inadvertently replay a possibly consumed refresh token.
5. `AuthRepository.logout()` currently removes only the access token to retain
   biometric re-entry. Distinguish an intentional app lock from a user-visible
   sign-out. A true sign-out should revoke the API family and clear both local
   tokens; biometric lock may retain the refresh credential by policy.
6. The Dio request interceptor attaches a stored bearer even to public login
   and provider-login calls, while its 401 handler excludes only
   `/auth/refresh`. A rejected password or provider proof can therefore
   trigger an unrelated session refresh and retry. Exclude public auth calls
   from bearer injection and automatic refresh-on-401.
7. Native Google/Facebook sign-in may now return 401 for an unlinked subject
   even when its email matches a local account. Provide an explicit signed-in
   linking flow using the new endpoint and current password, or make the
   limitation clear in the UI. Check native Google client IDs against the
   server's configured allow-list; do not hardcode provider secrets.

The existing Flutter client **does** parse `Set-Cookie` on login/provider login
and refresh. That transport compatibility was observed in source, not verified
on a device. Its current direct `Cookie` header remains supported by the
candidate API; changing to JSON-body refresh is optional, not a workaround for
the concurrency problem.

## Mobile verification requested before cutover

- Confirm the VM working tree, Play Store build, and development build versions;
  compare them with the reviewed source before making changes.
- On a disposable API/PostgreSQL fixture, test two concurrent 401s, biometric
  refresh overlapping a 401/background sync, a late 401 after another rotation,
  missing/late `Set-Cookie`, process interruption between token writes, and an
  uncertain refresh timeout. Verify one rotation per stored token and a clear
  sign-in recovery path without losing the offline sync queue.
- Test old-version token rejection at cutover, revoked/expired/replayed tokens,
  role-version change, disabled account, sixth-device eviction, logout and
  revoke-all. Confirm no refresh loop or accidental mutation replay.
- Test already-linked and unlinked Google/Facebook subjects with actual
  configured provider apps, including Google audience/verified-email checks
  and explicit linking. Do not test these against production accounts without
  a coordinated smoke plan.
- Review any registration, account-deletion, password-creation/reset, session,
  and sign-out UI for truthful behavior under the candidate API.

Do not deploy WORK-0030's SQL/API cutover merely because the pushed branches
build: it rejects existing sessions, has no safe automatic rollback to the old
auth behavior, and the native-client and other release gates remain open.
