# Repository audit (Phase 0)

Audit date: 2026-10-11. Performed by Claude Code against the local Windows checkout. Everything below was observed with read-only commands unless stated otherwise. It records facts and gaps; it is not a security certification.

## Checkout identity

| Fact | Observed value |
|---|---|
| Repository root | `C:/Users/yuges/OneDrive/Microsoft Copilot Chat Files/Documents/TradeCopierWebsite` |
| Branch | `main`, tracking `origin/main`, not ahead/behind at audit start |
| Remote | `origin` → `https://github.com/yugeshplayz-byte/Trade-Copier-Website.git` (no embedded credentials in the URL) |
| HEAD | `9518d5c Keep Claude skills local only` (parent `4e14157 Initial TradeCopierWebsite project`) |
| Uncommitted work at start | Untracked `CLAUDE.md` and `docs/` (the architecture package). Preserved; not overwritten. |
| Git config of note | `core.autocrlf=true`, `core.symlinks=false`; no global excludes file; `.git/info/exclude` has defaults only |
| Local toolchain | Node `v24.21.0`, npm `11.19.0`, Git `2.45.1.windows.1`. **Not installed:** pnpm, Docker, PostgreSQL (`psql`). |

## Tracked files at audit start

Only three files were tracked: `.gitignore` (one line: `.agents/skills/`), `DESIGN.md`, `skills-lock.json`.

There was **no application code**: no `package.json`, lockfile, source tree, database/migrations, tests, CI configuration, environment template or build/deployment configuration. The project is greenfield; there is no existing functionality to preserve beyond the documents themselves.

| File | Observation |
|---|---|
| `DESIGN.md` | A design-system analysis of Anthropic's Claude marketing brand (cream canvas, coral CTAs, Anthropic wordmark notes). It is not a product design system for this copier. Using it as this product's identity would imitate another company's branding, so the application shell does **not** adopt it. It is left untouched. FRONTEND.md's "restrained neutral palette" governs instead. |
| `skills-lock.json` | Local-skills metadata (source repo `Leonxlnx/taste-skill`, skill paths, content hashes). It is tooling metadata, not skill content or application source. Left untouched; whether it should remain tracked is the owner's choice. |

## Architecture package

`CLAUDE.md` plus `docs/` contain: MASTER_SPEC, ARCHITECTURE, ROADMAP, COPIER_ENGINE, BROKER_ADAPTERS, DATABASE, RISK_ENGINE, RECONCILIATION, REALTIME, SECURITY, TESTING, FRONTEND, DEPLOYMENT, OPERATIONS, BILLING_ADMIN, LEGAL_REVIEW, SOURCES. All files ROADMAP references for Phases 0–6 exist. No prior project instructions existed to merge with `CLAUDE.md`, so there are no conflicts. `docs/adr/` did not exist.

## Local skills protection

| Check | Result |
|---|---|
| `git check-ignore -v -- .agents/skills/` | `.gitignore:2:.agents/skills/` — ignored |
| `git ls-files -- .agents/skills/` | empty — not currently tracked |
| `git status --ignored` | `.agents/` reported as ignored |
| Local contents | 14 skill directories present (brandkit, design-taste-frontend, design-taste-frontend-v1, full-output-enforcement, gpt-taste, high-end-visual-design, image-to-code, imagegen-frontend-mobile, imagegen-frontend-web, industrial-brutalist-ui, minimalist-ui, redesign-existing-projects, stitch-design-taste, web-design-guidelines) |
| Build/deployment contexts | None existed at audit start (no Dockerfile, `.dockerignore`, bundler or deploy config) |

### Findings needing your decision

1. **Skills remain in published history.** Commit `4e14157` added the 15 skill files. Commit `9518d5c` removed them from the index and added the ignore rule. Both commits are on `origin/main`, so the skill files can still be retrieved from GitHub history. Removing them would require rewriting and force-pushing history, which this workflow forbids doing automatically. Options: (a) accept it; the content appears to come from a public skill repository, but check that repository's licence terms on redistribution; or (b) you decide on a coordinated history rewrite yourself. No action was taken.
2. **`.claude/skills/` holds 14 dangling symlinks, and nothing ignores them.** They point to `…/Documents/TradeWebsite/.agents/skills/<name>`, a folder that does not exist (it looks like a renamed earlier folder). Git currently prints `could not open directory '.claude/skills/…'` warnings and cannot see their contents. If those links ever resolve again, `.claude/skills/` would appear as untracked and a blanket `git add` could commit the skills. **Applied (additive, reviewable):** `.claude/skills/` was added to `.gitignore` in the Phase 1 change set. The links themselves were not modified or repaired.
3. **The repository lives inside OneDrive.** Syncing `node_modules/` and `.next/` produces heavy churn and can lock files on Windows. Consider excluding those folders from OneDrive sync or moving the checkout out of OneDrive. This is not a blocker.

## Baseline checks

There are no manifests or test configuration, so **no baseline build, lint, typecheck or test command existed to run**. That means "not run because absent", not "passed". The only baseline checks possible were the Git and skills checks above.

## Gaps against the specifications

Every roadmap phase from 1 onward was unimplemented at audit start: no runtime, no environment guards, no worker, no database, no authentication, no adapter contracts, no simulator, no copier/risk/reconciliation logic, no UI, no CI.

Environment gaps that affect later phases:

- **PostgreSQL is not available locally** (no install, no Docker). This blocks Phase 2, which needs real migrations, RLS roles and connection-pool isolation tests. A decision is needed: install PostgreSQL for Windows from the official installer (preferred; it matches DEPLOYMENT.md "local PostgreSQL via supported local install"), or approve an embedded PostgreSQL dev dependency.
- **Authentication provider not selected.** Phase 2 requires choosing a managed OIDC provider with MFA against current documentation, and creating a development tenant/client. Creating that account is your action.

## Correct next phase

Phase 1, "Foundation and one safe application shell". It depends only on this audit, and it is not blocked by provider approvals or the database. Phase 2 cannot start until the PostgreSQL and auth-provider decisions above are made.

## Phase 1 status

See `docs/adr/0001-stack-and-repository-layout.md`, `docs/adr/0002-environment-guard-and-dispatch-gate.md` and the root `README.md` for what Phase 1 added. Phase 1 deliberately has no database, authentication, broker adapters or copier logic.
