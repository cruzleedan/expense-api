---
id: 0003
title: "JWT auth: Bearer access token + HttpOnly cookie refresh token"
status: accepted
kind: infra
opened: 2026-08-01
decided: 2026-08-01
branch: ~
supersedes: ~
superseded-by: ~
---

# WORK-0003 — JWT auth: Bearer access token + HttpOnly cookie refresh token

| | |
|---|---|
| **Opened** | 2026-08-01 |
| **Status** | accepted |
| **Kind** | infra |
| **Supersedes** | — |
| **Superseded by** | — |

## Problem

The API serves both a web SPA client and a Flutter mobile client. Auth needs to
be stateless (no server-side session store) and support token refresh without
requiring re-login.

## Decision

Two-token JWT pattern using the **`jose`** library:

1. **Access token** — short-lived JWT, sent by client as `Authorization: Bearer <token>`
2. **Refresh token** — longer-lived JWT, stored as an **HttpOnly cookie** (web)
   or in secure storage (mobile)

## Options considered

| Option | Pros | Cons | Chosen? |
|---|---|---|---|
| Access + HttpOnly refresh cookie | Refresh token not accessible to JS (XSS protection); stateless | Cookie not usable by Flutter mobile without extra handling | ✓ |
| Single long-lived access token | Simpler | Token cannot be revoked without a blocklist; long exposure window | ✗ |
| Session-based (server-side store) | Revocable | Requires Redis/DB for sessions; not stateless | ✗ |

## Consequences

**Positive:**
- Refresh token in HttpOnly cookie is not accessible to JavaScript — XSS cannot
  steal it
- Stateless — API servers are horizontally scalable

**Negative / Trade-offs accepted:**
- CORS must have `credentials: true` on relevant endpoints
- Flutter mobile client receives the refresh token cookie but must handle it
  differently from web (see WORK-0004, mobile auth)
- `jose` is used (not `jsonwebtoken`) — async API, JWKS-compatible

**Risks / Open questions:**
- None outstanding.

## Definition of done

- [x] Access token expiry configured via `JWT_ACCESS_EXPIRES` env var
- [x] Refresh token expiry configured via `JWT_REFRESH_EXPIRES`
- [x] `jose` library used for signing/verification (not `jsonwebtoken`)
- [x] Refresh endpoint sets the new refresh token as an HttpOnly cookie

## Log

- 2026-08-01 accepted — decision made at project inception; migrated from
  ADR-0003 to this work item format

## Implementation Notes

```typescript
// Verify access token (middleware)
import { authMiddleware } from '../middleware/auth.js';
router.use('*', authMiddleware);

// Get authenticated user ID
import { getUserId } from '../middleware/auth.js';
const userId = getUserId(c); // throws UnauthorizedError if not set
```

---

> **For AI agents:** Do NOT implement this work item unless status is
> `accepted` or `building`. If status is `proposed`, surface it to the user
> for a decision before writing any code. If status is `superseded`, follow
> the item in `superseded-by` instead — do NOT implement the pattern
> described here. If you are about to contradict an `accepted`, `building`,
> `shipped`, or `operating` item, stop and surface it to the user before
> proceeding.
