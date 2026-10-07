import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { getStoredUser, logout as logoutApi, refreshMe } from '../../services/auth';
import type { AuthUser } from '../../services/auth';

type AuthState = {
  user: AuthUser | null;
  setUser: (u: AuthUser) => void;
  signOut: () => Promise<void>;
};

const Ctx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUserState] = useState<AuthUser | null>(() => getStoredUser());

  const setUser = useCallback((u: AuthUser) => setUserState(u), []);
  // Who may see what can change while someone is signed in; read it fresh on
  // every load so a tab given or taken away applies without signing out.
  useEffect(() => {
    if (!getStoredUser()) return;
    refreshMe().then(setUserState).catch(() => undefined);
  }, []);
  const signOut = useCallback(async () => {
    await logoutApi();
    setUserState(null);
  }, []);

  return <Ctx.Provider value={{ user, setUser, signOut }}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthState {
  const s = useContext(Ctx);
  if (!s) throw new Error('useAuth must be used within AuthProvider');
  return s;
}
