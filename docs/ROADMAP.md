# Phased implementation roadmap

Scope one phase per Claude implementation cycle, splitting large phases into smaller reviewable slices. Implement against dependencies, not a calendar promise. Security, risk, reconciliation and tests are introduced early and deepened later. Independent founder approval research can proceed while simulator development continues; unavailable commercial access does not block useful simulator work.

Every phase ends with a change summary, test results, runnable preview if applicable, known limitations, and the next exact task. Commit/push only after user review authorization. Do not report a later phase complete because screens exist without working backend behavior.

## Phase 0 — Inspect and protect the existing project

- **Goal:** establish facts without damaging local work or skills.
- **Features/systems:** repository audit, documentation alignment, Git/build exclusions.
- **Dependencies:** local `TradeCopierWebsite` checkout and this package.
- **Steps:** read existing `CLAUDE.md`; run Git status/branch/root/remotes; inspect manifests, tracked source, docs and existing functionality; inspect relevant local skill metadata and SKILL.md as needed; verify ignored/untracked status; run safe existing baseline checks; write `docs/REPO_AUDIT.md` and gap/next-phase report.
- **Acceptance:** verified current stack/branch/remote, changed files preserved, skills absent from tracking/build contexts, actual test baseline recorded, next bounded task identified.
- **Tests:** existing commands; `git check-ignore` and `git ls-files` checks; no invented test pass if environment is missing.
- **Risks:** wrong directory/remote, tracked private tooling, destructive overwrite, secrets in diagnostics.
- **Must not break:** local skills, uncommitted changes, existing application and ignore protections.

## Phase 1 — Foundation and one safe application shell

- **Goal:** make the verified project runnable with explicit simulator-only defaults.
- **Features/systems:** module boundaries, environment validation, minimal navigation/design primitives, local setup documentation, CI baseline.
- **Dependencies:** Phase 0 report; preserve an adequate existing framework.
- **Steps:** record stack ADR; add only needed domain/contracts/worker seams; configure locked scripts; design accessible shell using relevant skills; create synthetic fixtures; establish logging redaction and build allowlist.
- **Acceptance:** local shell and worker startup run, environment mode is clear, production credentials are refused in test mode, no broker orders can be sent.
- **Tests:** build/lint/typecheck, env guard, startup smoke, artifact exclusions and narrow viewport check.
- **Risks:** unnecessary rewrite, needless dependencies, frontend demo mistaken for a working copier.
- **Must not break:** baseline functionality, skills isolation, existing user data.

## Phase 2 — Identity, tenant database and authorized control API

- **Goal:** real persisted customer boundaries before trading state.
- **Features/systems:** auth, tenant/account schemas, RLS, migrations, versioned config and idempotent operations.
- **Dependencies:** Phase 1; auth provider selection using current docs.
- **Steps:** configure development auth; create user/tenant/config tables and scoped queries; implement session/CSRF/resource checks; add operation status endpoints; create two-tenant test fixtures.
- **Acceptance:** customer A cannot read/mutate customer B data through API, DB role, export or stream; migrations apply cleanly; repeated identical operation does not duplicate effects.
- **Tests:** auth, permission denial, pool-context isolation, migration, idempotency/conflict scenarios.
- **Risks:** UI-only isolation, privileged DB role bypass, stale authorization.
- **Must not break:** environment isolation and existing sign-in if present.

## Phase 3 — Adapter contracts and deterministic simulated broker

- **Goal:** test provider-independent behavior before live integration.
- **Features/systems:** normalized types, capability manifest, instrument/account identity, simulator fault controls.
- **Dependencies:** Phase 2 persistence and tenant checks.
- **Steps:** implement normalized schemas and error classes; simulator orders/executions/snapshots; virtual clock and seeded faults; connection discovery/status workflow; adapter contract test harness.
- **Acceptance:** reproducible partial fills, rejects, disconnects, duplicate/out-of-order events, missing acknowledgements; unsupported capabilities fail clearly.
- **Tests:** broker contract suite, deterministic replay, secret-redaction fixtures, environment identity cases.
- **Risks:** overfitting simulator to easy behavior, assuming native support.
- **Must not break:** tenant isolation and simulator labeling.

## Phase 4 — Durable execution slice with risk and reconciliation

