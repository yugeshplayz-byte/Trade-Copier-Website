import { describe, expect, it } from 'vitest';
import { REDACTED, createLogger, isSensitiveKey, redact, redactString } from './index.ts';

// Synthetic, obviously fake values. None of these are real credentials.
const FAKE_JWT = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJmYWtlIn0.ZmFrZXNpZ25hdHVyZQ';
const FAKE_STRIPE = 'sk_test_' + 'FAKEFAKEFAKE0000';

describe('redact', () => {
  it('masks values under sensitive keys at any depth', () => {
    const out = redact({
      connection: { apiKey: 'abc', nested: { refreshToken: 'r1', password: 'p' } },
      Authorization: 'Bearer xyz',
      accountId: 'SIM-1',
    });
    expect(out).toEqual({
      connection: { apiKey: REDACTED, nested: { refreshToken: REDACTED, password: REDACTED } },
      Authorization: REDACTED,
      accountId: 'SIM-1',
    });
  });

  it('matches whole key words rather than substrings', () => {
    for (const key of ['api_key', 'X-Api-Key', 'clientSecret', 'refresh_token', 'sessionId', 'privateKey', 'set-cookie']) {
      expect(isSensitiveKey(key), key).toBe(true);
    }
    for (const key of ['tradingSession', 'footprint', 'authState', 'tokenizer_version', 'accountId', 'author']) {
      expect(isSensitiveKey(key), key).toBe(false);
    }
  });

  it('scrubs secret-shaped substrings inside ordinary strings', () => {
    const text = `failed: Bearer ${FAKE_JWT} key=${FAKE_STRIPE} db=postgres://app:hunter2@localhost:5432/x`;
    const out = redactString(text);
    expect(out).not.toContain(FAKE_JWT);
    expect(out).not.toContain(FAKE_STRIPE);
    expect(out).not.toContain('hunter2');
    expect(out).toContain('localhost:5432/x');
  });

  it('keeps only name and redacted message from errors', () => {
    const err = Object.assign(new Error(`token ${FAKE_JWT} rejected`), { requestBody: { password: 'p' } });
    const out = redact({ err }) as { err: Record<string, unknown> };
    expect(Object.keys(out.err).sort()).toEqual(['message', 'name']);
    expect(out.err.message).not.toContain(FAKE_JWT);
  });

  it('handles cycles and depth without throwing', () => {
    const a: Record<string, unknown> = { name: 'a' };
    a.self = a;
    expect(redact(a)).toEqual({ name: 'a', self: '[CIRCULAR]' });
    let deep: Record<string, unknown> = {};
    const root = deep;
    for (let i = 0; i < 20; i++) {
      const next = {};
      deep.child = next;
      deep = next;
    }
    expect(JSON.stringify(redact(root))).toContain('[TRUNCATED]');
  });
});

describe('createLogger', () => {
  it('emits JSON lines with redacted fields and respects level', () => {
    const lines: string[] = [];
    const logger = createLogger({
      service: 'test',
      level: 'info',
      write: (_level, line) => lines.push(line),
      now: () => new Date('2026-10-11T12:00:00.000Z'),
    });
    logger.debug('hidden');
    logger.child({ connectionId: 'c1' }).warn(`auth failed with ${FAKE_STRIPE}`, { clientSecret: 'shh' });
    expect(lines).toHaveLength(1);
    const record = JSON.parse(lines[0]!);
    expect(record).toMatchObject({
      ts: '2026-10-11T12:00:00.000Z',
      level: 'warn',
      service: 'test',
      connectionId: 'c1',
      clientSecret: REDACTED,
    });
    expect(record.msg).not.toContain(FAKE_STRIPE);
  });
});
