---
id: 0008
title: "Spike: MCP server for expense-api (LLM client integration)"
status: accepted
kind: spike
opened: 2026-08-14
decided: 2026-08-14
branch: ~
supersedes: ~
superseded-by: 0009
---

# WORK-0008 — Spike: MCP server for expense-api (LLM client integration)

| | |
|---|---|
| **Opened** | 2026-08-14 |
| **Status** | accepted |
| **Kind** | spike |
| **Supersedes** | — |
| **Superseded by** | WORK-0009 |

## Problem

Users currently interact with expense data through the web SPA, the Flutter
mobile app, or the API's own built-in chat assistant (`/v1/chat`, backed by
Ollama — see `src/routes/chat.ts`, `src/services/chat.service.ts`). That chat
feature only works inside our own client surfaces.

The idea explored here: let users interact with `expense-api` from *any*
LLM client they already use — Claude Desktop, Claude Code, GitHub Copilot,
etc. — without us building a UI for it. The Model Context Protocol (MCP) is
the standard mechanism for this. This spike answers: what is MCP, how would
it plug into this specific codebase, what would the auth story actually look
like given our existing JWT design (WORK-0003), and is it worth building.

This is a **research spike only** — no code was written. Status stays
`proposed` until a human decides whether to move forward.

## What is MCP

MCP (Model Context Protocol) is an open, JSON-RPC-based protocol — originally
from Anthropic, now with broad multi-vendor support (Claude, ChatGPT, VS
Code, Cursor, and others) — for connecting LLM applications ("hosts") to
external tools and data. Think of it as the plumbing standard that lets any
MCP-aware chat client call into any MCP-aware server without custom
per-integration glue.

**Roles:**

| Role | What it is | In our case |
|---|---|---|
| **Host** | The end-user-facing app driving the LLM (Claude Desktop, Copilot, etc.) | Not ours — whatever the user already uses |
| **Client** | The MCP protocol implementation embedded in the host, one per server connection | Built into the host; we don't write this |
| **Server** | The thing we'd build — exposes tools/resources/prompts backed by our data | A new small service wrapping `expense-api` |

**What a server can expose:**

- **Tools** — functions the LLM can call, with a name, description, and a
  JSON Schema (Zod, in the TypeScript SDK) for input. This is the primary
  mechanism for CRUD — e.g. `create_expense_line`, `list_expense_reports`.
- **Resources** — file-like readable data (less relevant to us; our data is
  action-oriented, not document-oriented).
- **Prompts** — reusable prompt templates the host can surface to the user.
  Not needed for a first pass.

**Transports:**

| Transport | When | Auth |
|---|---|---|
| **stdio** | Server runs as a local subprocess of the host (e.g. Claude Desktop launches it) | Credentials come from the local environment (env vars, a config file) — no HTTP auth needed |
| **Streamable HTTP** | Server is a remote, always-on service multiple users/hosts connect to | OAuth 2.1 (below) |

For us, **Streamable HTTP is the right transport** — `expense-api` is a
multi-tenant hosted service, not something we'd want each user running
locally with a copy of their credentials in a config file. stdio would only
make sense for a single developer's local tooling, not for the "any user,
any LLM client" goal in the original ask.

**How current this is:** the protocol had a significant revision on
2026-07-28 that reworked the TypeScript SDK's package name
(`@modelcontextprotocol/sdk` → `@modelcontextprotocol/server` +
`@modelcontextprotocol/client`, now at v2) and some handler signatures
(`extra` param renamed to `ctx`). Any implementation work should pull the
SDK docs fresh rather than trust cached snippets, including this one —
confirm current package names and exact function signatures at
implementation time.

## Decision

**Accepted:** build a **separate, standalone MCP server**
— not inside `expense-api` itself — that:

1. Speaks MCP over **Streamable HTTP**.
2. Authenticates each incoming request via **OAuth 2.1**, per the MCP
   authorization spec, terminating at a thin **token-exchange layer** in
   front of our existing JWT system (design below) — not by replacing our
   JWT auth.
3. Exposes a **small, task-shaped tool set** (not a 1:1 mirror of every REST
   endpoint) that calls `expense-api` over plain HTTP using a user-scoped
   access token, so all existing `requirePermission`/`requireRole` checks in
   `expense-api` still apply unchanged.

This spike itself remains a design/research artifact — see Log for the
follow-up build item.

## Architecture