- **Goal:** one leader/two followers copy correctly across a restart in simulation.
- **Features/systems:** inbox/outbox, command/mapping ledger, account coordinator, multiplier sizing, caps, basic reconciliation, activity projection.
- **Dependencies:** Phase 3.
- **Steps:** implement atomic event processing and reservations; stable IDs; known/unknown submission states; cumulative size calculation; serialize account commands; compare actual/expected state; show first end-to-end timeline.
- **Acceptance:** first vertical slice in MASTER_SPEC works; duplicate events have one economic effect; post-acceptance crash cannot cause blind resend; fresh snapshots gate entries.
- **Tests:** scenarios 1–5, 7–9, 13–14, 17 in TESTING.md; transaction rollback and worker restart.
- **Risks:** external exactly-once assumption, partial-fill rounding, oversubscribed limits.
- **Must not break:** no UI-dependent execution, durable intent, known tenant/environment identity.

## Phase 5 — Recovery and safety controls

- **Goal:** deterministic behavior under faults and controls.
- **Features/systems:** pause/resume/halt/flatten, disconnect and reconciliation recovery, latches, sessions, fixed/ratio sizing specs implemented where tested.
- **Dependencies:** Phase 4.
- **Steps:** separate control/connectivity/consistency state; cancel-before-ack and reversal handling; leader/follower outage paths; stale-exit authorization; daily loss and session baselines; account takeovers; all remaining deterministic faults.
- **Acceptance:** all mandatory simulator scenarios pass; entry halt never falsely claims flat; unresolved broker state blocks exposure increases; resume requires defined preflight.
- **Tests:** full critical scenario suite, property tests, DST/loss reset, OCO/flatten simulator races.
- **Risks:** exit reversal, auto-reopening stopped positions, duplicated recovery commands.
- **Must not break:** native protection model, risk-reduction access, exclusive ownership.

## Phase 6 — Complete operational frontend

- **Goal:** a user can configure, observe and resolve simulated copier operations without developer tools.
- **Features/systems:** wizard, accounts/connections, detail/timeline, risk, alerts, snapshot+SSE, responsive UI.
- **Dependencies:** Phases 2–5 backend behavior.
- **Steps:** apply relevant local design skills; implement page contracts; wire actual read models/operations; add cursor resync and stale state; add per-account operation results and accessible confirmation flows.
- **Acceptance:** complete user journey including failure and recovery; browser closure has no effect on worker; narrow screens preserve critical controls; no fake healthy values.
- **Tests:** user-flow E2E, SSE reconnect/isolation, accessibility/keyboard, mobile and stale/empty/error checks.
- **Risks:** optimistic success, hidden operational failure, scope ambiguity in flatten.
- **Must not break:** command authorization, simulator/live distinction, backend source of truth.

## Phase 7 — First provider access spike and read-only adapter

- **Goal:** validate real technical access and commercial eligibility before trading.
- **Features/systems:** approved auth/secret custody, account discovery, capabilities, instrument lookup, streams/snapshots.
- **Dependencies:** Phases 3–5; sufficient provider permission for the exact testing activity.
- **Steps:** investigate Tradovate first; record the exact product/terms; implement only documented endpoints; read accounts/history; verify quotas, auth lifecycle, timestamps and account aliases; update evidence matrix.
- **Acceptance:** permissions and gaps documented; accurate read-only states; hosted order access remains disabled unless explicitly permitted.
- **Tests:** read-side contracts, token rotation, auth failure, snapshot gaps/pagination, permission denial and log scans.
- **Risks:** confusing personal access with commercial permission or partner/admin APIs with customer OAuth.
- **Must not break:** simulator, encrypted credentials, account boundaries; do not send a trade to prove read access.

## Phase 8 — First provider practice execution certification

- **Goal:** prove actual provider lifecycle and recovery with explicitly authorized practice accounts.
- **Features/systems:** order submission, ambiguous outcome resolution, native protection/close where supported, conformance evidence.
- **Dependencies:** Phase 7 access and hosted-routing authorization; Phase 5 tests.
- **Steps:** allowlist account IDs; certify market execution mode first; verify client IDs/retries; test cancel/partial/reconnect; test protection and flatten races; record capabilities; deny unproven order families.
- **Acceptance:** every enabled capability has evidence; no unexplained duplicate/reversal; customer-visible limitations documented; live mode remains gated.
- **Tests:** adapter conformance plus seeded core faults, controlled practice outage/restart and protection tests.
- **Risks:** practice/live differences, inadequate broker history, accidental real account use.
- **Must not break:** unknown-outcome halt, authorized account list, provider terms.

## Phase 9 — Billing, support and operations

- **Goal:** commercial lifecycle and incident tools without unsafe trading side effects.
- **Features/systems:** payment test mode, entitlement snapshots, notification delivery, admin RBAC, metrics and runbooks.
- **Dependencies:** Phase 6; billing business eligibility review for future live activation.
- **Steps:** implement verified webhook inbox; plan/version limits; safe downgrade/cancellation; in-app/email incident grouping; redacted admin pages; alert routing; support diagnostic export.
- **Acceptance:** failed payments block only new exposure after policy, exits stay available, restricted admin actions are audited, alert owner receives test incidents.
- **Tests:** billing duplicates/out-of-order, tenant limit races, exit access after lapse, admin RBAC, notification retry/dedupe.
- **Risks:** account shutdown stranding exposure, trading-related processor eligibility, support overprivilege.
- **Must not break:** risk latches, broker authorization or safe exit access.

