---
id: 0050
title: "Coordinate expense-mcp for the authentication-session cutover"
status: building
kind: fix
opened: 2026-09-19
decided: 2026-09-19
branch: fix/0050-auth-session-cutover
supersedes: ~
superseded-by: ~
---

# WORK-0050 — Coordinate expense-mcp for the authentication-session cutover

## Problem and evidence

WORK-0030 makes each access token valid only while its issuing refresh row is
active. A successful refresh rotates that row and immediately invalidates the
previous access token on the next API authentication check.

Read-only `expense-mcp` inspection found a separate integration hazard:

- `src/auth/tokenExchange.ts` exchanges the stored API refresh token on **every**
  tool call. Its per-user `tokenStore.withLock` correctly serializes the exchange
  and updates the stored rotated token, within one process.
- `src/tools/context.ts` releases that lock before `callExpenseApi` sends the
  tool's API request. A second overlapping tool call can rotate again after the
  first receives its access token but before the first API request authenticates.
  The first call then receives 401 despite a valid MCP session.
- `src/client/expenseApi.ts` deliberately does not retry API 401s. That avoids
  accidental replay of a mutation but surfaces this normal-use race as a tool
  authentication error.
- The token store and lock are process-local; the repository already documents
  that multi-instance operation is unsupported. This proposal does not silently
  expand deployment topology.
- The `auth_version=2` cutover rejects all previously minted API access and
  refresh tokens. Connected MCP users must reconnect and authenticate again.

This is a source-level race analysis, not a reproduced production incident or
proof that expense-mcp is currently deployed. No MCP code or live sessions were
changed.

## Decision

Accepted: bounded `expense-mcp` compatibility work before the
WORK-0030 API cutover. Preserve WORK-0030's immediate invalidation and replay
containment. Coordinate per-user API calls with rotation so an overlapping call
cannot revoke another in-flight call's access token. A full-request per-user
lock is the simplest correctness baseline; an access-token cache is acceptable
only if its refresh boundary also waits for in-flight calls and handles expiry,
logout, and failure. Do not blindly retry non-idempotent tool mutations on 401.

Keep the currently documented single-instance constraint unless a separate
deployment/storage decision explicitly changes it. Confirm the API's JSON-body
refresh and rotated `Set-Cookie` extraction against WORK-0030, then plan a
reconnect notice for existing MCP sessions at cutover.

## Definition of done

- [x] User explicitly authorizes MCP repository scope and accepted behavior.
- [x] Parallel tool calls for one user neither replay a refresh token nor lose
      an in-flight access token to another call's rotation; deterministic tests
      cover the exchange/request boundary and failed calls.
- [x] Read and mutating tool calls preserve their existing semantics; no
      automatic mutation replay after uncertain 401/network outcomes.
- [ ] Missing, revoked, expired, replayed, and version-1 API sessions produce a
      clear reconnect path without corrupting the stored token.
- [x] Body refresh and rotated-cookie parsing are verified against WORK-0030
      using disposable fixtures, not production credentials.
- [ ] Single-instance assumption is verified for deployment or a separately
      approved distributed-coordination design is completed before scaling.
- [ ] MCP test/build gates and an agreed reconnect/cutover smoke test pass
      before the WORK-0030 production API rollout.

## References

- [WORK-0030](0030-harden-authentication-oauth-and-session-lifecycle.md)
- [WORK-0049 frontend compatibility](0049-coordinate-expense-tracker-auth-session-cutover.md)
- [Session/client contract](../reference/auth-session-lifecycle.md)

## Log

- 2026-09-19 proposed — identified by read-only cross-client inspection during
  WORK-0030 staging. No MCP implementation authority or production change.
- 2026-09-19 accepted — user approved WORK-0049 and WORK-0050 implementation.
  MCP work follows frontend verification; no production cutover yet.
- 2026-09-19 building — frontend clean build and eight isolated browser tests
  passed; MCP compatibility implementation begins on
  `fix/0050-auth-session-cutover`. Real API/client smoke and deployment remain
  separate gates.
- 2026-09-19 MCP repository verification — full-request per-user locking now
  covers rotation and downstream API authentication; OAuth login's store write
  also uses the lock. Six deterministic tests pass for overlapping calls,
  JSON-body refresh/rotated-cookie extraction, non-replayed failed mutations,
  post-refresh 401 reconnection and legacy/revoked/transient refresh errors.
  `npm run build` passes. No existing MCP deployment was found in the inspected
  local Docker container list or this repository; real WORK-0030 API/PostgreSQL
  fixture, client reconnect smoke, and production topology verification remain
  open. No production change or commit.
- 2026-09-19 disposable integration — a clean Node 22 MCP test container used
  the isolated WORK-0030 API and PostgreSQL fixture to log in, capture a real
  `Set-Cookie` refresh token, run three overlapping API-backed tool calls,
  rotate via JSON-body transport, revoke all fixture sessions and verify a
  reconnect-required error on the next call. The fixture was removed afterward.
  No MCP service deployment or full OAuth-host/client end-to-end test occurred.
- 2026-09-19 bounded cache and final verification — the first shared browser/MCP
  fixture exhausted the disposable API's per-IP auth limit; this exposed
  unnecessary per-tool refresh churn. MCP now caches a same-user access token
  only until 30 seconds before its JWT expiry, still under the full-request
  lock. OAuth login replaces and clears that cache. One deterministic cache
  test was added; the clean-container build, six deterministic tests and real
  WORK-0030 login/concurrent-call/revocation smoke all passed after the change.
  The high-limit test-only fixture was removed; production rate limits were
  neither changed nor bypassed.