```
Claude Desktop / Copilot / etc.  (MCP host+client — not ours)
        │  MCP over Streamable HTTP, Authorization: Bearer <MCP token>
        ▼
expense-mcp  (new, separate service — this spike's subject)
        │  translates each tool call into a REST call
        │  HTTP request, Authorization: Bearer <expense-api JWT>
        ▼
expense-api  (unchanged — existing routes, existing auth/permission middleware)
```

**Why a separate service, not a route mounted inside `expense-api`:**

- MCP's request/response shape (JSON-RPC over SSE-flavored HTTP) and its
  session/capability negotiation model don't map onto `OpenAPIHono`'s
  route-per-endpoint model — it's a different protocol layer sitting *above*
  our REST API, not one more REST resource.
- Keeps blast radius contained. A bug in a fast-moving, less mature MCP SDK
  (mid-major-version-bump, per above) shouldn't be able to take down the
  production REST API mobile and web clients depend on.
- `expense-api`'s rate limiting, CORS, and error-handling middleware chain
  (`app.ts`) is tuned for REST semantics; an MCP endpoint has different
  traffic shape (long-lived connections, tool-call bursts) and would want
  its own tuning.
- It can be scaled, deployed, and versioned independently, and killed
  outright if the experiment doesn't pan out, without touching the
  API every mobile/web user depends on.

## Auth design — the part that actually matters

This is where the real design work is, and it's worth being precise about
because our JWT setup (WORK-0003) isn't a generic OAuth 2.1 authorization
server — it's a bespoke access+refresh JWT pair (`jose`, `HS256` presumably,
refresh in an HttpOnly cookie), described in `JwtPayloadV3`
(`src/types/index.ts`) with `sub`, `email`, `roles`, `permissions`,
`roles_version`. MCP's authorization spec assumes the server sits in front
of a real OAuth 2.1 authorization server (PKCE, dynamic client registration,
RFC 8707 resource-indicator-bound tokens, protected resource metadata at
`/.well-known/oauth-protected-resource`). We don't have one of those; we
have `POST /v1/auth/login` issuing a bespoke JWT.

Two options, in order of how much they respect the existing design:

### Option A — expense-mcp exchanges MCP tokens for expense-api JWTs (recommended)

`expense-mcp` becomes a small OAuth 2.1 resource server (satisfying the MCP
spec's requirements: protected resource metadata, `WWW-Authenticate` on 401,
audience-bound tokens per RFC 8707) *in front of* `expense-api`'s existing
login. Concretely:

1. User connects their MCP client to `expense-mcp`. The client is redirected
   through a standard OAuth 2.1 authorization-code + PKCE flow.
2. The authorization endpoint (part of `expense-mcp`, or a thin layer next
   to it) prompts the user to log in — reusing `expense-api`'s existing
   `/v1/auth/login` credential check — and on success mints an MCP-scoped
   access token whose audience is `expense-mcp`'s own canonical URI (per RFC
   8707), **not** an `expense-api` JWT directly.
3. `expense-mcp` stores a mapping from its own token to a real
   `expense-api` refresh token for that user (server-side, encrypted at
   rest — this is the one new piece of state this design introduces).
4. On each tool call, `expense-mcp` validates the incoming MCP bearer token,
   looks up the associated `expense-api` refresh token, mints/reuses a
   short-lived `expense-api` access token, and calls `expense-api` with it.
   Existing `authMiddleware` / `requirePermission` / `requireRole` in
   `expense-api` run exactly as they do today — the LLM never gets more
   access than the underlying user already has.

This keeps `expense-api` **completely untouched** — it never learns MCP
exists. All new auth surface lives in `expense-mcp`.

### Option B — expense-api issues MCP-scoped tokens directly

Extend `/v1/auth` to support the OAuth 2.1 flow MCP expects (dynamic client
registration, PKCE, resource-indicator validation) and have `expense-api`
itself act as the authorization + resource server for MCP clients, using
the *same* JWTs for both. Rejected for this proposal: it means teaching a
REST API that currently does simple bearer-JWT validation
(`verifyAccessToken` in `auth.service.ts`) to also be a spec-compliant OAuth
2.1 AS, permanently, for a client type (LLM hosts) that may or may not stick
around. Option A isolates that complexity in a service we can delete.

### Non-negotiables regardless of option

- **No shared static API key.** A single credential used for every user
  would mean the LLM (and by extension every MCP host) can see and modify
  every user's expenses. Each MCP session must map to one real
  `expense-api` user identity, enforced by the existing permission system.
