# Claude Code project instructions

## Role and project

You implement this project's approved architecture locally. The project folder is `TradeCopierWebsite`; expected remote is `https://github.com/yugeshplayz-byte/Trade-Copier-Website`. Verify the actual repository root, branch and remote before changing files. GitHub is remote source control, not the primary working filesystem. Do not build the whole platform in one uncontrolled session.

Read this file and `docs/MASTER_SPEC.md`, `docs/ARCHITECTURE.md`, `docs/ROADMAP.md`, and the specifications relevant to the current phase. Read existing project instructions before merging this recommended file. Preserve useful existing rules and working functionality; report genuine conflicts.

## Mandatory local skills rule

`.agents/skills/` contains LOCAL-ONLY DEVELOPMENT TOOLS FOR CLAUDE CODE. It is not application source, website content, a runtime dependency or deployable material.

1. You MAY read and use `.agents/skills/`.
2. Before major frontend, UI/UX, visual, redesign or website-development work, inspect that directory and read the relevant `SKILL.md` files. Apply relevant guidance to frontend quality, responsive layout, accessibility, dashboard/component design, structure and visual consistency.
3. Skill discovery is not proof that a skill was read or used. Report relevant skill names and actual use without copying their private contents into project documents.
4. Do not modify any skill unless the user explicitly asks for that exact modification.
5. Do not delete, move or rename the skills.
6. Do not copy skill contents into the website, public assets, application code, generated documentation, packages, archives or deployment artifacts.
7. Do not stage, commit or push `.agents/skills/`. Never use force-add to bypass its ignore rule.
8. Do not remove `.agents/skills/` from `.gitignore`, add a negation exposing it, or otherwise change ignore rules to make it tracked.
9. The application must install, build, test and run independently of the skills folder.
10. Preserve local skill files exactly during application work. Check build contexts and deployment exclusions as well as Git tracking.

Verify with read-only commands such as `git check-ignore -v -- .agents/skills/` and `git ls-files -- .agents/skills/`. An ignore entry does not untrack already tracked files. If skills are tracked or protection is missing, explain the finding; preserve local files and history. Propose a non-destructive protection fix. Do not delete skills, untrack files, overwrite user ignore rules or rewrite Git history automatically. Continue unrelated safe inspection when possible.

The user supplies skills to improve your development decisions; they are not part of the product.

## Initial inspection

- Run `git status --short --branch`, `git branch --show-current`, `git rev-parse --show-toplevel`, and inspect `git remote -v` without revealing embedded credentials.
- Read manifests, lockfiles, existing scripts, docs, relevant tracked source, environment templates and test configuration. Do not print `.env` or secret values.
- Record uncommitted user changes and avoid overwriting them. Do not use destructive reset/clean commands or reinitialize the repository.
- Inspect relevant local skills under the rule above. If the directory is empty/missing, report it and proceed with available guidance; do not claim the skills were applied.
- Run safe existing baseline checks and record failures honestly. Do not claim an inaccessible repository was audited.
- Write `docs/REPO_AUDIT.md` with current facts, implementation gaps and the next bounded phase. Do not blindly restructure a working app into the suggested tree.

## Product and architecture requirements

The product mechanically copies a customer's own futures trades across their authorized accounts. No independent trade recommendations, third-party signal marketplace, investment discretion, unrelated portfolio management or custody features without separate scope/legal review.

Execution is server-side in a persistent worker. Browser closure does not stop copying. Keep business logic outside React components and request-handler loops. Isolate broker-specific behavior behind normalized validated interfaces. Support capability detection and explicit environment/account class. Never fake an integration or show simulated data as live.

Start with the simulated broker and EXECUTION mode. ORDER mode is separately gated and never duplicates EXECUTION-mode commands for the same lineage. Missing broker credentials or approval means simulator/disabled adapter, not an undocumented workaround. Use current official provider documentation before implementing an adapter and record the verified version/date. Published APIs do not establish commercial or hosted-routing permission.

TopstepX hosted routing is disabled under the reviewed provider restriction; any change requires written evidence covering this deployment. Do not bypass origin, account, prop-firm, licensing or credential restrictions. Never use production broker accounts in CI or place live trades merely to test connectivity.

