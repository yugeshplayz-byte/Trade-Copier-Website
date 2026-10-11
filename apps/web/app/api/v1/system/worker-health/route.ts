import { withAuth } from '@workos-inc/authkit-nextjs';
import { NextResponse } from 'next/server';
import { getServerConfig } from '@/lib/server-config.ts';
import { classifyWorkerHealth, probeWorker } from '@/lib/worker-health.ts';

export const dynamic = 'force-dynamic';

/**
 * Read-only worker health projection for the dashboard. Contains no secrets or
 * account data. Requires a session once sign-in is configured.
 */
export async function GET() {
  const result = getServerConfig();
  if (!result.ok) {
    return NextResponse.json({ error: 'configuration_refused' }, { status: 503, headers: { 'cache-control': 'no-store' } });
  }
  if (result.config.auth.configured && !(await withAuth()).user) {
    return NextResponse.json(
      { error: { code: 'unauthenticated', message: 'Sign in to continue.' } },
      { status: 401, headers: { 'cache-control': 'no-store' } },
    );
  }
  const { config } = result;
  const probe = await probeWorker(config.worker.healthHost, config.worker.healthPort);
  const status = classifyWorkerHealth(probe, config.appEnv, new Date());
  return NextResponse.json({ status }, { headers: { 'cache-control': 'no-store' } });
}
