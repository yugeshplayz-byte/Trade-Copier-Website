# Tradeplex

Server-side copier for a customer's own futures trades across their own authorized accounts. Specifications live in `docs/` (start with `docs/MASTER_SPEC.md` and `docs/ROADMAP.md`).

**Current state: Phase 1 development build.** It is simulator-only. There is no sign-in, no database, no broker connection, and no order can be sent. See `docs/REPO_AUDIT.md`.

## Layout

```text
apps/web            Next.js control app and dashboard shell (never sends orders)
apps/worker         Persistent execution worker (runs without any browser)
packages/config     Environment validation and startup guards
packages/contracts  Shared types: environments, provider eligibility register, worker health schema
packages/observability  Redaction and structured JSON logging
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

`.env` is git-ignored. It holds only local, non-secret values. The build refuses broker credentials, live payment keys, non-loopback databases in LOCAL/TEST, and `APP_ENV=PRODUCTION`.

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
