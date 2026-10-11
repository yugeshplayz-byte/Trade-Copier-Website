import { z } from 'zod';
import { BROKER_ENVIRONMENTS, type BrokerEnvironment } from './environment.ts';
import { PROVIDER_IDS, type ProviderId } from './providers.ts';

/*
 * Normalized broker model (BROKER_ADAPTERS.md). Every provider adapter maps its
 * protocol onto these types. Prices are integer ticks with an explicit contract
 * spec; quantities are non-negative safe integers (signed only for net
 * positions); identifiers from providers are opaque strings.
 */

export const SIDES = ['BUY', 'SELL'] as const;
export type Side = (typeof SIDES)[number];

export const ORDER_TYPES = ['MARKET', 'LIMIT', 'STOP', 'STOP_LIMIT', 'TRAILING_STOP'] as const;
export type OrderType = (typeof ORDER_TYPES)[number];

export const TIME_IN_FORCE = ['DAY', 'GTC', 'IOC', 'FOK'] as const;
export type TimeInForce = (typeof TIME_IN_FORCE)[number];

/** Unknown capabilities default off (BROKER_ADAPTERS.md). */
export const SUPPORT_LEVELS = ['NATIVE', 'CERTIFIED_EMULATION', 'UNSUPPORTED', 'UNKNOWN'] as const;
export type Support = (typeof SUPPORT_LEVELS)[number];

