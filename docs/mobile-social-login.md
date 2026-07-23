Add mobile-friendly Google and Facebook sign-in endpoints to the expense-api backend.

## Context

The API currently has server-driven OAuth redirect flows for web:
- `GET /v1/auth/google` → 302 redirect to Google consent screen
- `GET /v1/auth/google/callback` → handles callback, returns `AuthResponse`
- `GET /v1/auth/facebook` → 302 redirect to Facebook consent screen
- `GET /v1/auth/facebook/callback` → handles callback, returns `AuthResponse`

These work for web but are not practical for a Flutter mobile app — there's no way
to cleanly receive a JSON response from inside a WebView mid-redirect-chain.

Mobile apps instead use native SDKs (`google_sign_in`, `flutter_facebook_auth`) to
obtain an ID token / access token directly from the OS-level Google/Facebook
account picker, then send that token to the backend for verification.

## Required new endpoints (additive — do not modify existing OAuth routes)

### `POST /v1/auth/google/mobile`

Request body:
```json
{ "idToken": "<Google ID token from native google_sign_in SDK>" }
```

Behavior:
1. Verify the ID token against Google's public keys (audience = this app's
   Google OAuth client ID — there should be a separate "Android"/"iOS" OAuth
   client ID registered in Google Cloud Console alongside the existing web
   client ID used by `/auth/google`).
2. Extract `sub` (Google user id), `email`, `name`, `picture` from the verified
   token claims.
3. Find or create a user record by email — reuse the exact same account-linking
   logic as the existing `/auth/google/callback` handler (so a user who signed
   up via web Google OAuth and later uses the mobile app resolves to the same
   account).
4. Issue the same session as `/auth/login`:
   - Return `200` with `AuthResponse` (`{ user, accessToken }`)
   - Set the `refreshToken` as an HttpOnly cookie, identical to `/auth/login`
     and `/auth/google/callback`.
5. On invalid/expired/unverifiable token, return `400` with the existing
   `Error` schema.

### `POST /v1/auth/facebook/mobile`

Request body:
```json
{ "accessToken": "<Facebook access token from native flutter_facebook_auth SDK>" }
```

Behavior: mirrors the Google endpoint above —
1. Verify the access token against Facebook's Graph API (`/me` or
   `/debug_token` with the app's app secret) to confirm it's valid and issued
   for this app.
2. Extract user id, email, name, picture from the verified profile.
3. Find or create a user record by email — reuse the same account-linking
   logic as `/auth/facebook/callback`.
4. Issue session identically to `/auth/login` (200 + `AuthResponse` +
   `refreshToken` cookie).
5. On invalid token, return `400` with `Error` schema.

## Notes

- Both endpoints should be added under the existing `Authentication` tag in the
  OpenAPI spec, documented with request/response schemas matching the pattern
  above (request body schemas can be named `GoogleMobileLoginRequest` /
  `FacebookMobileLoginRequest`).
- Reuse existing account-linking / user-upsert logic from the web OAuth callback
  handlers rather than duplicating it — both flows should converge on the same
  user record for a given email/provider account.
- Do not change `/v1/auth/google`, `/v1/auth/google/callback`,
  `/v1/auth/facebook`, `/v1/auth/facebook/callback`, or `/v1/auth/login` —
  these are used by the existing web client and must keep working as-is.
- If Google/Facebook mobile OAuth client IDs/app secrets aren't already
  configured for this project, flag that as a setup step (these are typically
  separate credentials from the web client, registered in Google Cloud Console
  / Facebook Developer Console for the app's Android package name / iOS bundle
  ID).
