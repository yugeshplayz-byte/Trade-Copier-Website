# ADR 0004: Database access, roles and tenant isolation

Status: proposed (Phase 2a, pending review) · Date: 2026-10-11

## Context

ROADMAP Phase 2 requires persisted customer boundaries before any trading state. The acceptance bar is threefold:

- customer A cannot read or mutate customer B's data;
- migrations apply cleanly;
- repeated identical operations have no duplicate effect.

DATABASE.md calls for:

- PostgreSQL with migrations;
- tenant-scoped composite foreign keys;
- RLS applied through a non-owner role, tested with the actual roles and connection pooling;
- transaction-local tenant context.

Local PostgreSQL 18.6 is installed (official EDB installer).

## Decision

### Roles

These are created by `scripts/db/bootstrap-local.sql`, which the owner runs as superuser through `node scripts/db/bootstrap.mjs`. The superuser password is entered only at psql's prompt.

| Role | Purpose | Attributes |
|---|---|---|
| `tradeplex_migrator` | Owns databases, schemas and tables; runs migrations; owns the provisioning function | LOGIN, not superuser, no CREATEDB/CREATEROLE, no BYPASSRLS |
| `tradeplex_app` | Runtime role for web and worker | LOGIN, NOINHERIT, not superuser, no BYPASSRLS, owns nothing, column-level grants, no DELETE/TRUNCATE anywhere |

Local role passwords are generated on the machine. The runtime URL lives in `.env`. Migrator and test URLs live in `.env.db-admin`, which the web app and worker never load. The config guard refuses non-loopback hosts in LOCAL/TEST and refuses well-known superuser names in any database URL. At startup, `assertRestrictedRuntimeRole` rejects a runtime connection that is a superuser, can bypass RLS, or owns application tables.

### Tenant isolation

- Every customer table carries `tenant_id`. Configuration versions use composite foreign keys `(tenant_id, profile_id)`, so a row cannot link to another tenant's parent.
- RLS is enabled on all `app` tables, with policies scoped `TO tradeplex_app`. Policies compare against `app.current_tenant_id()` / `app.current_user_id()`, which read transaction-local settings. With no context set, every policy matches nothing: it fails closed.
- `withTenant(pool, ctx, fn)` sets the context with `set_config(..., true)` inside one transaction, so a pooled connection cannot carry context into another request. `ctx` is server-derived (session or authorized job), never taken from request input.
- The table owner bypasses RLS by design (no `FORCE`). The owner is used only for migrations and the `SECURITY DEFINER` function `app.provision_user`. That function:
  - is the single cross-tenant write path;
  - validates its input and pins `search_path`;
  - serializes concurrent calls per subject with an advisory lock;
  - creates the user plus one personal tenant idempotently.

### Migrations

A small in-repo runner (`packages/database/src/migrate.ts`):

- reads ordered `NNNN_name.sql` files and applies each in its own transaction under `pg_advisory_lock`;
- records a SHA-256 checksum in `meta.schema_migrations`;
- refuses modified applied migrations, and database migrations unknown to the codebase;
- runs only explicitly (`npm run db:migrate`), never at app startup (DEPLOYMENT.md).

A library was not adopted because the required behaviour is about 100 lines and adds no dependency risk.

### Idempotent operations and versioned config

- `executeIdempotent` stores the canonical-JSON SHA-256 request hash per `(tenant_id, idempotency_key)`.
  - Same key with the same request returns the stored result without re-running anything.
  - Same key with a different request raises `IdempotencyConflictError` (HTTP 409).
  - The operation row, its effects and an audit record commit together. If the handler fails, nothing is recorded.
- Risk profiles are the first versioned configuration. Versions are immutable (insert-only for the runtime role). Publishing takes `expectedVersion` with `SELECT ... FOR UPDATE`; a stale version raises `ConfigVersionConflictError` (HTTP 409). Limits are validated with zod before any write.
- `audit_logs` is append-only for the runtime role. As SECURITY.md notes, this is not tamper-proof against database administrators.

### Driver

`pg` 8.23.0 (node-postgres). It has a server-side statement timeout, an idle-in-transaction timeout, and a pool error listener.

## Evidence

The integration tests in `packages/database/src/database.integration.test.ts` run against real PostgreSQL with the actual runtime role. They cover:

- migration idempotence, and tamper detection;
- runtime role restrictions;
- no DELETE, TRUNCATE or history rewrites;
- idempotent and concurrent provisioning;
- fail-closed reads with no tenant context, and no context leakage across pooled connections;
- cross-tenant read, update and version attempts, and spoofed-tenant inserts;
- the composite foreign key;
- stale and concurrent version publishes;
- idempotency replay, conflict, per-tenant scope and failure retry.

A mutation check (an RLS policy changed to `USING (true)`) made four isolation tests fail.

CI runs these tests against a PostgreSQL 18 service container with `REQUIRE_DB_TESTS=1`, so a missing database fails the build instead of skipping silently.

## Not yet done (Phase 2b)

- Identity provider integration and MFA policy.
- Sessions, CSRF and origin checks.
- The authorized `/api/v1` resources, with 401/403/409/422 mapping.
- Tenant-authorized SSE.
- Export endpoints.

These are needed to prove isolation through the API, SSE and export paths. The worker and web app do not connect to the database yet.