- **Token audience binding is not optional** — the MCP spec requires it
  (RFC 8707) specifically to prevent a token issued for one purpose being
  replayed against a different resource. `expense-mcp` must validate this,
  not just check token signature.
- **stdio is a dead end for the "any user, any client" goal.** It's worth
  keeping in mind only as a possible *local development* shortcut, not the
  production auth story.

## Proposed tool surface

Task-shaped, not endpoint-shaped — mirrors the existing bulk-create
precedent (WORK-0007) of designing for how the caller actually wants to use
it, not for symmetry with the REST surface. Draft for a first pass, scoped
to what a normal (non-admin) user needs day to day:

| Tool | Wraps | Notes |
|---|---|---|
| `list_expense_reports` | `GET /v1/expense-reports` | Filterable by status/date |
| `get_expense_report` | `GET /v1/expense-reports/{id}` | Includes line items |
| `create_expense_report` | `POST /v1/expense-reports` | |
| `add_expense_line` | `POST /v1/expense-reports/{reportId}/lines` | Single line; bulk deliberately excluded from v1 tool surface — see below |
| `update_expense_line` | `PUT /v1/expense-lines/{id}` | |
| `delete_expense_line` | `DELETE /v1/expense-lines/{id}` | **Confirmation-worthy** — see Risks |
| `submit_expense_report` | Workflow submit action (`src/routes/workflow.ts`) | Moves report into approval |
| `list_expense_categories` | `GET /v1/expense-categories` | Read-only lookup, needed so the LLM can pick valid category codes without guessing |

