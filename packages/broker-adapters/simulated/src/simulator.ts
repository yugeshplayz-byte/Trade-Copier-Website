import {
  TERMINAL_ORDER_STATUSES,
  UnsupportedCapabilityError,
  instrumentKeyId,
  type AccountRef,
  type AccountSnapshot,
  type AuthStatus,
  type BrokerAdapter,
  type BrokerEventPayload,
  type CancelOrder,
  type Capabilities,
  type CommandResolution,
  type ConnectionState,
  type ContractSpec,
  type EventEnvelope,
  type Execution,
  type ExecutionPage,
  type InstrumentKey,
  type OrderState,
  type PlaceOrder,
  type Position,
  type Side,
  type SubmitResult,
  type Subscription,
} from '@tradecopier/contracts';
import { VirtualClock, seededRandom } from './clock.ts';

/*
 * Deterministic simulated broker (BROKER_ADAPTERS.md "Simulator contract").
 * It exists to prove copier invariants under faults. It makes no claim about
 * real execution quality, latency or any provider's behaviour.
 *
 * Determinism: all time comes from a VirtualClock and all randomness from a
 * seeded PRNG, so the same seed and the same calls produce the same event log.
 */

export interface SimulatedAccountConfig {
  readonly providerAccountId: string;
  /** Simulated margin limit: risk-increasing orders beyond this absolute position are rejected. */
  readonly maxAbsPosition?: number;
}

export interface SimulatedBrokerOptions {
  readonly seed: number;
  readonly startTime: string;
  readonly accounts: readonly SimulatedAccountConfig[];
  readonly contracts: readonly ContractSpec[];
  readonly connectionId?: string;
  /**
   * Scopes canonical account IDs (sim:<namespace>:<account>) so accounts from
   * different connections can never collide. Persisted connections pass their ID.
   */
  readonly accountNamespace?: string;
  /** Broker-side submission deduplication by client order ID. Off by default: a resend creates a second order. */
  readonly deduplicateClientOrderIds?: boolean;
  /** Delay before an accepted order becomes visible to lookupCommand. */
  readonly historyVisibilityDelayMs?: number;
  readonly executionPageSize?: number;
}

/** Liquidity available per simulation step: a fixed quantity, seeded random chunks, or unlimited. */
export type Depth = number | 'RANDOM' | 'UNLIMITED';

export interface MarketState {
  readonly bidTicks: number;
  readonly askTicks: number;
  readonly depth?: Depth;
}

/** Faults on a submission call. */
export type SubmitFault =
  /** Transport fails before anything reaches the broker: non-acceptance is proven. */
  | 'FAIL_BEFORE_SEND'
  /** The broker accepts the request but the response is lost: caller sees UNKNOWN. */
  | 'TIMEOUT_AFTER_ACCEPT'
  /** Rejected by rate limiting before acceptance. */
  | 'RATE_LIMITED';

/** Faults on the event stream between broker and consumer. */
export type StreamFault = 'DUPLICATE_NEXT' | 'DROP_NEXT' | 'SWAP_NEXT_TWO';

/** Faults on snapshot reads. */
export type SnapshotFault = 'STALE';

interface AccountRecord {
  readonly ref: AccountRef;
  readonly maxAbsPosition: number | undefined;
  readonly positions: Map<string, { instrument: InstrumentKey; net: number }>;
  readonly orders: Map<string, OrderState>;
  readonly executions: Execution[];
  sequence: number;
  /** State after each sequence number, for stale-snapshot simulation. */
  readonly history: Map<number, { at: string; positions: Position[]; orders: OrderState[] }>;
}

const SIM_SECRET_PREFIX = 'sim:';

export class SimulatedBroker implements BrokerAdapter {
  readonly provider = 'simulated' as const;
  readonly environment = 'SIMULATED' as const;

