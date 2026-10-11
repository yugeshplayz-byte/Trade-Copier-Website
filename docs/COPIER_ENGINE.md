# Copier engine

## Safety invariants

- Every command maps to one tenant, canonical account, environment, group activation epoch, settings version, source cause, and risk decision.
- One immutable logical command may have multiple transport attempts only when nonacceptance is established or provider deduplication is certified for that same command.
- Persist intent before making an external call. Never claim exactly-once external execution across the database and broker.
- Do not add exposure to reconcile an unexplained mismatch. A normal new fill is different from repairing old divergence.
- Do not let a sell intended as an exit become a new short, or a buy exit become a new long.
- No follower-generated event becomes a leader signal; reject multi-group cycles at configuration time and retain command provenance at runtime.
- Replay reconstructs state with dispatch disabled. Replayed historical fills never become fresh trades.

## Orthogonal state model

Store three independent axes. Do not overload one status string.

| Axis | Values |
|---|---|
| Desired control | DRAFT, ARMING, ACTIVE, PAUSING, PAUSED, EXIT_ONLY, HALTED, FLATTENING, DISABLED |
| Connectivity | CONNECTED, STALE, RECONNECTING, DISCONNECTED, AUTH_REQUIRED |
| Consistency | SYNCED, PENDING, DEGRADED, OUT_OF_SYNC, UNKNOWN, ERROR |

The UI shows the most severe condition plus the other badges. `SYNCED` requires matching fresh confirmed state, not simply absence of errors. PENDING denotes expected transient differences while acknowledged commands are working. Partial follower failure can degrade a group while leaving unaffected followers operational under the configured isolation policy.

Activation claims exclusive account membership, snapshots flat state, freezes the settings version, and records a stream boundary. Events before that boundary are evidence only. Pause increments the control epoch so queued entries cannot escape. Resume requires a new preflight and is permitted only at a flat leader/follower boundary in MVP/beta. No missed-entry catch-up.

## Primary mode: EXECUTION

For each confirmed leader execution, update the signed leader net position and immutable fill ledger. Compute the follower target from the activation's sizing rule. Only that stream of fills changes target exposure; leader order placement does not.

Target `T` is a signed integer. Let `A` be the fresh actual follower position, `W` the signed unfilled quantities of outstanding copier commands, and `R` the signed reservations of prepared commands. A normal new intent considers `D = T - A - W - R`. It can proceed only if the prior state is consistent, command outcomes are known, and account sequencing and risk checks approve it. Opposing working orders are not blindly netted: cancel/resolve them before dispatching an opposite-side command. Unknown outcomes prevent use of this equation for new orders.

Process source events durably and in order. Coalesce unsent obsolete targets where appropriate, recording each superseded intent. Example: a buy and complete exit arrive before any follower submission; submit neither, record a missed round trip. Do not execute both late. If an entry is already in flight, resolve/cancel it and close any resulting exposure under the latest target. A newly received event whose provider timestamp is old, or follows a stream gap, is held for reconciliation instead of treated as a fresh entry.

### Sizing contracts

Use rational arithmetic, nonnegative integer lots, and round magnitude down. Never round a fractional result up to one unless the user explicitly chooses a separately tested future policy. A zero-sized copy is a visible `SKIPPED_ROUNDING` result, not an error or an invisible trade.

| Rule | Definition | Release / limitation |
|---|---|---|
| Multiplier | `T(L) = sign(L) * floor(abs(L) * numerator / denominator)` | MVP. Apply to cumulative net exposure, not independently to each partial fill. |
| Ratio | Same formula with explicit numerator/denominator and preview examples | Beta. Same engine, different UX. |
| Fixed opening-order quantity K | At a flat start, freeze original accepted leader opening order quantity `Q0`; target magnitude is `floor(K * abs(L) / Q0)` | Beta. Maximum K when original order fills. Additional independent scale-in orders in that episode are unsupported and halt entries. If Q0 is unknown, reject activation for this rule. |
| Equity proportional | Frozen, verifiable equity ratio at a documented boundary | Future; no inference from nominal prop account size. |