**Deliberately excluded from v1:** bulk line creation
(`POST /v1/expense-lines/bulk`), receipts/OCR upload, admin analytics,
role/permission management, workflow approval actions (approving *other
people's* reports). These are either higher-risk (approval actions moving
money-adjacent state on someone else's behalf), redundant with what a
conversational one-line-at-a-time flow naturally produces (bulk create), or
out of scope for "a user manages their own expenses via chat."

## Options considered

| Option | Pros | Cons | Chosen? |
|---|---|---|---|
| Separate `expense-mcp` service, Streamable HTTP, token-exchange auth (Option A above) | Zero changes to `expense-api`; isolates a fast-moving/less-mature dependency; independently killable | New service to build, deploy, and operate; new (small) piece of persisted state (token mapping) | ✓ (proposed) |
| MCP route mounted inside `expense-api` | One fewer service to run | Different protocol shape doesn't fit `OpenAPIHono`'s model; couples API uptime to MCP SDK stability; SDK is mid-major-version churn right now | ✗ |
| `expense-api` becomes a full OAuth 2.1 AS itself (Option B above) | Single source of truth for tokens | Permanently expands the REST API's auth surface for a use case that may not pan out | ✗ |
| stdio-only local server (each user runs their own, configured with a personal API key) | No hosted auth problem to solve at all | Doesn't meet the stated goal — needs local setup per user, defeats "any client, no friction" | ✗ (maybe viable as a dev-only fallback) |
| Do nothing; point users at the existing `/v1/chat` assistant | Zero new work | Only works inside our own clients; doesn't answer the actual question being explored | ✗ |

## Consequences

**Positive:**
- Users could manage expenses from Claude Desktop, Copilot, or any other
  MCP-aware client with zero UI work on our side beyond the tool
  definitions.
- Forces a clean separation already worth having: nothing about this
  requires touching `expense-api`'s route/service/permission layers, which
  is a signal the existing REST API design is sound as an integration
  surface.
- The tool-scoping exercise (deliberately excluding admin/approval/bulk
  actions from v1) is a useful forcing function for thinking about
  least-privilege access generally, independent of whether MCP ships.

**Negative / Trade-offs accepted:**
- A new service to build and operate (`expense-mcp`), including a small new
  piece of persisted, security-sensitive state (the MCP-token →
  `expense-api`-refresh-token mapping) that doesn't exist today.
- MCP tooling (TypeScript SDK, protocol version) is moving fast — the
  2026-07-28 revision changed package names and handler signatures from the
  prior major version. Building on it now means either riding that churn
  or pinning a version and accepting drift.
- An LLM with write/delete access to financial data via natural language
  is a materially different risk profile than a REST API called by code we
  wrote — see Risks below.

**Risks / Open questions:**
- **Destructive-action confirmation.** MCP hosts vary in whether/how they
  surface tool-call confirmation to the user before executing (Claude
  Desktop prompts per call by default; behavior across other hosts isn't
  guaranteed). `delete_expense_line` and `submit_expense_report` should not
  be treated as safe just because the host *might* confirm — worth deciding
  whether `expense-mcp` itself should require some form of explicit
  confirmation step for destructive tools, independent of host behavior.
- **Prompt injection via receipt/report content.** If a future tool ever
  lets the LLM read back free-text fields (descriptions, vendor names) that
  originated from OCR'd receipts or user input, that text is untrusted and
  could attempt to steer the LLM into calling other tools. Not a concern
  for the v1 read/write tool surface above (no tool ingests untrusted
  document text), but worth flagging before adding any resource/receipt
  tools later.
- **Who actually wants this?** This spike doesn't establish user demand —
  it establishes technical feasibility and a design. Worth validating there's
  an actual user (or admin/power-user) who'd use an LLM chat client over the
  existing app/web UI before investing in `expense-mcp` for real.
- **Token-mapping store operational cost.** The refresh-token mapping in
  Option A needs encryption at rest, rotation, and revocation-on-logout
  handling that doesn't exist anywhere in the codebase today — this is new
  security-critical surface, not a rounding error.
- **Resolved 2026-08-14:** `expense-api`'s `refreshTokens()`
  (`auth.service.ts`) does support minting a new access token headlessly
  from a stored refresh token — no cookie/browser dependency, callable
  server-to-server. But it changes Option A's design in one important way:
  **refresh tokens are single-use and rotate on every call** — `refreshTokens()`
  revokes the presented refresh token and returns a brand-new one in the same
  response (`src/services/auth.service.ts:547-582`). `expense-mcp` cannot
  treat the stored refresh token as a stable, reusable credential; it must
  overwrite its stored value with the newly-rotated one after every refresh
  and guard against concurrent refresh calls racing each other into
  self-inflicted lockout (the second caller's presented token is already
  revoked by the first). Access tokens default to 15m, refresh to 7d
  (`JWT_ACCESS_EXPIRES_IN` / `JWT_REFRESH_EXPIRES_IN`, `env.ts`) — so
  `expense-mcp` will be rotating roughly every 15 minutes of tool-call
  activity per user, not once per session.
- **New finding:** `revokeAllTokens(userId)` already exists in
  `auth.service.ts` but is not wired to any route — there is currently no
  way for a user to revoke their own sessions via the API. This matters for
  MCP: a user who wants to disconnect an MCP client should be able to
  revoke `expense-mcp`'s access without changing their password. Either
  expose `revokeAllTokens` as a real endpoint, or give `expense-mcp` its
  own narrower revocation path — decide in the feature work item.

## Definition of done

This is a spike — "done" means the open questions above are resolved enough
to make a build/no-build call, not that anything is built. That call has
been made (accepted); remaining items are prerequisites for the follow-up
`feature` work item, not for this document.

- [x] MCP explained (architecture, transports, tool model) grounded in
      current (2026-07-28 revision) protocol docs
- [x] Auth options evaluated against `expense-api`'s actual JWT design
      (WORK-0003), not generic OAuth advice
- [x] Concrete tool surface proposed, scoped by risk (v1 exclusions listed
      with reasons)
- [x] Decide: build/no-build — accepted 2026-08-14
- [x] Validate refresh-token-mint-on-demand assumption in `auth.service.ts`
      against Option A's requirements — confirmed supported, but tokens
      rotate on every use (single-use refresh tokens); see Risks
- [x] Open a new `kind: feature` work item for the actual build,
      superseding this spike — see WORK-0009

## Log

- 2026-08-14 proposed — spike opened and researched; no code written, see
  Problem/Decision above for why.
- 2026-08-14 accepted — proposal (separate `expense-mcp` service, Streamable
  HTTP, Option A token-exchange auth, v1 tool surface as scoped above)
  approved.
- 2026-08-14 — validated the refresh-token assumption directly in
  `auth.service.ts`: `refreshTokens()` works headlessly as needed, but
  refresh tokens are single-use/rotating, not stable — updated Risks with
  the corrected design implication (store-and-overwrite, not
  store-and-reuse) and a new gap (`revokeAllTokens` exists but has no
  route). Opened WORK-0009 for the actual build; this spike is superseded
  by it.

---

> **For AI agents:** Do NOT implement this work item unless status is
> `accepted` or `building`. If status is `proposed`, surface it to the user
> for a decision before writing any code. If status is `superseded`, follow
> the item in `superseded-by` instead — do NOT implement the pattern
> described here. If you are about to contradict an `accepted`, `building`,
> `shipped`, or `operating` item, stop and surface it to the user before
> proceeding.
