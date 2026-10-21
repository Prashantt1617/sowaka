// End-to-end encrypted salaries in the dashboard: one SealedPayroll for the
// browser tab, holding the company's payroll key in memory once unlocked
// (never in storage), plus the company's encryption status for the screens.
import { api } from './http';
import { SealedPayroll, type CryptoStatus, type PayrollApi } from './payroll-core';

const transport: PayrollApi = {
  get: <T,>(path: string) => api<T>(path),
  post: <T,>(path: string, body?: unknown) => api<T>(path, { method: 'POST', body: body ?? {} }),
  put: <T,>(path: string, body?: unknown) => api<T>(path, { method: 'PUT', body: body ?? {} }),
};

export const sealedPayroll = new SealedPayroll(transport);

let status: CryptoStatus | null = null;
let loading: Promise<CryptoStatus | null> | null = null;
const listeners = new Set<() => void>();

const notify = () => listeners.forEach((l) => l());

/** Calls `fn` whenever the status or the lock changes. Returns the unsubscribe. */
export function onPayrollLockChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** The company's encryption status; null when this person can't see payroll keys. */
export function payrollCryptoStatus(force = false): Promise<CryptoStatus | null> {
  if (status && !force) return Promise.resolve(status);
  if (loading && !force) return loading;
  loading = sealedPayroll.status()
    .then((s) => { status = s; notify(); return s; })
    .catch(() => null)
    .finally(() => { loading = null; });
  return loading;
}

export const cachedPayrollStatus = () => status;

/** True when this company's salaries are encrypted (amounts go through the sealed path). */
export async function isPayrollEncrypted(): Promise<boolean> {
  return (await payrollCryptoStatus())?.mode === 'encrypted';
}

export function isPayrollUnlocked(): boolean {
  return sealedPayroll.unlocked;
}

/** After a change made through `sealedPayroll` (setup, unlock, lock, grant…). */
export async function payrollCryptoChanged(): Promise<CryptoStatus | null> {
  const s = await payrollCryptoStatus(true);
  notify();
  return s;
}

export function lockPayroll(): void {
  sealedPayroll.lock();
  notify();
}

/** Thrown by a payroll call that needs the key while the company is encrypted and locked. */
export class PayrollLocked extends Error {
  constructor() {
    super('Unlock payroll to see salaries');
    this.name = 'PayrollLocked';
  }
}

/** The sealed client, ready to use; throws PayrollLocked when it isn't unlocked. */
export function unlockedSealed(): SealedPayroll {
  if (!sealedPayroll.unlocked) throw new PayrollLocked();
  return sealedPayroll;
}
