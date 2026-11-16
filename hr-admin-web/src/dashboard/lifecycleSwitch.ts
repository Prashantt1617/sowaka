// Whether the company has the employee lifecycle switched on
// (companies.features.lifecycle), read once per sign-in from
// GET /admin/lifecycle/settings. The sidebar's Employee lifecycle group and
// Setup's card show only once it says yes; until it has answered, nobody is
// sent away from a lifecycle page they already have open.
import { useEffect, useSyncExternalStore } from 'react';
import { getLifecycleSettings, isNotAvailable } from '../services/lifecycle';
import { getToken } from '../services/http';

let on: boolean | null = null;
let forToken: string | null = null;
let pending: Promise<void> | null = null;
const subs = new Set<() => void>();
const notify = () => subs.forEach((f) => f());

/** true / false once known; null while it is being asked (or could not be). */
export function lifecycleOn(): boolean | null {
  return forToken === getToken() ? on : null;
}

export function loadLifecycleSwitch(): Promise<void> {
  const token = getToken();
  if (forToken === token && (on !== null || pending)) return pending ?? Promise.resolve();
  forToken = token;
  on = null;
  pending = getLifecycleSettings()
    .then((r) => { on = r.enabled === true; })
    .catch((e: unknown) => {
      // Off for the company (404) or not given to this person (403): no group.
      if (isNotAvailable(e) || (e as { status?: number })?.status === 404 || (e as { status?: number })?.status === 403) on = false;
    })
    .finally(() => { pending = null; notify(); });
  return pending;
}

const subscribe = (f: () => void) => {
  subs.add(f);
  return () => { subs.delete(f); };
};

/** The switch, kept current: asks the server the first time it is used for a signed-in person. */
export function useLifecycleOn(ask: boolean): boolean | null {
  const value = useSyncExternalStore(subscribe, lifecycleOn);
  useEffect(() => { if (ask) void loadLifecycleSwitch(); }, [ask]);
  return value;
}