  private readonly clock: VirtualClock;
  private readonly random: () => number;
  private readonly options: SimulatedBrokerOptions;
  private readonly connectionId: string;
  private readonly accounts = new Map<string, AccountRecord>();
  private readonly specs = new Map<string, ContractSpec>();
  private readonly markets = new Map<string, MarketState>();
  private readonly depthLeft = new Map<string, number>();
  private readonly handlers = new Set<(event: EventEnvelope) => void>();
  private readonly generated: EventEnvelope[] = [];
  private readonly pending: EventEnvelope[] = [];
  private readonly submitFaults = new Map<'placeOrder' | 'cancelOrder', SubmitFault[]>();
  private readonly streamFaults: StreamFault[] = [];
  private readonly snapshotFaults: SnapshotFault[] = [];
  private state: ConnectionState = 'CREATED';
  private authenticated = false;
  private orderCounter = 0;
  private executionCounter = 0;

  constructor(options: SimulatedBrokerOptions) {
    this.options = options;
    this.clock = new VirtualClock(options.startTime);
    this.random = seededRandom(options.seed);
    this.connectionId = options.connectionId ?? 'sim-connection-1';
    for (const account of options.accounts) {
      const canonicalAccountId = options.accountNamespace
        ? `sim:${options.accountNamespace}:${account.providerAccountId}`
        : `sim:${account.providerAccountId}`;
      this.accounts.set(canonicalAccountId, {
        ref: {
          provider: 'simulated',
          environment: 'SIMULATED',
          providerAccountId: account.providerAccountId,
          canonicalAccountId,
        },
        maxAbsPosition: account.maxAbsPosition,
        positions: new Map(),
        orders: new Map(),
        executions: [],
        sequence: 0,
        history: new Map([[0, { at: this.clock.iso(), positions: [], orders: [] }]]),
      });
    }
    for (const spec of options.contracts) this.specs.set(instrumentKeyId(spec.instrument), spec);
  }

  /* ---------------- BrokerAdapter ---------------- */

  capabilities(): Capabilities {
    return {
      orderTypes: ['MARKET', 'LIMIT'],
      timeInForce: ['DAY', 'GTC'],
      brackets: 'UNSUPPORTED',
      oco: 'UNSUPPORTED',
      protectionLocation: 'UNKNOWN',
      reduceOnly: 'UNSUPPORTED',
      nativeClosePosition: 'UNSUPPORTED',
      nativeFlattenAccount: 'UNSUPPORTED',
      atomicModify: 'UNSUPPORTED',
      clientOrderId: 'NATIVE',
      lookupByClientOrderId: 'NATIVE',
      submissionDeduplication: this.options.deduplicateClientOrderIds ? 'NATIVE' : 'UNSUPPORTED',
      executionHistory: 'NATIVE',
      executionCorrections: 'UNSUPPORTED',
      streamReplay: 'UNSUPPORTED',
      sequenceScope: 'ACCOUNT',
      snapshotCursor: 'NATIVE',
      accountPnl: 'UNSUPPORTED',
      limits: [],
      restrictions: ['Simulator only: proves copier invariants, not real execution quality or provider behaviour.'],
    };
  }

  async authenticate(secretRef: string): Promise<AuthStatus> {
    this.authenticated = secretRef.startsWith(SIM_SECRET_PREFIX);
    if (!this.authenticated) this.state = 'AUTH_REQUIRED';
    return { state: this.authenticated ? 'AUTHENTICATED' : 'AUTH_REQUIRED' };
  }

  async connect(): Promise<ConnectionState> {
    this.state = this.authenticated ? 'READY' : 'AUTH_REQUIRED';
    return this.state;
  }

  async disconnect(): Promise<void> {
    this.state = 'DISCONNECTED';
    // Undelivered events are lost with the stream; history and snapshots remain.
    this.pending.length = 0;
  }

  connectionState(): ConnectionState {
    return this.state;
  }

  async getAccounts(): Promise<readonly AccountRef[]> {
    return [...this.accounts.values()].map((a) => a.ref);
  }

