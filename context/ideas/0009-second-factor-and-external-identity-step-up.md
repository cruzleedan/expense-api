---
id: IDEA-0009
title: "Design second-factor and external-identity step-up assurance"
status: exploring
opened: 2026-09-15
promoted-to: ~
---

# IDEA-0009 — Design second-factor and external-identity step-up assurance

## Opportunity

WORK-0029 now checks recent server-side session assurance for the legacy
`requires_mfa` flag. Its implemented ceremony rechecks a local password: it is
not second-factor MFA. OAuth-only accounts cannot establish that evidence, so
their protected actions fail closed. We need to shape actual factor assurance
and provider-backed reauthentication without mislabeling password checks as MFA.

## Hypothesis

A documented assurance model can let ERP users perform protected actions with
appropriate identity proof while keeping enrollment, recovery, and OAuth account
linking from becoming new privilege-bypass paths.

## Capability sketch

- Explicit assurance methods and levels instead of treating every ceremony as MFA.
- Evaluate enrolled factors, such as passkeys or authenticator challenges, and
  determine which satisfy each permission's required assurance.
- An accepted provider-backed step-up flow for OAuth users, with server-verified
  freshness, identity/session binding, and replay protection.
- Controlled enrollment, factor removal, recovery, and emergency procedures;
  never automatic OAuth-to-password conversion or a client-supplied timestamp.
- Frontend/mobile/MCP challenge and retry contracts, expiry behavior, and audit
  records for successful, failed, and recovery ceremonies.

## Questions to shape

- Which ERP actions require a second factor versus recent reauthentication?
- Which assurance evidence can each configured identity provider supply and
  which actions may accept it?
- What are the session lifetime, rotation, revocation, and factor-change rules?
- Who owns recovery approvals, and how is the final control-plane admin recovered
  without a public API bypass?
- Which factor options fit browser, mobile, and MCP user journeys?
- Should the legacy flag be renamed or evolved to an explicit assurance policy?

## Promotion criteria

- [ ] Business/security owners and protected-action matrix identified.
- [ ] Assurance levels, accepted methods, and provider evidence agreed.
- [ ] Enrollment/recovery threat model and audit requirements assessed.
- [ ] Client and session-lifecycle contracts agreed.
- [ ] Promoted to an accepted work item or explicitly parked/rejected.

## Related records

- [WORK-0029](../work/0029-atomic-rbac-sod-and-step-up-controls.md) — shipped
  session-bound password reauthentication, not true MFA.
- [WORK-0030](../work/0030-harden-authentication-oauth-and-session-lifecycle.md) —
  proposed identity/session hardening; coordinate with its eventual design.

## Log

- 2026-09-15 exploring — captured the explicit password-versus-MFA distinction
  and OAuth-only assurance gap while completing WORK-0029.

---

> **For AI agents:** An idea is not implementation authorization. Do not weaken
> fail-closed step-up checks or introduce new factors without an accepted design.
