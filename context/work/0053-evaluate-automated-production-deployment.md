---
id: 0053
title: "Evaluate automated production deployment on d3"
status: proposed
kind: infra
opened: 2026-09-25
decided: ~
branch: ~
supersedes: ~
superseded-by: ~
---

# WORK-0053 — Evaluate automated production deployment on d3

| | |
|---|---|
| **Opened** | 2026-09-25 |
| **Status** | proposed |
| **Kind** | infra |
| **Supersedes** | — |
| **Superseded by** | — |

## Problem

`expense-api` only has CI. Production on d3 (`compose.prod.yaml`, run from
`/home/dan/projects/expense-api`) changes only when someone rebuilds it by
hand, following `context/reference/release-quality-gates.md` → "Production
artifact, SBOM, and rollout". Merged work therefore sits undeployed with no
signal. As of 2026-09-25, `main` contains `@hono/node-server` 2 (#30) and
`jose` 6 (WORK-0052), but the running container still has the previous
dependencies.

Two things make this project different from the d3 projects that already
auto-deploy (`portfolio`, `flutter-rag`, both via repo-scoped self-hosted
GitHub Actions runners):

1. **It's production** (d3-homelab: "Production environment — be
   conservative with changes"). The release gates require a fresh
   production-image audit, prior/new image identities, `npm run
   verify:deployment`, and image-only rollback. Schema changes use a
   reviewed, manually applied procedure (`db:apply-change`,
   `context/skills/add-migration.md`) and must never be automated blindly.
2. **The repository is public.** GitHub advises against self-hosted runners
   on public repositories: a pull request from a fork runs the workflow files
   *from the fork*, so it can target a self-hosted label and execute
   arbitrary code on d3. The portfolio/flutter-rag pattern can't be reused
   safely as it is.

## Decision (proposed)

Automate the **image-only rollout** that the release gates already describe.
Leave database changes manual, and don't place a GitHub runner on d3. The
proposed mechanism is **pull-based**:

- A systemd **timer + service on d3**, running as the deploying user (not
  root), polls every few minutes. It deploys only when **all** of
  these hold:
  - `origin/main` has a new commit;
  - that commit's required CI checks (`verify`, `postgres`,
    `production-image`) are green (read with `gh api`, using a read-only
    fine-grained token scoped to this repository);
  - the commit changes no `src/db/**` files and no reviewed SQL (schema
    changes stop auto-deploy and notify instead, because they need the manual
    `db:apply-change` procedure first);
  - the canonical checkout is clean.
- The deploy itself is exactly the documented rollout:
  - record the prior image ID;
  - `git checkout --detach <sha>`;
  - `docker compose -f compose.prod.yaml config --quiet`, then `build
    expense-api`;
  - a **fresh** `npm audit --omit=dev --audit-level=high` of the built image
    (abort on findings);
  - `up -d --no-deps expense-api` (never PostgreSQL, never a Caddy reload);
  - then `npm run verify:deployment`.
- **Automatic image-only rollback** if `verify:deployment` fails: re-run the
  prior image through the Compose override that the release gates describe,
  then verify again. A rollback never touches the database.
- **An evidence trail:** each run appends the SHA, prior/new image IDs, the
  audit result, and the verification output to a log file on d3. The
  commit's work item still records deployments by hand, as the playbook's
  completion stages require.

Pull-based means GitHub never executes anything on d3, and fork PRs have no
path to the host. The polling latency (minutes) is irrelevant for this
service.

## Options considered

| Option | Pros | Cons | Chosen? |
|---|---|---|---|
| Keep manual rollouts | Maximum control; matches "be conservative" | Merged fixes sit undeployed with no signal (the current state) | Baseline to compare against |
| Self-hosted runner (portfolio pattern) | Proven on d3; immediate | **Unsafe on a public repo**: fork PRs can run code on the host | ✗ |
| Self-hosted runner with the repo made private, or with fork-workflow approval required | Reuses the pattern | Changes the project's visibility or relies on a setting that's easy to regress; still runs GitHub-controlled code on production | ✗ |
| GitHub-hosted job that SSHes into d3 | No runner on the host | Requires inbound SSH to d3, which the Cloudflare Tunnel design avoids; credentials stored in GitHub | ✗ |
| Pull-based systemd timer on d3, gated on green CI, image-only, auto-rollback | No GitHub-to-host execution path; encodes the existing rollout gates; database stays manual | A bespoke script to maintain; needs a read-only GitHub token on d3 | ✓ proposed |
| Watchtower-style image polling from a registry | Standard tool | No registry exists today (images build locally); skips the audit and verification gates | ✗ |

## Consequences

**Positive:**
- Merged, green, schema-free changes reach production without a human
  remembering to, and they still pass the documented release gates.
- Failed rollouts roll back to the prior image automatically.

**Negative / Trade-offs accepted:**
- A custom deploy script on the production host, which needs its own tests
  (dry-run mode, a forced verification failure).
- Anything that touches the schema still needs a person. This is deliberate,
  and the timer reports it rather than silently skipping.
- A read-only GitHub token lives on d3.

**Risks / Open questions:**
- **Is automation wanted for production at all?** Keeping manual rollouts and
  adding only a *notification* ("main is N commits ahead of production") is a
  legitimate smaller outcome of this evaluation.
- How does the service notify: a log only, or push/email?
- Should the "no schema change" check be path-based (`src/db/**`, SQL files)
  or rely on an explicit marker in the commit or work item?
- Deploy windows: should deploys be restricted to hours when someone can
  react?

## Definition of done

- [ ] Evaluation recorded: choose full auto-rollout, notify-only, or keep
      manual, with the user's decision logged.
- [ ] If automating: a timer/service on d3 deploys only green, schema-free
      `main` commits through the documented image-only rollout, with a fresh
      audit, `verify:deployment`, and automatic image rollback.
- [ ] Verified: a red CI commit, a schema-touching commit, and a dirty
      checkout each block deployment. A forced `verify:deployment` failure
      rolls back to the prior image.
- [ ] No GitHub runner or inbound access is added to d3. The GitHub token is
      read-only and repository-scoped.
- [ ] `release-quality-gates.md` documents the automated path, and the
      manual procedure as the fallback. d3-homelab's `homelab.md` notes the
      timer.

## Log

- 2026-09-25 proposed — the user asked for auto-deploy options to be written
  up for later evaluation, after WORK-0052 and Dependabot #27/#28/#30 were
  merged but not deployed. Surveyed d3: only `portfolio` and `flutter-rag`
  auto-deploy (self-hosted runners). This repository is public, which rules
  out reusing that pattern here.