  async getAccountState(canonicalAccountId: string): Promise<AccountSnapshot> {
    const account = this.requireAccount(canonicalAccountId);
    const requestedAt = this.clock.iso();
    const stale = this.snapshotFaults.shift() === 'STALE';
    const cursor = stale ? Math.max(0, account.sequence - 1) : account.sequence;
    const view = account.history.get(cursor);
    if (!view) throw new Error(`missing simulator history at ${cursor}`);
    return {
      account: account.ref,
      requestedAt,
      receivedAt: this.clock.iso(),
      asOf: view.at,
      cursor: String(cursor),
      complete: true,
      positions: view.positions,
      orders: view.orders,
    };
  }

  async getExecutions(canonicalAccountId: string, cursor?: string): Promise<ExecutionPage> {
    const account = this.requireAccount(canonicalAccountId);
    const start = cursor === undefined ? 0 : Number.parseInt(cursor, 10);
    if (!Number.isSafeInteger(start) || start < 0) throw new RangeError('invalid execution cursor');
    const size = this.options.executionPageSize ?? 50;
    const executions = account.executions.slice(start, start + size);
    const next = start + executions.length;
    const complete = next >= account.executions.length;
    return { executions, nextCursor: complete ? null : String(next), complete };
  }

  async getContractSpec(instrument: InstrumentKey): Promise<ContractSpec> {
    const spec = this.specs.get(instrumentKeyId(instrument));
    if (!spec) throw new UnsupportedCapabilityError('instrument', `unknown contract ${instrumentKeyId(instrument)}`);
    return spec;
  }

  subscribe(handler: (event: EventEnvelope) => void): Subscription {
    this.handlers.add(handler);
    return { unsubscribe: () => this.handlers.delete(handler) };
  }

  async placeOrder(command: PlaceOrder): Promise<SubmitResult> {
    const caps = this.capabilities();
    if (!caps.orderTypes.includes(command.orderType)) {
      throw new UnsupportedCapabilityError('orderType', `${command.orderType} is not supported; it is never substituted`);
    }
    if (!caps.timeInForce.includes(command.timeInForce)) {
      throw new UnsupportedCapabilityError('timeInForce', `${command.timeInForce} is not supported`);
    }

    const blocked = this.transportCheck();
    if (blocked) return blocked;
    const fault = this.submitFaults.get('placeOrder')?.shift();
    if (fault === 'FAIL_BEFORE_SEND') return reject('NOT_SENT', true, 'Transport failed before the request was sent.');
    if (fault === 'RATE_LIMITED') return reject('RATE_LIMITED', true, 'Rate limited before acceptance.');

    const account = this.accounts.get(command.account.canonicalAccountId);
    if (!account || command.account.provider !== 'simulated' || command.account.environment !== 'SIMULATED') {
      return reject('ACCOUNT_NOT_AUTHORIZED', false, 'Account is not available on this connection.');
    }
    const key = instrumentKeyId(command.instrument);
    if (!this.specs.has(key)) return reject('INVALID_CONTRACT', false, 'Unknown contract.');
    if (!Number.isSafeInteger(command.quantity) || command.quantity <= 0) {
      return reject('INVALID_QUANTITY', false, 'Quantity must be a positive integer.');
    }
    if (command.orderType === 'LIMIT' && !Number.isSafeInteger(command.limitPriceTicks)) {
      return reject('INVALID_PRICE', false, 'Limit orders need an integer tick price.');
    }
    if (command.orderType === 'MARKET' && !this.markets.has(key)) {
      return reject('MARKET_CLOSED', false, 'No market for this contract.');
    }

    if (this.options.deduplicateClientOrderIds) {
      const existing = [...account.orders.values()].find((o) => o.clientOrderId === command.clientOrderId);
      if (existing) return this.accepted(existing.brokerOrderId, fault, command.attemptId);
    }

    if (account.maxAbsPosition !== undefined) {
      const exposure = this.projectedExposure(account, key);
      const next = exposure + signed(command.side, command.quantity);
      if (Math.abs(next) > account.maxAbsPosition && Math.abs(next) > Math.abs(exposure)) {
        return reject('INSUFFICIENT_MARGIN', false, 'Simulated margin limit exceeded.');
      }
    }

    const now = this.clock.iso();
    const order: OrderState = {
      brokerOrderId: `SIM-O-${String(++this.orderCounter).padStart(6, '0')}`,
      clientOrderId: command.clientOrderId,
      canonicalAccountId: account.ref.canonicalAccountId,
      instrument: command.instrument,
      side: command.side,
      orderType: command.orderType,
      quantity: command.quantity,
      filledQuantity: 0,
      ...(command.orderType === 'LIMIT' ? { limitPriceTicks: command.limitPriceTicks! } : {}),
      status: 'WORKING',
      version: 1,
      createdAt: now,
      updatedAt: now,
    };
    account.orders.set(order.brokerOrderId, order);
    this.emit(account, { kind: 'ORDER', order });
    this.match(key);
    this.flush();
    return this.accepted(order.brokerOrderId, fault, command.attemptId);
  }

