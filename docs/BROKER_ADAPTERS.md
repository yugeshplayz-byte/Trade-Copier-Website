# Broker adapter specification

## Integration eligibility is separate from implementation

An adapter can be coded without being approved for customer use. Maintain an allowlist keyed by provider, API product/version, account class, broker/prop firm, deployment origin, environment, region, and certified capabilities. Missing or expired evidence disables activation. Never infer approval for one firm from approval for another firm using the same technology.

| Provider | Verified public technical evidence | Missing commercial evidence / decision |
|---|---|---|
| Tradovate | API and OAuth documentation; retail access article lists live-account balance, data-agreement, and API-add-on requirements [S01–S03] | Verify current terms, OAuth client approval, commercial hosted multi-user operation, eligible prop accounts, quotas and fees. First investigation candidate, not confirmed production support. |
| NinjaTrader | Official enterprise REST/Swagger API offering exists [S05] | Confirm exact Trade API product, provisioning, commercial license, hosting, account universe, auth, and conformance. Do not equate desktop NinjaScript, enterprise Trade API, and Tradovate credentials. |
| Rithmic | Official API suite describes C++/.NET and wire-protocol options [S06] | Obtain developer kit/agreement, deployment and redistribution rights, system credentials, conformance obligations, fees and broker permission. Protocol sidecar only if needed. |
| ProjectX | Gateway documentation exists with platform-specific entry points [S07] | Verify independently for each supported firm. No platform-wide assumption of commercial authorization. |
| TopstepX | Published guidance allows API use but restricts remote-server order flow and excludes Live Funded API trading [S04] | Cloud execution disabled in this architecture unless written permission changes that restriction. Do not route through customer devices as a disguised relay. |
| Simulator | Owned deterministic implementation | Internal/test only. UI must say simulated. It proves core behavior, not real provider support. |

The Tradovate Partner documentation reviewed is directed partly at organization/evaluation administrators [S03]. Its privileged endpoints and credentials are not a generic retail OAuth solution. Do not use them to create accounts or administer customers without the appropriate agreement.

## Normalized model

The following is a specification sketch, not an installed SDK or claim about exact provider endpoints. Implement schema validation and contract tests alongside the types.

```ts
type Decimal = string; // validated decimal; never binary floating point for prices/money
type Qty = number;     // nonnegative safe integer; signed only for net positions
type Environment = 'SIMULATED' | 'PROVIDER_PRACTICE' | 'LIVE';
type Support = 'NATIVE' | 'CERTIFIED_EMULATION' | 'UNSUPPORTED' | 'UNKNOWN';

interface Capabilities {
  orderTypes: Array<'MARKET'|'LIMIT'|'STOP'|'STOP_LIMIT'|'TRAILING_STOP'>;
  timeInForce: Array<'DAY'|'GTC'|'IOC'|'FOK'>;
  brackets: Support;
  oco: Support;
  protectionLocation: 'EXCHANGE'|'BROKER'|'CLIENT'|'UNKNOWN';
  reduceOnly: Support;
  nativeClosePosition: Support;
  nativeFlattenAccount: Support;
  atomicModify: Support;
  clientOrderId: Support;
  lookupByClientOrderId: Support;
  submissionDeduplication: Support;
  submissionDeduplicationWindowMs?: number;
  executionHistory: Support;
  executionCorrections: Support;
  streamReplay: Support;
  sequenceScope?: 'CONNECTION'|'ACCOUNT'|'ORDER';
  snapshotCursor: Support;
  accountPnl: Support;
  maxConnections?: number;
  limits: RateLimitDefinition[];
  restrictions: string[];
}

interface EventEnvelope<T> {
  schemaVersion: number;
  provider: string;
  environment: Environment;
  connectionId: string;
  canonicalAccountId: string;
  eventId: string;             // stable provider ID or documented synthetic identity
  executionId?: string;
  providerSequence?: string;
  sequenceScopeKey?: string;
  occurredAt?: string;
  receivedAt: string;
  payload: T;
  quality: 'CONTIGUOUS'|'GAP'|'UNSEQUENCED'|'SNAPSHOT';
}

type SubmitResult =
  | { outcome: 'ACCEPTED'; brokerOrderId: string; acknowledgedAt: string }
  | { outcome: 'REJECTED'; code: string; retryable: boolean }
  | { outcome: 'UNKNOWN'; attemptId: string; reason: string };

interface BrokerAdapter {
  capabilities(ctx: AccountContext): Promise<Capabilities>;
  authenticate(secretRef: string): Promise<AuthStatus>;
  refreshAuthentication(): Promise<AuthStatus>;
  connect(): Promise<ConnectionStatus>;
  disconnect(): Promise<void>;
  getAccounts(): Promise<BrokerAccount[]>;
  getAccountState(account: string): Promise<AccountSnapshot>;
  getBalances(account: string): Promise<BalanceSnapshot>;
  getPositions(account: string): Promise<PositionSnapshot>;
  getOrders(account: string): Promise<OrderSnapshot>;
  getExecutions(account: string, cursor?: string): Promise<ExecutionPage>;
  subscribeOrders(handler: EventHandler): Promise<Subscription>;
  subscribeExecutions(handler: EventHandler): Promise<Subscription>;
  subscribePositions(handler: EventHandler): Promise<Subscription>;
  getInstrument(key: InstrumentKey): Promise<Instrument>;
  getContractSpecifications(key: InstrumentKey): Promise<ContractSpec>;
  placeOrder(command: PlaceOrder): Promise<SubmitResult>;
  modifyOrder(command: ModifyOrder): Promise<SubmitResult>;
  cancelOrder(command: CancelOrder): Promise<SubmitResult>;
  lookupCommand(command: CommandLookup): Promise<CommandResolution>;
  flattenPosition(command: ClosePosition): Promise<SubmitResult>;
  flattenAccount(command: CloseAccount): Promise<SubmitResult>;
}
```

