---
name: implement-work-item
description: "Implement an accepted expense-api work item from scope check through repository and authorized deployment verification."
applies-to: expense-api
---

## When to invoke

Use when the user asks to implement, finish, or ship one or more
`expense-api/context/work/` items. Do not use for read-only review or for shaping
an unapproved proposal.

## Required reference

Read `context/reference/implementation-playbook.md` completely before acting.
It is authoritative for the detailed procedure and durable local friction notes.

## Procedure

1. Read workspace/project instructions, releasing guidance, related work items,
   and Git status. Build an explicit ordered queue containing only authorized
   `accepted`/`building` work (or items the user explicitly approves now).
2. Advance the current item to `building` and append its log. Never silently
   include an adjacent proposed or superseded item.
3. Make one impact map: route, schema, permission/resource policy, service,
   transaction, SQL/Drizzle, side effects, and deployment boundary.
4. Implement the narrowest authoritative policy and test seam first, then wire
   callers. Keep state-dependent authorization, version checks, history, audit,
   and mutation within one transaction.
5. Run focused checks while editing. Before handoff run `npm run check` and
   review a work-item/path-scoped diff plus `git diff --check`.
6. If database or deployment work is in scope, use the relevant project skill,
   verify the exact target read-only, mutate only the authorized target, and run
   `npm run verify:deployment` where applicable.
7. Check the Definition of done, append verification/deployment/external-gate
   evidence, and only then mark `shipped`. Run the context verifier after edits.
8. Report implemented, deployed, operating, and release-ready states separately.

## Stop conditions

Stop and surface the decision when required work would implement an unapproved
proposal, alter a different project or production environment outside the
request, require business/accounting semantics not recorded in the item, or
perform credential rotation/destructive recovery without explicit authority.
