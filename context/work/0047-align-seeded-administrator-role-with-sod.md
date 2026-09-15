---
id: 0047
title: "Align the seeded administrator role with separation-of-duties policy"
status: proposed
kind: fix
opened: 2026-09-15
decided: ~
branch: ~
supersedes: ~
superseded-by: ~
---

# WORK-0047 — Align the seeded administrator role with separation-of-duties policy

## Problem

The seeded system `admin` role uses a broad permission denylist that gives it
three combinations prohibited by the active SoD rules:

- `report.edit.all` + `report.approve` — Approval Fraud.
- `report.approve` + `report.post` — Financial Bypass.
- `audit.export` + `report.edit.all` — Evidence Tampering.

This was confirmed both in `src/db/schema.sql` and by read-only inspection of
the live role grants on 2026-09-15. The inconsistency predated WORK-0029; its
authoritative final-state enforcement now rejects assigning `admin` to an
ordinary user. It also rejects retaining conflicting access during a role-set
change. Existing assignments were not retroactively revoked, and system roles
cannot be edited through the API. The only accepted preventive-SoD exemption is
the active system `super_admin` role, not `admin`.

Severity: P1 control-policy/catalog consistency and administration usability.

## Decision

Proposed: agree a compliant control-plane administrator capability set, replace
the seeded denylist with an explicit grant set, and migrate existing grants and
assignments with policy simulation, token invalidation, and audit. Report
approval, posting/payment, and evidence administration must have agreed owners.
Do not weaken SoD or extend the super-admin exemption to repair this implicitly.

## Options considered

| Option | Benefit | Trade-off |
|---|---|---|
| Compliant administrator allowlist | Explicit, testable scope | Requires business ownership and data migration |
| Split administration into narrower system roles | Stronger responsibility boundaries | More assignment and client coordination |
| Exempt ordinary administrators | Restores current broad access | Weakens preventive controls; requires an explicit risk decision |

## Questions to resolve

- Which report and audit actions genuinely belong to ordinary administrators?
- Should role creation and elevated-role assignment be separate operators?
- How should existing users with conflicting role combinations be remediated
  without disrupting approval queues or losing the final control-plane admin?
- Which clients assume that the role named `admin` grants financial capabilities?

## Definition of done

- [ ] Approved administrator capability matrix and responsibility owners exist.
- [ ] Bootstrap grants and existing-database migration match that matrix.
- [ ] Ordinary seeded roles individually satisfy active SoD rules; the explicit
      super-admin exception is tested and documented.
- [ ] Existing affected users are simulated, remediated, audited, and invalidated
      transactionally, preserving the final-admin invariant.
- [ ] Role assignment and replacement tests cover seeded administrator roles,
      combined-role conflicts, and client compatibility.
- [ ] Deployment evidence and outstanding coordination gates are recorded.

## Related records

- [WORK-0029](0029-atomic-rbac-sod-and-step-up-controls.md) — authoritative policy
  enforcement; this follow-up does not undo its accepted controls.
- [WORK-0040](0040-central-authorization-matrix-and-openapi-contract.md) — broader
  capability and client-contract alignment, still a separate proposal.

## Log

- 2026-09-15 proposed — captured the seeded administrator/SoD mismatch during
  WORK-0029 final verification; no grant changes or retroactive revocations made.

---

> **For AI agents:** Do not implement while proposed. This item needs an explicit
> capability/migration decision; do not add an administrator SoD bypass silently.
