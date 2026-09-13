import { useCallback, useMemo } from 'react';
import { useUser, useClerk } from '@clerk/clerk-react';

export interface AppUser {
  uid: string;
  email: string | null;
}

// Thin wrapper around Clerk so the rest of the app keeps working with a
// Firebase-like `user` shape: `undefined` while loading, `null` logged out,
// an object when signed in.
export function useAuth() {
  const { user, isLoaded, isSignedIn } = useUser();
  const { signOut } = useClerk();

  // IMPORTANT: keep a stable reference so effects keyed on `user` don't
  // re-fire on unrelated re-renders (Clerk's `user` object is stable per
  // auth state; a fresh object here would cause profile reloads + stage
  // bounces).
  const authUser = useMemo<AppUser | null>(() => {
    if (!isSignedIn || !user) return null;
    return {
      uid: user.id,
      email: user.primaryEmailAddress?.emailAddress ?? null,
    };
  }, [isSignedIn, user]);

  const logout = useCallback(async () => {
    await signOut();
  }, [signOut]);

  return {
    user: isLoaded ? authUser : undefined,
    authLoading: !isLoaded,
    logout,
  };
}

export function friendlyAuthError(err: any): string {
  const first = err?.errors?.[0];
  if (first?.longMessage) return first.longMessage;
  return err?.message || 'Something went wrong. Please try again.';
}