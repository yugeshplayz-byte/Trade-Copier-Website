# ADR 0006: Sign-in with WorkOS AuthKit

Status: accepted (Phase 2b) · Date: 2026-10-11 · Verified end to end against the owner's WorkOS staging environment on 2026-10-11

## Context

SECURITY.md requires a maintained, managed OIDC identity solution with MFA; homegrown passwords or MFA are not allowed. The owner chose **WorkOS AuthKit** on 2026-10-11. Reasons: third-party summaries report MFA included free up to 1M monthly users, and free staging environments. Pricing is classified REQUIRES VERIFICATION against workos.com.

The implementation follows the official AuthKit Next.js guide (workos.com/docs/authkit/nextjs, read 2026-10-11) and the installed SDK's type definitions.

## Decision

- **Packages:** `@workos-inc/authkit-nextjs` 4.3.2 and `@workos-inc/node` 10.14.0, both pinned; newer releases were under two weeks old.
- **Configuration:** `WORKOS_API_KEY`, `WORKOS_CLIENT_ID`, `WORKOS_COOKIE_PASSWORD` (32+ characters, generated locally) and `NEXT_PUBLIC_WORKOS_REDIRECT_URI`. The startup guard:
  - treats sign-in as configured only when all four are valid;
  - accepts only staging keys (`sk_test_`);
  - requires the redirect URI to be `/callback` on an allowed app origin;
  - requires sign-in in STAGING.

  Problems name variables, never values. Secrets live only in the git-ignored `.env`. The dev launcher withholds `WORKOS_*` and `NEXT_PUBLIC_*` from the worker process.
- **Session:** `apps/web/proxy.ts` (the Next.js 16 proxy) calls `authkit()` to validate and refresh the encrypted, HttpOnly session cookie on every request, using `handleAuthkitProxy` to merge headers. Signed-out visitors to app pages are redirected to hosted sign-in. API routes are not redirected: they answer 401. When sign-in is not configured, the proxy passes requests through and every protected API route answers 401.
- **Callback:** `/callback` runs `handleAuth` and then provisions the Tradeplex user and personal tenant (subject `workos|<WorkOS user id>`) through the database's `provision_user`, before returning to `/overview`.
- **Principal:** `workosPrincipalResolver` reads the session with `withAuth()` and maps it through the read-only `app.resolve_user` (migration 0002), provisioning as a fallback. Non-ACTIVE accounts get 403. The tenant comes only from this mapping.
- **Sign-in and sign-out:** `/login` redirects to `getSignInUrl()` and is also the dashboard's Initiate-login URI. Sign-out is a server action calling `signOut()`.
- **Worker-health route** requires a session once sign-in is configured.

## Verification (2026-10-11)

- Signed out: pages redirect to the hosted sign-in, and the API and worker health answer 401. A malformed or expired callback shows a 400 page instead of a 500.
- After the owner signed up through the hosted page, the callback provisioned exactly one active user with one personal tenant. The API answered 200 for that session. The session cookie is not readable by page JavaScript.
- A browser write with an Idempotency-Key returned 201, then 200 replayed for the identical request: one profile, one operation.
- The account menu (initials button with name, email, Settings and Sign out) works by keyboard; Escape closes it and returns focus.

## Open items

- **MFA proof per session:** REQUIRES VERIFICATION. The SDK session exposes `authenticationMethod`, but not proof that MFA was completed. MFA is enforced by the WorkOS dashboard policy. `Principal.mfaVerified` stays `false`, so live-capable features must not rely on it until verified.
- **Recent authentication** for sensitive changes: `checkRecentAuth()` exists in the SDK and will be applied when such actions exist.
- Session revocation behaviour and SSE authorization come in later slices.
