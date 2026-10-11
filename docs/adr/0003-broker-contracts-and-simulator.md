# ADR 0003: Normalized broker contracts and deterministic simulator

Status: proposed (Phase 3, first slice) · Date: 2026-10-11

## Context

ROADMAP Phase 3 builds the adapter contracts and a deterministic simulated broker. Phase 2 (tenant database and authentication) is blocked on two owner decisions: installing local PostgreSQL and choosing an auth provider. The provider-independent parts of Phase 3 need no persistence, so they are built first. Wiring into persisted connections and tenants waits for Phase 2.

## Decision

### Contracts (`packages/contracts`)

- **`broker.ts`**: the normalized model from BROKER_ADAPTERS.md, covering:
  - instrument keys with explicit expiry, and contract specs;
  - account identity that includes provider and environment, and capability manifests;
  - commands carrying `commandId`, `attemptId` and `clientOrderId`;
  - `SubmitResult` as `ACCEPTED`, `REJECTED` (with a `retryable` flag, true only when non-acceptance is proven) or `UNKNOWN`;
  - `CommandResolution`, where `NOT_FOUND` is typed `conclusive: false`: an empty search is never proof;
  - order state with a monotonic `version`, immutable executions, snapshots with a cursor, the `BrokerAdapter` interface, and `UnsupportedCapabilityError`.
- **Runtime validation**: zod schemas validate normalized event envelopes before they enter the system.
- **`decimal.ts`**: exact BigInt decimal arithmetic for price↔tick conversion and tick money. Unaligned prices throw; nothing rounds.
- **`sequence.ts`**: `SequenceTracker` classifies per-scope sequences as first, contiguous, gap, late or duplicate, and remembers outstanding gaps.

### Simulator (`packages/broker-adapters/simulated`)

- A virtual clock plus a seeded PRNG. The same seed and calls always produce an identical event log.
- Market and limit orders only. Every other order type, modify and native flatten throw `UnsupportedCapabilityError` before anything is sent; nothing is ever substituted.
- Liquidity per step (fixed, seeded random, or unlimited) produces cumulative partial fills. Price gaps fill resting limit orders. Market orders are rejected when no market exists; they are never filled late.
- Faults:
  - Submission: `FAIL_BEFORE_SEND` (retryable, proven not sent), `TIMEOUT_AFTER_ACCEPT` (order exists, caller gets `UNKNOWN`), `RATE_LIMITED`.
  - Stream: `DUPLICATE_NEXT`, `DROP_NEXT`, `SWAP_NEXT_TWO`.
  - Snapshot: `STALE`, whose cursor lags by one event.
  - Connection: disconnect (broker-held orders keep filling, and the stream loses those events; history recovers them), token expiry (`AUTH_REQUIRED`, never retryable), and a simulated margin limit (`INSUFFICIENT_MARGIN`, which still allows risk-reducing orders).
- **Broker deduplication is off by default**, matching the spec's warning that client order IDs do not prove deduplication. A test shows that blindly resending after `UNKNOWN` doubles exposure. With dedupe enabled, which the capability manifest reports as `NATIVE`, a resend maps to the same order.
- Lookup supports a visibility delay, so tests can model inconclusive history.

### Conformance suite (`tests/contracts/adapter-conformance.ts`)

A provider-independent suite that every adapter must pass. It checks:

- capability declarations, and typed rejection of undeclared order types before sending;
- schema-valid events, unique execution IDs and bounded cumulative fills;
- no order-state regression;
- snapshot shape, and exactly-once execution paging;
- lookup by client order ID;
- cancels never erasing fills.

The simulator passes it. Mutation checks confirmed that both the suite and the simulator tests fail when cancels erase fills or execution IDs repeat.

## Not yet done

These remain open within Phase 3:

- persisted connections and simulated accounts per tenant;
- the connection discovery and status workflow and UI;
- secret-reference handling beyond the `sim:` prefix;
- stop and stop-limit orders, brackets and OCO races, expiry, modification.

The dispatch gate still registers no adapter, so worker health continues to report dispatch disabled. The simulator becomes dispatchable only in Phase 4, behind the durable intent ledger.

## Consequences

- Real adapters (Phase 7 onward) implement `BrokerAdapter` and must pass the same conformance suite against authorized practice accounts.
- The simulator's behaviour is a test instrument, not evidence of how any provider behaves.
