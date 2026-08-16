---
id: 0018
title: "Admin endpoints to unlock and deactivate/reactivate user accounts"
status: shipped
kind: feature
opened: 2026-08-16
decided: 2026-08-16
branch: feature/0018-admin-unlock-deactivate-users
supersedes: ~
superseded-by: ~
---

# WORK-0018 — Admin endpoints to unlock and deactivate/reactivate user accounts

| | |
|---|---|
| **Opened** | 2026-08-16 |
| **Status** | shipped |
| **Kind** | feature |
| **Supersedes** | — |
| **Superseded by** | — |

> **Companion item:** expense-tracker `context/work/0020-admin-unlock-deactivate-users-ui.md`
> — the admin UI buttons that call these endpoints.

## Problem

`loginWithEmail()` in `auth.service.ts` locks an account for 15 minutes
after 5 failed password attempts (`failed_login_attempts` /
`locked_until`), but nothing ever clears that lock except waiting it out.
`unlockAccount()` already existed in `auth.service.ts` but was never
imported by any route — an admin had no way to unlock a user. Same gap for
`deactivateAccount()`/`reactivateAccount()`: admins had no way to disable a
compromised or offboarded user's access, or restore it, even though the
service functions — and matching frontend client code in `userApi.ts` /
`useUsers.ts` — already existed on both sides, just never wired together.

Separately, discovered while verifying the unlock endpoint:
`computeStatus()` in `user.service.ts` (and the identical `CASE`
expression in the paginated list query) checked `is_active` before
`locked_until`. Since lockout never touches `is_active`, the `'locked'`
branch was unreachable dead code — the API always reported a locked
account as `'active'`, even though login was actually blocked at the DB
level. The unlock feature is meaningless without this being correct, since
the admin UI decides whether to show the unlock action based on this
status.

## Decision

Add three admin-only `POST` endpoints on the existing `/v1/users/{id}`
resource, each a thin wrapper around the already-written service
functions:

- `POST /v1/users/{id}/unlock` → `unlockAccount(id)`, gated by `user.unlock`
- `POST /v1/users/{id}/deactivate` → `deactivateAccount(id)` (also revokes
  all refresh tokens), gated by `user.deactivate`
- `POST /v1/users/{id}/activate` → `reactivateAccount(id)`, gated by
  `user.deactivate` (no separate `user.activate` permission exists in the
  permissions table, and re-enabling is the same admin capability as
  disabling)

All three return the updated `UserWithRoles`, matching the existing
`GET`/`PUT` handler response shape.

Fixed `computeStatus()` and the list-query `CASE` expression to check
`locked_until` before falling back to the `is_active`-derived branches, so
`'locked'` is reachable while `'inactive'`/`'pending_verification'` still
take precedence over a stale lock on an already-deactivated account.

## Options considered

| Option | Pros | Cons | Chosen? |
|---|---|---|---|
| Wire existing `unlockAccount`/`deactivateAccount`/`reactivateAccount` to new routes | Reuses already-written, already-correct service logic; minimal surface area | None significant | ✓ |
| Fold unlock/deactivate into the general `PUT /users/{id}` update endpoint (e.g. a `status` field) | One fewer route | Conflates a targeted admin action with the general profile-edit form; can't gate it on its own permission separately from `user.edit` | ✗ |
| Single `POST /users/{id}/status` endpoint taking a target status | Fewer routes | Loses the specific permission gating — `user.unlock` and `user.deactivate` are separate, intentionally scoped permissions already defined in the permissions table | ✗ |

## Consequences

**Positive:**
- Closes a real support gap: locked-out users previously had no recourse
  but to wait 15 minutes; deactivated/offboarded users' access could not
  be revoked or restored via the admin UI at all
- `status: "locked"` is now accurate, which the admin UI depends on to
  decide when to show the unlock/deactivate/activate actions

**Negative / Trade-offs accepted:**
- No self-protection guard against an admin deactivating their own
  account — consistent with the existing `DELETE /users/{id}`, which has
  the same gap; not introduced as new scope here

**Risks / Open questions:**
- None new

## Definition of done

- [x] `POST /v1/users/{id}/unlock` clears `failed_login_attempts`/`locked_until`, verified live: locked a real account via 5 failed logins, confirmed `status: "locked"`, unlocked via the endpoint, confirmed `status: "active"` and login succeeds again
- [x] `POST /v1/users/{id}/deactivate` and `/activate` verified live end-to-end: deactivated a real account, confirmed login is rejected with "Account is deactivated", reactivated, confirmed login succeeds again
- [x] All three routes reject non-privileged callers with `403` (`Missing required permissions`)
- [x] `computeStatus()` / list-query fix verified against all seed users — a deactivated user still reports `inactive`, a genuinely locked user correctly reports `locked` while the lock is active
- [x] `tsc --noEmit` clean

## Log

- 2026-08-16 proposed, accepted, building — user asked whether the admin
  could unlock a locked-out user; investigation found `unlockAccount()`
  already written but orphaned (no route, no frontend wiring). Implemented
  and verified live. While verifying, discovered `computeStatus()` had
  `is_active` checked before `locked_until`, making the `'locked'` status
  unreachable — fixed in the same change since the unlock feature is
  meaningless without it. User then asked whether admins should also be
  able to deactivate/lock a user out of the app entirely — found
  `deactivateAccount()`/`reactivateAccount()` in the same orphaned state,
  with matching frontend client code already stubbed. Implemented and
  verified live the same way.
- 2026-08-16 shipped — merged to `main` (PR #11), confirmed with
  `git merge-base --is-ancestor` against `origin/main` and a content grep
  for the `/unlock`/`/deactivate`/`/activate` routes on `origin/main`'s
  `src/routes/users.ts`, not just the PR's "Merged" label.

---

> **For AI agents:** Do NOT implement this work item unless status is
> `accepted` or `building`. If status is `proposed`, surface it to the user
> for a decision before writing any code. If status is `superseded`, follow
> the item in `superseded-by` instead — do NOT implement the pattern
> described here. If you are about to contradict an `accepted`, `building`,
> `shipped`, or `operating` item, stop and surface it to the user before
> proceeding.
