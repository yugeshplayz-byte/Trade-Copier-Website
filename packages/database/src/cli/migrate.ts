// Applies pending migrations. Run explicitly with `npm run db:migrate`; never at app startup.
// Usage: node packages/database/src/cli/migrate.ts [--test]
import { loadConfig } from '@tradecopier/config';
import { createLogger } from '@tradecopier/observability';
import { migrate } from '../migrate.ts';
import { createPool } from '../pool.ts';

const logger = createLogger({ service: 'db-migrate' });
const target = process.argv.includes('--test') ? 'TEST_MIGRATION_DATABASE_URL' : 'MIGRATION_DATABASE_URL';

const config = loadConfig(process.env);
if (!config.ok) {
  logger.error('migration refused: configuration rejected', { problems: config.problems });
  process.exitCode = 78;
} else if (!process.env[target]) {
  logger.error(`migration refused: ${target} is not set (expected in .env.db-admin)`);
  process.exitCode = 78;
} else {
  const pool = createPool({ connectionString: process.env[target]!, applicationName: 'tradeplex-migrate', max: 1, statementTimeoutMs: 60_000 });
  try {
    const report = await migrate(pool);
    logger.info('migrations complete', { target, applied: report.applied, alreadyApplied: report.alreadyApplied.length });
  } catch (err) {
    logger.error('migration failed', { target, err });
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}
