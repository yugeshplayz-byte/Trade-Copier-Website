import { authkit, handleAuthkitProxy } from '@workos-inc/authkit-nextjs';
import { NextResponse, type NextRequest } from 'next/server';
import { loadConfig } from '@tradecopier/config';

/** Routes reachable without a session. API routes answer 401 themselves instead of redirecting. */
const PUBLIC_PATHS = new Set(['/login', '/callback']);

/**
 * Session handling (Next.js 16 proxy). When sign-in is configured, AuthKit
 * validates and refreshes the encrypted session cookie on every request, and
 * signed-out visitors to app pages are sent to the hosted sign-in. Without
 * sign-in configured, requests pass through and the API reports 401.
 */
export default async function proxy(request: NextRequest) {
  const result = loadConfig(process.env);
  if (!result.ok || !result.config.auth.configured) return NextResponse.next();

  const { session, headers, authorizationUrl } = await authkit(request);
  const { pathname } = request.nextUrl;
  const needsSession = !pathname.startsWith('/api/') && !PUBLIC_PATHS.has(pathname);
  if (needsSession && !session.user && authorizationUrl) {
    return handleAuthkitProxy(request, headers, { redirect: authorizationUrl });
  }
  return handleAuthkitProxy(request, headers);
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|icon.svg|favicon.ico).*)'],
};
