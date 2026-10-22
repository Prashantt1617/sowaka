// Loading state for a view's own requests, to pair with the skeletons in ui.tsx.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { LoadState } from './ui';

/** The worst of several states: any error wins, then anything still loading. */
export function combineLoad(...states: LoadState[]): LoadState {
  if (states.includes('error')) return 'error';
  if (states.includes('loading')) return 'loading';
  return 'ready';
}

type Slot<T> = { key: string; state: LoadState; data: T | undefined };

/**
 * One request a view needs before it can draw, keyed by `deps`.
 *
 * When the key changes (another employee, another month) the old data is
 * dropped at once, so the page shows the skeleton for the new data rather than
 * the old one, and a late answer for an old key is ignored. `reload()`
 * refetches in place and keeps what is on screen (after a save); `retry()`
 * starts over after a failure. A failed reload keeps the data and rethrows, so
 * the caller can flash it as before.
 */
export function useLoad<T>(fetcher: () => Promise<T>, deps: readonly unknown[]) {
  const key = JSON.stringify(deps);
  const [slot, setSlot] = useState<Slot<T>>({ key, state: 'loading', data: undefined });
  const fetchRef = useRef(fetcher);
  fetchRef.current = fetcher;
  const gen = useRef(0);
  const keyRef = useRef(key);
  keyRef.current = key;

  const run = useCallback(async (quiet: boolean) => {
    const my = ++gen.current;
    const k = keyRef.current;
    if (!quiet) setSlot({ key: k, state: 'loading', data: undefined });
    try {
      const data = await fetchRef.current();
      if (my === gen.current) setSlot({ key: k, state: 'ready', data });
    } catch (e) {
      if (my !== gen.current) return;
      if (quiet) throw e;
      setSlot({ key: k, state: 'error', data: undefined });
    }
  }, []);

  useEffect(() => {
    void run(false);
  }, [key, run]);

  const current = slot.key === key ? slot : { key, state: 'loading' as LoadState, data: undefined };
  const setData = useCallback((next: T | ((prev: T | undefined) => T)) => {
    setSlot((s) => ({ ...s, state: 'ready', data: typeof next === 'function' ? (next as (p: T | undefined) => T)(s.data) : next }));
  }, []);
  return {
    data: current.data,
    state: current.state,
    reload: () => run(true),
    retry: () => void run(false),
    setData,
  };
}
