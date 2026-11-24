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
export function usePageHead(head: PageHeadOverride | null) {
  // null: the page sits inside another (a profile's Exit tab) and leaves the head as it is.
  const { title, eyebrow, backLabel, tag } = head ?? { title: '' };
  // The latest onBack, without re-setting the head on every render.
  const back = useRef(head?.onBack);
  back.current = head?.onBack;
  const hasBack = Boolean(head?.onBack);
  const on = head !== null;
  useEffect(() => {
    if (!on) return undefined;
    set({ title, eyebrow, backLabel, ...(tag ? { tag } : {}), ...(hasBack ? { onBack: () => back.current?.() } : {}) });
    return () => set(null);
  }, [on, title, eyebrow, backLabel, tag, hasBack]);
}

// —— Unsaved changes ——
// A page with unsaved edits (the onboarding template editor) asks before the dashboard leaves it by the
// sidebar or any other page change; its own back arrow and links ask for themselves.
let leaveGuard: (() => boolean) | null = null;
/** While set, `mayLeavePage()` asks it; pass null when the page has nothing unsaved (or is gone). */
export function setLeaveGuard(guard: (() => boolean) | null) { leaveGuard = guard; }
/** False when the open page has unsaved changes and the person chose to stay. */
export function mayLeavePage(): boolean { return !leaveGuard || leaveGuard(); }
