---
id: 0004
title: "Mobile OAuth endpoints for Flutter client (Google + Facebook)"
status: proposed
kind: feature
opened: 2026-08-01
decided: ~
branch: ~
supersedes: ~
superseded-by: ~
---

# WORK-0004 — Mobile OAuth endpoints for Flutter client

| | |
|---|---|
| **Opened** | 2026-08-01 |
| **Status** | proposed |
| **Kind** | feature |
| **Supersedes** | — |
| **Superseded by** | — |

## Problem

The existing OAuth routes (`GET /v1/auth/google`, `GET /v1/auth/google/callback`)
use 302 redirects and are designed for web browsers. A Flutter WebView cannot
cleanly receive a JSON response mid-redirect-chain. Native mobile SDKs instead
obtain an ID/access token from the OS and send it to the backend for verification.

## Decision

Add `POST /v1/auth/google/mobile` and `POST /v1/auth/facebook/mobile` endpoints
so the Flutter client can authenticate using native OS-level account pickers
(google_sign_in, flutter_facebook_auth) rather than the web redirect flow.

### `POST /v1/auth/google/mobile`

```json
// Request body
{ "idToken": "<Google ID token from google_sign_in SDK>" }
```

Behavior:
1. Verify ID token against Google's public keys (audience = Android/iOS OAuth
   client ID registered in Google Cloud Console — separate from the web client ID)
2. Extract `sub`, `email`, `name`, `picture` from verified token claims
3. Find-or-create user by email using the **same account-linking logic** as
   `/auth/google/callback` — a user who signed up via web Google OAuth must
   resolve to the same account on mobile
4. Return `200 AuthResponse` + set `refreshToken` HttpOnly cookie, identical to
   `/auth/login`
5. Invalid/expired token → `400` with existing `Error` schema

### `POST /v1/auth/facebook/mobile`

```json
// Request body
{ "accessToken": "<Facebook access token from flutter_facebook_auth SDK>" }
```

Behavior mirrors Google: verify via Facebook Graph API (`/debug_token`), extract
profile, find-or-create user, issue session.

### Constraints

- Do **not** modify or remove existing web OAuth routes
- Both endpoints added under the existing `Authentication` OpenAPI tag
- Request body schemas: `GoogleMobileLoginRequest`, `FacebookMobileLoginRequest`
- Reuse user-upsert logic from existing callback handlers — do not duplicate

## Options considered

| Option | Pros | Cons | Chosen? |
|---|---|---|---|
| Native SDK token verification (this design) | Clean JSON response; standard mobile OAuth pattern | Requires separate OAuth client IDs per platform | ✓ |
| OAuth redirect via WebView | Reuses existing web routes | Does not cleanly return JSON to Flutter | ✗ |
| Custom deep-link handling | — | Complex, platform-specific, error-prone | ✗ |

## Consequences

**Positive:**
- Flutter client gets a native OS-level account picker instead of a WebView redirect
- Reuses existing account-linking and session-issuing logic — no duplicated auth paths

**Negative / Trade-offs accepted:**
- Requires separate OAuth client IDs registered for Android and iOS in Google
  Cloud Console and Facebook Developer Console

**Risks / Open questions:**
- Are Android/iOS OAuth client IDs and Facebook app secret already configured?
  If not, flag as a prerequisite before implementing.

## Definition of done

- [ ] `POST /v1/auth/google/mobile` implemented and verified against Google's public keys
- [ ] `POST /v1/auth/facebook/mobile` implemented and verified via Facebook Graph API
- [ ] Both reuse existing find-or-create/account-linking logic (no duplication)
- [ ] Existing web OAuth routes unmodified
- [ ] Android/iOS/Facebook OAuth client IDs confirmed configured

## Log

- 2026-08-01 proposed — migrated from RFC-0001 to this work item format

---

> **For AI agents:** Do NOT implement this work item unless status is
> `accepted` or `building`. If status is `proposed`, surface it to the user
> for a decision before writing any code. If status is `superseded`, follow
> the item in `superseded-by` instead — do NOT implement the pattern
> described here. If you are about to contradict an `accepted`, `building`,
> `shipped`, or `operating` item, stop and surface it to the user before
> proceeding.
