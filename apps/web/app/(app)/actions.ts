'use server';

import { signOut } from '@workos-inc/authkit-nextjs';

/** Ends the session and returns through the WorkOS sign-out flow. */
export async function signOutAction(): Promise<void> {
  await signOut();
}
