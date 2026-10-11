/**
 * Authenticated caller, derived on the server from a verified identity-provider
 * session. Tenant identity always comes from here, never from request input.
 */
export interface Principal {
  readonly userId: string;
  readonly tenantId: string;
  /**
   * Whether this session is known to have completed MFA. The identity provider
   * enforces MFA by policy; until its session exposes proof per sign-in, this
   * stays false (REQUIRES VERIFICATION) and live-capable actions must not rely on it.
   */
  readonly mfaVerified: boolean;
}

export type PrincipalResolver = (request: Request) => Promise<Principal | null>;

/** Used when no identity provider is configured: nobody is authenticated, so every protected route answers 401. */
export const noIdentityProvider: PrincipalResolver = async () => null;
