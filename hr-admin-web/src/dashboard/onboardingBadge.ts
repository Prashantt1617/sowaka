// The Onboarding sidebar badge: joiners waiting on HR now (Needs you) or late,
// each counted once (GET /admin/lifecycle/counts). Read on load, every five
// minutes, and whenever the board or a joiner's panel changes something.
import { useEffect, useState } from 'react';
import { getLifecycleCounts } from '../services/lifecycle';

const badgeRefreshers = new Set<() => void>();
/** Read the Onboarding badge again (after HR did something on the board or a joiner's panel). */
export function refreshOnboardingBadge() {
  for (const r of badgeRefreshers) r();
}

/**
 * Joiners waiting on HR now (Needs you) or late, each counted once: the red
 * count on the sidebar's Onboarding entry. Read on load, every five minutes,
 * and whenever the board changes something.
 */
export function useOnboardingBadge(enabled: boolean): number | null {
  const [count, setCount] = useState<number | null>(null);
  useEffect(() => {
    if (!enabled) { setCount(null); return; }
    let live = true;
    const load = () => { getLifecycleCounts().then((c) => { if (live) setCount(c.onboarding.badge); }).catch(() => undefined); };
    load();
    badgeRefreshers.add(load);
    const timer = setInterval(load, 5 * 60_000);
    return () => { live = false; badgeRefreshers.delete(load); clearInterval(timer); };
  }, [enabled]);
  return count;
}