  async cancelOrder(command: CancelOrder): Promise<SubmitResult> {
    const blocked = this.transportCheck();
    if (blocked) return blocked;
    const fault = this.submitFaults.get('cancelOrder')?.shift();
    if (fault === 'FAIL_BEFORE_SEND') return reject('NOT_SENT', true, 'Transport failed before the request was sent.');
    if (fault === 'RATE_LIMITED') return reject('RATE_LIMITED', true, 'Rate limited before acceptance.');

    const account = this.accounts.get(command.account.canonicalAccountId);
    const order = account?.orders.get(command.brokerOrderId);
    if (!account || !order) return reject('ORDER_NOT_FOUND', false, 'No such order on this account.');
    if (TERMINAL_ORDER_STATUSES.has(order.status)) {
      return reject('ORDER_NOT_CANCELLABLE', false, `Order is already ${order.status}; existing fills stand.`);
    }
    const cancelled: OrderState = { ...order, status: 'CANCELLED', version: order.version + 1, updatedAt: this.clock.iso() };
    account.orders.set(order.brokerOrderId, cancelled);
    this.emit(account, { kind: 'ORDER', order: cancelled });
    this.flush();
    return this.accepted(order.brokerOrderId, fault, command.attemptId);
  }

  async modifyOrder(): Promise<SubmitResult> {
    throw new UnsupportedCapabilityError('atomicModify', 'the simulator does not modify orders');
  }

  async flattenPosition(): Promise<SubmitResult> {
    throw new UnsupportedCapabilityError('nativeClosePosition', 'no native close primitive in the simulator');
  }

  async flattenAccount(): Promise<SubmitResult> {
    throw new UnsupportedCapabilityError('nativeFlattenAccount', 'no native flatten primitive in the simulator');
  }

  async lookupCommand(lookup: { account: AccountRef; clientOrderId: string }): Promise<CommandResolution> {
    if (this.state !== 'READY') return { status: 'UNAVAILABLE', reason: `Connection is ${this.state}.` };
    const account = this.accounts.get(lookup.account.canonicalAccountId);
    if (!account) return { status: 'UNAVAILABLE', reason: 'Account is not available on this connection.' };
    const visibleBefore = this.clock.nowMs() - (this.options.historyVisibilityDelayMs ?? 0);
    const matches = [...account.orders.values()].filter(
      (o) => o.clientOrderId === lookup.clientOrderId && Date.parse(o.createdAt) <= visibleBefore,
    );
    if (matches.length === 1) return { status: 'FOUND', order: matches[0]! };
    if (matches.length > 1) return { status: 'AMBIGUOUS', orders: matches };
    return { status: 'NOT_FOUND', conclusive: false, reason: 'No visible order with this client order ID.' };
  }

  /* ---------------- Simulation controls (never exposed to customers) ---------------- */

  /** Sets the market for a contract and matches resting orders against it (models price gaps). */
  setMarket(instrument: InstrumentKey, market: MarketState): void {
    if (!Number.isSafeInteger(market.bidTicks) || !Number.isSafeInteger(market.askTicks) || market.bidTicks > market.askTicks) {
      throw new RangeError('market requires integer ticks with bid <= ask');
    }
    const key = instrumentKeyId(instrument);
    if (!this.specs.has(key)) throw new RangeError('unknown contract');
    this.markets.set(key, market);
    this.depthLeft.delete(key);
    this.match(key);
    this.flush();
  }

