// Requests as they happen: the server says when a leave, overtime, correction
// or claim anywhere in the company was raised or decided, and the dashboard
// reads its request lists again. Without this the lists only changed when HR
// reloaded the page.
import { useEffect, useRef } from 'react';
import { io } from 'socket.io-client';
import type { Socket } from 'socket.io-client';
import { BASE_URL, getToken } from '../services/http';

/**
 * Calls `onChange` when the company's requests change, when the connection
 * comes back after a drop, and when HR returns to the tab — the last two in
 * case a change was missed meanwhile. Bursts are coalesced into one call.
 */
export function useRequestsLive(enabled: boolean, onChange: () => void) {
  const latest = useRef(onChange);
  latest.current = onChange;

  useEffect(() => {
    const token = getToken();
    if (!enabled || !token) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const soon = () => {
      clearTimeout(timer);
      timer = setTimeout(() => latest.current(), 600);
    };
    const socket = io(BASE_URL, {
      path: '/connect/socket',
      transports: ['websocket', 'polling'],
      auth: { token },
    });
    let connectedOnce = false;
    socket.on('connect', () => {
      if (connectedOnce) soon();
      connectedOnce = true;
    });
    socket.on('requests:changed', soon);
    const onVisible = () => { if (document.visibilityState === 'visible') soon(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
      socket.close();
    };
  }, [enabled]);
}

// —— Support desk ————————————————————————————————————————————————————————
// The server says `support:changed` with a ticket id and what happened, never
// the ticket itself; each screen reads it again with its own permissions. A
// Support head hears every ticket of the company, staff only their own.

export type SupportChangeKind = 'created' | 'message' | 'assigned' | 'sent_back' | 'resolved';
export type SupportChange = { ticketId: string; kind: SupportChangeKind };
/** `null`: something may have been missed (the connection came back, or HR returned to the tab). */
type SupportListener = (change: SupportChange | null) => void;

// One socket for every support listener (the sidebar badge and the desk both
// listen), opened with the first and closed with the last.
const supportListeners = new Set<SupportListener>();
let supportSocket: Socket | null = null;
let supportCleanup: (() => void) | null = null;

function emitSupport(change: SupportChange | null) {
  for (const l of supportListeners) l(change);
}

function openSupportSocket(token: string) {
  const socket = io(BASE_URL, { path: '/connect/socket', transports: ['websocket', 'polling'], auth: { token } });
  let connectedOnce = false;
  socket.on('connect', () => {
    if (connectedOnce) emitSupport(null);
    connectedOnce = true;
  });
  socket.on('support:changed', (payload: Partial<SupportChange> | undefined) => {
    if (payload && typeof payload.ticketId === 'string') emitSupport({ ticketId: payload.ticketId, kind: payload.kind as SupportChangeKind });
    else emitSupport(null);
  });
  const onVisible = () => { if (document.visibilityState === 'visible') emitSupport(null); };
  document.addEventListener('visibilitychange', onVisible);
  supportSocket = socket;
  supportCleanup = () => {
    document.removeEventListener('visibilitychange', onVisible);
    socket.close();
  };
}

/**
 * Calls `onChange` when a support ticket this person may see changes, and with
 * `null` when a change may have been missed. Calls are not coalesced: a
 * listener that reloads should debounce.
 */
export function useSupportLive(enabled: boolean, onChange: SupportListener) {
  const latest = useRef(onChange);
  latest.current = onChange;

  useEffect(() => {
    const token = getToken();
    if (!enabled || !token) return;
    const listener: SupportListener = (c) => latest.current(c);
    supportListeners.add(listener);
    if (!supportSocket) openSupportSocket(token);
    return () => {
      supportListeners.delete(listener);
      if (supportListeners.size === 0) {
        supportCleanup?.();
        supportCleanup = null;
        supportSocket = null;
      }
    };
  }, [enabled]);
}
