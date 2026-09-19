---
id: 0048
title: "Agree account retention, deletion, and pseudonymization policy"
status: proposed
kind: spike
opened: 2026-09-15
decided: ~
branch: ~
supersedes: ~
superseded-by: ~
---

# WORK-0048 — Agree account retention, deletion, and pseudonymization policy

## Problem

The legacy self-service deletion endpoint creates a login session, catches every
delete failure as a financial-retention conflict, and claims personal data was
removed while identifiers/credentials remain. WORK-0030 implements endpoint
closure under explicit approval (production cutover pending); it does not choose
an erasure/retention policy.

## Decision

Proposed: inventory account, identity, credential, receipt, financial, audit,
request-metadata, export, and backup data. Agree retention authority, periods,
legal holds, permitted deletion/pseudonymization, credential/session revocation,
operator controls, and accurate user-facing outcomes before enabling deletion.
No legal compliance or completed erasure is asserted by endpoint closure.

## Definition of done

- [ ] Data owners approve a retention/erasure matrix including financial/audit data.
- [ ] Identity/credential/session handling, legal holds, backups and export retention are defined.
- [ ] Approved deletion/request/operator workflows preserve last-admin and audit invariants.
- [ ] User responses distinguish requests, deactivation, retention, pseudonymization, and actual erasure.
- [ ] Promote the implementation and credential-only/expected-conflict/no-session-side-effect regressions to accepted work.

## References

- [WORK-0030](0030-harden-authentication-oauth-and-session-lifecycle.md) — interim endpoint closure.

## Log

- 2026-09-15 proposed — recorded the user-approved deferral of retention design
  from WORK-0030. No deletion/pseudonymization implementation approved or performed.
