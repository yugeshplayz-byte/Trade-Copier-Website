import 'server-only';
import { assertRestrictedRuntimeRole, createPool, type Pool } from '@tradecopier/database';
import { ApiError } from '@/lib/api/http.ts';
import { noIdentityProvider } from '@/lib/api/principal.ts';
import type { ApiDeps } from '@/lib/api/risk-profiles.ts';
import { getServerConfig } from '@/lib/server-config.ts';
import { isAuthConfigured, workosPrincipalResolver } from './auth.ts';

let pool: Pool | undefined;
let verified: Promise<void> | undefined;

/** Runtime pool, verified once to be the restricted role before first use. */
export async function getVerifiedPool(): Promise<Pool> {
  const result = getServerConfig();
  if (!result.ok || !result.config.databaseUrl) {
    throw new ApiError(503, 'database_unavailable', 'The database is not configured.');
  }
  pool ??= createPool({ connectionString: result.config.databaseUrl, applicationName: 'tradeplex-web' });
  verified ??= assertRestrictedRuntimeRole(pool);
  await verified;
  return pool;
}

export function apiDeps(): ApiDeps {
  const result = getServerConfig();
  return {
    pool: getVerifiedPool,
    resolvePrincipal: isAuthConfigured() ? workosPrincipalResolver(getVerifiedPool) : noIdentityProvider,
    allowedOrigins: result.ok ? result.config.allowedOrigins : [],
  };
}
