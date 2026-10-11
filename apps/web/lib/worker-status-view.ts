import type { WorkerStatus } from './worker-health.ts';
import { formatAge, formatTime } from './format.ts';

export type Tone = 'neutral' | 'info' | 'ok' | 'warn' | 'danger';

/** Client-side view states in addition to the server classification. */
export type WorkerStatusView =
  | { state: 'CHECKING' }
  | { state: 'STATUS_UNAVAILABLE'; at: string }
  | WorkerStatus;

export interface WorkerStatusPresentation {
  tone: Tone;
  /** Standalone label, e.g. for the top bar. */
  label: string;
  /** Value when the context already says "worker". */
  short: string;
  detail: string;
}

/** Maps worker status to text plus tone. Colour is never the only signal. */
export function presentWorkerStatus(view: WorkerStatusView): WorkerStatusPresentation {
  switch (view.state) {
    case 'CHECKING':
      return { tone: 'neutral', label: 'Worker: checking…', short: 'Checking…', detail: 'Waiting for the first health check.' };
    case 'STATUS_UNAVAILABLE':
      return {
        tone: 'warn',
        label: 'Worker: unknown',
        short: 'Unknown',
        detail: `The web server did not answer the status request at ${formatTime(view.at)}.`,
      };
    case 'RUNNING':
      return {
        tone: 'ok',
        label: 'Worker running',
        short: 'Running',
        detail: `Heartbeat ${formatAge(view.heartbeatAgeMs)} before check at ${formatTime(view.checkedAt)}.`,
      };
    case 'STALE':
      return {
        tone: 'warn',
        label: 'Worker stale',
        short: 'Stale heartbeat',
        detail: `Last heartbeat ${formatAge(view.heartbeatAgeMs)} before check at ${formatTime(view.checkedAt)}. It may be stalled.`,
      };
    case 'ENVIRONMENT_MISMATCH':
      return {
        tone: 'danger',
        label: 'Worker env mismatch',
        short: 'Env mismatch',
        detail: `Worker reports ${view.health.appEnv}; this app is ${view.expected}. Its status is not trusted.`,
      };
    case 'INVALID_RESPONSE':
      return {
        tone: 'danger',
        label: 'Worker invalid',
        short: 'Invalid response',
        detail: `${view.detail} Checked at ${formatTime(view.checkedAt)}.`,
      };
    case 'UNREACHABLE':
      return {
        tone: 'danger',
        label: 'Worker not running',
        short: 'Not running',
        detail: `${view.detail} Start it with npm run dev:worker. Checked at ${formatTime(view.checkedAt)}.`,
      };
  }
}
