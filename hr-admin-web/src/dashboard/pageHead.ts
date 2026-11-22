// A page inside a view (Offboarding › Start an exit, Final settlement · a name) names itself in
// the page head: its own title and section line, and a back arrow beside the title.
import { useEffect, useRef, useSyncExternalStore } from 'react';

export interface PageHeadOverride { title: string; eyebrow?: string; onBack?: () => void; backLabel?: string; /** A pill beside the title (an onboarding template's "Default"). */ tag?: string }

let current: PageHeadOverride | null = null;
const listeners = new Set<() => void>();
const set = (next: PageHeadOverride | null) => { current = next; listeners.forEach((l) => l()); };

/** What the page head shows instead of the view's own title, while a sub-page is open. */
export function usePageHeadOverride(): PageHeadOverride | null {
  return useSyncExternalStore((l) => { listeners.add(l); return () => { listeners.delete(l); }; }, () => current, () => null);
}

/** Sets the page head while the calling page is on screen; cleared when it leaves. */
export function usePageHead(head: PageHeadOverride) {
  const { title, eyebrow, backLabel, tag } = head;
  // The latest onBack, without re-setting the head on every render.
  const back = useRef(head.onBack);
  back.current = head.onBack;
  const hasBack = Boolean(head.onBack);
  useEffect(() => {
    set({ title, eyebrow, backLabel, ...(tag ? { tag } : {}), ...(hasBack ? { onBack: () => back.current?.() } : {}) });
    return () => set(null);
  }, [title, eyebrow, backLabel, tag, hasBack]);
}