The referenced payload types must define account/environment binding, immutable command ID, attempt ID, client order ID, settings version, parent/child/OCO identifiers, total and cumulative filled quantities, side, prices in ticks, time in force, trading session, provider rejection details, and source timestamps. `AccountContext` is constructed server-side only. Auth methods return status and expiration metadata, not tokens to the caller's browser. Methods that are unsupported return a typed capability error; they do not silently approximate behavior.

Snapshots contain `requestedAt`, `receivedAt`, optional provider `asOf`, cursor/sequence, pagination completeness, and consistency quality. A stitched snapshot with gaps must not qualify for activation. A sequence number is ordered only inside its documented scope. Historical fills include correction/bust relationships; if those cannot be resolved, mark the account uncertain.

Do not synthesize execution identity from timestamp, price and quantity alone: two legitimate fills can share all three. A provider lacking stable execution IDs must supply another certified history/sequence-based identity scheme. Otherwise execution-based copying is unsupported for that adapter. Duplicate event IDs with different payload hashes are integrity incidents, not ordinary duplicates.

## Identity and instruments

Canonical account identity includes provider routing system, clearing/broker identity when available, provider account ID and environment. A user-visible account name is not a unique identity. Provider aliases that identify the same account must resolve to a shared account lock and owner; uncertain alias identity blocks simultaneous use.

Instrument key: exchange, product, expiration, currency, and provider contract ID. Store tick size, currency-per-point, lot increment, price bands when provided, last trading date and trading calendar source. Use explicit contracts such as a specific MNQ expiry, never a chart's continuous-contract label. Do not map NQ to MNQ merely because both names contain NQ. No automatic roll, FX conversion, or cross-product substitution in initial releases.

## Authentication and connection lifecycle

`CREATED → AUTHENTICATING → CONNECTING → SNAPSHOTTING → READY`. Failure branches: `RECONNECTING`, `AUTH_REQUIRED`, `DISCONNECTED`, `BLOCKED`. Broker socket open is not READY.

OAuth authorization-code flow with server-side exchange is preferred where officially supported; use state validation and PKCE if supported. Verify the account grant against discovered accounts. If a provider requires API secrets, accept them over a dedicated TLS endpoint with no request-body logging, encrypt promptly, and never return stored values. No broker login scraping or invented OAuth endpoints.

Serialize token refresh by connection, rotate atomically, preserve refresh state on crash, and retry only according to provider guidance. Reconnect obtains execution history and snapshots before allowing entries. Subscription success and first fresh account snapshot are both required. Disconnect requests with exposure show consequences and offer safe shutdown; provider revocation may nevertheless make recovery impossible.

## Capability and certification rules

- Unsupported order families cannot be selected in ORDER mode; unsupported leader events halt new entries and explain the affected order.
- A broker-hosted stop and a client-hosted stop have different reliability. Only certified broker/exchange-hosted protection qualifies as durable protection.
- Native flatten is not assumed to be atomic, reduce-only, or to cancel all pending orders. Document actual semantics before enabling it.
- Public availability of client order IDs does not prove broker deduplication. Test repeated IDs, time windows, restart behavior and lookup history coverage.
- Production adapter certification covers place, cancel, modify, partial fill, replace identity, expiration, rejection, reconnect, stream gaps, ambiguous submission, and rate limits.
- Capture API version and capability evidence date in each release. Unknown capabilities default off.

## Simulator contract

Seeded deterministic clock, account balances, full order state, matching rules and an append-only event log. Support market/limit/stop/stop-limit, partial fills, bracket/OCO races, rejects, expiration, modifications, cancellations, latency and price gaps. Provide faults before broker acceptance, after acceptance but before acknowledgement, before persistence, and during reconnect. Inject duplicate/out-of-order/corrected events, pagination gaps, stale snapshots, rate limits and authentication expiry.

No claims of realistic execution quality from the simulator. Its role is proving invariants. Provider practice mode is a separate environment and may behave differently from live routing.
