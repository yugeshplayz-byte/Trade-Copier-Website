import 'server-only';
import { withAuth } from '@workos-inc/authkit-nextjs';
import { provisionUser, resolveUser, type Pool } from '@tradecopier/database';
import { ApiError } from '@/lib/api/http.ts';
import type { PrincipalResolver } from '@/lib/api/principal.ts';
import { getServerConfig } from '@/lib/server-config.ts';

export function isAuthConfigured(): boolean {
  const result = getServerConfig();
  return result.ok && result.config.auth.configured;
}

/** Stable internal subject for a WorkOS user ID. */
export function workosSubject(workosUserId: string): string {
  return `workos|${workosUserId}`;
}

export function displayNameOf(user: { firstName?: string | null; lastName?: string | null }): string {
  return [user.firstName, user.lastName].filter(Boolean).join(' ').trim().slice(0, 200);
}

/**
 * Resolves the request's principal from the encrypted AuthKit session cookie
 * (refreshed by proxy.ts). The WorkOS user maps to a provisioned Tradeplex user
 * and personal tenant; inactive accounts are refused.
 */
export function workosPrincipalResolver(getPool: () => Promise<Pool>): PrincipalResolver {
  return async () => {
    const { user } = await withAuth();
    if (!user) return null;
    const pool = await getPool();
    const subject = workosSubject(user.id);
    const found = (await resolveUser(pool, subject)) ?? (await provisionUser(pool, subject, displayNameOf(user)));
    if (found.status !== 'ACTIVE') throw new ApiError(403, 'account_inactive', 'This account is not active.');
    return { userId: found.userId, tenantId: found.tenantId, mfaVerified: false };
  };
}
