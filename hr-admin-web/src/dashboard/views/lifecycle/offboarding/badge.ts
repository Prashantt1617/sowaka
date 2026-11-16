// The Offboarding sidebar badge (red): cards that need you plus late ones, from
// GET /admin/lifecycle/offboarding/count. One read shared by the sidebar and the
// header (which shows IT / Admin / Finance staff their team); read again when
// the board changes something.
import { useEffect, useState } from 'react';
import { getOffboardingCount } from '../../../../services/lifecycleOffboarding';
import type { OffboardingCountDTO } from '../../../../services/lifecycleOffboarding';

let current: OffboardingCountDTO | null = null;
let loading = false;
const listeners = new Set<(v: OffboardingCountDTO | null) => void>();

function load() {
  if (loading) return;
  loading = true;
  getOffboardingCount()
    .then((v) => { current = v; for (const l of listeners) l(v); })
    .catch(() => undefined)
    .finally(() => { loading = false; });
}

/** Read the badge again, e.g. after a resignation is accepted or a clearance item ticked. */
export function refreshOffboardingBadge() {
  if (listeners.size) load();
}

export function useOffboardingCount(enabled: boolean): OffboardingCountDTO | null {
  const [value, setValue] = useState<OffboardingCountDTO | null>(enabled ? current : null);
  useEffect(() => {
    if (!enabled) { setValue(null); return; }
    listeners.add(setValue);
    if (current) setValue(current);
    else load();
    return () => { listeners.delete(setValue); };
  }, [enabled]);
  return value;
}

export const TEAM_NAME = { it: 'IT', admin: 'Admin', finance: 'Finance' } as const;
