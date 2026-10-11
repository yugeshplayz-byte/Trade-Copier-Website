import { describe, expect, it } from 'vitest';
import { loadConfig } from './index.ts';

// Synthetic fixtures only. Credential-looking values are obviously fake.
const FAKE_SECRET = 'fake-secret-value-0000';
const FAKE_LIVE_KEY = 'sk_live_' + 'FAKE0000FAKE0000';

function problemsFor(env: Record<string, string>): string[] {
  const result = loadConfig(env);
  if (result.ok) throw new Error('expected configuration to be refused');
  return result.problems;
}

describe('loadConfig', () => {
  it('accepts a minimal local simulator configuration with safe defaults', () => {
    const result = loadConfig({ APP_ENV: 'LOCAL' });
    expect(result).toEqual({
      ok: true,
      config: {
        appEnv: 'LOCAL',
        brokerMode: 'SIMULATED',
        logLevel: 'info',
        worker: { healthHost: '127.0.0.1', healthPort: 4100 },
        databaseUrl: undefined,
        allowedOrigins: ['http://127.0.0.1:3000', 'http://localhost:3000'],
      },
    });
  });

  it('validates APP_ORIGIN: origin only, loopback locally, https remotely', () => {
    expect(problemsFor({ APP_ENV: 'LOCAL', APP_ORIGIN: 'http://127.0.0.1:3000/app' })[0]).toMatch(/origin only/);
    expect(problemsFor({ APP_ENV: 'LOCAL', APP_ORIGIN: 'http://example.com' })[0]).toMatch(/loopback/);
    expect(problemsFor({ APP_ENV: 'STAGING', APP_ORIGIN: 'http://staging.example.com' })[0]).toMatch(/https/);
    expect(problemsFor({ APP_ENV: 'STAGING' })).toEqual(['APP_ORIGIN: required for STAGING.']);
    expect(problemsFor({ APP_ENV: 'LOCAL', APP_ORIGIN: 'nonsense' })[0]).toMatch(/valid origin/);
    const staging = loadConfig({ APP_ENV: 'STAGING', APP_ORIGIN: 'https://staging.example.com' });
    expect(staging.ok && staging.config.allowedOrigins).toEqual(['https://staging.example.com']);
  });

  it('requires an explicit APP_ENV', () => {
    expect(problemsFor({})).toEqual([expect.stringMatching(/^APP_ENV: required/)]);
    expect(problemsFor({ APP_ENV: 'local' })[0]).toMatch(/^APP_ENV/);
  });

  it('refuses PRODUCTION entirely in this build', () => {
    expect(problemsFor({ APP_ENV: 'PRODUCTION' })).toEqual([expect.stringMatching(/PRODUCTION is refused/)]);
  });

  it.each(['LIVE', 'PROVIDER_PRACTICE', 'PRACTICE', 'simulated'])('refuses BROKER_MODE=%s', (mode) => {
    expect(problemsFor({ APP_ENV: 'LOCAL', BROKER_MODE: mode })[0]).toMatch(/^BROKER_MODE/);
  });

  it.each([
    'TRADOVATE_API_SECRET',
    'tradovate_password',
    'RITHMIC_PASSWORD',
    'TOPSTEPX_API_KEY',
    'PROJECTX_TOKEN',
    'NINJATRADER_CLIENT_SECRET',
    'BROKER_API_KEY',
  ])('refuses broker credential %s in test mode without echoing its value', (name) => {
    for (const appEnv of ['TEST', 'LOCAL', 'STAGING']) {
      const problems = problemsFor({ APP_ENV: appEnv, [name]: FAKE_SECRET });
      expect(problems.some((p) => p.startsWith(`${name}:`))).toBe(true);
      expect(problems.join('\n')).not.toContain(FAKE_SECRET);
    }
  });

  it('ignores empty provider variables', () => {
    expect(loadConfig({ APP_ENV: 'TEST', TRADOVATE_API_SECRET: '' }).ok).toBe(true);
  });

  it('refuses live payment keys outside production without echoing them', () => {
    const problems = problemsFor({ APP_ENV: 'TEST', STRIPE_SECRET_KEY: FAKE_LIVE_KEY });
    expect(problems).toEqual([expect.stringMatching(/^STRIPE_SECRET_KEY: a live payment key is refused/)]);
    expect(problems.join('\n')).not.toContain(FAKE_LIVE_KEY);
  });

  it('allows test-mode payment keys', () => {
    expect(loadConfig({ APP_ENV: 'TEST', STRIPE_SECRET_KEY: 'sk_test_' + 'FAKE' }).ok).toBe(true);
  });

  it('limits LOCAL and TEST databases to loopback hosts', () => {
    expect(loadConfig({ APP_ENV: 'LOCAL', DATABASE_URL: 'postgres://app@localhost:5432/tc' }).ok).toBe(true);
    expect(loadConfig({ APP_ENV: 'TEST', DATABASE_URL: 'postgres://app@127.0.0.1:5432/tc' }).ok).toBe(true);
    const remote = 'postgres://app:' + FAKE_SECRET + '@db.example.com:5432/tc';
    const problems = problemsFor({ APP_ENV: 'LOCAL', DATABASE_URL: remote });
    expect(problems).toEqual([expect.stringMatching(/^DATABASE_URL: LOCAL may only use a loopback/)]);
    expect(problems.join('\n')).not.toContain(FAKE_SECRET);
    expect(problemsFor({ APP_ENV: 'TEST', DATABASE_URL: 'not a url' })).toEqual([
      'DATABASE_URL: not a valid connection URL.',
    ]);
    expect(problemsFor({ APP_ENV: 'TEST', DATABASE_URL: 'mysql://app@localhost/tc' })).toEqual([
      'DATABASE_URL: not a valid connection URL.',
    ]);
  });

  it('applies the loopback rule to migration and test database URLs too', () => {
    const problems = problemsFor({
      APP_ENV: 'LOCAL',
      MIGRATION_DATABASE_URL: 'postgres://tradeplex_migrator@db.example.com/tc',
      TEST_DATABASE_URL: 'postgres://tradeplex_app@10.0.0.5/tc_test',
    });
    expect(problems).toEqual([
      'MIGRATION_DATABASE_URL: LOCAL may only use a loopback database host.',
      'TEST_DATABASE_URL: LOCAL may only use a loopback database host.',
    ]);
  });

  it('refuses superuser connections in every database URL without echoing passwords', () => {
    const url = 'postgres://postgres:' + FAKE_SECRET + '@127.0.0.1:5432/tc';
    for (const name of ['DATABASE_URL', 'MIGRATION_DATABASE_URL', 'TEST_DATABASE_URL']) {
      const problems = problemsFor({ APP_ENV: 'LOCAL', [name]: url });
      expect(problems).toEqual([`${name}: must use a restricted role, never a database superuser.`]);
      expect(problems.join('\n')).not.toContain(FAKE_SECRET);
    }
  });

  it('validates the worker health port range', () => {
    expect(problemsFor({ APP_ENV: 'LOCAL', WORKER_HEALTH_PORT: '80' })[0]).toMatch(/^WORKER_HEALTH_PORT/);
    const ok = loadConfig({ APP_ENV: 'LOCAL', WORKER_HEALTH_PORT: '4555' });
    expect(ok.ok && ok.config.worker.healthPort).toBe(4555);
  });

  it('reports every problem at once', () => {
    const problems = problemsFor({ APP_ENV: 'PRODUCTION', TRADOVATE_API_KEY: FAKE_SECRET });
    expect(problems).toHaveLength(2);
  });
});
