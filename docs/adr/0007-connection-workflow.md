# ADR 0007: Broker connection workflow (simulator)

Status: proposed (completes Phase 3) · Date: 2026-10-11

## Context

ROADMAP Phase 3 requires a connection discovery and status workflow. BROKER_ADAPTERS.md defines the lifecycle `CREATED → AUTHENTICATING → CONNECTING → SNAPSHOTTING → READY`, with failure branches, and states that an open socket is not READY. ARCHITECTURE.md assigns broker sessions to the execution worker, never to the web app.

## Decision

- **Schema** (migration 0003):
  - `app.broker_connections` and `app.broker_accounts`, both carrying `tenant_id`, with a composite foreign key from accounts to their connection, row-level security, and no DELETE for the runtime role.
  - CHECK constraints accept only `simulated` / `SIMULATED` (account class `SIMULATED`), as defence in depth behind the API's 422 for unapproved providers.
  - `canonical_account_id` is **unique across all tenants**, so one account has one owner. Simulator accounts are namespaced by connection (`sim:<connectionId>:<account>`), so separate connections never collide.
- **Requests:** `POST /api/v1/connections` records a request (`202`, with idempotency key and origin checks) and returns `CREATED`. Real providers get `422 provider_not_approved`, with the eligibility register's status and reason. `GET` endpoints are tenant-scoped (404 for others).
- **Worker supervisor** (`apps/worker/src/connections.ts`):
  - It claims waiting connections with `app.claim_connection_work`, a narrow `SECURITY DEFINER` function using `FOR UPDATE SKIP LOCKED` that returns each claim's tenant. All further work then runs inside that tenant's context.
  - It authenticates (`sim:` reference), moves to `SNAPSHOTTING`, connects, discovers accounts and takes a complete snapshot of each. It records the accounts idempotently and then marks the connection `READY`.
  - Failures become `DISCONNECTED` with a reason and no automatic retry. Unapproved providers become `BLOCKED`.
  - The worker polls every 2 s, never overlapping ticks.
- **Restart:** sessions live only in worker memory. On startup, `app.mark_connections_for_reconnect` moves every previously live connection to `RECONNECTING`. It is re-established and re-snapshotted, never assumed live. Accounts are not duplicated.
- **Tenant context for jobs:** `TenantContext.userId` may be `null` for worker jobs. `UserContext` (a non-null user) is required wherever an actor is recorded.
- **UI:** the Connections page lists the tenant's connections, with state, environment, snapshot time (ET) and each account's position, open orders and snapshot cursor. It polls only while a connection is still being established. "Add simulated connection" reuses its idempotency key across retries of the same click.

## Evidence

- Database integration tests:
  - the simulator-only constraint (23514);
  - tenant isolation;
  - cross-tenant canonical uniqueness (23505) with nothing exposed;
  - idempotent account recording;
  - disjoint concurrent claims;
  - restart marking.
- Worker integration tests: the full lifecycle to READY with three flat accounts and connection-scoped canonical IDs; restart recovery without duplicates; deterministic seeds.
- API integration tests: 202 with replay, 422 for Tradovate (NOT_APPROVED) and TopstepX (BLOCKED), 400 for unknown providers, 404 across tenants, and 401/403/400 guards.
- Live, signed in as the owner: "Waiting for worker", then READY in about 2 s with three flat accounts. After a worker restart, RECONNECTING was followed by READY with a fresh snapshot and still three accounts.

## Consequences and limits

- One worker process owns sessions. There are no leases or fencing yet; multi-worker ownership and fencing are Phase 4–5 work (DEPLOYMENT.md).
- The web app and worker share the runtime role. A narrower worker role is planned with the execution slice.
- Order dispatch remains disabled: the simulator is connected but not registered in the dispatch gate until durable intents exist (Phase 4).
