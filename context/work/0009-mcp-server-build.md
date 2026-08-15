---
id: 0009
title: "Build expense-mcp: MCP server for LLM client access to expense-api"
status: building
kind: feature
opened: 2026-08-14
decided: 2026-08-14
branch: ~
supersedes: 0008
superseded-by: ~
---

# WORK-0009 — Build expense-mcp: MCP server for LLM client access to expense-api

| | |
|---|---|
| **Opened** | 2026-08-14 |
| **Status** | building |
| **Kind** | feature |
| **Supersedes** | WORK-0008 |
| **Superseded by** | — |

## Problem

WORK-0008 (spike, accepted) established that exposing `expense-api` to
arbitrary MCP-capable LLM clients (Claude Desktop, Copilot, etc.) is
technically sound and designed the shape of it: a separate `expense-mcp`
service, Streamable HTTP transport, and an OAuth 2.1 token-exchange layer
in front of `expense-api`'s existing JWT auth rather than modifying
`expense-api` itself. That spike also validated the one load-bearing
assumption the design depended on — headless refresh-token minting — and
found it works, but with a wrinkle: **refresh tokens are single-use and
rotate on every call** (`refreshTokens()` in `auth.service.ts`, confirmed
2026-08-14), not a stable credential `expense-mcp` can reuse indefinitely.

This work item is the actual build, scoped narrowly to a first working
version — read/write on the user's own expense reports and lines, nothing
admin, nothing destructive-without-confirmation.

**Read WORK-0008 in full before starting** — the architecture diagram,
auth design (Option A), and tool-surface table there are the spec this
item implements. This document does not repeat that content; it only adds
what's new since the spike (the rotation-handling design) and the concrete
build checklist.

## Decision

Build `expense-mcp` as a new, separate repository/service (sibling to
`expense-api`, not a directory inside it — consistent with WORK-0008's
reasoning: different protocol shape, independent deploy/kill lifecycle,
isolates MCP SDK churn from the production REST API).

Scope for this first version:

- **Auth**: Option A from WORK-0008 — `expense-mcp` is its own OAuth 2.1
  resource server; on successful login it stores an `expense-api` refresh
  token per user (encrypted at rest) and exchanges it for short-lived
  access tokens on each tool call.
- **Refresh-token rotation handling (new since the spike):** every call to
  `expense-api`'s `refreshTokens()` both consumes the presented refresh
  token and returns a new one. `expense-mcp`'s token store must:
  - Overwrite the stored refresh token with the newly-rotated one
    immediately after every use, in the same transaction/critical section
    as the access-token mint — never leave the old (now-revoked) token as
    the "current" value even transiently.
  - Serialize refresh calls per-user (e.g. a per-user lock or single-flight
    pattern) so two concurrent tool calls for the same user can't both read
    the same stored refresh token, both attempt to use it, and have the
    second one fail because the first already rotated it out from under it.
  - Treat a failed refresh (revoked/expired token) as "this user's MCP
    session is dead" — surface it as an MCP auth error prompting
    re-authentication, not a generic tool failure.
- **Tool surface**: exactly the 8 tools scoped in WORK-0008 ("Proposed tool
  surface" table) — `list_expense_reports`, `get_expense_report`,
  `create_expense_report`, `add_expense_line`, `update_expense_line`,
  `delete_expense_line`, `submit_expense_report`,
  `list_expense_categories`. No bulk create, no receipts/OCR, no admin, no
  approving other users' reports, per that table's stated reasons.
- **Destructive-action confirmation**: `delete_expense_line` and
  `submit_expense_report` require an explicit confirmation round-trip
  inside `expense-mcp` itself (e.g. a two-step tool call, or returning a
  structured "confirm?" response the LLM must re-invoke with an explicit
  flag) — not left to whatever the MCP host happens to do, per WORK-0008's
  Risks.
- **Session revocation**: since `revokeAllTokens(userId)` exists in
  `auth.service.ts` but has no route, this work item includes exposing it
  (new `POST /v1/auth/sessions/revoke-all` or similar in `expense-api`) so
  a user can kill their MCP access without a password change. This is the
  one change this work item makes to `expense-api` itself — everything
  else about MCP lives in `expense-mcp`.

## Options considered

Architecture and auth options were already evaluated in WORK-0008 — see
that document's Options Considered table. Nothing new to weigh here beyond
one implementation-level choice:

| Option (refresh-token concurrency) | Pros | Cons | Chosen? |
|---|---|---|---|
| Per-user lock / single-flight around refresh | Correct under concurrent tool calls; simple to reason about | Adds a small amount of latency to the first concurrent call while others wait | ✓ |
| Optimistic — let concurrent refreshes race, retry on failure | No locking infra needed | A losing caller's tool call fails visibly to the user for no reason they can see; worse UX for a problem that's entirely avoidable | ✗ |
| Store multiple valid refresh tokens per user (avoid rotation conflicts) | Sidesteps the race | `expense-api`'s refresh-token table doesn't support this usage pattern; would mean `expense-mcp` fighting the grain of `auth.service.ts` instead of working with it | ✗ |

## Consequences

**Positive:**
- Delivers the actual capability WORK-0008 was investigating.
- The revocation-route gap (`revokeAllTokens` unwired) gets fixed as a
  side effect, which is a real, independently useful gap regardless of
  whether MCP ships.

**Negative / Trade-offs accepted:**
- New service to operate, deploy, and monitor.
- New security-sensitive state: per-user encrypted refresh-token storage
  in `expense-mcp`, plus the concurrency-control logic around it. This is
  the highest-risk new component in the whole design and should get
  focused review/testing before shipping, not treated as boilerplate.
- `expense-api` gets one new route (session revocation) — small, additive,
  doesn't touch existing auth flows.

**Risks / Open questions:**
- Everything under WORK-0008's Risks section still applies (prompt
  injection surface if resource/receipt tools are added later; unvalidated
  user demand). Re-read before scope-creeping this work item.
