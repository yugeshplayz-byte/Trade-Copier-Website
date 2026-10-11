import { loadConfig } from '@tradecopier/config';
import { assertRestrictedRuntimeRole, createPool, type Pool } from '@tradecopier/database';
import { createLogger, type Logger } from '@tradecopier/observability';
import { createActivationProcessor } from './activation.ts';
import { createConnectionSupervisor } from './connections.ts';
import { createWorker } from './worker.ts';

/** sysexits EX_CONFIG: refuse to start on unsafe or invalid configuration. */
const EXIT_CONFIG = 78;
/** How often the worker looks for connections to establish. */
const CONNECTION_POLL_MS = 2_000;

interface JobLoop {
  stop(): Promise<void>;
}

/** Runs the connection supervisor, then activation preflights, on an interval without overlapping ticks. */
async function startConnectionLoop(databaseUrl: string, logger: Logger): Promise<JobLoop> {
  const pool: Pool = createPool({ connectionString: databaseUrl, applicationName: 'tradeplex-worker', max: 4 });
  await assertRestrictedRuntimeRole(pool);
  const supervisor = createConnectionSupervisor({ pool, logger: logger.child({ component: 'connections' }) });
  await supervisor.recoverOnStartup();
  const activations = createActivationProcessor({
    pool,
    logger: logger.child({ component: 'activation' }),
    sessions: supervisor.sessions,
  });

  let running = false;
  let stopped = false;
  const timer = setInterval(() => {
    if (running || stopped) return;
    running = true;
    supervisor
      .tick()
      .then(() => activations.tick())
      .catch((err: unknown) => logger.error('worker tick failed', { err }))
      .finally(() => {
        running = false;
      });
  }, CONNECTION_POLL_MS);

  return {
    async stop() {
      stopped = true;
      clearInterval(timer);
      await pool.end();
    },
  };
}

async function main(): Promise<void> {
  const result = loadConfig(process.env);
  if (!result.ok) {
    createLogger({ service: 'execution-worker' }).error('startup refused: configuration rejected', {
      problems: result.problems,
    });
    // Let stderr drain instead of calling process.exit().
    process.exitCode = EXIT_CONFIG;
    return;
  }

  const { config } = result;
  const logger = createLogger({ service: 'execution-worker', level: config.logLevel });
  const worker = createWorker({ config, logger });
  let jobs: JobLoop | undefined;

  const shutdown = (signal: string): void => {
    Promise.all([jobs?.stop(), worker.stop(signal)]).then(
      () => process.exit(0),
      (err: unknown) => {
        logger.error('shutdown failed', { err });
        process.exit(1);
      },
    );
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  // Fail closed: an unexpected error stops the worker rather than leaving it in an unknown state.
  process.on('uncaughtException', (err) => {
    logger.error('uncaught exception; stopping', { err });
    process.exit(1);
  });
  process.on('unhandledRejection', (err) => {
    logger.error('unhandled rejection; stopping', { err });
    process.exit(1);
  });

  try {
    await worker.start();
    if (config.databaseUrl) {
      jobs = await startConnectionLoop(config.databaseUrl, logger);
      logger.info('connection supervisor started', { pollMs: CONNECTION_POLL_MS });
    } else {
      logger.warn('no DATABASE_URL: connection supervisor not started');
    }
  } catch (err) {
    logger.error('startup failed', { err });
    process.exitCode = 1;
    await jobs?.stop();
    await worker.stop('startup failed');
  }
}

await main();
