import { redact, redactString } from './redact.ts';

export const LOG_LEVELS = ['debug', 'info', 'warn', 'error'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

export type LogFields = Record<string, unknown>;

export interface Logger {
  debug(msg: string, fields?: LogFields): void;
  info(msg: string, fields?: LogFields): void;
  warn(msg: string, fields?: LogFields): void;
  error(msg: string, fields?: LogFields): void;
  child(fields: LogFields): Logger;
}

export interface LoggerOptions {
  service: string;
  level?: LogLevel;
  /** Line sink; defaults to stdout for debug/info and stderr for warn/error. */
  write?: (level: LogLevel, line: string) => void;
  now?: () => Date;
}

const RANK: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

function defaultWrite(level: LogLevel, line: string): void {
  if (RANK[level] >= RANK.warn) process.stderr.write(line + '\n');
  else process.stdout.write(line + '\n');
}

/**
 * Structured JSON-lines logger. Every message and field passes through
 * redaction before it is serialised, so callers cannot accidentally log a
 * credential by attaching it as a field.
 */
export function createLogger(options: LoggerOptions, bound: LogFields = {}): Logger {
  const minimum = RANK[options.level ?? 'info'];
  const write = options.write ?? defaultWrite;
  const now = options.now ?? (() => new Date());

  const emit = (level: LogLevel, msg: string, fields?: LogFields): void => {
    if (RANK[level] < minimum) return;
    const record = {
      ts: now().toISOString(),
      level,
      service: options.service,
      msg: redactString(msg),
      ...(redact({ ...bound, ...fields }) as LogFields),
    };
    write(level, JSON.stringify(record));
  };

  return {
    debug: (msg, fields) => emit('debug', msg, fields),
    info: (msg, fields) => emit('info', msg, fields),
    warn: (msg, fields) => emit('warn', msg, fields),
    error: (msg, fields) => emit('error', msg, fields),
    child: (fields) => createLogger(options, { ...bound, ...fields }),
  };
}
