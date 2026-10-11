# ADR 0005: Control API conventions and authorization seam

Status: proposed (Phase 2b, first slice) · Date: 2026-10-11

## Context

ARCHITECTURE.md defines a versioned HTTP control API. Its rules:

- Mutations carry a validated payload, an `Idempotency-Key`, and the expected configuration version.
- Status codes:
  - 409 for idempotency or configuration conflicts;
  - 422 for unavailable capabilities;
  - 401/403 for authentication and authorization failures;
  - 202 for asynchronous actions.
- A tenant ID is never accepted as proof of authorization.

The identity provider decision is still open. ADR 0004 already enforces isolation in PostgreSQL itself.

## Decision

- **Authorization seam:** routes resolve a `Principal` (`userId`, `tenantId`, `mfaVerified`) through `resolvePrincipal(request)`. Until an identity provider is connected, it returns `null` for everyone, so every protected route answers **401**. There is no development bypass, header shortcut or default user in application code. Tests inject verified identities through a test-only resolver, standing in for a provider session.
- **Tenant identity comes only from the principal.** Request schemas are strict, so a body field such as `tenantId` is rejected with 400 rather than ignored.
- **CSRF and origin protection:** every state-changing request must carry an `Origin` from `config.allowedOrigins`, or, with no Origin, `Sec-Fetch-Site: same-origin`. Anything else gets **403** before authentication or parsing. `APP_ORIGIN` is required and must be HTTPS outside LOCAL/TEST; locally, `127.0.0.1` and `localhost` are equivalent. This complements the SameSite session cookies planned with the provider integration.
- **Idempotency:** every mutation requires `Idempotency-Key`: 8–200 characters from `[A-Za-z0-9_-]`.
  - A first execution returns **201**.
  - An identical replay returns **200** with `replayed: true` and the stored result.
  - Reusing a key for a different request returns **409** `idempotency_conflict`.
- **Bodies:** `application/json` only (otherwise **415**), at most 16 KiB (otherwise **413**), and validated with zod (**400** with field paths and messages, never the submitted values).
- **Error mapping:**
  - not found, or not visible to this tenant → **404**, deliberately indistinguishable;
  - stale configuration version → **409** `config_version_conflict` with `currentVersion`;
  - unsafe or missing database → **503**;
  - anything else → generic **500** with no stack trace, SQL or input values; details are logged with redaction.
- **Read responses** include `asOf`, and all API responses are `Cache-Control: no-store`.
- **Structure:** route files in `apps/web/app/api/v1/**` stay thin. Handlers are built by a factory with injected dependencies (pool, principal resolver, allowed origins), and the logic lives in `packages/database`.
- **Migration tooling** is a separate package entry, `@tradecopier/database/migrate`, so the web bundle never contains the migration runner.

First resources: `GET/POST /api/v1/risk-profiles`, `GET /api/v1/risk-profiles/{id}`, `POST /api/v1/risk-profiles/{id}/versions` (with `expectedVersion`).

## Evidence

- Guard unit tests cover origin, idempotency key, media type, size, malformed JSON and unknown fields.
- API integration tests against real PostgreSQL with the runtime role cover:
  - 401 on every route, including with the production resolver;
  - 403 for cross-site and origin-less mutations, with no side effects;
  - spoofed `tenantId` rejected without being echoed;
  - idempotent create, replay and conflict;
  - customer B unable to list, read or version customer A's profile;
  - optimistic-concurrency 409 with the current version;
  - 404 for malformed IDs.
- A mutation check (origin guard removed) made the CSRF test fail.
- On the live dev server: 401 without a session, and 403 for a cross-site POST.

## Not yet done

- Identity provider integration: sign-in, sessions (HttpOnly, Secure, SameSite), MFA policy, recent authentication for sensitive changes, revocation.
- Operation status endpoints and per-account results (`202`), SSE with tenant authorization, and export endpoints.
