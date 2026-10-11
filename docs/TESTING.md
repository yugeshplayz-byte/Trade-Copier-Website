# Testing and release evidence

## Strategy

Build deterministic tests alongside each phase. Tests verify financial and security invariants, not merely matching implementation details. Use the simulated broker's virtual clock for faults; real provider practice testing is additional conformance evidence, not a replacement. Never use production accounts in CI.

| Subsystem | Required tests |
|---|---|
| Copier domain | Multiplier/ratio/fixed sizing boundaries, zero rounding, cumulative partial fills, reductions, reversals, stale/superseded intent, immutable settings |
| Orders/mapping | Cancel-before-ack, fill-during-cancel, replace IDs, expired partial order, reject after partial fill, bracket child quantities, native OCO race |
| Risk | Shared reservation races, known+unknown exposure, loss latch persistence, DST/reset, stale equity, fee/cashflow adjustments, legitimate exits despite entry blocks |
| Inbox/outbox/database | Duplicate delivery, conflicting payload identity, transaction rollback, crash before/after persistence, account ordering, migration constraints |
| Adapter contract | All declared capability families, signed quantities, exact prices, timestamps, full pagination, sequence scope, error classification, refresh, reconnect, quota handling |
| Reconciliation | Explained pending difference vs mismatch, missing/extra/manual exposure, stale snapshot, reconnect leader flat, unknown submission resolution, bust/correction |
| Authentication/isolation | Tenant-ID substitution, cross-tenant objects/exports/SSE/jobs, revoked grant, actual RLS roles and connection pooling, MFA recovery |
| API | Idempotency keys with same/different body, stale config version, scope validation, auth/CSRF, operation status progression |
| UI | Setup and review, unavailable/empty/stale distinctions, keyboard/focus, pause vs flatten, per-follower failure, narrow-screen operations |
| Billing/admin | Duplicate/out-of-order webhooks, invalid signature, renewal/downgrade with exposure, failed payment preserving exits, admin role and audit checks |
| Deployment/security | Secret scans, build exclusion of skills, dependency review, backup restore, egress fencing, production/staging separation |
| Load | Intended launch account/follower fanout, burst events, slow provider, rate-limit budgets, queue age, p95/p99 stage latency, memory/DB saturation |

## Mandatory deterministic scenarios

1. Deliver the same buy execution 100 times: one economic fill in the ledger; no additional follower command.
2. Deliver leader cumulative fill 2 then stale fill-status 1: do not reduce the economic total absent an explicit correction.
3. Buy 3 at 0.5x in partial executions: follower target ends 1, not 0 or 3; exit leaves zero.
4. Crash immediately after broker accepts a buy but before acknowledgement persists: UNKNOWN → resolve existing order; zero blind retries.
5. Crash before intent transaction commits: no outbound order; event can be reprocessed once.
6. Leader closes while follower disconnected: no replayed entry on reconnect; managed residual handled under confirmed exit policy.
7. Follower margin rejection: isolate follower, notify, preserve unaffected followers, no automatic compensation round trip.
8. Leader +2→−1 at 2x: close +4, confirm zero, then short 2 if allowed. A risk failure leaves zero.
9. Pause races with queued entry: later epoch prevents unsent entry; in-flight acceptance is resolved and displayed.
10. Follower protective stop fills while leader remains long: follower is not reopened automatically.
11. OCO legs race during flatten: no reversal in certified flow; unsupported flow remains blocked.
12. Duplicate canonical account through two connections: second active ownership claim rejected.
13. Two accounts race for one group contract of remaining capacity: one succeeds, one is blocked.
14. Database connectivity lost while broker request in flight: no failover duplicate; reconstruct from broker after persistence returns.
15. Billing becomes entry-disabled while position open: supported exits/protection remain available.
16. Manual follower trade changes exposure: mismatch shown, no silent target adoption.
17. Complete leader round trip occurs before follower dispatch: obsolete unsent entry/exit skipped; no late speculative round trip.
18. Trading day crosses DST and process restart: exactly one defined baseline reset, no latch bypass.
19. Replay archive in analysis mode: zero outbound provider requests.
20. Disconnect browser after activation: worker continues and audit proves results; reopen gets consistent snapshot/SSE.
21. Former worker is network-partitioned but still running: replacement cannot send until old egress is fenced or termination proven.
22. Restore an old DB backup containing READY commands: trading starts disabled; commands are reconciled, not automatically resent.

Property-based tests generate valid and invalid event sequences and assert: tenant isolation; bounded quantities; no duplicate logical command; terminal state cannot regress from stale data; reductions cannot reverse exposure; latches survive restarts; no unsupported capability becomes an order. Seed/replay every failure.

## Acceptance evidence

Each phase report records commit/worktree identity, environment, simulator seed or provider practice account class, test commands, outcomes, remaining gaps and sanitized artifacts. Production-provider certification records API version, permissions, actual observed behavior and limitations. Unknown behavior is a failed gate, not a passing mocked test.

Proposed pre-beta soak: at least 5 full relevant trading sessions at intended small-beta capacity, including disconnect/restart/unknown-submit exercises. Proposed launch load target: 2x planned launch concurrency and 5x measured normal burst rate within certified provider quotas. These are planning targets to refine after Phase 0 and provider limits, not universal standards.

Release gates: all critical scenarios pass; lint/typecheck/build pass; no known duplicate-order, tenant-leakage or unintended-reversal defect; no unresolved exploitable high/critical security issue in critical paths; restore and operational drills pass; legal/provider gates closed. A single critical execution defect blocks live expansion.
