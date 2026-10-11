# Tradeplex

Server-side copier for a customer's own futures trades across their own authorized accounts. Specifications live in `docs/` (start with `docs/MASTER_SPEC.md` and `docs/ROADMAP.md`).

**Current state:** Phases 0–1 are complete.

- **Phase 2 (in progress):** the database foundation is built. It has restricted roles, row-level tenant isolation, idempotent operations and versioned configuration. Sign-in is next.
- **Phase 3 (in progress):** broker contracts, exact tick math, a deterministic simulated broker and an adapter conformance suite.

The build is simulator-only. There is no sign-in yet, and no broker connection; no order can be sent from the app. See `docs/REPO_AUDIT.md` and `docs/adr/`.

## Layout

```text
apps/web            Next.js control app and dashboard shell (never sends orders)
apps/worker         Persistent execution worker (runs without any browser)
packages/config     Environment validation and startup guards
packages/contracts  Shared types: environments, provider eligibility register, worker health schema
packages/observability  Redaction and structured JSON logging
packages/database   PostgreSQL migrations, tenant-scoped transactions, repositories
packages/broker-adapters/simulated  Deterministic simulated broker with fault injection (test use only)
tests/contracts     Provider-independent adapter conformance suite
scripts/            Dev launcher, Next.js wrapper, artifact and secret verification
docs/               Specifications, audit, ADRs, brand
```

## Requirements

- Node.js 24 (see `.nvmrc`). The worker runs TypeScript directly with Node's built-in type stripping.
- npm 11 (lockfile: `package-lock.json`).

## Setup

```bash
npm ci
```

```bash
cp .env.example .env
```

`.env` is git-ignored. It holds only local, non-secret values. The build refuses broker credentials, live payment keys, non-loopback databases in LOCAL/TEST, superuser database connections, and `APP_ENV=PRODUCTION`.

> **Windows PowerShell:** if `npm` fails with "running scripts is disabled", use `npm.cmd` (for example `npm.cmd run dev`) or run the underlying `node` command. There is no need to change the execution policy.

### Database (PostgreSQL 18)

1. Install PostgreSQL 18 from <https://www.postgresql.org/download/windows/>.
2. Put a restricted-role `DATABASE_URL` in `.env`. Put `MIGRATION_DATABASE_URL`, `TEST_DATABASE_URL` and `TEST_MIGRATION_DATABASE_URL` in `.env.db-admin`. Both files are git-ignored; see `.env.example` for the format. Generate fresh local passwords.
3. Create the roles and databases. Run this in a normal terminal window, since psql must prompt you for the `postgres` superuser password:

   ```bash
   node scripts/db/bootstrap.mjs
   ```

4. Apply migrations to the dev database:

   ```bash
   npm run db:migrate
   ```

Integration tests reset and migrate `tradeplex_test` automatically. If the test URLs are missing, they are skipped with a warning; CI requires them.

## Run

```bash
npm run dev
```

This starts both processes:

- Web: <http://127.0.0.1:3000>
- Worker health: <http://127.0.0.1:4100/healthz> (loopback only)

They run as separate processes (`npm run dev:web` and `npm run dev:worker` start them individually). Closing the browser does not stop the worker; stopping the process or shutting down the computer does.

## Checks

```bash
npm run check
```

That runs lint, typecheck, tests, build and artifact verification. Each can also run on its own: `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`, `npm run verify:artifacts`.

`verify:artifacts` confirms that local-only tooling (`.agents/skills/`, `.claude/skills/`) and env files are neither tracked nor in the build output. It also runs a heuristic secret scan over commit candidates.

## Local-only tooling

`.agents/skills/` holds local Claude Code development skills. It is git-ignored, must never be committed or packaged, and the application has no dependency on it.
