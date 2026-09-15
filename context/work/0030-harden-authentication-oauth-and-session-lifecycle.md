---
id: 0030
title: "Harden authentication, OAuth identity, and session lifecycle"
status: proposed
kind: fix
opened: 2026-09-14
decided: ~
branch: ~
supersedes: ~
superseded-by: ~
---

# WORK-0030 — Harden authentication, OAuth identity, and session lifecycle

| | |
|---|---|
| **Opened** | 2026-09-14 |
| **Status** | proposed |
| **Kind** | fix |
| **Supersedes** | — (candidate successor to WORK-0003) |
| **Superseded by** | — |

## Problem

The accepted token design in WORK-0003 needs corrective evolution:

- access tokens without `roles_version` skip database checks for user existence,
  activity, and role invalidation;
- refresh verification, revocation, and replacement are separate operations, so
  concurrent refreshes can both succeed; no token family/reuse containment exists;
- concurrent-session enforcement is query/revoke/create rather than atomic;
- registration/OAuth user creation, default role assignment, and token creation
  can partially complete;
- OAuth auto-links an existing account by email without local reauthentication,
  Google flows do not consistently require verified email, and `(provider, id)`
  is a non-unique single slot on `users`;
- auth routes do not pass supported IP/user-agent metadata; refresh cookie age is
  hardcoded to seven days instead of using configured token expiry;
- public and administrator password rules disagree (12-character complexity vs
  8 characters);
- delete-account authenticates through normal login (creating a session), catches
  every delete error as “has reports,” and calls an incomplete anonymization that
  retains identifiers and credentials while claiming personal data was removed.

## Decision

Proposed: require versioned tokens and current-user validation, implement atomic
one-time refresh rotation with token families, normalize account creation and
session limits into transactions, and move external identities into a unique
`user_identities(provider, subject)` table. Account linking must require verified
provider identity plus explicit proof for an existing local account.

## Options considered

| Option | Pros | Cons | Chosen? |
|---|---|---|---|
| Correct current JWT/cookie design | Fits current stack and WORK-0003 | Requires migration and client coordination | ✓ proposed |
| Adopt Passport/session stack from WORK-0006 | Large ecosystem | Previously rejected; unnecessary | ✗ |
| Accept refresh races until expiry | No work | Replay and session-limit controls remain false assurances | ✗ |

## Consequences

**Positive:** predictable revocation, safe identity linking, accurate session data.

**Negative / Trade-offs:** existing legacy tokens must be expired through a
controlled cutover; clients may need refresh-error recovery.

**Risks / Open questions:** define email verification provider, deletion/legal
retention policy, and whether mobile refresh remains cookie or body based.

## Definition of done

- [ ] Legacy access tokens are rejected after a documented cutover.
- [ ] Refresh is atomic and replay revokes the relevant token family.
- [ ] Session cap is enforced atomically and has deterministic eviction semantics.
- [ ] OAuth subject identity is unique per provider and multiple identities can link.
- [ ] Provider email verification and explicit existing-account linking are enforced.
- [ ] Account creation, default role, and first session cannot partially commit.
- [ ] IP/user-agent and cookie expiry match trusted request/config data.
- [ ] One password policy is reused by every password-creation/reset path.
- [ ] Account deletion uses a credential check without login side effects, catches
      only expected conflicts, and follows an agreed retention/pseudonymization policy.
- [ ] Concurrent refresh, OAuth collision, disabled-user, and deletion tests exist.

## Log

- 2026-09-14 proposed — corrective successor drafted during architecture audit.

---

> **For AI agents:** Do NOT implement while this item is `proposed`. If accepted,
> reconcile and update WORK-0003's status rather than silently contradicting it.
