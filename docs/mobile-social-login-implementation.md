# Mobile Social Login — Implementation Status

Implements the spec in [mobile-social-login.md](./mobile-social-login.md).

## Summary

| Item | Status |
|---|---|
| `POST /v1/auth/google/mobile` | ✅ Implemented |
| `POST /v1/auth/facebook/mobile` | ✅ Implemented |
| Existing OAuth routes (`/google`, `/google/callback`, `/facebook`, `/facebook/callback`, `/login`) | ✅ Unchanged |
| Account-linking reuse via `loginWithOAuth` | ✅ Implemented |
| OpenAPI documentation | ✅ Implemented |
| Google mobile OAuth client IDs configured | ⚠️ Skipped — needs setup |
| Facebook app secret configured | ⚠️ Skipped — needs setup |
| Apple / Sign in with Apple | ❌ Not in scope |
| X / Twitter | ❌ Not in scope |

## What's implemented

### `POST /v1/auth/google/mobile`

- **Route**: [src/routes/auth.ts](../src/routes/auth.ts)
- **Request**: `{ "idToken": "<Google ID token>" }` (`GoogleMobileLoginRequestSchema` in [src/schemas/auth.ts](../src/schemas/auth.ts))
- **Verification**: `verifyGoogleIdToken()` in [src/services/auth.service.ts](../src/services/auth.service.ts)
  - Uses `jose.createRemoteJWKSet('https://www.googleapis.com/oauth2/v3/certs')` to fetch and cache Google's public keys
  - Verifies the JWT signature, `iss` (`accounts.google.com` / `https://accounts.google.com`), and `aud` against `GOOGLE_MOBILE_CLIENT_IDS`
  - Extracts `sub` (Google user id) and `email` from verified claims
- **User resolution**: `loginWithOAuth('google', sub, email)` — identical function used by `/auth/google/callback`, so a user who signed up via web Google OAuth resolves to the same account on mobile
- **Response**: `200 AuthResponse` (`{ user, accessToken }`) + `refreshToken` HttpOnly cookie, same as `/auth/login`
- **Errors**: any verification failure (bad signature, wrong audience/issuer, expired, missing config) → `400 VALIDATION_ERROR`

### `POST /v1/auth/facebook/mobile`

- **Route**: [src/routes/auth.ts](../src/routes/auth.ts)
- **Request**: `{ "accessToken": "<Facebook access token>" }` (`FacebookMobileLoginRequestSchema`)
- **Verification**: `verifyFacebookAccessToken()` in [src/services/auth.service.ts](../src/services/auth.service.ts)
  - Calls Graph API `GET /debug_token?input_token=<token>&access_token=<app_id>|<app_secret>`
  - Confirms `data.is_valid === true` and `data.app_id === FACEBOOK_CLIENT_ID`
  - Fetches `GET /me?fields=id,email&access_token=<token>` for profile data
- **User resolution**: `loginWithOAuth('facebook', id, email)` — same as `/auth/facebook/callback`
- **Response**: `200 AuthResponse` + `refreshToken` cookie, same as `/auth/login`
- **Errors**: invalid/expired token, app mismatch, or missing email → `400 VALIDATION_ERROR`

### Shared behavior

Both endpoints:
- Are registered under the `Authentication` tag in the OpenAPI spec
- Reuse `setRefreshTokenCookie()` (same cookie config as web flows: `httpOnly`, `sameSite=Lax`, 7-day `maxAge`)
- Reuse `loginWithOAuth()` for find-or-create / account-linking — no duplicated user-upsert logic
- Do not touch `/auth/google`, `/auth/google/callback`, `/auth/facebook`, `/auth/facebook/callback`, or `/auth/login`

## What's skipped / needs setup

### Google mobile OAuth client IDs

`GOOGLE_MOBILE_CLIENT_IDS` (new env var, in [.env](../.env) and [.env.example](../.env.example)) is currently **empty**. Until set, `/auth/google/mobile` returns:

```json
{ "error": { "message": "Google mobile sign-in not configured", "code": "VALIDATION_ERROR" } }
```

To enable:
1. In Google Cloud Console, register separate OAuth client IDs for the Android package name and iOS bundle ID (these are distinct from the existing "Web application" client ID used by `/auth/google`).
2. Set `GOOGLE_MOBILE_CLIENT_IDS` to a comma-separated list of those client IDs (e.g. `android-client-id.apps.googleusercontent.com,ios-client-id.apps.googleusercontent.com`). The `aud` claim of ID tokens issued by `google_sign_in` must match one of these.

### Facebook app secret

`/auth/facebook/mobile` reuses the existing `FACEBOOK_CLIENT_ID` / `FACEBOOK_CLIENT_SECRET` env vars (no new var added). If these are unset, the endpoint returns:

```json
{ "error": { "message": "Facebook mobile sign-in not configured", "code": "VALIDATION_ERROR" } }
```

To enable: ensure `FACEBOOK_CLIENT_ID` and `FACEBOOK_CLIENT_SECRET` are populated with the app's credentials from the Facebook Developer Console (same app used for the web OAuth flow — Graph API's `/debug_token` works across platforms for a given app).

### Out of scope

- **Apple / Sign in with Apple** and **X/Twitter** mobile login were not requested by the spec and are not implemented.

## Verification performed

- `npx tsc --noEmit` — clean
- Both endpoints confirmed registered in `/openapi.json` under `Authentication`
- Live requests against the running dev container return `400 VALIDATION_ERROR` with the "not configured" messages above (expected, since the new env vars are unset)
