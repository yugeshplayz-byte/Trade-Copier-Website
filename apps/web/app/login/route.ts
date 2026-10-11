import { getSignInUrl } from '@workos-inc/authkit-nextjs';
import { redirect } from 'next/navigation';
import { isAuthConfigured } from '@/lib/server/auth.ts';

export const dynamic = 'force-dynamic';

/** Starts sign-in (also the dashboard's "Initiate login URI"). */
export async function GET() {
  if (!isAuthConfigured()) return new Response('Sign-in is not configured.', { status: 404 });
  redirect(await getSignInUrl());
}
