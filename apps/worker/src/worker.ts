import { createServer, type Server } from 'node:http';
import type { AppConfig } from '@tradecopier/config';
import type { WorkerHealth } from '@tradecopier/contracts';
import type { Logger } from '@tradecopier/observability';
import { orderDispatchSummary } from './dispatch-gate.ts';

/** Proposed simulation default (REALTIME.md); calibrate per provider before beta. */
export const HEARTBEAT_INTERVAL_MS = 5_000;

export interface WorkerDeps {
  readonly config: AppConfig;
  readonly logger: Logger;
  readonly now?: () => Date;
  readonly heartbeatIntervalMs?: number;
}

export interface Worker {
  start(): Promise<void>;
  stop(reason: string): Promise<void>;
  health(): WorkerHealth;
  /** Bound health address once started. */
  address(): { host: string; port: number } | null;
}

/**
 * Persistent execution worker process. In this phase it owns only its lifecycle,
 * heartbeat and loopback health endpoint; it has no broker adapters, jobs or
 * database. It runs independently of any browser session.
 */
export function createWorker(deps: WorkerDeps): Worker {
  const now = deps.now ?? (() => new Date());
  const intervalMs = deps.heartbeatIntervalMs ?? HEARTBEAT_INTERVAL_MS;
  const log = deps.logger;
  const startedAt = now();
  let lastHeartbeatAt = startedAt;
  let timer: NodeJS.Timeout | undefined;
  let server: Server | undefined;
  let stopping = false;

  const health = (): WorkerHealth => ({
    service: 'execution-worker',
    schemaVersion: 1,
    appEnv: deps.config.appEnv,
    brokerMode: deps.config.brokerMode,
    startedAt: startedAt.toISOString(),
    lastHeartbeatAt: lastHeartbeatAt.toISOString(),
    heartbeatIntervalMs: intervalMs,
    orderDispatch: orderDispatchSummary(),
  });

  const heartbeat = (): void => {
    lastHeartbeatAt = now();
    log.debug('heartbeat', { lastHeartbeatAt: lastHeartbeatAt.toISOString() });
  };

  const address = (): { host: string; port: number } | null => {
    const addr = server?.address();
    if (!addr || typeof addr === 'string') return null;
    return { host: addr.address, port: addr.port };
  };

  return {
    async start() {
      server = createServer((req, res) => {
        if (req.method === 'GET' && req.url === '/healthz') {
          const body = JSON.stringify(health());
          res.writeHead(200, {
            'content-type': 'application/json; charset=utf-8',
            'cache-control': 'no-store',
            'x-content-type-options': 'nosniff',
          });
          res.end(body);
          return;
        }
        res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
        res.end('not found');
      });
      server.requestTimeout = 5_000;
      server.headersTimeout = 5_000;

      const { healthHost, healthPort } = deps.config.worker;
      await new Promise<void>((resolve, reject) => {
        server!.once('error', reject);
        server!.listen(healthPort, healthHost, () => {
          server!.off('error', reject);
          resolve();
        });
      });

      timer = setInterval(heartbeat, intervalMs);
      const addr = address();
      log.info('worker started', {
        appEnv: deps.config.appEnv,
        brokerMode: deps.config.brokerMode,
        orderDispatch: orderDispatchSummary(),
        health: addr ? `http://${addr.host}:${addr.port}/healthz` : null,
      });
    },

    async stop(reason) {
      if (stopping) return;
      stopping = true;
      if (timer) clearInterval(timer);
      if (server) {
        server.closeAllConnections();
        await new Promise<void>((resolve) => server!.close(() => resolve()));
      }
      log.info('worker stopped', { reason });
    },

    health,
    address,
  };
}
