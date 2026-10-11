import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { assertSameOrigin, readJsonBody, requireIdempotencyKey } from './guards.ts';
import { ApiError } from './http.ts';

const ALLOWED = ['http://127.0.0.1:3000', 'http://localhost:3000'];

function req(headers: Record<string, string>, body?: string): Request {
  return new Request('http://127.0.0.1:3000/api/v1/x', { method: 'POST', headers, ...(body !== undefined ? { body } : {}) });
}

function statusOf(fn: () => unknown): number | undefined {
  try {
    fn();
    return undefined;
  } catch (err) {
    return err instanceof ApiError ? err.status : -1;
  }
}

describe('assertSameOrigin', () => {
  it('accepts the app origin and same-origin fetch metadata', () => {
    expect(statusOf(() => assertSameOrigin(req({ origin: 'http://localhost:3000' }), ALLOWED))).toBeUndefined();
    expect(statusOf(() => assertSameOrigin(req({ 'sec-fetch-site': 'same-origin' }), ALLOWED))).toBeUndefined();
  });

  it('refuses foreign, null and missing origins', () => {
    expect(statusOf(() => assertSameOrigin(req({ origin: 'https://evil.example' }), ALLOWED))).toBe(403);
    expect(statusOf(() => assertSameOrigin(req({ origin: 'null' }), ALLOWED))).toBe(403);
    expect(statusOf(() => assertSameOrigin(req({ 'sec-fetch-site': 'cross-site' }), ALLOWED))).toBe(403);
    expect(statusOf(() => assertSameOrigin(req({}), ALLOWED))).toBe(403);
  });
});

describe('requireIdempotencyKey', () => {
  it('requires a well-formed key', () => {
    expect(requireIdempotencyKey(req({ 'idempotency-key': 'abc-12345' }))).toBe('abc-12345');
    for (const bad of ['short', 'has space here', 'x'.repeat(201), 'semi;colon1']) {
      expect(statusOf(() => requireIdempotencyKey(req({ 'idempotency-key': bad })))).toBe(400);
    }
    expect(statusOf(() => requireIdempotencyKey(req({})))).toBe(400);
  });
});

describe('readJsonBody', () => {
  const schema = z.object({ name: z.string() }).strict();

  async function statusOfAsync(p: Promise<unknown>): Promise<number | undefined> {
    try {
      await p;
      return undefined;
    } catch (err) {
      return err instanceof ApiError ? err.status : -1;
    }
  }

  it('parses valid JSON bodies', async () => {
    await expect(readJsonBody(req({ 'content-type': 'application/json' }, '{"name":"a"}'), schema)).resolves.toEqual({ name: 'a' });
  });

  it('rejects wrong media type, oversize, malformed JSON and unknown fields', async () => {
    expect(await statusOfAsync(readJsonBody(req({ 'content-type': 'text/plain' }, '{}'), schema))).toBe(415);
    expect(await statusOfAsync(readJsonBody(req({ 'content-type': 'application/json' }, `{"name":"${'x'.repeat(20_000)}"}`), schema))).toBe(413);
    expect(await statusOfAsync(readJsonBody(req({ 'content-type': 'application/json' }, '{nope'), schema))).toBe(400);
    await expect(readJsonBody(req({ 'content-type': 'application/json' }, '{"name":"a","tenantId":"x"}'), schema)).rejects.toThrow();
  });
});