export const ORDER_STATUSES = [
  'PENDING',
  'WORKING',
  'PARTIALLY_FILLED',
  'FILLED',
  'PENDING_CANCEL',
  'CANCELLED',
  'EXPIRED',
  'REJECTED',
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const TERMINAL_ORDER_STATUSES: ReadonlySet<OrderStatus> = new Set(['FILLED', 'CANCELLED', 'EXPIRED', 'REJECTED']);

export const CONNECTION_STATES = [
  'CREATED',
  'AUTHENTICATING',
  'CONNECTING',
  'SNAPSHOTTING',
  'READY',
  'RECONNECTING',
  'AUTH_REQUIRED',
  'DISCONNECTED',
  'BLOCKED',
] as const;
export type ConnectionState = (typeof CONNECTION_STATES)[number];

/** Explicit contract identity. Never a continuous-contract chart label. */
export interface InstrumentKey {
  readonly exchange: string;
  readonly product: string;
  /** Contract month, YYYY-MM. */
  readonly expiry: string;
  readonly currency: string;
  readonly providerContractId: string;
}

export interface ContractSpec {
  readonly instrument: InstrumentKey;
  /** Decimal string, e.g. "0.25". */
  readonly tickSize: string;
  /** Currency per tick per contract, decimal string. */
  readonly tickValue: string;
  readonly lotIncrement: 1;
  readonly specVersion: number;
}

/** Canonical account identity includes provider and environment. */
export interface AccountRef {
  readonly provider: ProviderId;
  readonly environment: BrokerEnvironment;
  readonly providerAccountId: string;
  readonly canonicalAccountId: string;
}

export interface RateLimitDefinition {
  readonly scope: 'CONNECTION' | 'ACCOUNT' | 'LOGIN';
  readonly maxRequests: number;
  readonly perMs: number;
}

export interface Capabilities {
  readonly orderTypes: readonly OrderType[];
  readonly timeInForce: readonly TimeInForce[];
  readonly brackets: Support;
  readonly oco: Support;
  readonly protectionLocation: 'EXCHANGE' | 'BROKER' | 'CLIENT' | 'UNKNOWN';
  readonly reduceOnly: Support;
  readonly nativeClosePosition: Support;
  readonly nativeFlattenAccount: Support;
  readonly atomicModify: Support;
  readonly clientOrderId: Support;
  readonly lookupByClientOrderId: Support;
  readonly submissionDeduplication: Support;
  readonly submissionDeduplicationWindowMs?: number;
  readonly executionHistory: Support;
  readonly executionCorrections: Support;
  readonly streamReplay: Support;
  readonly sequenceScope?: 'CONNECTION' | 'ACCOUNT' | 'ORDER';
  readonly snapshotCursor: Support;
  readonly accountPnl: Support;
  readonly maxConnections?: number;
  readonly limits: readonly RateLimitDefinition[];
  readonly restrictions: readonly string[];
}

export interface PlaceOrder {
  /** Immutable logical command identity. */
  readonly commandId: string;
  /** Identity of this transport attempt. */
  readonly attemptId: string;
  /** Derived stably from the command identity. */
  readonly clientOrderId: string;
  readonly account: AccountRef;
  readonly instrument: InstrumentKey;
  readonly side: Side;
  readonly quantity: number;
  readonly orderType: OrderType;
  readonly limitPriceTicks?: number;
  readonly stopPriceTicks?: number;
  readonly timeInForce: TimeInForce;
}

export interface CancelOrder {
  readonly commandId: string;
  readonly attemptId: string;
  readonly account: AccountRef;
  readonly brokerOrderId: string;
}

/**
 * Outcome of one transport attempt. UNKNOWN means the request may have been
 * accepted: callers must resolve it through lookup, never by resending.
 */
export type SubmitResult =
  | { readonly outcome: 'ACCEPTED'; readonly brokerOrderId: string; readonly acknowledgedAt: string }
  | {
      readonly outcome: 'REJECTED';
      readonly code: string;
      /** True only when non-acceptance is proven (e.g. failed before send). */
      readonly retryable: boolean;
      readonly message: string;
    }
  | { readonly outcome: 'UNKNOWN'; readonly attemptId: string; readonly reason: string };

export interface OrderState {
  readonly brokerOrderId: string;
  readonly clientOrderId: string;
  readonly canonicalAccountId: string;
  readonly instrument: InstrumentKey;
  readonly side: Side;
  readonly orderType: OrderType;
  readonly quantity: number;
  readonly filledQuantity: number;
  readonly limitPriceTicks?: number;
  readonly status: OrderStatus;
  /** Monotonic per order; a lower version never replaces a higher one. */
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** Immutable economic fact. Corrections are new records referencing the original. */
export interface Execution {
  readonly executionId: string;
  readonly brokerOrderId: string;
  readonly clientOrderId: string;
  readonly canonicalAccountId: string;
  readonly instrument: InstrumentKey;
  readonly side: Side;
  readonly quantity: number;
  readonly priceTicks: number;
  readonly occurredAt: string;
  readonly correctionOf?: string;
}

export interface Position {
  readonly canonicalAccountId: string;
  readonly instrument: InstrumentKey;
  /** Signed: positive long, negative short. */
  readonly netQuantity: number;
}

/**
 * Resolution of an ambiguous submission. NOT_FOUND is never conclusive on its
 * own: an empty search does not prove the order was not accepted.
 */
export type CommandResolution =
  | { readonly status: 'FOUND'; readonly order: OrderState }
  | { readonly status: 'AMBIGUOUS'; readonly orders: readonly OrderState[] }
  | { readonly status: 'NOT_FOUND'; readonly conclusive: false; readonly reason: string }
  | { readonly status: 'UNAVAILABLE'; readonly reason: string };

export interface AccountSnapshot {
  readonly account: AccountRef;
  readonly requestedAt: string;
  readonly receivedAt: string;
  readonly asOf: string;
  /** Stream position the snapshot reflects, comparable with event sequences in the same scope. */
  readonly cursor: string;
  readonly complete: boolean;
  readonly positions: readonly Position[];
  readonly orders: readonly OrderState[];
}

export interface ExecutionPage {
  readonly executions: readonly Execution[];
  readonly nextCursor: string | null;
  readonly complete: boolean;
}

export interface AuthStatus {
  readonly state: 'AUTHENTICATED' | 'AUTH_REQUIRED';
  readonly expiresAt?: string;
}

export type BrokerEventPayload =
  | { readonly kind: 'ORDER'; readonly order: OrderState }
  | { readonly kind: 'EXECUTION'; readonly execution: Execution }
  | { readonly kind: 'POSITION'; readonly position: Position };

export interface EventEnvelope<T = BrokerEventPayload> {
  readonly schemaVersion: 1;
  readonly provider: ProviderId;
  readonly environment: BrokerEnvironment;
  readonly connectionId: string;
  readonly canonicalAccountId: string;
  /** Stable provider identity, or a documented synthetic identity. */
  readonly eventId: string;
  readonly executionId?: string;
  readonly providerSequence?: string;
  readonly sequenceScopeKey?: string;
  readonly occurredAt?: string;
  readonly receivedAt: string;
  readonly payload: T;
  readonly quality: 'CONTIGUOUS' | 'GAP' | 'UNSEQUENCED' | 'SNAPSHOT';
}

export interface Subscription {
  unsubscribe(): void;
}

/** Thrown before anything is sent when an operation is outside declared capabilities. */
export class UnsupportedCapabilityError extends Error {
  override readonly name = 'UnsupportedCapabilityError';
  readonly code = 'UNSUPPORTED_CAPABILITY';
  readonly capability: string;

  constructor(capability: string, detail: string) {
    super(`Unsupported capability ${capability}: ${detail}`);
    this.capability = capability;
  }
}

/**
 * Provider-independent adapter contract. Methods return status metadata, never
 * credentials. Unsupported operations throw UnsupportedCapabilityError rather
 * than approximating behaviour.
 */
export interface BrokerAdapter {
  readonly provider: ProviderId;
  readonly environment: BrokerEnvironment;
  capabilities(): Capabilities;
  authenticate(secretRef: string): Promise<AuthStatus>;
  connect(): Promise<ConnectionState>;
  disconnect(): Promise<void>;
  connectionState(): ConnectionState;
  getAccounts(): Promise<readonly AccountRef[]>;
  getAccountState(canonicalAccountId: string): Promise<AccountSnapshot>;
  getExecutions(canonicalAccountId: string, cursor?: string): Promise<ExecutionPage>;
  getContractSpec(instrument: InstrumentKey): Promise<ContractSpec>;
  subscribe(handler: (event: EventEnvelope) => void): Subscription;
  placeOrder(command: PlaceOrder): Promise<SubmitResult>;
  cancelOrder(command: CancelOrder): Promise<SubmitResult>;
  modifyOrder(command: unknown): Promise<SubmitResult>;
  flattenPosition(command: unknown): Promise<SubmitResult>;
  flattenAccount(command: unknown): Promise<SubmitResult>;
  lookupCommand(lookup: { account: AccountRef; clientOrderId: string }): Promise<CommandResolution>;
}

export function instrumentKeyId(key: InstrumentKey): string {
  return [key.exchange, key.product, key.expiry, key.currency, key.providerContractId].join('|');
}

/* ---------- Runtime validation for normalized events entering the system ---------- */

const safeInt = z.number().int().refine(Number.isSafeInteger, 'must be a safe integer');
const nonNegativeInt = safeInt.refine((n) => n >= 0, 'must be non-negative');
const positiveInt = safeInt.refine((n) => n > 0, 'must be positive');
const id = z.string().min(1).max(200);
const isoTime = z.iso.datetime();

export const instrumentKeySchema = z
  .object({
    exchange: z.string().min(1).max(32),
    product: z.string().min(1).max(32),
    expiry: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
    currency: z.string().regex(/^[A-Z]{3}$/),
    providerContractId: id,
  })
  .strict();

export const orderStateSchema = z
  .object({
    brokerOrderId: id,
    clientOrderId: id,
    canonicalAccountId: id,
    instrument: instrumentKeySchema,
    side: z.enum(SIDES),
    orderType: z.enum(ORDER_TYPES),
    quantity: positiveInt,
    filledQuantity: nonNegativeInt,
    limitPriceTicks: safeInt.optional(),
    status: z.enum(ORDER_STATUSES),
    version: positiveInt,
    createdAt: isoTime,
    updatedAt: isoTime,
  })
  .strict()
  .refine((o) => o.filledQuantity <= o.quantity, 'filledQuantity exceeds quantity');

export const executionSchema = z
  .object({
    executionId: id,
    brokerOrderId: id,
    clientOrderId: id,
    canonicalAccountId: id,
    instrument: instrumentKeySchema,
    side: z.enum(SIDES),
    quantity: positiveInt,
    priceTicks: safeInt,
    occurredAt: isoTime,
    correctionOf: id.optional(),
  })
  .strict();

export const positionSchema = z
  .object({ canonicalAccountId: id, instrument: instrumentKeySchema, netQuantity: safeInt })
  .strict();

export const brokerEventPayloadSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('ORDER'), order: orderStateSchema }).strict(),
  z.object({ kind: z.literal('EXECUTION'), execution: executionSchema }).strict(),
  z.object({ kind: z.literal('POSITION'), position: positionSchema }).strict(),
]);

export const eventEnvelopeSchema = z
  .object({
    schemaVersion: z.literal(1),
    provider: z.enum(PROVIDER_IDS),
    environment: z.enum(BROKER_ENVIRONMENTS),
    connectionId: id,
    canonicalAccountId: id,
    eventId: id,
    executionId: id.optional(),
    providerSequence: z.string().regex(/^\d{1,18}$/).optional(),
    sequenceScopeKey: id.optional(),
    occurredAt: isoTime.optional(),
    receivedAt: isoTime,
    payload: brokerEventPayloadSchema,
    quality: z.enum(['CONTIGUOUS', 'GAP', 'UNSEQUENCED', 'SNAPSHOT']),
  })
  .strict();
