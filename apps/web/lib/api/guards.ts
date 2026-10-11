import type { ZodType } from 'zod';
import { ApiError } from './http.ts';

const IDEMPOTENCY_KEY = /^[A-Za-z0-9_-]{8,200}$/;
const DEFAULT_MAX_BODY_BYTES = 16_384;

/**
 * CSRF defence for state-changing requests: the browser-sent Origin must be one
 * of the app's own origins. Without an Origin header, only a same-origin
 * Sec-Fetch-Site is accepted. Anything else is refused.
 */
export function assertSameOrigin(request: Request, allowedOrigins: readonly string[]): void {
  const origin = request.headers.get('origin');
  if (origin !== null) {
    if (!allowedOrigins.includes(origin)) {
      throw new ApiError(403, 'origin_rejected', 'This request did not come from the Tradeplex app.');
    }
    return;
  }
  if (request.headers.get('sec-fetch-site') === 'same-origin') return;
  throw new ApiError(403, 'origin_required', 'State-changing requests must come from the Tradeplex app.');
}

/** Every mutation requires a client-generated Idempotency-Key so retries cannot duplicate effects. */
export function requireIdempotencyKey(request: Request): string {
  const key = request.headers.get('idempotency-key');
  if (key === null || !IDEMPOTENCY_KEY.test(key)) {
    throw new ApiError(400, 'idempotency_key_required', 'Send an Idempotency-Key header of 8-200 letters, digits, - or _.');
  }
  return key;
}

/** Reads and validates a bounded JSON body. */
export async function readJsonBody<T>(request: Request, schema: ZodType<T>, maxBytes = DEFAULT_MAX_BODY_BYTES): Promise<T> {
  const contentType = request.headers.get('content-type') ?? '';
  if (!contentType.toLowerCase().startsWith('application/json')) {
    throw new ApiError(415, 'unsupported_media_type', 'Send the request body as application/json.');
  }
  const declared = Number(request.headers.get('content-length') ?? '0');
  if (declared > maxBytes) throw new ApiError(413, 'body_too_large', 'The request body is too large.');
  const text = await request.text();
  if (new TextEncoder().encode(text).length > maxBytes) {
    throw new ApiError(413, 'body_too_large', 'The request body is too large.');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new ApiError(400, 'invalid_json', 'The request body is not valid JSON.');
  }
  return schema.parse(parsed);
}
