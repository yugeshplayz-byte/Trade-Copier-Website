import type { Pool } from './pool.ts';
import type { TenantContext } from './tenant.ts';

export interface ProvisionedUser extends TenantContext {
  readonly status: 'ACTIVE' | 'SUSPENDED' | 'DELETED';
}

/**
 * Creates or returns the user for a verified identity-provider subject, plus
 * their personal tenant. The subject must come from a validated identity token,
 * never from request input. Idempotent and safe under concurrent calls.
 */
export async function provisionUser(pool: Pool, authSubject: string, displayName: string): Promise<ProvisionedUser> {
  const { rows } = await pool.query<{ out_user_id: string; out_tenant_id: string; out_status: ProvisionedUser['status'] }>(
    'SELECT out_user_id, out_tenant_id, out_status FROM app.provision_user($1, $2)',
    [authSubject, displayName],
  );
  const row = rows[0];
  if (!row) throw new Error('provisioning returned no row');
  return { userId: row.out_user_id, tenantId: row.out_tenant_id, status: row.out_status };
}
