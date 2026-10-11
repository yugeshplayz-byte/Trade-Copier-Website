export const REDACTED = '[REDACTED]';

/**
 * Field-name words whose values are always secret, regardless of content. Keys
 * are split into words (camelCase, snake_case, kebab-case) so that unrelated
 * names such as `tradingSession` or `footprint` are not masked.
 */
const SENSITIVE_WORDS = new Set([
  'password',
  'passwd',
  'passphrase',
  'pwd',
  'secret',
  'secrets',
  'token',
  'tokens',
  'authorization',
  'cookie',
  'cookies',
  'credential',
  'credentials',
  'signature',
  'bearer',
  'otp',
  'mfa',
  'apikey',
  'ciphertext',
]);

/** Adjacent word pairs that are secret together but not alone. */
const SENSITIVE_PAIRS = new Set(['api key', 'private key', 'access key', 'session id', 'session key', 'auth header']);

/** Secret-shaped substrings that can appear inside otherwise harmless strings. */
const SENSITIVE_VALUE_PATTERNS: readonly RegExp[] = [
  /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi,
  /\b(?:sk|rk|pk|whsec)_(?:live|test)_[A-Za-z0-9]+/g,
  /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, // JWT
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  /\b(?:postgres(?:ql)?|mysql|redis|amqp):\/\/[^\s:@/]+:[^\s@/]+@/gi, // credentials inside connection URLs
];

const MAX_DEPTH = 8;

export function redactString(value: string): string {
  let out = value;
  for (const pattern of SENSITIVE_VALUE_PATTERNS) {
    out = out.replace(pattern, REDACTED);
  }
  return out;
}

export function isSensitiveKey(key: string): boolean {
  const words = key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  for (let i = 0; i < words.length; i++) {
    if (SENSITIVE_WORDS.has(words[i]!)) return true;
    if (i + 1 < words.length && SENSITIVE_PAIRS.has(`${words[i]} ${words[i + 1]}`)) return true;
  }
  return false;
}

/**
 * Returns a redacted, JSON-safe copy of `value` for logs and diagnostics.
 * Sensitive keys are masked entirely; strings are scanned for secret-shaped
 * substrings. Errors keep name and redacted message only, because stacks and
 * attached properties can carry request bodies.
 */
export function redact(value: unknown): unknown {
  return redactInner(value, 0, new WeakSet());
}

function redactInner(value: unknown, depth: number, seen: WeakSet<object>): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return redactString(value);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'function' || typeof value === 'symbol') return undefined;
  if (depth >= MAX_DEPTH) return '[TRUNCATED]';

  const obj = value as object;
  if (seen.has(obj)) return '[CIRCULAR]';
  seen.add(obj);

  if (value instanceof Error) {
    return { name: value.name, message: redactString(value.message) };
  }
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? 'Invalid Date' : value.toISOString();
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactInner(item, depth + 1, seen));
  }

  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    out[key] = isSensitiveKey(key) ? REDACTED : redactInner(child, depth + 1, seen);
  }
  return out;
}
