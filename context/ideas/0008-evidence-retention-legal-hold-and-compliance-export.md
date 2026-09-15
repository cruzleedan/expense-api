---
id: IDEA-0008
title: "Evidence retention, legal hold, and compliance export"
status: exploring
opened: 2026-09-14
promoted-to: ~
---

# IDEA-0008 — Evidence retention, legal hold, and compliance export

## Opportunity

Receipts, approval history, audit rows, LLM prompts, and personal information have
different legal and operational retention needs. Current hard/soft deletion and
account “anonymization” do not implement a coherent retention or legal-hold model.

## Hypothesis

A classified retention framework would preserve required financial evidence,
honor deletion/privacy obligations, and make audits/export reproducible.

## Capability sketch

- Data classification and retention schedule by entity, jurisdiction, and record type.
- Immutable evidence package for a posted report: calculation/policy/workflow/
  receipt/audit hashes and relevant snapshots.
- Legal hold overriding scheduled disposition with authorization and reason.
- Pseudonymization separating retained financial facts from login identifiers.
- Permissioned export manifest with checksums, chain/signature verification, and redaction.
- Disposition jobs with dry run, approval, audit, and reconciliation.

## Questions to shape

- Which jurisdictions and statutory retention periods apply?
- What personal data may/must remain on financial evidence?
- Who may create/release legal holds and exports?
- Are LLM prompts/responses evidence, operational telemetry, or disposable content?

## Promotion criteria

- [ ] Legal/privacy/finance owners approve classification and schedule.
- [ ] Evidence package and export consumer/use case are defined.
- [ ] Legal-hold and disposition authorization/SoD are agreed.
- [ ] Storage immutability, key management, and deletion feasibility are assessed.

## Related records

- WORK-0030, WORK-0035, WORK-0042, WORK-0043.

## Log

- 2026-09-14 exploring — captured from compliance architecture review.

---

> **For AI agents:** This idea is not authorization to implement.

