---
id: 0028
title: "Lock down account bootstrap and user administration"
status: shipped
kind: fix
opened: 2026-09-14
decided: 2026-09-14
branch: feature/0023-report-list-permission-scope
supersedes: ~
superseded-by: ~
---

# WORK-0028 — Lock down account bootstrap and user administration

| | |
|---|---|
| **Opened** | 2026-09-14 |
| **Status** | shipped |
| **Kind** | fix |
| **Severity** | P0 — release blocker |
| **Supersedes** | — |
| **Superseded by** | — |

## Problem

Public registration creates an active user and issues tokens even though
`users.is_verified` defaults false. Login checks `is_active` but not verification
(`src/services/auth.service.ts:266-317,338-421`).

In `src/routes/users.ts`, list, create, get, update, delete, get/set/add/remove
roles are protected only by the router-wide authentication middleware. Only
unlock/deactivate/reactivate have explicit permissions. A newly registered user
can list users and role identifiers, then assign a privileged role to themself.
This turns an authenticated authorization defect into an internet-reachable
self-super-admin chain.

## Decision

Accepted: define an explicit permission and resource-scope matrix for every user
administration route; remove or delegate duplicate role-mutation paths to the
canonical RBAC policy service. Until the matrix ships, use invite/admin-created
registration or otherwise prevent unverified public accounts from authenticating.

## Options considered

| Option | Pros | Cons | Chosen? |
|---|---|---|---|
| Permission middleware plus service-level policy | Defense in depth; testable | Requires route inventory | ✓ accepted |
| Hide administrative UI only | No API change | Trivially bypassed | ✗ |
| Require a single admin role string | Simple | Bypasses granular permission design | ✗ |

## Consequences

**Positive:** closes self-escalation and user-directory disclosure.

**Negative / Trade-offs:** onboarding and support flows need explicitly assigned
capabilities rather than relying on “any logged-in user.”

**Risks / Open questions:** decide whether public self-registration is a product
requirement and define verification/invitation ownership.

For this release, the decision is admin-provisioned onboarding. Public password
registration and first-time OAuth account creation fail closed. Administrator-
created users are marked verified; every token issue and validation path checks
that the account remains both active and verified.

## Definition of done

- [x] Every `/v1/users` operation has an explicit permission and scope.
- [x] A user cannot assign, replace, or remove their own roles without a
      deliberately approved break-glass policy.
- [x] Duplicate role routes use one transactional RBAC mutation service; deeper
      SoD and step-up work remains tracked by `WORK-0029`.
- [x] Unverified or uninvited accounts cannot obtain normal access tokens.
- [x] Tests cover anonymous, employee, manager, HR/admin, and super-admin actors.
- [x] A public-registration-to-admin regression test fails closed.

## Log

- 2026-09-14 proposed — confirmed during authorization audit.
- 2026-09-14 accepted — immediate release blocker implementation approved.
- 2026-09-14 building — applying route capabilities, self-role protections, and
  admin-provisioned account bootstrap.
- 2026-09-14 shipped — user administration now has explicit capability gates and
  resource scope; role mutations share a transactional service boundary; token
  issue/validation requires active verified accounts; 14 repository tests pass.
- 2026-09-15 deployed — production image rebuilt; live registration probe returns
  403 and the replacement container is healthy.

---

> **For AI agents:** This item is shipped. Do not reopen public registration
> without an accepted verification or invitation design.
