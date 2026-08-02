---
id: 0001
title: "Hono + OpenAPIHono as the web framework (schema-first API)"
status: accepted
kind: infra
opened: 2026-08-01
decided: 2026-08-01
branch: ~
supersedes: ~
superseded-by: ~
---

# WORK-0001 — Hono + OpenAPIHono as the web framework (schema-first API)

| | |
|---|---|
| **Opened** | 2026-08-01 |
| **Status** | accepted |
| **Kind** | infra |
| **Supersedes** | — |
| **Superseded by** | — |

## Problem

The expense-api needed a TypeScript HTTP framework for a REST API deployed in a
Node.js Docker container. Key requirements: lightweight, TypeScript-native,
built-in OpenAPI/Swagger support, Zod validation without boilerplate.

## Decision

Use **Hono** with the **`@hono/zod-openapi`** and **`@hono/swagger-ui`** packages.
Routes are defined using `createRoute()` with Zod schemas that simultaneously
validate requests/responses AND generate the OpenAPI 3.x spec. The app instance
is `OpenAPIHono`, not plain `Hono`.

## Options considered

| Option | Pros | Cons | Chosen? |
|---|---|---|---|
| Hono + OpenAPIHono | Schema-first; one Zod schema = validation + OpenAPI spec; tiny runtime; Node + edge compatible | Smaller ecosystem than Express | ✓ |
| Express + swagger-jsdoc | Huge ecosystem, well-known | JSDoc comments are not type-safe; spec drifts from code | ✗ |
| Fastify + @fastify/swagger | Fast, schema validation via JSON Schema | Separate schema formats (JSON Schema vs. Zod); more config | ✗ |
| NestJS | Decorators, DI, opinionated structure | Heavy; slow startup; over-engineered for this scale | ✗ |

## Consequences

**Positive:**
- OpenAPI spec is always in sync with actual request/response shapes
- Zod schemas serve double duty: validation and documentation
- Swagger UI at `/doc` is auto-generated with zero extra work

**Negative / Trade-offs accepted:**
- Every route must define a `createRoute()` spec — more boilerplate per endpoint
  than Express `router.get()`
- `OpenAPIHono` instance must be used throughout, not plain `Hono`

**Risks / Open questions:**
- None outstanding.

## Definition of done

- [x] Zod schemas call `.openapi('Name')` to appear correctly in the spec
- [x] Route files export typed routers, mounted in `app.ts`
- [x] Swagger UI served at `/doc`

## Log

- 2026-08-01 accepted — decision made at project inception; migrated from
  ADR-0001 to this work item format

---

> **For AI agents:** Do NOT implement this work item unless status is
> `accepted` or `building`. If status is `proposed`, surface it to the user
> for a decision before writing any code. If status is `superseded`, follow
> the item in `superseded-by` instead — do NOT implement the pattern
> described here. If you are about to contradict an `accepted`, `building`,
> `shipped`, or `operating` item, stop and surface it to the user before
> proceeding.
