<!-- last triaged: never -->

# Friction Log

Append-only. Log an entry only when something about the **framework itself**
(not the codebase you're working in) caused a wrong turn, confusion, or extra
steps — an ambiguous instruction, a skill step that didn't match reality, a
missing file path, a convention applied inconsistently. Most sessions should
add nothing here.

See `context/skills/triage-friction.md` for how entries get reviewed and
turned into fixes.

## Format

```
YYYY-MM-DD | project | source-file | what happened
```

Use `(cross-project)` for the project field when the issue isn't specific to
one project's files.

## Entries

2026-09-15 | (cross-project) | `/home/dan/projects/AGENTS.md` | Required `scripts/verify-context.sh` is absent from the workspace root; only the `context-template` repository contains the script, so project-local verification was added instead.

2026-09-15 | expense-api | `context-template/scripts/verify-context.sh` | The shared validator rejects the user-required `context/ideas/`, `context/reviews/`, and `context/README.md` taxonomy used by this project; the project-local verifier explicitly supports and validates that taxonomy.
