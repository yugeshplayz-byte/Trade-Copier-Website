import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { workerHealthSchema } from '@tradecopier/contracts';

const MAIN = fileURLToPath(new URL('./main.ts', import.meta.url));
const FAKE_SECRET = 'fake-broker-secret-0000';

/** Minimal environment: nothing from the developer's shell leaks into the worker. */
function baseEnv(extra: Record<string, string>): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...extra };
  for (const key of ['PATH', 'Path', 'SystemRoot', 'TEMP', 'TMP']) {
    if (process.env[key]) env[key] = process.env[key];
  }
  return env;
}

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      srv.close(() => (addr && typeof addr !== 'string' ? resolve(addr.port) : reject(new Error('no port'))));
    });
  });
}

interface Run {
  child: ChildProcess;
  output: () => string;
  exited: Promise<number | null>;
}

function runWorker(env: Record<string, string>): Run {
  const child = spawn(process.execPath, [MAIN], { env: baseEnv(env), stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  child.stdout!.on('data', (d) => (out += d));
  child.stderr!.on('data', (d) => (out += d));
  const exited = new Promise<number | null>((resolve) => child.on('exit', (code) => resolve(code)));
  return { child, output: () => out, exited };
}

async function waitForHealth(port: number, timeoutMs = 10_000): Promise<unknown> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/healthz`);
      return await res.json();
    } catch (err) {
      if (Date.now() > deadline) throw err;
      await new Promise((r) => setTimeout(r, 100));
    }
  }
}

let running: Run | undefined;
afterEach(async () => {
  if (running && running.child.exitCode === null) {
    running.child.kill();
    await running.exited;
  }
  running = undefined;
});

describe('worker process', () => {
  it('starts as a standalone process and reports dispatch disabled', async () => {
    const port = await freePort();
    running = runWorker({ APP_ENV: 'TEST', WORKER_HEALTH_PORT: String(port) });
    const health = workerHealthSchema.parse(await waitForHealth(port));
    expect(health.orderDispatch.enabled).toBe(false);
    expect(health.appEnv).toBe('TEST');
  });

  it('refuses to start in PRODUCTION with a configuration exit code', async () => {
    const run = runWorker({ APP_ENV: 'PRODUCTION' });
    expect(await run.exited).toBe(78);
    expect(run.output()).toContain('startup refused');
    expect(run.output()).toContain('PRODUCTION is refused');
  });

  it('refuses broker credentials in test mode without printing the secret', async () => {
    const run = runWorker({ APP_ENV: 'TEST', TRADOVATE_API_SECRET: FAKE_SECRET });
    expect(await run.exited).toBe(78);
    expect(run.output()).toContain('TRADOVATE_API_SECRET');
    expect(run.output()).not.toContain(FAKE_SECRET);
  });

  it('refuses to start without an explicit APP_ENV', async () => {
    const run = runWorker({});
    expect(await run.exited).toBe(78);
    expect(run.output()).toContain('APP_ENV');
  });
});