For fixed sizing, the original opening order may fill in parts. A partial cancellation can leave copied quantity below K; do not top it up. Changing the opening total after fills is unsupported until separately specified. For all rules, complete leader exit targets zero and closes the remaining copier-owned follower quantity after pending entry resolution. Record expected-versus-actual residuals instead of leaving dust due to rounding.

Examples: 0.5x leader cumulative 1, 2, 3 contracts yields follower targets 0, 1, 1. Leader 3→2→1→0 yields 1→1→0→0. At 2x, leader +2→−1 is split into follower +4→0, confirmed flat, then 0→−2 after current risk revalidation. If risk blocks the new short, remain flat and display skipped reversal entry. In fixed mode, Q0=4 and K=2 gives targets 0,1,1,2 as the opening order fills 1,2,3,4.

Default on a requested target exceeding a hard cap: reject the risk-increasing intent and mark divergence. Do not silently clamp into a different strategy. A future user-selected capped-sizing policy must explicitly show its consequences for exits and mapping.

### Event semantics

| Leader event | EXECUTION behavior |
|---|---|
| Market order fill | Update target and submit supported follower market delta |
| Limit, stop, stop-limit fill | Same fill-derived behavior; follower price/type is not a replica of the leader resting order |
| Modify/cancel unfilled leader order | No follower order exists to modify/cancel; record informational event |
| Partial fill | Recompute cumulative target; reserve against pending deltas so duplicate/partial events do not multiply orders |
| Reject/expire with zero fill | No copy; if partially filled, retained fills still count |
| Position increase/reduction | Update target; reductions are clipped to verified managed exposure and pending orders resolved |
| Reversal | Close then confirm flat, then revalidate entry; never one blind oversized opposite order |
| Bracket/OCO child execution | Treat as a closing fill; do not also execute an independent bracket-mirroring path |
| Trailing stop update | Informational in this mode; its eventual execution changes target |
| Trade correction/bust | Apply explicit ledger correction, hold new entries, reconcile; no automatic replacement trade |

In MVP the simulator follower has no independently hosted protective stop by default; label that limitation. Do not market execution copying as preserving the leader's stop. Before live beta, users must see whether protection is truly broker-hosted, simulated, or absent. Beta native protective orders are explicit customer risk instructions. If a follower's own stop executes before the leader exits, mark that follower EXIT_ONLY/OUT_OF_SYNC and never reopen it automatically to match the leader. This prevents target tracking from defeating protection.

## Secondary mode: ORDER, gated Production V1

Mirror accepted working orders with stable lineage and explicit order-family capability. Price, tick alignment, side, TIF and contract must be supported on both accounts. Size the whole leader order once; track cumulative fills and remaining quantity separately. Reject a modify that reduces total quantity below already-filled quantity. Market entries may be mirrored on broker acceptance; do not also copy their fills into new market orders.

Leader limit/stop/stop-limit orders create corresponding follower working orders. Changes are serialized revisions. A cancel request sets desired cancellation even if follower acceptance is pending; send cancel once identity is known. Cancel acknowledgement does not erase fills racing with cancellation. Cancel/replace chains retain all broker order IDs and superseded revisions.

Follower fills can precede leader fills or differ in quantity. Account exposure follows actual fills; mapping consistency and position convergence are separate statuses. Do not chase convergence with market entries. If the leader cancels an unfilled order after a follower filled, pause new entries, preserve supported protection, and ask the user to resolve residual exposure. A user-preauthorized reduce-only close policy may be added only after certification.

Bracket/OCO support requires a certified native order graph. Child size follows actual follower parent fills; do not place independent full-size exit legs. Native OCO does not automatically prove race-free no-reversal behavior: test partial child fills and simultaneous triggers. Unsupported native protection or unreliable reduce-only semantics blocks that order family. Client-emulated OCO/trailing stops are deferred. Unknown order types are not converted to market orders.

