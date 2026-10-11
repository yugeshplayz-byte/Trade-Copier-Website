import { describe, expect, it } from 'vitest';
import { classifyWorkerHealth, HEARTBEAT_TIMEOUT_MS } from './worker-health.ts';

const NOW = new Date('2026-10-11T14:00:20.000Z');

function healthDoc(overrides: Record<string, unknown> = {}) {
  return {
    service: 'execution-worker',
    schemaVersion: 1,
    appEnv: 'LOCAL',
    brokerMode: 'SIMULATED',
    startedAt: '2026-10-11T14:00:00.000Z',
    lastHeartbeatAt: '2026-10-11T14:00:15.000Z',
    heartbeatIntervalMs: 5000,
    orderDispatch: { enabled: false, reason: 'No adapter.' },
    ...overrides,
  };
}

describe('classifyWorkerHealth', () => {
  it('reports RUNNING only for a valid, same-environment, fresh heartbeat', () => {
    const status = classifyWorkerHealth({ kind: 'response', status: 200, body: healthDoc() }, 'LOCAL', NOW);
    expect(status).toMatchObject({ state: 'RUNNING', heartbeatAgeMs: 5000 });
  });

  it('reports STALE when the heartbeat is older than the timeout', () => {
    const old = new Date(NOW.getTime() - HEARTBEAT_TIMEOUT_MS - 1).toISOString();
    const status = classifyWorkerHealth(
      { kind: 'response', status: 200, body: healthDoc({ lastHeartbeatAt: old }) },
      'LOCAL',
      NOW,
    );
    expect(status.state).toBe('STALE');
  });

  it('flags a worker from a different environment instead of trusting it', () => {
    const status = classifyWorkerHealth(
      { kind: 'response', status: 200, body: healthDoc({ appEnv: 'STAGING' }) },
      'LOCAL',
      NOW,
    );
    expect(status).toMatchObject({ state: 'ENVIRONMENT_MISMATCH', expected: 'LOCAL' });
  });

  it('rejects documents claiming order dispatch is enabled or carrying unknown fields', () => {
    for (const body of [
      healthDoc({ orderDispatch: { enabled: true, reason: 'x' } }),
      healthDoc({ extra: 'field' }),
      { nonsense: true },
      null,
    ]) {
      expect(classifyWorkerHealth({ kind: 'response', status: 200, body }, 'LOCAL', NOW).state).toBe('INVALID_RESPONSE');
    }
  });

  it('distinguishes HTTP errors from an unreachable worker', () => {
    expect(classifyWorkerHealth({ kind: 'response', status: 500, body: null }, 'LOCAL', NOW)).toMatchObject({
      state: 'INVALID_RESPONSE',
      detail: 'HTTP 500',
    });
    expect(classifyWorkerHealth({ kind: 'error', detail: 'No worker is listening.' }, 'LOCAL', NOW).state).toBe(
      'UNREACHABLE',
    );
  });
});