## Financial correctness rules

- Persist normalized events, immutable intent, mappings, risk decision and outbox before any external order request.
- Enforce one execution owner per canonical account, not merely per group or connection. No cycles or chained followers.
- Use exact decimal/tick math and integer quantities; handle partial fills cumulatively.
- Timeout after possible acceptance is `SUBMISSION_UNKNOWN`. Never blindly resend. Resolve through certified broker identity/history or require review.
- A queue's at-least-once delivery is not exactly-once broker execution. Test crashes on both sides of every external call.
- Recheck risk, freshness, authorization, control epoch and reservation at dispatch.
- No silent automatic position top-up after mismatch, no automatic reopening after a follower protection exit, no stale-entry replay.
- Reversals close, confirm flat, then revalidate new exposure.
- Keep pause, entry halt and flatten separate. Do not claim flat until broker state confirms it and reopening orders are resolved.
- Billing/session/loss entry restrictions must not block otherwise authorized supported risk reductions.
- Keep broker-held protection during outages as designed; never cancel protection merely because a close command was queued.
- Follow the complete reconciliation and risk specifications. Defaults are proposed policies, not guarantees.

## Security and data

Validate external input; enforce tenant/resource authorization server-side and in workers; use migrations for schema changes and scoped DB roles. Secrets must be encrypted and restricted. Use established authentication with MFA for live access. Do not create custom cryptography, auth or MFA.

NEVER commit `.env`, credentials, API keys, real tokens or private agreements. Never hard-code secrets, print broker credentials in logs, expose them to the browser, put them in URLs, or use them in fixtures. `.env.example` may contain placeholders only. Redact diagnostic output. Separate LOCAL/STAGING/PRODUCTION identity, billing, broker and database configuration.

Use explicit build/deployment inputs so local tooling cannot be packaged accidentally. Avoid unnecessary dependencies. Document significant tradeoffs in `docs/adr/`. Do not add speculative microservices, Redis/Kafka or broad rewrites without an evidenced need.

## Working cycle

1. Establish the earliest incomplete roadmap phase from actual evidence.
2. Describe a bounded implementation plan with files/modules, dependencies, acceptance criteria and tests.
3. Implement only that phase or a reviewable vertical slice. Keep the application runnable and preserve existing work.
4. Add meaningful invariant/fault/security tests for critical behavior. Tests are part of implementation, not postponed until launch.
5. Run project tests, lint, typecheck and build. For UI work, run locally and inspect primary desktop/mobile/error workflows.
6. Provide the localhost preview when runnable and state which services must remain running. If it cannot run, give the exact blocker and do not invent a URL or successful test.
7. Report files changed, behavior, relevant skills used, commands/results, blockers, limitations and next phase. Label simulation and unsupported features clearly.
8. Stop at the review checkpoint before commit/push unless this session already explicitly authorizes those exact changes after review.

## Source-control workflow

Local inspection → local changes → local tests → localhost preview → user review → authorized commit → authorized push.

Before staging, inspect diff and status. Stage an explicit allowlist of approved application/specification files. Do not use blanket `git add .` or `git add -A`. Check `git diff --cached --name-only` and scan staged content for secrets/local tooling. Ensure `.agents/skills/` is absent. Do not include unrelated user changes.

Never force-push or rewrite remote history. Never commit or push the skills. Never alter ignore rules to expose them. If authorization to commit/push is absent, leave the completed tested changes locally for review. If authorized, confirm the intended branch/remote, commit only approved files, push normally, and report the resulting commit ID. A Git push is not proof that a hosted application deployed successfully.

## Review handoff

For Astra review, provide a concise change summary, actual diff or accessible files, phase acceptance matrix, test results and unresolved decisions. Do not claim Astra reviewed code that it has not received. Classify external uncertainty as ASSUMPTION, REQUIRES VERIFICATION, REQUIRES BROKER APPROVAL, REQUIRES CONTRACT REVIEW, REQUIRES LEGAL REVIEW or FUTURE DECISION.