- MCP TypeScript SDK version/package names should be re-confirmed at
  implementation start — WORK-0008 noted a recent (2026-07-28) breaking
  revision; don't trust that spike's cached snippets as current by the
  time this is picked up.
- **Resolved 2026-08-14:** encryption-at-rest is application-level
  AES-256-GCM with a key supplied via `MCP_TOKEN_ENCRYPTION_KEY` (see
  `expense-mcp/src/store/crypto.ts`), not KMS-backed. Deliberate first-
  version tradeoff — no online key rotation (re-encrypting the store is a
  manual offline operation). Revisit before wider rollout; recorded here
  and in `expense-mcp/README.md` so it isn't mistaken for an oversight.
- **New finding, confirmed by installing the SDK:** `@modelcontextprotocol/server`
  v2 depends on `zod@^4.2.0` directly (not a peer dependency) — its
  `registerTool` schemas are structurally incompatible with `zod@^3.x` at
  the type level (confirmed via `tsc`: a v3 `ZodType` fails to satisfy the
  SDK's v4-based `ZodRawShape`/`StandardSchemaWithJSON`). `expense-mcp`
  therefore runs `zod@^4`, one major version ahead of `expense-api`'s
  `zod@^3.24.1`. This is fine — the two are separate npm projects with
  separate `node_modules` — but don't "helpfully" downgrade `expense-mcp`'s
  zod to match `expense-api` if touching this later; it will break tool
  registration the same way it did here.

## Definition of done

- [x] `expense-mcp` service scaffolded (separate repo), Streamable HTTP
      transport — `expense-mcp/` sibling directory, own git repo
- [x] OAuth 2.1 resource server behavior: protected resource metadata,
      `WWW-Authenticate` on 401, PKCE, RFC 8707 audience-bound tokens —
      implemented in `expense-mcp/src/auth/routes.ts` +
      `expense-mcp/src/auth/verifier.ts`; smoke-tested: correct 401 +
      `WWW-Authenticate` challenge on missing auth, correct RFC 9728/8414
      metadata responses, PKCE-protected `/token`, redirect_uri and
      RFC 8707 resource validation both reject with 400 (including a
      malformed `resource` value — caught and fixed as a review finding,
      see Log)
- [x] Login flow reuses `expense-api`'s existing credential check
      (`/v1/auth/login`) rather than duplicating password verification —
      `expense-mcp/src/client/expenseApi.ts`'s `loginToExpenseApi`
- [x] Encrypted refresh-token store with per-user locking around rotation,
      per the Decision section above — `expense-mcp/src/store/tokenStore.ts`
      + `crypto.ts`; concurrency behavior verified directly (see last item)
- [x] All 8 tools from WORK-0008 implemented, each calling `expense-api`
      with a per-user access token (existing `authMiddleware` /
      `requirePermission` enforced unchanged on the `expense-api` side) —
      `expense-mcp/src/tools/{expenseReports,expenseLines,workflow}.ts`
- [x] Confirmation step implemented for `delete_expense_line` and
      `submit_expense_report` — via the MCP SDK's `inputRequired`/`elicit`
      multi-round-trip mechanism, factored into a shared
      `requireConfirmation` helper (`expense-mcp/src/tools/context.ts`)
      after code review flagged the first draft's duplication
- [x] `expense-api`: session revocation route added, wired to existing
      `revokeAllTokens(userId)` — `POST /v1/auth/sessions/revoke-all` in
      `src/routes/auth.ts`, type-checked clean
- [ ] End-to-end test: connect a real MCP client (e.g. Claude Desktop) to
      a local `expense-mcp`, exercise each tool against a test user,
      confirm permission boundaries hold (a tool call cannot see/modify
      another user's data) — **not done**. What *was* verified: the OAuth
      surface (metadata, PKCE, validation) via curl, and the token-rotation
      lock via a direct unit-level exercise of `tokenStore.withLock` (see
      next item). A real client end-to-end run, and a full login →
      authorize → token → tool-call chain against a live `expense-api` +
      Postgres, still needs to happen before this is considered
      production-ready.
- [x] Token rotation race condition specifically tested: fire concurrent
      tool calls for the same user, confirm no spurious auth failures —
      ran 3 concurrent `tokenStore.withLock` calls for one user directly;
      all completed correctly in order with no race. (This exercises the
      locking primitive, not a full concurrent-tool-call-through-HTTP path
      against a live `expense-api` — that's part of the still-open
      end-to-end item above.)

## Log

- 2026-08-14 proposed — opened from accepted spike WORK-0008, carrying
  forward its validated auth design and adding the refresh-token-rotation
  handling the spike's follow-up check surfaced.
- 2026-08-14 accepted — build approved. Scope, auth design (Option A +
  rotation handling), tool surface, and Definition of Done above stand as
  written; branch to be filled in when implementation starts.
- 2026-08-14 building — implemented in this session:
  - `expense-api`: added `POST /v1/auth/sessions/revoke-all`
    (`src/routes/auth.ts`), wired to the pre-existing `revokeAllTokens`.
    Type-checks clean; no other `expense-api` files touched.
  - `expense-mcp`: new sibling repo. OAuth 2.1 authorization+resource
    server (`src/auth/`), AES-256-GCM-encrypted refresh-token store with
    per-user rotation locking (`src/store/`), `expense-api` HTTP client
    (`src/client/`), all 8 tools (`src/tools/`), Streamable HTTP transport
    wired via Hono + `@modelcontextprotocol/server` v2 (`src/index.ts`,
    `src/mcp/`).
  - Ran a `code-review` pass (medium effort) against the new code before
    calling it done; it surfaced three real issues, all fixed and
    re-verified: (1) `tokenStore.withLock`'s cleanup check compared two
    separately-constructed promises that could never be `===` equal, so
    the lock map leaked one entry per distinct user forever — fixed by
    storing the chained promise once and reusing it; verified by direct
    test that the map now empties correctly. (2) `GET /authorize` threw an
    uncaught exception on a malformed `resource` query param instead of
    the intended 400 — wrapped in try/catch; verified with a curl repro
    before and after. (3) The delete/submit confirmation-elicitation
    boilerplate was duplicated verbatim across two tool files — extracted
    to a shared `requireConfirmation` helper in `tools/context.ts`.
  - Smoke-tested (not full end-to-end — see Definition of Done): server
    boots, `/health` responds, RFC 9728/8414 metadata endpoints return
    correct JSON, unauthenticated `/mcp` returns 401 with a spec-correct
    `WWW-Authenticate` challenge, dynamic client registration works,
    `/authorize` renders and validates `redirect_uri`/`resource` correctly
    (400 on mismatch or malformed input), `/token` rejects an invalid code
    with `invalid_grant`.
  - Confirmed live against the installed SDK (not just its docs) that
    `@modelcontextprotocol/server` v2 requires `zod@^4`, not `^3` — see
    the Risks entry above. `expense-mcp` runs zod v4 in its own
    `node_modules`, independent of `expense-api`'s v3.
  - Remaining before this is production-ready: a real MCP client
    end-to-end run, and a full login→authorize→token→tool-call chain
    against a live `expense-api` + Postgres (the smoke tests above ran
    with `expense-api` unavailable, so login-dependent paths are
    unverified beyond their error handling). `expense-mcp`'s in-memory
    storage (token store, OAuth client/code registry) is explicitly a
    single-instance, restart-loses-state design — see its README's Known
    Limitations section before considering multi-instance deployment.

---

> **For AI agents:** Do NOT implement this work item unless status is
> `accepted` or `building`. If status is `proposed`, surface it to the user
> for a decision before writing any code. If status is `superseded`, follow
> the item in `superseded-by` instead — do NOT implement the pattern
> described here. If you are about to contradict an `accepted`, `building`,
> `shipped`, or `operating` item, stop and surface it to the user before
> proceeding.
