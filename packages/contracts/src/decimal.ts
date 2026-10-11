/**
 * Exact decimal and tick arithmetic for prices and money (DATABASE.md, CLAUDE.md
 * financial correctness rules). Values are carried as decimal strings at the
 * boundary and as scaled BigInts internally; binary floating point is never used
 * for a price, tick size, tick value or amount.
 */

const DECIMAL_PATTERN = /^-?\d{1,30}(?:\.\d{1,18})?$/;

export class DecimalFormatError extends Error {
  override readonly name = 'DecimalFormatError';
}

export class TickAlignmentError extends Error {
  override readonly name = 'TickAlignmentError';
}

interface Scaled {
  readonly units: bigint;
  readonly scale: number;
}

function parse(text: string, label: string): Scaled {
  if (typeof text !== 'string' || !DECIMAL_PATTERN.test(text)) {
    throw new DecimalFormatError(`${label} is not a plain decimal string`);
  }
  const negative = text.startsWith('-');
  const body = negative ? text.slice(1) : text;
  const [whole = '0', fraction = ''] = body.split('.');
  const units = BigInt(whole + fraction) * (negative ? -1n : 1n);
  return { units, scale: fraction.length };
}

function rescale(value: Scaled, scale: number): bigint {
  return value.units * 10n ** BigInt(scale - value.scale);
}

function format(units: bigint, scale: number): string {
  const negative = units < 0n;
  const digits = (negative ? -units : units).toString().padStart(scale + 1, '0');
  const whole = scale === 0 ? digits : digits.slice(0, -scale);
  let fraction = scale === 0 ? '' : digits.slice(-scale);
  fraction = fraction.replace(/0+$/, '');
  const text = fraction ? `${whole}.${fraction}` : whole;
  return negative && text !== '0' ? `-${text}` : text;
}

function toSafeInteger(value: bigint, label: string): number {
  if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < BigInt(Number.MIN_SAFE_INTEGER)) {
    throw new RangeError(`${label} exceeds the safe integer range`);
  }
  return Number(value);
}

/** Validates a decimal string and returns its canonical form (no trailing zeros). */
export function normalizeDecimal(text: string): string {
  const value = parse(text, 'value');
  return format(value.units, value.scale);
}

/** Compares two decimal strings exactly: -1, 0 or 1. */
export function compareDecimal(a: string, b: string): -1 | 0 | 1 {
  const x = parse(a, 'a');
  const y = parse(b, 'b');
  const scale = Math.max(x.scale, y.scale);
  const left = rescale(x, scale);
  const right = rescale(y, scale);
  return left === right ? 0 : left < right ? -1 : 1;
}

function positiveTick(tickSize: string): Scaled {
  const tick = parse(tickSize, 'tickSize');
  if (tick.units <= 0n) throw new DecimalFormatError('tickSize must be positive');
  return tick;
}

/**
 * Converts a decimal price to an integer number of ticks. Throws when the price
 * is not an exact multiple of the tick size; it never rounds.
 */
export function priceToTicks(price: string, tickSize: string): number {
  const p = parse(price, 'price');
  const tick = positiveTick(tickSize);
  const scale = Math.max(p.scale, tick.scale);
  const priceUnits = rescale(p, scale);
  const tickUnits = rescale(tick, scale);
  if (priceUnits % tickUnits !== 0n) {
    throw new TickAlignmentError(`price ${price} is not aligned to tick size ${tickSize}`);
  }
  return toSafeInteger(priceUnits / tickUnits, 'tick count');
}

/** Converts an integer tick count back to an exact decimal price string. */
export function ticksToPrice(ticks: number, tickSize: string): string {
  if (!Number.isSafeInteger(ticks)) throw new RangeError('ticks must be a safe integer');
  const tick = positiveTick(tickSize);
  return format(BigInt(ticks) * tick.units, tick.scale);
}

/**
 * Exact money amount for a signed tick movement on a signed quantity:
 * ticks × quantity × tickValue (currency per tick per contract).
 */
export function tickMoney(ticks: number, quantity: number, tickValue: string): string {
  if (!Number.isSafeInteger(ticks) || !Number.isSafeInteger(quantity)) {
    throw new RangeError('ticks and quantity must be safe integers');
  }
  const value = parse(tickValue, 'tickValue');
  return format(BigInt(ticks) * BigInt(quantity) * value.units, value.scale);
}
