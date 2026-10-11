/** Same idempotency key reused with a different request: maps to HTTP 409. */
export class IdempotencyConflictError extends Error {
  override readonly name = 'IdempotencyConflictError';
}

/** Expected configuration version is stale: maps to HTTP 409 with reload/review. */
export class ConfigVersionConflictError extends Error {
  override readonly name = 'ConfigVersionConflictError';
  readonly currentVersion: number;

  constructor(currentVersion: number) {
    super(`configuration changed; current version is ${currentVersion}`);
    this.currentVersion = currentVersion;
  }
}

/** Resource absent or not visible to this tenant. Deliberately indistinguishable. */
export class NotFoundError extends Error {
  override readonly name = 'NotFoundError';
}

/** The connected role is not the restricted runtime role this code requires. */
export class UnsafeDatabaseRoleError extends Error {
  override readonly name = 'UnsafeDatabaseRoleError';
}

/** The resource is in a state that does not allow this action: maps to HTTP 409. */
export class StateConflictError extends Error {
  override readonly name = 'StateConflictError';
}
