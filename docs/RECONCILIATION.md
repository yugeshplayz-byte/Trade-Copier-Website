# Reconciliation and recovery

## Model

Compare intent-derived expected positions/orders with fresh broker-reported positions/orders/executions. Never overwrite expected state with actual state merely to make the dashboard green. Keep desired target, confirmed actual state, in-flight commitments, and discrepancy evidence separately.

A position comparison uses canonical account, environment, exchange/product/expiry, signed integer quantity, and managed lineage. Quantity tolerance is zero after eligible in-flight commands settle. Different execution prices are expected; record slippage but do not call unequal prices a quantity mismatch. Orders also compare side, total/filled/remaining quantity, type, tick-aligned price, TIF, protection graph, and status/revision.

## Schedule and coherent reads

Run at activation, reconnect, worker restart, unknown submission, command rejection, unexpected execution, explicit customer request and periodic intervals. Proposed active cadence: positions/open orders every 5 seconds and deeper history/account reconciliation every 60 seconds, adjusted to provider quotas. These are design targets, not guaranteed API capacity. A coalescing scheduler prevents a per-follower polling explosion.

Establish stream-before-snapshot or provider-supported snapshot cursor. Buffer events during reads; apply only those after the snapshot boundary, deduplicate overlap. If no coherent cursor exists, use documented history plus overlapping snapshots to obtain a stable view; until that view can be trusted, block entries. Fetch all pages. Record read start/end and source times. Silence on an event stream does not imply fresh balances.

Use a short measured settling window for acknowledged in-flight orders, with PENDING rather than SYNCED. Default initial simulation threshold is 2 seconds; broker-specific certification overrides it. A late acknowledgement or expired window becomes DEGRADED/UNKNOWN, never an automatic duplicate order.

## Decision table

| Finding | State / immediate action | Recovery |
|---|---|---|
| Exact fresh match; no unknown commands | SYNCED | Continue if control and risk allow |
| Difference fully explained by known working order | PENDING | Monitor until settlement/timeout |
| Snapshot stale/incomplete or stream gap | UNKNOWN; block new entries | Resnapshot/history; do not compare inconsistent views as fact |
| Missing follower entry or margin rejection | OUT_OF_SYNC; isolate follower; alert | User can flatten/wind down or acknowledge missed entry at flat boundary; no auto top-up |
| Follower still open after leader exits | OUT_OF_SYNC; block new entries | Resolve pending entries first; under preauthorized exit policy close verified managed remainder; otherwise request confirmation |
| Unexpected manual order/position | OUT_OF_SYNC; hold account entries | Show takeover/flatten options; never assume it belongs to copier |
| Quantity exceeding target | OUT_OF_SYNC | No blind opposite order; cancel obsolete entries; propose reduction with fresh state |
| Missing/incorrect protection | ERROR with high-priority alert | Freeze entries; use certified protection repair only if explicitly authorized and bounded; else direct user action |
| Duplicate provider reports with same execution ID | No additional economic effect | Record deduplication metric |
| Corrected/busted trade | UNKNOWN | Correct ledger; inspect actual exposure; manual decision if still divergent |
| Ambiguous submitted order | UNKNOWN | Resolve client ID/history; never resend without evidence |

## Automatic action boundary

Allowed by default: read/retry snapshots within limits, reauthenticate as permitted, rebuild projections, deduplicate events, discard unsent obsolete entries, and cancel identified obsolete copier entry orders. Risk-reducing closes require the user's explicit activation policy and certified close semantics. This authorization covers the current managed episode; it does not authorize chasing old fills after a long outage.

Proposed stale-exit policy: if the leader is verified flat and the follower's lineage is unambiguous, persist a fresh reduction proposal. Automatic dispatch is allowed only while the user's reconnect-exit authorization remains valid and there are no uncertain/opening commands. Otherwise show a confirmation with fresh position and account identity. No automatic entry correction in MVP, beta, or V1.

If actual quantity is MNQ +1 while target is +2, detect it, explain whether a known order accounts for the missing contract, then mark OUT_OF_SYNC if not. Do not automatically buy 1. If target is 0 and actual is +1, a certified managed close can be a reduction, subject to the policy above.

## Recovery workflow

Incident → freeze affected new entries → capture coherent broker state and command history → classify cause → show proposed action and its scope → execute authorized action with idempotency → resnapshot → verify flat/matched → require resume preflight. Persist who authorized it, evidence times, before/after states and unresolved account results.

No automatic resumption after disconnect, unknown submission, protection-triggered local exit or mismatch. In initial releases, resume only after both leader and follower are flat with no managed working orders. If a stream loses recoverable execution history, reconstruct only current state and require a fresh activation boundary.