  /** Closes the market for a contract: new market orders are rejected, resting orders wait. */
  closeMarket(instrument: InstrumentKey): void {
    this.markets.delete(instrumentKeyId(instrument));
  }

  /** Advances simulated time by one step: replenishes liquidity, continues partial fills, delivers events. */
  advance(ms: number): void {
    this.clock.advance(ms);
    this.depthLeft.clear();
    for (const key of this.markets.keys()) this.match(key);
    this.flush();
  }

  injectSubmitFault(operation: 'placeOrder' | 'cancelOrder', fault: SubmitFault): void {
    const queue = this.submitFaults.get(operation) ?? [];
    queue.push(fault);
    this.submitFaults.set(operation, queue);
  }

  injectStreamFault(fault: StreamFault): void {
    this.streamFaults.push(fault);
  }

  injectSnapshotFault(fault: SnapshotFault): void {
    this.snapshotFaults.push(fault);
  }

  /** Simulates token expiry: the connection requires re-authentication. */
  expireAuthentication(): void {
    this.authenticated = false;
    this.state = 'AUTH_REQUIRED';
  }

  /** Every event the broker generated, in order, before stream faults. */
  eventLog(): readonly EventEnvelope[] {
    return this.generated;
  }

  now(): string {
    return this.clock.iso();
  }

  /* ---------------- Internals ---------------- */

  private transportCheck(): SubmitResult | null {
    if (this.state === 'AUTH_REQUIRED') return reject('AUTH_REQUIRED', false, 'Re-authentication is required.');
    if (this.state !== 'READY') return reject('NOT_CONNECTED', true, `Connection is ${this.state}; nothing was sent.`);
    return null;
  }

  private accepted(brokerOrderId: string, fault: SubmitFault | undefined, attemptId: string): SubmitResult {
    if (fault === 'TIMEOUT_AFTER_ACCEPT') {
      return { outcome: 'UNKNOWN', attemptId, reason: 'Response lost after the broker may have accepted the request.' };
    }
    return { outcome: 'ACCEPTED', brokerOrderId, acknowledgedAt: this.clock.iso() };
  }

  private requireAccount(canonicalAccountId: string): AccountRecord {
    const account = this.accounts.get(canonicalAccountId);
    if (!account) throw new RangeError(`unknown simulated account ${canonicalAccountId}`);
    return account;
  }

  /** Signed position plus signed unfilled quantity of working orders for one contract. */
  private projectedExposure(account: AccountRecord, key: string): number {
    let exposure = account.positions.get(key)?.net ?? 0;
    for (const order of account.orders.values()) {
      if (instrumentKeyId(order.instrument) !== key || TERMINAL_ORDER_STATUSES.has(order.status)) continue;
      exposure += signed(order.side, order.quantity - order.filledQuantity);
    }
    return exposure;
  }

  private availableDepth(key: string, market: MarketState, want: number): number {
    const depth = market.depth ?? 'UNLIMITED';
    if (depth === 'UNLIMITED') return want;
    if (!this.depthLeft.has(key)) {
      const budget = depth === 'RANDOM' ? 1 + Math.floor(this.random() * 3) : depth;
      this.depthLeft.set(key, budget);
    }
    return Math.min(want, this.depthLeft.get(key)!);
  }

  private match(key: string): void {
    const market = this.markets.get(key);
    if (!market) return;
    for (const account of this.accounts.values()) {
      const working = [...account.orders.values()]
        .filter((o) => instrumentKeyId(o.instrument) === key && !TERMINAL_ORDER_STATUSES.has(o.status))
        .sort((a, b) => a.brokerOrderId.localeCompare(b.brokerOrderId));
      for (const order of working) {
        const price = order.side === 'BUY' ? market.askTicks : market.bidTicks;
        const marketable =
          order.orderType === 'MARKET' ||
          (order.side === 'BUY' ? price <= order.limitPriceTicks! : price >= order.limitPriceTicks!);
        if (!marketable) continue;
        const qty = this.availableDepth(key, market, order.quantity - order.filledQuantity);
        if (qty <= 0) continue;
        if (this.depthLeft.has(key)) this.depthLeft.set(key, this.depthLeft.get(key)! - qty);
        this.fill(account, order, qty, price);
      }
    }
  }