## Persistent processing pipeline

1. Adapter validates and normalizes the event; assign stable provider identity scoped to connection/account/environment.
2. Insert inbox event under a uniqueness constraint, persisting safe normalized payload and provenance. Duplicate insert has no additional trading effect.
3. Serialize account/group processing, detect gaps or invalid transitions, update leader/order ledger.
4. In one transaction calculate desired changes, reserve risk capacity, write intent/command/outbox/audit, and mark event processed. Settings and epoch are checked in that transaction.
5. Dispatcher claims the next eligible account command, verifies ownership and epoch again, rechecks risk with fresh state, persists attempt, and calls broker outside the database transaction.
6. Store accepted/rejected/unknown outcome. Subsequent stream executions update mappings and release reservations only for confirmed quantities or terminal unfilled remainders.
7. Reconcile then publish tenant-scoped UI events through the durable outbox.

If the database is unavailable, stop new outbound commands. Existing broker-held orders can still fill; reconcile on recovery.

## Command and order lifecycle

Commands: `PREPARED → READY → DISPATCHING → ACKNOWLEDGED | REJECTED | SUBMISSION_UNKNOWN`. Additional terminal states: `SUPERSEDED`, `EXPIRED`, `CANCELLED_BEFORE_SEND`. `SUBMISSION_UNKNOWN → ACKNOWLEDGED | PROVEN_NOT_ACCEPTED | MANUAL_REVIEW` only through evidence.

Orders: pending, working, partially filled, filled, pending cancel, cancelled, expired, rejected; raw provider state is retained. Fills are immutable economic facts with explicit corrections. A later stale working event must not regress a filled order. Cancelled orders may have cumulative fills; terminal status alone is not enough for position calculation.

## Unknown submissions, retries and replay

Timeout after write, worker crash during request, or malformed success response means UNKNOWN, not failure. Hold the account's entries. Query by client ID and broker history with pagination and documented visibility delay. Empty search results alone do not prove nonacceptance. If certainty is unavailable, require operator/customer broker inspection and record evidence; do not resubmit.

Only proven-before-send transport failures or certified broker deduplication permit a retry of the same logical command. Recheck current target, risk, epoch, TTL and eligibility first. Initial retry proposal: at most 3 safe attempts with jittered backoff, within command TTL and provider limits. Never retry margin, position limit, invalid contract, unsupported order or auth errors as transient trading failures. Data/read requests can have a separate bounded retry budget.

Dead letters retain complete causal identity and redacted evidence. Reprocessing means recalculate/reconcile under current state, not send the original command again. Disconnected leader exits are reconciled as current state on reconnect, not played back as stale entries.

## Control semantics

| Control | Exact behavior |
|---|---|
| Pause new entries | Durably block risk increases, cancel copier-owned pending entry orders, preserve protective orders and risk-reducing copy exits. Show PAUSING until cancellations resolved, then PAUSED/EXIT_ONLY if exposure remains. |
| Disable/remove follower | Same safe wind-down; membership cannot be released with working managed orders, unknown commands or open managed exposure. User takeover is explicit and audited. |
| Emergency halt | Latch risk-increasing dispatch off immediately after durable receipt; cancel entry orders where possible, retain protective orders and supported exits. Does not mean flat. |
| Flatten follower/group | Separate explicit liquidation operation: cancel/resolve entries, coordinate exit/protection cancellation with certified close semantics, close verified remaining exposure, verify flat and no reopening orders. Per-account results; no atomic group guarantee. |
| Global halt | Operators stop new entries; cannot claim control over manual trades or native orders already at brokers. Default excludes discretionary admin flatten. |

