---
id: 0051
title: "Upgrade Zod and Hono OpenAPI integration together"
status: building
kind: infra
opened: 2026-09-20
decided: 2026-09-20
branch: infra/0051-zod4-openapi-upgrade
supersedes: ~
superseded-by: ~
---

# WORK-0051 — Upgrade Zod and Hono OpenAPI integration together

| | |
|---|---|
| **Opened** | 2026-09-20 |
| **Status** | building |
| **Kind** | infra |
| **Supersedes** | — |
| **Superseded by** | — |

## Problem

Dependabot PRs #23 (`@hono/zod-openapi` 1.6.3) and #24 (Zod 4.6.5)
individually fail `npm ci`: each new package requires the other. Neither PR
can safely be merged on its own. Zod 4 also changes the types and parsing
semantics of transformed defaults and requires explicit record key schemas.

## Decision

The user approved merging the remaining dependency branches in a safe order on
2026-09-20. Upgrade these two packages as one integration change, preserving
the API's parsed query defaults and free-form JSON record values. Keep the
OpenAPI snapshot gate: review generated differences and explicitly refresh its
baseline only for compatible schema representation/documentation changes.
Replace the two incompatible standalone PRs with one reviewed PR.

The generated contract review found no path, field, requiredness, or security
removal. Three versioned command request schemas become flattened object
schemas instead of `allOf` references; their intended required fields remain
the same. Nullable enum schemas now include `null` in the enum as well as
`nullable: true`. Existing query descriptions are emitted where previously
omitted. Generated-client consumers should review the three flattened command
models and nullable enum representation, even though HTTP payload shapes are
unchanged.

## Options considered

| Option | Assessment |
|---|---|
| Merge #23 or #24 alone | Rejected: peer dependency resolution fails. |
| Force npm peer resolution | Rejected: creates an unsupported dependency graph. |
| Upgrade both with schema and contract verification | Chosen: preserves install, runtime validation, and explicit contract review. |

## Consequences

The dependency graph stays installable on Node 22. The contract baseline changes
only after review; mobile/OpenAPI-codegen consumers should inspect the model
representation differences. No database change or deployment is in scope.

## Definition of done

- [x] Both packages are upgraded together and a clean Node 22 `npm ci` succeeds.
- [x] Schema defaults and record parsing have focused regression tests.
- [x] `npm run check`, PostgreSQL integration suite, production-image/security/SBOM checks, and contract parity pass in CI.
- [x] The generated OpenAPI diff is reviewed, documented, and baselined.
- [x] A single integration PR replaces #23/#24; neither standalone failing PR is merged.

## Log

- 2026-09-20 accepted — User requested merging the remaining branches in a conflict-safe order.
- 2026-09-20 building — Began coordinated dependency, validation, and contract integration after the independent updates merged.
- 2026-09-20 repository verification — Clean Node 22 install and `npm run check` passed in the verification image; the disposable PostgreSQL suite passed, and the production image passed a fresh zero-finding audit and actual-dependency SBOM parity. Awaiting PR CI on the final reviewed lockfile.
- 2026-09-20 contract review — Reviewed the generated differences: three flattened command schemas retain required payload fields, five nullable enums redundantly include `null`, and existing query descriptions become visible. Updated the baseline and client-codegen note; no path/security/field removal was observed.
- 2026-09-20 CI verification — PR #26 passed verification, isolated PostgreSQL, and production-image checks. Closed failing standalone PRs #23 and #24 and deleted their remote branches; awaiting integration merge. Deployment and live health were not requested or performed.
