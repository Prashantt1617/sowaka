// Authentication: passwordless email OTP → bearer session token.
import { api, setToken } from './http';

const USER_KEY = 'sowaka.user';

export type AuthUser = {
  id: string;
  email: string;
  name: string;
  role: 'manager' | 'employee';
  company: string;
  /** The company's id, e.g. 'convrse' — what per-company styling keys off. */
  org?: string;
  dashboardAccess?: boolean;
  isLeadership?: boolean;
};

export function getStoredUser(): AuthUser | null {
  const raw = localStorage.getItem(USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as AuthUser;
  } catch {
    return null;
  }
}

function storeUser(user: AuthUser | null) {
  if (user) localStorage.setItem(USER_KEY, JSON.stringify(user));
  else localStorage.removeItem(USER_KEY);
}

export async function requestOtp(email: string): Promise<void> {
  await api('/auth/request-otp', { method: 'POST', body: { email } });
}

export async function verifyOtp(email: string, otp: string): Promise<AuthUser> {
  const res = await api<{ success: boolean; token: string; user: AuthUser }>('/auth/verify-otp', {
    method: 'POST',
    body: { email, otp },
  });
  setToken(res.token);
  storeUser(res.user);
  return res.user;
}

export async function logout(): Promise<void> {
  try {
    await api('/auth/logout', { method: 'POST' });
  } catch {
    // best-effort — clear local session regardless
  }
  setToken(null);
  storeUser(null);
}

export function clearSession() {
  setToken(null);
  storeUser(null);
}
