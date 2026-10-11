import { z } from 'zod';
import { APP_ENVS, BROKER_MODES, type AppEnv, type BrokerMode } from '@tradecopier/contracts';

export interface AppConfig {
  readonly appEnv: AppEnv;
  readonly brokerMode: BrokerMode;
  readonly logLevel: 'debug' | 'info' | 'warn' | 'error';
  readonly worker: {
    /** Loopback only; the health endpoint is never exposed on a public interface. */
    readonly healthHost: '127.0.0.1';
    readonly healthPort: number;
  };
  readonly databaseUrl: string | undefined;
}

export type ConfigResult = { ok: true; config: AppConfig } | { ok: false; problems: string[] };

type Env = Readonly<Record<string, string | undefined>>;

const schema = z.object({
  APP_ENV: z.enum(APP_ENVS),
  BROKER_MODE: z.enum(BROKER_MODES).default('SIMULATED'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  WORKER_HEALTH_PORT: z.coerce.number().int().min(1024).max(65535).default(4100),
  DATABASE_URL: z.string().min(1).optional(),
});

/**
 * Environment variable prefixes that carry broker/provider credentials. No
 * provider adapter is approved in this build, so supplying any of them is a
 * configuration error in every environment rather than something to ignore.
 */
const BROKER_CREDENTIAL_PREFIXES = [
  'TRADOVATE_',
  'NINJATRADER_',
  'RITHMIC_',
  'PROJECTX_',
  'TOPSTEPX_',
  'TOPSTEP_',
  'CQG_',
] as const;

/** `BROKER_*` names that are configuration, not credentials. */
const BROKER_CONFIG_NAMES = new Set(['BROKER_MODE']);

/** Live payment-provider keys must never reach a non-production process. */
const LIVE_PAYMENT_KEY = /\b(?:sk|rk|pk)_live_[A-Za-z0-9]+/;

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

/**
 * Validates process configuration and applies startup guards. Problems name the
 * offending variable but never echo its value, so the output is safe to log.
 */
export function loadConfig(env: Env): ConfigResult {
  const problems: string[] = [];

  for (const [name, value] of Object.entries(env)) {
    if (!value) continue;
    const upper = name.toUpperCase();
    const isProviderCredential = BROKER_CREDENTIAL_PREFIXES.some((prefix) => upper.startsWith(prefix));
    const isBrokerCredential = upper.startsWith('BROKER_') && !BROKER_CONFIG_NAMES.has(upper);
    if (isProviderCredential || isBrokerCredential) {
      problems.push(
        `${name}: broker credentials are refused. No provider adapter is approved in this build; remove this variable.`,
      );
    }
  }

  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const name = issue.path.join('.') || '(environment)';
      problems.push(`${name}: ${describeIssue(name, issue)}`);
    }
    return { ok: false, problems };
  }

  const data = parsed.data;

  if (data.APP_ENV === 'PRODUCTION') {
    problems.push(
      'APP_ENV: PRODUCTION is refused by this build. No provider, billing or identity configuration is certified for production.',
    );
  }

  if (data.APP_ENV !== 'PRODUCTION') {
    for (const [name, value] of Object.entries(env)) {
      if (value && LIVE_PAYMENT_KEY.test(value)) {
        problems.push(`${name}: a live payment key is refused outside PRODUCTION.`);
      }
    }
  }

  if (data.DATABASE_URL !== undefined && (data.APP_ENV === 'LOCAL' || data.APP_ENV === 'TEST')) {
    const host = databaseHost(data.DATABASE_URL);
    if (host === null) {
      problems.push('DATABASE_URL: not a valid connection URL.');
    } else if (!LOOPBACK_HOSTS.has(host)) {
      problems.push(`DATABASE_URL: ${data.APP_ENV} may only use a loopback database host.`);
    }
  }

  if (problems.length > 0) return { ok: false, problems };

  return {
    ok: true,
    config: {
      appEnv: data.APP_ENV,
      brokerMode: data.BROKER_MODE,
      logLevel: data.LOG_LEVEL,
      worker: { healthHost: '127.0.0.1', healthPort: data.WORKER_HEALTH_PORT },
      databaseUrl: data.DATABASE_URL,
    },
  };
}

function describeIssue(name: string, issue: z.core.$ZodIssue): string {
  if (name === 'APP_ENV') {
    return `required; must be one of ${APP_ENVS.join(', ')}.`;
  }
  if (name === 'BROKER_MODE') {
    return `must be ${BROKER_MODES.join(' or ')}. Practice and live routing are not available in this build.`;
  }
  // Zod messages for these fields do not include input values.
  return issue.message;
}

function databaseHost(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}
