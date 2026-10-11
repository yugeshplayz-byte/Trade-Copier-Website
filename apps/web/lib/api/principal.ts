/**
 * Authenticated caller, derived on the server from a verified identity-provider
 * session. Tenant identity always comes from here, never from request input.
 */
export interface Principal {
  readonly userId: string;
  readonly tenantId: string;
  readonly mfaVerified: boolean;
}

export type PrincipalResolver = (request: Request) => Promise<Principal | null>;

/**
 * No identity provider is connected yet (Phase 2b awaits the provider decision),
 * so nobody is authenticated and every protected route answers 401. This is
 * deliberate: there is no development bypass.
 */
export const resolvePrincipal: PrincipalResolver = async () => null;
