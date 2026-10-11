import { handleAuth } from '@workos-inc/authkit-nextjs';
import type { NextRequest } from 'next/server';
import { provisionUser } from '@tradecopier/database';
import { createLogger } from '@tradecopier/observability';
import { getVerifiedPool } from '@/lib/server/api-deps.ts';
import { displayNameOf, isAuthConfigured, workosSubject } from '@/lib/server/auth.ts';

export const dynamic = 'force-dynamic';

/**
 * AuthKit callback: exchanges the authorization code for an encrypted session
 * cookie, then makes sure the user and their personal tenant exist.
 */
export async function GET(request: NextRequest) {
  if (!isAuthConfigured()) return new Response('Sign-in is not configured.', { status: 404 });
  const handler = handleAuth({
    returnPathname: '/overview',
    onSuccess: async ({ user }) => {
      await provisionUser(await getVerifiedPool(), workosSubject(user.id), displayNameOf(user));
    },
    // Missing or invalid codes, expired state, or provisioning failures: a clear
    // page without internals. Nothing is signed in when this runs.
    onError: ({ error }) => {
      logger.warn('sign-in callback failed', { err: error });
      return new Response(SIGN_IN_FAILED_HTML, {
        status: 400,
        headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
      });
    },
  });
  return handler(request);
}

const logger = createLogger({ service: 'web-auth' });

const SIGN_IN_FAILED_HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Sign-in not completed · Tradeplex</title></head>
<body style="font-family:system-ui,sans-serif;max-width:560px;margin:12vh auto;padding:0 16px;line-height:1.55">
<h1 style="font-size:1.5rem">Sign-in was not completed</h1>
<p>The sign-in link was missing, expired or already used. You are not signed in.</p>
<p><a href="/login">Try signing in again</a></p>
</body></html>`;