## Phase 10 — Staging, independent security review and recovery drills

- **Goal:** validate the hosted system as an operational service.
- **Features/systems:** isolated deployment, secrets/keys, migrations, backups, fencing, CI artifact and security checks.
- **Dependencies:** Phases 5–9; exact provider test permissions.
- **Steps:** deploy staging simulator first; test authorized practice only afterward; inspect roles/egress; exercise worker termination and partition; restore backup with dispatch disabled; run load/soak and independent security review.
- **Acceptance:** full browser→API→worker→broker→DB→UI flow verified; restore/fencing proven; no unresolved critical execution/security defects; named on-call coverage.
- **Tests:** load targets, split-brain and restore scenarios, pentest findings regression, staged upgrade/rollback.
- **Risks:** live secrets in staging, automatic replay after restore, unproven failover.
- **Must not break:** one writer per account, audit continuity and protection during deploys.

## Phase 11 — Restricted private beta

- **Goal:** limited real-customer validation within approved account types and operating hours.
- **Features/systems:** allowlisted users/accounts, conservative caps, user education, incident/support process.
- **Dependencies:** legal/provider/contract approvals for the actual beta, Phase 10 pass and documented customer consent.
- **Steps:** onboard a small cohort with explicit scope; require MFA; demonstrate pause/flatten and failure handling; staff sessions; review every mismatch/rejection; hold expansion on incidents.
- **Acceptance:** proposed five-session soak completed with no unresolved critical faults; evidence supports supported workflows; users can understand and recover failures.
- **Tests:** production smoke without unsolicited trades, scheduled supervised scenarios under explicit user consent, audit review.
- **Risks:** slippage, real outages, account-specific restrictions, insufficient support capacity.
- **Must not break:** account/firm eligibility, risk caps and ability to stop new entries immediately.

## Phase 12 — Production V1 readiness and narrow launch

- **Goal:** launch only certified scope with honest public documentation and paid lifecycle.
- **Features/systems:** approved public/legal pages, production billing, service/incident docs; ORDER mode only if separately certified.
- **Dependencies:** Phase 11 evidence; all approval-register items closed for scope.
- **Steps:** resolve beta issues; reverify current agreements; finalize prices/support; certify selected native order families if ready; enable approved feature flags; document limitations and rollback; release explicitly.
- **Acceptance:** production checklist signed by engineering/operations/founder and relevant reviewers; current capability matrix; no unsupported integration advertised; staged rollout works.
- **Tests:** complete critical regression, billing live-mode configuration verification without unauthorized charges, release smoke, alert/rollback rehearsal.
- **Risks:** marketing exceeds implementation, unreviewed feature expansion, unsupported native order edge cases.
- **Must not break:** approved behavior, safety access, least privilege and local-skill exclusion.

## Phase 13 — Additional providers and later features

- **Goal:** extend without changing core invariants.
- **Features/systems:** independent NinjaTrader/Rithmic integrations as approved; more order families, optional future sizing and organization features.
- **Dependencies:** separate provider/legal access plus repeated Phases 7–11 for each addition.
- **Steps:** compare capability gaps; implement isolated adapter; reuse conformance/fault tests; explicitly map accounts/contracts; validate quotas and licensing; canary approved accounts; update documentation.
- **Acceptance:** existing adapter suites unchanged and passing; new provider scope certified; cross-provider differences visible to users.
- **Tests:** regression across every enabled adapter pair and mode, out-of-order/partial/fault combinations, rate-limit load.
- **Risks:** assuming API compatibility, cross-provider instrument errors, changing ownership/legal scope.
- **Must not break:** core adapter independence, single writer, customer-owned-account boundary. TopstepX hosted order execution remains disabled unless its deployment restriction is resolved in writing.

## Critical path and next task

Phase 0 → 1 → 2 → 3 → 4 → 5 → 6 produces a useful internal MVP. Phases 7–8 establish one real adapter. Phases 9–11 establish commercial/operational readiness and limited beta. Phase 12 is a deliberate launch; Phase 13 is independent expansion.

The next task for Claude is Phase 0. After it verifies the checkout, it should implement the earliest incomplete bounded phase whose prerequisites exist. Missing provider permissions should lead to simulator work, not invented connections. No reliable implementation timeline or budget can be promised until the repository audit, provider access and staffing decisions are known.
