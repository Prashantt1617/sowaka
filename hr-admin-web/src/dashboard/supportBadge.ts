// The Support desk's sidebar badge, and a way for the desk to ask for it to be
// read again (opening a ticket marks it read, which sends no live event).
import { useCallback, useEffect, useRef, useState } from 'react';
import { useSupportLive } from './live';
import { listSupportTickets } from '../services/support';
import type { SupportRole } from '../services/support';

// —— Sidebar badge ——————————————————————————————————————————————————————————
// New tickets plus unread for a head; their own unread for staff. One call:
// the Mine list carries every count.

const badgeRefreshers = new Set<() => void>();
/** Read the sidebar badge again, e.g. after opening a ticket marked it read. */
export function refreshSupportBadge() {
  for (const r of badgeRefreshers) r();
}

export function useSupportBadge(role: SupportRole | null | undefined): number {
  const [count, setCount] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const load = useCallback(() => {
    if (!role) return;
    listSupportTickets('mine')
      .then((r) => {
        const unread = r.tickets.reduce((n, t) => n + (t.status === 'resolved' ? 0 : t.unread || 0), 0);
        setCount((role === 'head' ? r.counts.new : 0) + unread);
      })
      .catch(() => undefined);
  }, [role]);
  const soon = useCallback(() => {
    clearTimeout(timer.current);
    timer.current = setTimeout(load, 700);
  }, [load]);
  useEffect(() => {
    if (!role) { setCount(0); return; }
    load();
    badgeRefreshers.add(soon);
    return () => { badgeRefreshers.delete(soon); clearTimeout(timer.current); };
  }, [role, load, soon]);
  useSupportLive(Boolean(role), soon);
  return count;
}
