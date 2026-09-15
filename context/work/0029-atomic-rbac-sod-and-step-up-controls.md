---
id: 0029
title: "Make RBAC, separation of duties, and step-up controls authoritative"
status: proposed
kind: fix
opened: 2026-09-14
decided: ~
branch: ~
supersedes: ~
superseded-by: ~
---

# WORK-0029 — Make RBAC, separation of duties, and step-up controls authoritative

| | |
|---|---|
| **Opened** | 2026-09-14 |
| **Status** | proposed |
| **Kind** | fix |
| **Severity** | P1 security/control integrity |
| **Supersedes** | — |
| **Superseded by** | — |

## Problem

Role assignment/removal and `roles_version` invalidation are separate database
operations in both permission and user services. `deleteRole` relies on cascade
but does not increment affected users' versions. A crash can therefore revoke a
role while an old privileged JWT remains valid. Editing/deleting a permission
that is already assigned has the same invalidation requirement and is not
consistently tied to affected users.

SoD is also non-authoritative: role create/update routes do not call
`validateRolePermissionChange`; replacement validation unions old and new
permissions; role-set validation unions current and replacement roles; checks
run outside the mutation transaction. `permissions.requires_mfa` is stored but
never enforced, and nothing prevents removal of the final control-plane admin
(`src/services/permission.service.ts:481-558,704-880`).

## Decision

Proposed: route every role/permission mutation through one policy service and one
transaction. Lock affected users/roles, simulate the final effective permission
set, evaluate SoD, mutate assignments, and invalidate tokens atomically. Enforce
a last-admin invariant and step-up authentication for flagged permissions.

## Options considered

| Option | Pros | Cons | Chosen? |
|---|---|---|---|
| Transactional final-state policy evaluation | Correct for add/set/edit/delete | More locking and tests | ✓ proposed |
| Keep preflight validators | Easy | Race-prone and semantically wrong for replacement | ✗ |
| Periodic SoD audit only | Detects drift | Does not prevent toxic access | supplemental |

## Consequences

**Positive:** token claims, role state, SoD, and administrator survivability agree.

**Negative / Trade-offs:** mutations may serialize on high-risk roles/users;
step-up requires an authentication ceremony and timestamped assurance claim.

**Risks / Open questions:** define break-glass ownership, logging, duration, and
whether MFA is required globally for critical operations.

## Definition of done

- [ ] Role and permission assign/add/remove/set/delete/edit operations are atomic
      with invalidation of every affected user's tokens.
- [ ] SoD evaluates the exact post-mutation effective permission set.
- [ ] Updating a role validates every assigned user's final permissions.
- [ ] The final active super-admin/control-plane principal cannot be removed.
- [ ] `requires_mfa` is enforced using recent step-up evidence, not token metadata.
- [ ] Concurrency tests prove no stale privileged token survives a committed change.
- [ ] Every mutation is included in the audit transaction (`WORK-0042`).

## Log

- 2026-09-14 proposed — confirmed during RBAC and SoD audit.

---

> **For AI agents:** Do NOT implement while this item is `proposed`.
