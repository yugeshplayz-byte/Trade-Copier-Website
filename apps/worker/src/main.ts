import { loadConfig } from '@tradecopier/config';
import { createLogger } from '@tradecopier/observability';
import { createWorker } from './worker.ts';

/** sysexits EX_CONFIG: refuse to start on unsafe or invalid configuration. */
const EXIT_CONFIG = 78;

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

  const shutdown = (signal: string): void => {
    worker.stop(signal).then(
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
  } catch (err) {
    logger.error('startup failed', { err });
    process.exitCode = 1;
    await worker.stop('startup failed');
  }
}

await main();
