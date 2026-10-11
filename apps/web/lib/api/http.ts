import { ZodError } from 'zod';
import {
  ConfigVersionConflictError,
  IdempotencyConflictError,
  NotFoundError,
  UnsafeDatabaseRoleError,
} from '@tradecopier/database';
import { createLogger } from '@tradecopier/observability';

const logger = createLogger({ service: 'web-api' });

/** An error with a deliberate HTTP status and a stable machine-readable code. */
export class ApiError extends Error {
  override readonly name = 'ApiError';
  readonly status: number;
  readonly code: string;
  readonly extra: Record<string, unknown>;

  constructor(status: number, code: string, message: string, extra: Record<string, unknown> = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

export function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { 'cache-control': 'no-store' } });
}

function problem(status: number, code: string, message: string, extra: Record<string, unknown> = {}): Response {
  return json({ error: { code, message, ...extra } }, status);
}

/**
 * Runs a route body and maps known failures to HTTP responses. Unknown errors
 * become a generic 500: no stack traces, SQL or input values reach the client.
 */
export async function handle(fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof ApiError) return problem(err.status, err.code, err.message, err.extra);
    if (err instanceof ZodError) {
      // Paths and messages only; never echo submitted values.
      const issues = err.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
      return problem(400, 'validation_failed', 'The request body is invalid.', { issues });
    }
    if (err instanceof IdempotencyConflictError) {
      return problem(409, 'idempotency_conflict', 'This Idempotency-Key was already used for a different request.');
    }
    if (err instanceof ConfigVersionConflictError) {
      return problem(409, 'config_version_conflict', 'The configuration changed. Reload and review before saving.', {
        currentVersion: err.currentVersion,
      });
    }
    if (err instanceof NotFoundError) return problem(404, 'not_found', 'Not found.');
    if (err instanceof UnsafeDatabaseRoleError) {
      logger.error('database role check failed', { err });
      return problem(503, 'database_unavailable', 'The service is temporarily unavailable.');
    }
    logger.error('unhandled API error', { err });
    return problem(500, 'internal_error', 'Something went wrong. No changes were confirmed.');
  }
}