Account-wide flatten can affect manual positions: show its exact scope and obtain explicit customer confirmation. Group flatten defaults to followers, never silently flattens the leader. Flatten remains pending/failed if a broker is unavailable. Preserve native protection as long as possible; never remove it merely because a close request was queued. If the provider cannot safely prevent a close order racing with protection from reversing exposure, that flatten workflow needs certification or manual broker intervention, not a generic sell/buy fallback.

## Failure behavior matrix

The default isolation unit is the affected follower account. A leader failure affects its entire group; a shared provider/session failure affects all dependent accounts. Existing healthy followers are not unwound merely because another follower failed.

| Condition | Deterministic response |
|---|---|
| Leader disconnect | Group entries halted; retain existing follower protection; no inference that leader is flat; reconnect/reconcile before resume. |
| Follower disconnect | Isolate follower, block its entries, show exposure/freshness; other healthy followers may continue. |
| Broker/API outage | Circuit breaker and provider incident; cancel/close may be unavailable; do not show success until confirmed. |
| Network interruption | Treat every in-flight submission as potentially accepted; UNKNOWN recovery applies. |
| Server restart | Restore durable state with sending disabled, claim/fence ownership, resolve in-flight commands, snapshot/reconcile. |
| Worker crash | Same recovery; no concurrent replacement writer until old writer is fenced. |
| Delayed event | Record source age; old/gapped entry events are held and reconciled, not blindly dispatched. |
| Duplicate event | Unique identity suppresses repeated economic effect; retain observable duplicate metric. |
| Out-of-order event | Use provider sequence/version within scope; buffer boundedly or fetch history; never regress terminal state. |
| Rejected follower order | Release only confirmed unfilled reservation; record cause, mark divergence, notify; no compensating trades elsewhere. |
| Insufficient margin | Nonretryable for this intent; isolate and require fresh plan/flat-boundary resume. |
| Max-position restriction | Same as deterministic risk rejection; no smaller improvised retry. |
| Closed market | Reject/hold according to certified order/TIF semantics; no stale market entry on reopen. Pending exits escalate and require fresh verification. |
| Stale order/command | Unsent obsolete entry is superseded/expired; a broker-held order requires acknowledged cancellation, not deletion from DB. |
| Partial fill mismatch | Account for known pending remainder; after settlement classify divergence, preserve protection, no automatic top-up. |
| Quantity mismatch | OUT_OF_SYNC and entry block; compare full actual position and lineage before proposing any action. |
| Unexpected position/order | Treat as possible external activity; do not adopt or liquidate it without scope authorization. |
| Token expiry | Serialize approved refresh; if unsuccessful AUTH_REQUIRED and entry halt. |
| Authentication failure | Bounded reconnect only where appropriate; require user reauthorization; never loop submissions or expose secrets. |
| Copier paused with open position | EXIT_ONLY behavior: entries blocked, protection and supported reductions continue, position stays visibly open. |
| Leader exits during follower disconnection | On return verify latest leader/follower state and outstanding commands; handle managed residual per authorized stale-exit policy. |
| Protection fills before leader exit | Stop automatic increases for follower; require recovery review and flat-boundary resume. |
| Rate-limit response | Respect shared provider backoff; retry a trading request only if nonacceptance/deduplication is proven, with entry TTL/risk revalidation. |
| DB failure | No new external command; retain native broker state, recover ledger from history; unknown outcomes remain visible. |
| Unsupported order family | Block that copy path, alert with specific capability reason; do not substitute order types. |
| Daily loss/session restriction | Block entries, cancel pending entries when supported, preserve authorized exits; latch/reset semantics from RISK_ENGINE. |

Ordinary user configuration cannot turn off exits while claiming the follower remains synchronized and protected. Advanced 'copy entries/exits/modifications/stops/take profits' toggles are capability-aware: in EXECUTION mode only fills generate trading actions; in ORDER mode unsupported combinations are rejected at review. Disabling an essential exit/protection path requires explicit manual-management takeover and cannot be offered as an innocuous checkbox.
