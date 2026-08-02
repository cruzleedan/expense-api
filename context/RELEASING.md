# Releasing — d3 Homelab

Thin, deliberately. This governs how work ships once a `context/work/` item
reaches `building` — it does not introduce versioning, changelogs, or a
release train; none of that fits a solo homelab cadence.

## Commit format

Conventional Commits — already the de facto standard in every project's
git history, now written down:

```
<type>(<scope>): <summary>
```

`type` is one of `feat | fix | refactor | chore | docs | test`. `scope` is
usually the affected module or route (e.g. `auth`, `receipt-parser`).

## Branch naming

```
<kind>/<work-id>-<slug>
```

`kind` matches the work item's `kind` field. `work-id` is the 4-digit
zero-padded ID. Example: `feat/0007-receipt-line-icr`.

This means the branch name, the commit prefix, and the work item's ID trace
back to each other — `grep` finds the design decision behind any commit
without relying on memory.

## Definition of done

Pulled from the work item itself — every box in its **Definition of done**
checklist must be checked before status moves to `shipped`. There is no
separate DoD to maintain; if the checklist is wrong, fix it on the work item.

## Before marking a context/work/ item "shipped"

- [ ] All Definition of done boxes checked
- [ ] Deployed, per the project's `AGENTS.md` deploy command
- [ ] `scripts/verify-context.sh` passes
- [ ] Log entry added: `- YYYY-MM-DD shipped — <one line>`

## After shipping

Status moves to `operating` once the change has been live without issue —
this is a separate step from `shipped` so "just merged" and "proven stable"
aren't conflated. There's no fixed waiting period; use judgment.
