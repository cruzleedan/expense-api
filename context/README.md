# Expense API context records

This directory separates decisions, exploratory ideas, dated evidence, reusable
skills, and review friction:

| Location | Purpose | Implementation authority |
|---|---|---|
| `work/` | Numbered decisions, fixes, features, migrations, infrastructure, and spikes | Only `accepted` or `building` items authorize implementation |
| `ideas/` | Early ERP or architecture opportunities that still need business/design shaping | Never; promote to a work item first |
| `reviews/` | Dated observations and finding indexes | Never by itself; recheck current code and follow linked work status |
| `skills/` | Project-specific implementation procedures | Follow when the task matches |
| `agents/` | Project-specific review roles/checklists | Guidance only |
| `friction.md` | Context/process problems rather than application defects | Triage separately |
| `reference/implementation-playbook.md` | Mandatory, maintained work-item implementation procedure | Procedural guidance |
| `reference/release-quality-gates.md` | Clean dependency verification, isolated database suites, OpenAPI/SBOM/audit and rollout policy | Procedural guidance; transferred coverage criteria live in WORK-0034/0040/0041 |

The 2026-09-14 defect and architecture review is indexed in
`reviews/2026-09-14-expense-api-architecture-audit.md`. It created proposed
`WORK-0027` through `WORK-0045` and exploratory `IDEA-0001` through
`IDEA-0008`. The four immediate blockers, WORK-0027, WORK-0028, WORK-0032,
and WORK-0033, shipped on 2026-09-15; all individual records remain
authoritative and this index does not approve any proposed follow-on item.

WORK-0046 codifies the durable implementation and verification process learned
while shipping those blockers. Future implementation sessions must start with
`reference/implementation-playbook.md` rather than reconstructing the process
from the dated audit.

WORK-0045's dependency and release-quality infrastructure shipped on 2026-09-15.
The user approved transferring its full authorization-matrix, exact-money/
owner-scoped sync-race, and multi-worker job-idempotency requirements to
WORK-0040, WORK-0034, and WORK-0041. Those items retain unchecked mandatory CI
criteria and remain proposed; coverage ownership is not implementation approval
or proof of full ERP release readiness.
