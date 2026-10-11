import { workerHealthSchema, type AppEnv, type WorkerHealth } from '@tradecopier/contracts';

/** Proposed heartbeat timeout (REALTIME.md): older heartbeats are stale, not healthy. */
export const HEARTBEAT_TIMEOUT_MS = 15_000;

export type WorkerStatus =
  | { state: 'RUNNING'; checkedAt: string; heartbeatAgeMs: number; health: WorkerHealth }
  | { state: 'STALE'; checkedAt: string; heartbeatAgeMs: number; health: WorkerHealth }
  | { state: 'ENVIRONMENT_MISMATCH'; checkedAt: string; health: WorkerHealth; expected: AppEnv }
  | { state: 'INVALID_RESPONSE'; checkedAt: string; detail: string }
  | { state: 'UNREACHABLE'; checkedAt: string; detail: string };

export type WorkerProbe =
  | { kind: 'response'; status: number; body: unknown }
  | { kind: 'error'; detail: string };

/**
 * Classifies a worker health probe. A reachable worker is only RUNNING when its
 * document validates, belongs to the same environment and its heartbeat is fresh.
 */
export function classifyWorkerHealth(probe: WorkerProbe, expectedEnv: AppEnv, checkedAt: Date): WorkerStatus {
  const at = checkedAt.toISOString();
  if (probe.kind === 'error') {
    return { state: 'UNREACHABLE', checkedAt: at, detail: probe.detail };
  }
  if (probe.status !== 200) {
    return { state: 'INVALID_RESPONSE', checkedAt: at, detail: `HTTP ${probe.status}` };
  }
  const parsed = workerHealthSchema.safeParse(probe.body);
  if (!parsed.success) {
    return { state: 'INVALID_RESPONSE', checkedAt: at, detail: 'Health document failed validation.' };
  }
  const health = parsed.data;
  if (health.appEnv !== expectedEnv) {
    return { state: 'ENVIRONMENT_MISMATCH', checkedAt: at, health, expected: expectedEnv };
  }
  const heartbeatAgeMs = Math.max(0, checkedAt.getTime() - Date.parse(health.lastHeartbeatAt));
  const state = heartbeatAgeMs > HEARTBEAT_TIMEOUT_MS ? 'STALE' : 'RUNNING';
  return { state, checkedAt: at, heartbeatAgeMs, health };
}

/** Probes the loopback worker health endpoint with a short timeout. */
export async function probeWorker(host: string, port: number, timeoutMs = 1_500): Promise<WorkerProbe> {
  try {
    const res = await fetch(`http://${host}:${port}/healthz`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(timeoutMs),
    });
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      body = null;
    }
    return { kind: 'response', status: res.status, body };
  } catch (err) {
    const timedOut = err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError');
    return { kind: 'error', detail: timedOut ? 'Health check timed out.' : 'No worker is listening.' };
  }
}
