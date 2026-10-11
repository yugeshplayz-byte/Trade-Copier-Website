/** Runs once when the Next.js server starts: report configuration refusal loudly. */
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const { loadConfig } = await import('@tradecopier/config');
  const { createLogger } = await import('@tradecopier/observability');
  const result = loadConfig(process.env);
  const logger = createLogger({ service: 'web' });
  if (!result.ok) {
    logger.error('configuration refused; every page will show the refusal', { problems: result.problems });
  } else {
    logger.info('web started', { appEnv: result.config.appEnv, brokerMode: result.config.brokerMode });
  }
}