  private fill(account: AccountRecord, order: OrderState, quantity: number, priceTicks: number): void {
    const now = this.clock.iso();
    const execution: Execution = {
      executionId: `SIM-X-${String(++this.executionCounter).padStart(6, '0')}`,
      brokerOrderId: order.brokerOrderId,
      clientOrderId: order.clientOrderId,
      canonicalAccountId: account.ref.canonicalAccountId,
      instrument: order.instrument,
      side: order.side,
      quantity,
      priceTicks,
      occurredAt: now,
    };
    account.executions.push(execution);
    this.emit(account, { kind: 'EXECUTION', execution });

    const filledQuantity = order.filledQuantity + quantity;
    const updated: OrderState = {
      ...order,
      filledQuantity,
      status: filledQuantity === order.quantity ? 'FILLED' : 'PARTIALLY_FILLED',
      version: order.version + 1,
      updatedAt: now,
    };
    account.orders.set(order.brokerOrderId, updated);
    this.emit(account, { kind: 'ORDER', order: updated });

    const key = instrumentKeyId(order.instrument);
    const position = account.positions.get(key) ?? { instrument: order.instrument, net: 0 };
    position.net += signed(order.side, quantity);
    account.positions.set(key, position);
    this.emit(account, {
      kind: 'POSITION',
      position: { canonicalAccountId: account.ref.canonicalAccountId, instrument: order.instrument, netQuantity: position.net },
    });
  }

  private emit(account: AccountRecord, payload: BrokerEventPayload): void {
    account.sequence += 1;
    const now = this.clock.iso();
    const envelope: EventEnvelope = {
      schemaVersion: 1,
      provider: 'simulated',
      environment: 'SIMULATED',
      connectionId: this.connectionId,
      canonicalAccountId: account.ref.canonicalAccountId,
      eventId: `${account.ref.canonicalAccountId}#${account.sequence}`,
      ...(payload.kind === 'EXECUTION' ? { executionId: payload.execution.executionId } : {}),
      providerSequence: String(account.sequence),
      sequenceScopeKey: account.ref.canonicalAccountId,
      occurredAt: now,
      receivedAt: now,
      payload,
      quality: 'CONTIGUOUS',
    };
    this.generated.push(envelope);
    account.history.set(account.sequence, {
      at: now,
      positions: [...account.positions.values()].map((p) => ({
        canonicalAccountId: account.ref.canonicalAccountId,
        instrument: p.instrument,
        netQuantity: p.net,
      })),
      orders: [...account.orders.values()],
    });
    // A dropped stream loses events; the broker state above still changed.
    if (this.state === 'READY') this.pending.push(envelope);
  }

  private flush(): void {
    const deliver = (event: EventEnvelope) => {
      const received = { ...event, receivedAt: this.clock.iso() };
      for (const handler of this.handlers) handler(received);
    };
    while (this.pending.length > 0) {
      const event = this.pending.shift()!;
      const fault = this.streamFaults.shift();
      if (fault === 'DROP_NEXT') continue;
      if (fault === 'DUPLICATE_NEXT') {
        deliver(event);
        deliver(event);
        continue;
      }
      if (fault === 'SWAP_NEXT_TWO' && this.pending.length > 0) {
        deliver(this.pending.shift()!);
        deliver(event);
        continue;
      }
      deliver(event);
    }
  }
}

function signed(side: Side, quantity: number): number {
  return side === 'BUY' ? quantity : -quantity;
}

function reject(code: string, retryable: boolean, message: string): SubmitResult {
  return { outcome: 'REJECTED', code, retryable, message };
}
