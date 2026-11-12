// The FBP requests sidebar badge: bills waiting for HR, every FY. Read on
// load and again whenever the FBP requests page decides a bill.
import { useCallback, useEffect, useState } from 'react';
import { fbpPendingCount } from '../services/payroll';

const refreshers = new Set<() => void>();
/** Read the badge again, e.g. after a bill was approved or rejected. */
export function refreshFbpBadge() {
  for (const r of refreshers) r();
}

export function useFbpBadge(enabled: boolean): number | null {
  const [count, setCount] = useState<number | null>(null);
  const load = useCallback(() => {
    if (!enabled) return;
    fbpPendingCount().then(setCount).catch(() => undefined);
  }, [enabled]);
  useEffect(() => {
    if (!enabled) { setCount(null); return; }
    load();
    refreshers.add(load);
    return () => { refreshers.delete(load); };
  }, [enabled, load]);
  return count;
}
