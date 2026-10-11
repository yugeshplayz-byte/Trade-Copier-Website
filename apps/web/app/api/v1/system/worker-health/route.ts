import { NextResponse } from 'next/server';
import { getServerConfig } from '@/lib/server-config.ts';
import { classifyWorkerHealth, probeWorker } from '@/lib/worker-health.ts';

export const dynamic = 'force-dynamic';

/**
 * Read-only worker health projection for the dashboard. Contains no secrets or
 * account data. Authentication is added with the tenant model in Phase 2.
 */
export async function GET() {
  const result = getServerConfig();
  if (!result.ok) {
    return NextResponse.json({ error: 'configuration_refused' }, { status: 503, headers: { 'cache-control': 'no-store' } });
  }
  const { config } = result;
  const probe = await probeWorker(config.worker.healthHost, config.worker.healthPort);
  const status = classifyWorkerHealth(probe, config.appEnv, new Date());
  return NextResponse.json({ status }, { headers: { 'cache-control': 'no-store' } });
}
