import { afterEach, describe, expect, it } from 'vitest';
import { loadConfig } from '@tradecopier/config';
import { workerHealthSchema } from '@tradecopier/contracts';
import { createLogger } from '@tradecopier/observability';
import { createWorker, type Worker } from './worker.ts';

function testConfig() {
  const result = loadConfig({ APP_ENV: 'TEST', WORKER_HEALTH_PORT: '4100' });
  if (!result.ok) throw new Error(result.problems.join('\n'));
  // Port 0 asks the OS for a free ephemeral port.
  return { ...result.config, worker: { ...result.config.worker, healthPort: 0 } };
}

let worker: Worker | undefined;
afterEach(async () => {
  await worker?.stop('test cleanup');
  worker = undefined;
});

describe('createWorker', () => {
  it('serves a schema-valid loopback health document with dispatch disabled', async () => {
    const lines: string[] = [];
    worker = createWorker({
      config: testConfig(),
      logger: createLogger({ service: 'test', write: (_l, line) => lines.push(line) }),
    });
    await worker.start();
    const addr = worker.address();
    expect(addr?.host).toBe('127.0.0.1');

    const res = await fetch(`http://127.0.0.1:${addr!.port}/healthz`);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const health = workerHealthSchema.parse(await res.json());
    expect(health).toMatchObject({ appEnv: 'TEST', brokerMode: 'SIMULATED', orderDispatch: { enabled: false } });

    expect((await fetch(`http://127.0.0.1:${addr!.port}/anything`)).status).toBe(404);
    expect(lines.some((l) => JSON.parse(l).msg === 'worker started')).toBe(true);
  });

  it('advances its heartbeat on the configured interval', async () => {
    let t = Date.parse('2026-10-11T14:00:00.000Z');
    worker = createWorker({
      config: testConfig(),
      logger: createLogger({ service: 'test', write: () => {} }),
      now: () => new Date(t),
      heartbeatIntervalMs: 20,
    });
    await worker.start();
    const first = worker.health().lastHeartbeatAt;
    t += 5_000;
    await new Promise((r) => setTimeout(r, 80));
    expect(worker.health().lastHeartbeatAt).not.toBe(first);
    expect(worker.health().startedAt).toBe('2026-10-11T14:00:00.000Z');
  });

  it('stops idempotently and releases the port', async () => {
    worker = createWorker({ config: testConfig(), logger: createLogger({ service: 'test', write: () => {} }) });
    await worker.start();
    const port = worker.address()!.port;
    await worker.stop('first');
    await worker.stop('second');
    await expect(fetch(`http://127.0.0.1:${port}/healthz`)).rejects.toThrow();
  });
});
