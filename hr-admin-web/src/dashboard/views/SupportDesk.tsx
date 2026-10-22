// Support › Tickets — concerns employees raise from the app, and the chat
// with them. Two desks on one tab: a Support head sees every ticket and decides
// who works it (Assign to…, Keep it); support staff see only the tickets
// assigned to them and can reply, resolve or send one back to the head.
// Nobody gets the tab without a Support role (People › Accesses). A Support
// head or a dashboard admin also edits the company's ticket types here.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { useStore } from '../store';
import { useAuth } from '../auth/AuthContext';
import { useSupportLive } from '../live';
import { refreshSupportBadge } from '../supportBadge';
import { ApiError } from '../../services/http';
import {
  SUPPORT_MAX_FILE_BYTES,
  SUPPORT_MAX_FILES,
  assignSupportTicket,
  getSupportMe,
  getSupportTicket,
  listSupportAssignees,
  listSupportTickets,
  listSupportTopics,
  resolveSupportTicket,
  saveSupportTopics,
  sendBackSupportTicket,
  sendSupportMessage,
} from '../../services/support';
import type {
  SupportAssignee,
  SupportAttachment,
  SupportCounts,
  SupportEvent,
  SupportMessage,
  SupportRole,
  SupportStatus,
  SupportTicket,
  SupportTopic,
  SupportView,
} from '../../services/support';
import type { Pill as PillTone } from '../theme';
import { Card, PageActions, Pill, SearchInput, SelectBox, SkeletonLines, SkeletonRows } from '../ui';
import { PersonAvatar } from '../PersonAvatar';
import { btn, btnClass, eyebrow, iconBtn, inp, SEG, segBtn } from '../ds';
import { IconChevronDown, IconClose, IconFile } from '../icons';
import { ConfirmResolveDialog, SendBackDialog, TicketTypesDialog } from './SupportDialogs';

// —— Shared bits ————————————————————————————————————————————————————————————

const STATUS: Record<SupportStatus, { label: string; tone: PillTone }> = {
  // Solid pills, as the prototype's Pending / In progress / Resolved.
  open: { label: 'New', tone: { bg: 'var(--p-yellow)', fg: 'var(--p-yellow-ink)' } },
  assigned: { label: 'In progress', tone: { bg: 'var(--p-blue)', fg: 'var(--on-accent)' } },
  resolved: { label: 'Resolved', tone: { bg: 'var(--p-green)', fg: 'var(--on-accent)' } },
};

const errText = (e: unknown, fallback: string) => (e instanceof ApiError ? e.message : fallback);

function relTime(iso: string): string {
  const d = new Date(iso);
  const mins = Math.round((Date.now() - d.getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} h ago`;
  if (hours < 48) return 'Yesterday';
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}
const clock = (iso: string) => new Date(iso).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
function dayLabel(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const yest = new Date();
  yest.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === yest.toDateString()) return 'Yesterday';
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });
}
const fullDate = (iso: string) => new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });
function fileSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

const IconClip = ({ size = 18, stroke = 'var(--ink-3)' }: { size?: number; stroke?: string }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 11.5l-8.6 8.6a5 5 0 0 1-7.1-7.1l8.6-8.6a3.4 3.4 0 0 1 4.8 4.8l-8.6 8.6a1.7 1.7 0 0 1-2.4-2.4l7.9-7.9" />
  </svg>
);
const IconHistory = ({ size = 16, stroke = 'currentColor' }: { size?: number; stroke?: string }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
    <path d="M3 3v5h5M12 7v5l3 2" />
  </svg>
);

/** The requester's face: their photo, or their initials. */
function RequesterAvatar({ ticket, size = 38 }: { ticket: SupportTicket; size?: number }) {
  return <PersonAvatar name={ticket.requester.name || '?'} userId={ticket.requester.userId} src={ticket.requester.photoUrl} size={size} font={Math.round(size * 0.37)} />;
}

// —— The tab ————————————————————————————————————————————————————————————————

export function SupportDesk() {
  const { user } = useAuth();
  const [role, setRole] = useState<SupportRole | null>(user?.supportRole ?? null);
  const [canEditTopics, setCanEditTopics] = useState(user?.supportRole === 'head' || user?.dashboardAdmin === true);
  const [checked, setChecked] = useState(false);
  // The session can be a little stale; the server has the last word.
  useEffect(() => {
    let live = true;
    getSupportMe()
      .then((r) => { if (live) { setRole(r.role); setCanEditTopics(r.canEditTopics === true); } })
      .catch(() => undefined)
      .finally(() => { if (live) setChecked(true); });
    return () => { live = false; };
  }, []);
  if (!role && !checked) return <Card><SkeletonRows rows={5} cols={2} rowHeight={72} /></Card>;
  if (!role) {
    return (
      <Card>
        <div style={{ padding: 48, textAlign: 'center', color: 'var(--ink-3)', fontSize: 14, fontWeight: 400 }}>
          {checked ? 'You don’t have a Support role. A dashboard admin can give you one in People › Accesses.' : 'Loading…'}
          {/* A dashboard admin without a role still owns the ticket types. */}
          {checked && canEditTopics && <div style={{ marginTop: 16 }}><TicketTypesButton /></div>}
        </div>
      </Card>
    );
  }
  return <Desk key={role} role={role} meId={user?.id ?? ''} canEditTopics={canEditTopics} />;
}

/**
 * The company's ticket types: what the app offers when an employee raises a
 * ticket, read for the topic filter. `null` until loaded (or if it failed).
 */
function useSupportTopics() {
  const [topics, setTopics] = useState<SupportTopic[] | null>(null);
  useEffect(() => {
    let live = true;
    listSupportTopics().then((r) => { if (live) setTopics(r.topics); }).catch(() => undefined);
    return () => { live = false; };
  }, []);
  return [topics, setTopics] as const;
}

/** Opens the ticket types editor; `onSaved` hears the list as saved. */
function TicketTypesButton({ topics: known, onSaved }: { topics?: SupportTopic[] | null; onSaved?: (topics: SupportTopic[]) => void }) {
  const { flash } = useStore();
  const [open, setOpen] = useState<SupportTopic[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // Read fresh on opening: someone else may have changed them since.
  const start = async () => {
    setLoading(true);
    try {
      setError('');
      setOpen((await listSupportTopics()).topics);
    } catch (e) {
      if (known) setOpen(known);
      else flash(errText(e, 'Could not load the ticket types'), 'error');
    } finally {
      setLoading(false);
    }
  };
  const save = async (topics: { key?: string; label: string }[]) => {
    setBusy(true);
    setError('');
    try {
      const r = await saveSupportTopics(topics);
      setOpen(null);
      onSaved?.(r.topics);
      flash('Ticket types saved. The app offers them from now on.');
    } catch (e) {
      setError(errText(e, 'Could not save the ticket types. Try again.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button type="button" disabled={loading} onClick={() => void start()} style={ghostBtn}>Ticket types</button>
      {open && <TicketTypesDialog topics={open} busy={busy} error={error} onClose={() => setOpen(null)} onSave={(t) => void save(t)} />}
    </>
  );
}

type Detail = { ticket: SupportTicket; messages: SupportMessage[]; events: SupportEvent[] };
type StatusFilter = 'any' | SupportStatus;
const HEAD_VIEWS: { key: SupportView; label: string }[] = [
  { key: 'new', label: 'New' },
  { key: 'assigned', label: 'Assigned' },
  { key: 'mine', label: 'Mine' },
  { key: 'all', label: 'All' },
];
const EMPTY_TEXT: Record<SupportView, string> = {
  new: 'Nothing waiting. New tickets land here first.',
  assigned: 'No tickets are with support staff right now.',
  mine: 'You have no tickets on your desk.',
  all: 'No tickets yet. They appear when employees raise one from the app.',
};

function Desk({ role, meId, canEditTopics }: { role: SupportRole; meId: string; canEditTopics: boolean }) {
  const { flash } = useStore();
  const [types, setTypes] = useSupportTopics();
  const isHead = role === 'head';
  const [view, setView] = useState<SupportView>(isHead ? 'new' : 'mine');
  const [tickets, setTickets] = useState<SupportTicket[] | null>(null);
  const [counts, setCounts] = useState<SupportCounts | null>(null);
  const [listError, setListError] = useState('');
  const [q, setQ] = useState('');
  const [topic, setTopic] = useState('any');
  const [status, setStatus] = useState<StatusFilter>('any');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [detailState, setDetailState] = useState<'idle' | 'loading' | 'error'>('idle');

  const viewRef = useRef(view);
  viewRef.current = view;
  const selectedRef = useRef(selectedId);
  selectedRef.current = selectedId;

  // Reloads overlap (a live change during a view switch) and can come back out
  // of order: a reply lands only for the view still on screen, and only if
  // nothing asked after it has landed already.
  const listSeq = useRef({ asked: 0, landed: 0 });
  const loadList = useCallback(async (quiet = false) => {
    const asked = viewRef.current;
    const seq = ++listSeq.current.asked;
    const stale = () => viewRef.current !== asked || seq < listSeq.current.landed;
    if (!quiet) setListError('');
    try {
      const r = await listSupportTickets(asked);
      if (stale()) return;
      listSeq.current.landed = seq;
      setTickets(r.tickets);
      setCounts(r.counts);
      setListError('');
    } catch (e) {
      if (stale()) return;
      if (!quiet) { setTickets([]); setListError(errText(e, 'Could not load tickets')); }
    }
  }, []);

  /** `live`: re-read because the server said it changed, so a refusal means it left this desk. */
  const loadDetail = useCallback(async (id: string, live = false) => {
    if (!live) setDetailState('loading');
    try {
      const r = await getSupportTicket(id);
      if (selectedRef.current !== id) return;
      setDetail(r);
      setDetailState('idle');
      // Opening it marked the employee's messages read for the desk.
      setTickets((ts) => ts?.map((t) => (t.id === id ? { ...t, unread: 0 } : t)) ?? ts);
      refreshSupportBadge();
    } catch (e) {
      if (selectedRef.current !== id) return;
      if (e instanceof ApiError && (e.status === 403 || e.status === 404)) {
        setSelectedId(null);
        setDetail(null);
        setDetailState('idle');
        flash(live ? 'This ticket was moved to another desk' : errText(e, 'You can no longer open this ticket'), 'error');
        void loadList(true);
        return;
      }
      if (!live) setDetailState('error');
    }
  }, [flash, loadList]);

  useEffect(() => { setTickets(null); void loadList(); }, [view, loadList]);
  useEffect(() => {
    if (!selectedId) { setDetail(null); return; }
    setDetail((d) => (d?.ticket.id === selectedId ? d : null));
    void loadDetail(selectedId);
  }, [selectedId, loadDetail]);

  // Live: the list quietly, and the open thread when it is the one that changed.
  const listTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const detailTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useSupportLive(true, (change) => {
    clearTimeout(listTimer.current);
    listTimer.current = setTimeout(() => void loadList(true), 400);
    const open = selectedRef.current;
    if (open && (!change || change.ticketId === open)) {
      clearTimeout(detailTimer.current);
      detailTimer.current = setTimeout(() => void loadDetail(open, true), 300);
    }
  });
  useEffect(() => () => { clearTimeout(listTimer.current); clearTimeout(detailTimer.current); }, []);

  /** After this desk changed a ticket: re-read both, and drop it if it left the desk. */
  const afterAction = useCallback(async (id: string, msg: string, leavesDesk = false) => {
    if (msg) flash(msg);
    // Only if it is still the one open: another may have been picked meanwhile.
    if (leavesDesk && selectedRef.current === id) { setSelectedId(null); setDetail(null); }
    await Promise.all([loadList(true), leavesDesk ? Promise.resolve() : loadDetail(id, true)]);
    refreshSupportBadge();
  }, [flash, loadList, loadDetail]);

  // Replies shown the moment they are written, per ticket: sent in the
  // background, and marked only if the server turns them down. Held here, not
  // in the ticket pane, so a reply on its way (or its Retry) survives opening
  // another ticket and coming back.
  const [pending, setPending] = useState<Record<string, PendingMessage[]>>({});
  const pendingRef = useRef(pending);
  pendingRef.current = pending;
  const patchPending = useCallback((ticketId: string, change: (list: PendingMessage[]) => PendingMessage[]) => {
    setPending((all) => ({ ...all, [ticketId]: change(all[ticketId] ?? []) }));
  }, []);
  /** Done with a local reply, sent or deleted: drop it and free its image previews. */
  const dropPending = useCallback((item: PendingMessage) => {
    revokePreviews(item);
    patchPending(item.ticketId, (list) => list.filter((p) => p.id !== item.id));
  }, [patchPending]);

  const deliver = useCallback((item: PendingMessage) => {
    patchPending(item.ticketId, (list) => list.map((p) => (p.id === item.id ? { ...p, failed: false } : p)));
    sendSupportMessage(item.ticketId, item.text, item.files).then(
      (r) => {
        // From here it is matched by the server's id, so two identical
        // replies (two screenshots, "ok" twice) stay two.
        patchPending(item.ticketId, (list) => list.map((p) => (p.id === item.id ? { ...p, serverId: r.message.id } : p)));
        void afterAction(item.ticketId, '');
      },
      (e) => {
        patchPending(item.ticketId, (list) => list.map((p) => (p.id === item.id ? { ...p, failed: true } : p)));
        flash(errText(e, 'Your reply was not sent. Click it to try again.'), 'error');
      },
    );
  }, [afterAction, flash, patchPending]);

  const sendReply = useCallback((ticketId: string, text: string, files: File[]) => {
    const item: PendingMessage = {
      id: `local-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      ticketId,
      side: 'staff',
      senderLabel: 'You',
      text,
      files,
      attachments: files.map((f) => ({
        name: f.name,
        contentType: f.type,
        size: f.size,
        url: f.type.startsWith('image/') ? URL.createObjectURL(f) : '',
      })),
      createdAt: new Date().toISOString(),
      failed: false,
    };
    patchPending(ticketId, (list) => [...list, item]);
    deliver(item);
  }, [deliver, patchPending]);

  // Once the server's copy is in the open thread, the local one is done with.
  useEffect(() => {
    if (!detail) return;
    const have = new Set(detail.messages.map((m) => m.id));
    for (const p of pending[detail.ticket.id] ?? []) if (p.serverId && have.has(p.serverId)) dropPending(p);
  }, [detail, pending, dropPending]);
  // Leaving the tab frees whatever previews are still held.
  useEffect(() => () => { for (const list of Object.values(pendingRef.current)) list.forEach(revokePreviews); }, []);

  // The company's types in their order, each matching its tickets by key
  // (so old tickets of a renamed type are there too); then every other name
  // tickets still carry — a type since renamed or removed — matched by name.
  const topicOptions = useMemo(() => {
    if (!types) {
      const m = new Map<string, string>();
      for (const t of tickets ?? []) m.set(t.topic, t.topicLabel);
      return { current: [...m.entries()].sort((a, b) => a[1].localeCompare(b[1])), earlier: [] as [string, string][] };
    }
    const named = new Map(types.map((t) => [t.key, t.label]));
    const earlier = new Map<string, string>();
    for (const t of tickets ?? []) if (named.get(t.topic) !== t.topicLabel) earlier.set(`label:${t.topicLabel}`, t.topicLabel);
    return {
      current: types.map((t): [string, string] => [t.key, t.label]),
      earlier: [...earlier.entries()].sort((a, b) => a[1].localeCompare(b[1])),
    };
  }, [types, tickets]);
  // A type that has gone from both lists filters nothing: back to Any.
  useEffect(() => {
    if (topic !== 'any' && tickets && types && ![...topicOptions.current, ...topicOptions.earlier].some(([v]) => v === topic)) setTopic('any');
  }, [topic, tickets, types, topicOptions]);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const byName = topic.startsWith('label:') ? topic.slice('label:'.length) : null;
    return (tickets ?? [])
      .filter((t) => topic === 'any' || (byName !== null ? t.topicLabel === byName : t.topic === topic))
      .filter((t) => status === 'any' || t.status === status)
      .filter((t) => !needle
        || t.requester.name.toLowerCase().includes(needle)
        || t.topicLabel.toLowerCase().includes(needle)
        || (t.lastMessagePreview ?? '').toLowerCase().includes(needle)
        || (t.assignee?.name ?? '').toLowerCase().includes(needle)
        || (t.requester.employeeId ?? '').toLowerCase().includes(needle));
  }, [tickets, q, topic, status]);

  return (
    <div style={{ animation: 'fade .3s ease both' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        {isHead ? (
          <QueueTabs view={view} counts={counts} onSelect={(v) => { setView(v); setStatus('any'); }} />
        ) : (
          <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--ink)', marginRight: 8 }}>
            My tickets{counts ? <span style={{ color: 'var(--ink-3)', fontWeight: 400 }}> · {counts.mine}</span> : null}
          </div>
        )}
        <SearchInput value={q} onChange={setQ} placeholder="Search tickets…" width={250} />
        <SelectBox value={topic} onChange={setTopic}>
          <option value="any">Topic: Any</option>
          {topicOptions.current.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          {topicOptions.earlier.length > 0 && (
            <optgroup label="Earlier types">
              {topicOptions.earlier.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </optgroup>
          )}
        </SelectBox>
        {view !== 'new' && (
          <SelectBox value={status} onChange={(v) => setStatus(v as StatusFilter)}>
            <option value="any">Any status</option>
            {isHead && <option value="open">New</option>}
            <option value="assigned">In progress</option>
            <option value="resolved">Resolved</option>
          </SelectBox>
        )}
      </div>
      <PageActions>
        <span style={{ fontSize: 12.5, color: 'var(--ink-3)', fontWeight: 400 }}>
          {isHead ? 'Support head' : 'Support staff · only tickets assigned to you'}
        </span>
        {canEditTopics && <TicketTypesButton topics={types} onSaved={setTypes} />}
      </PageActions>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(300px, 380px) minmax(0, 1fr)', gap: 20, height: 'calc(100vh - 290px)', minHeight: 540 }}>
        <Card style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          <div className="scry" style={{ flex: 1, overflowY: 'auto' }}>
            {tickets === null && <SkeletonRows rows={6} cols={1} rowHeight={76} />}
            {tickets !== null && listError && (
              <ListNote>
                {listError}
                <div><button type="button" onClick={() => void loadList()} style={{ ...ghostBtn, marginTop: 12 }}>Try again</button></div>
              </ListNote>
            )}
            {tickets !== null && !listError && rows.length === 0 && (
              <ListNote>{tickets.length === 0 ? (isHead ? EMPTY_TEXT[view] : 'No tickets on your desk. The Support head assigns them to you.') : 'No tickets match your filters.'}</ListNote>
            )}
            {rows.map((t) => <TicketRow key={t.id} ticket={t} role={role} meId={meId} active={t.id === selectedId} onOpen={() => setSelectedId(t.id)} />)}
          </div>
        </Card>

        <Card style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          {!selectedId && (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: 'var(--ink-3)', padding: 30, textAlign: 'center' }}>
              <div style={{ width: 72, height: 72, borderRadius: 22, background: 'var(--t-lilac)', color: 'var(--t-lilac-i)', display: 'grid', placeItems: 'center', marginBottom: 12 }}>
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M4 14v-2a8 8 0 0 1 16 0v2" />
                  <path d="M4 14a2 2 0 0 1 2-2h1v6H6a2 2 0 0 1-2-2v-2zM20 14a2 2 0 0 0-2-2h-1v6h1a2 2 0 0 0 2-2v-2z" />
                </svg>
              </div>
              <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--ink)' }}>Pick a ticket</div>
              <div style={{ fontSize: 13, marginTop: 4, maxWidth: 340, lineHeight: 1.5, color: 'var(--ink-2)' }}>
                {isHead ? 'Open a ticket to read it, then assign it to someone or keep it.' : 'Open a ticket to read the conversation and reply.'}
              </div>
            </div>
          )}
          {selectedId && !detail && (
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--ink-3)', fontWeight: 400 }}>
              {detailState === 'error'
                ? <span>Could not open this ticket. <button type="button" onClick={() => void loadDetail(selectedId)} style={linkBtn}>Try again</button></span>
                : <SkeletonLines lines={6} gap={16} style={{ width: '100%', alignSelf: 'flex-start', padding: '24px 26px' }} />}
            </div>
          )}
          {selectedId && detail && detail.ticket.id === selectedId && (
            <TicketPane key={detail.ticket.id} detail={detail} role={role} meId={meId} onChanged={afterAction}
              pending={pending[detail.ticket.id] ?? []} onSend={sendReply} onRetry={deliver} onDiscard={dropPending} />
          )}
        </Card>
      </div>
    </div>
  );
}

function ListNote({ children }: { children: ReactNode }) {
  return <div style={{ padding: '44px 24px', textAlign: 'center', color: 'var(--ink-3)', fontSize: 13.5, fontWeight: 400, lineHeight: 1.5 }}>{children}</div>;
}

function QueueTabs({ view, counts, onSelect }: { view: SupportView; counts: SupportCounts | null; onSelect: (v: SupportView) => void }) {
  return (
    <div style={SEG}>
      {HEAD_VIEWS.map((v) => {
        const on = view === v.key;
        const n = counts?.[v.key];
        return (
          <button key={v.key} type="button" onClick={() => onSelect(v.key)} style={segBtn(on)}>
            {v.label}
            {n !== undefined && (
              <span style={{ fontSize: 11, fontWeight: 700, color: on ? 'inherit' : v.key === 'new' && n > 0 ? 'var(--warn)' : 'var(--ink-3)', opacity: on ? 0.8 : 1 }}>{n}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

function TicketRow({ ticket: t, role, meId, active, onOpen }: { ticket: SupportTicket; role: SupportRole; meId: string; active: boolean; onOpen: () => void }) {
  const st = STATUS[t.status];
  const unread = t.status !== 'resolved' && t.unread > 0;
  const who = t.assignee ? (t.assignee.userId === meId ? 'You' : t.assignee.name) : null;
  return (
    <button type="button" onClick={onOpen} className={active ? undefined : 'dc-row'}
      style={{ display: 'flex', gap: 12, width: '100%', textAlign: 'left', padding: '12px 16px', border: 'none', borderBottom: '1px solid var(--line)', boxShadow: active ? 'inset 3px 0 0 var(--accent)' : 'none', background: active ? 'color-mix(in srgb, var(--accent-soft) 55%, var(--surface))' : 'var(--surface)', cursor: 'pointer', fontFamily: 'inherit', color: 'var(--ink)' }}>
      <RequesterAvatar ticket={t} size={34} />
      <span style={{ flex: 1, minWidth: 0, display: 'block' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <span style={{ fontSize: 14, fontWeight: 500, lineHeight: 1.4, color: 'var(--ink)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.topicLabel}</span>
          <span style={{ marginLeft: 'auto', fontSize: 11.5, color: 'var(--ink-3)', fontWeight: 400, whiteSpace: 'nowrap' }}>{relTime(t.lastMessageAt || t.createdAt)}</span>
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 7, marginTop: 1 }}>
          <span style={{ fontSize: 11.5, fontWeight: 400, color: 'var(--ink-3)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {t.requester.name}{t.requester.department ? <span> · {t.requester.department}</span> : null}
          </span>
          {unread && <span style={{ marginLeft: 'auto', fontSize: 11, fontWeight: 700, lineHeight: '16.5px', minWidth: 20, textAlign: 'center', background: 'var(--hi)', color: '#fff', borderRadius: 99, padding: '1px 7px' }}>{t.unread}</span>}
        </span>
        <span style={{ display: 'block', fontSize: 12.5, color: unread ? 'var(--ink)' : 'var(--ink-3)', fontWeight: unread ? 500 : 400, marginTop: 4, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {t.lastMessagePreview || '—'}
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 7, marginTop: 7 }}>
          <Pill label={st.label} tone={st.tone} />
          {role === 'head' && (
            <span style={{ fontSize: 11.5, color: 'var(--ink-3)', fontWeight: 400, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {who ? `→ ${who}` : 'Unassigned'}
            </span>
          )}
        </span>
      </span>
    </button>
  );
}

// —— One ticket ——————————————————————————————————————————————————————————————

type Dialog = 'sendback' | 'resolve' | null;

function TicketPane({ detail, role, meId, onChanged, pending, onSend, onRetry, onDiscard }: {
  detail: Detail;
  role: SupportRole;
  meId: string;
  onChanged: (id: string, msg: string, leavesDesk?: boolean) => Promise<void>;
  /** This ticket's replies still on their way, held by the desk. */
  pending: PendingMessage[];
  onSend: (ticketId: string, text: string, files: File[]) => void;
  onRetry: (item: PendingMessage) => void;
  onDiscard: (item: PendingMessage) => void;
}) {
  const { flash } = useStore();
  const { ticket: t, messages, events } = detail;
  const isHead = role === 'head';
  const resolved = t.status === 'resolved';
  const mineNow = t.assignee?.userId === meId;
  const [dialog, setDialog] = useState<Dialog>(null);
  const [busy, setBusy] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  // A sent reply steps aside once the server's copy, by its id, is in the thread.
  const shownPending = pending.filter((p) => !p.serverId || !messages.some((m) => m.id === p.serverId));
  const firstName = (n: string) => n.split(/\s+/)[0] || n;

  const run = async (work: () => Promise<unknown>, msg: string, leavesDesk = false) => {
    setBusy(true);
    try {
      await work();
      setDialog(null);
      await onChanged(t.id, msg, leavesDesk);
    } catch (e) {
      flash(errText(e, 'Something went wrong. Try again.'), 'error');
      // Someone changed it first: show it as it is now.
      if (e instanceof ApiError && e.status === 409) void onChanged(t.id, '');
    } finally {
      setBusy(false);
    }
  };

  // Sent with the version on screen, so a ticket changed meanwhile is refused, not overwritten.
  const assign = (p: SupportAssignee) =>
    run(() => assignSupportTicket(t.id, p.userId, t.version), p.userId === meId ? 'You kept this ticket' : `Assigned to ${p.name}`);
  const keep = () => run(() => assignSupportTicket(t.id, meId, t.version), 'You kept this ticket');

  const requesterMeta = [t.requester.employeeId, t.requester.department].filter(Boolean).join(' · ');
  const resolvedEvent = [...events].reverse().find((e) => e.type === 'resolved');

  return (
    <>
      {/* Header */}
      <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--line)' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
          <RequesterAvatar ticket={t} size={42} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 16, fontWeight: 600, lineHeight: 1.5 }}>{t.topicLabel}</span>
              <Pill label={STATUS[t.status].label} tone={STATUS[t.status].tone} />
            </div>
            <div style={{ fontSize: 13.5, fontWeight: 500, color: 'var(--ink)', marginTop: 2 }}>
              {t.requester.name}
              {requesterMeta && <span style={{ color: 'var(--ink-3)', fontWeight: 400 }}> · {requesterMeta}</span>}
            </div>
            <div style={{ fontSize: 11.5, color: 'var(--ink-3)', fontWeight: 400, marginTop: 2 }}>
              Raised {fullDate(t.createdAt)} · {t.assignee ? <>With <strong style={{ color: 'var(--ink-2)' }}>{mineNow ? 'you' : t.assignee.name}</strong></> : 'In the head’s queue, unassigned'}
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 16, flexWrap: 'wrap' }}>
          {isHead && !resolved && (
            <>
              <AssignMenu label={t.assignee ? 'Reassign…' : 'Assign to…'} currentId={t.assignee?.userId} meId={meId} disabled={busy} onPick={(p) => void assign(p)} />
              {!mineNow && <button type="button" disabled={busy} onClick={() => void keep()} style={ghostBtn}>Keep it</button>}
            </>
          )}
          {!isHead && !resolved && (
            <button type="button" disabled={busy} onClick={() => setDialog('sendback')} style={ghostBtn}>Send back to head</button>
          )}
          {!resolved && (isHead || mineNow) && (
            <button type="button" disabled={busy} onClick={() => setDialog('resolve')} className={btnClass('ok')} style={btn('ok')}>Resolve</button>
          )}
          <button type="button" onClick={() => setShowHistory((s) => !s)}
            style={{ ...ghostBtn, marginLeft: 'auto', background: showHistory ? 'var(--sel)' : 'var(--surface)', color: showHistory ? 'var(--on-sel)' : 'var(--ink)', borderColor: showHistory ? 'var(--sel)' : 'var(--line-2)' }}>
            <IconHistory size={15} /> History{events.length ? ` · ${events.length}` : ''}
          </button>
        </div>
      </div>

      {showHistory && <HistoryPanel events={events} meId={meId} />}

      <Thread messages={messages} pending={shownPending} onRetry={onRetry} onDiscard={onDiscard} />

      {/* Footer: who may write here, and when */}
      {resolved ? (
        <FooterNote tone="done">
          Resolved{resolvedEvent ? ` ${fullDate(resolvedEvent.createdAt)}` : ''}{resolvedEvent ? ` by ${eventActor(resolvedEvent, meId)}` : ''}. The employee can’t reply; the app asks them to raise a new ticket.
        </FooterNote>
      ) : isHead && !mineNow ? (
        <FooterNote>
          <span style={{ flex: 1 }}>
            {t.assignee
              ? <>{firstName(t.assignee.name)} has this ticket. Keep it to reply yourself; it leaves {firstName(t.assignee.name)}’s desk.</>
              : 'Keep this ticket to reply, so the employee hears one voice.'}
          </span>
          <button type="button" disabled={busy} onClick={() => void keep()} style={primaryBtn}>Keep it</button>
        </FooterNote>
      ) : (
        <Composer onSend={(text, files) => onSend(t.id, text, files)} />
      )}

      {dialog === 'sendback' && (
        <SendBackDialog busy={busy} onClose={() => setDialog(null)}
          onConfirm={(note) => void run(() => sendBackSupportTicket(t.id, note || undefined), 'Sent back to the Support head', true)} />
      )}
      {dialog === 'resolve' && (
        <ConfirmResolveDialog busy={busy} onClose={() => setDialog(null)}
          onConfirm={() => void run(() => resolveSupportTicket(t.id), 'Ticket resolved')} />
      )}
    </>
  );
}

function FooterNote({ children, tone }: { children: ReactNode; tone?: 'done' }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '16px 20px', borderTop: '1px solid var(--line)', background: tone === 'done' ? 'var(--ok-bg)' : 'var(--surface-2)', fontSize: 13, fontWeight: 400, color: tone === 'done' ? 'var(--ok)' : 'var(--ink-2)', lineHeight: 1.5 }}>
      {children}
    </div>
  );
}

// —— Assign to… ————————————————————————————————————————————————————————————

// Everyone with a Support role, read once per page load.
let assigneesCache: Promise<SupportAssignee[]> | null = null;
function loadAssignees(): Promise<SupportAssignee[]> {
  if (!assigneesCache) {
    assigneesCache = listSupportAssignees().then((r) => r.people).catch((e) => { assigneesCache = null; throw e; });
  }
  return assigneesCache;
}

function AssignMenu({ label, currentId, meId, disabled, onPick }: { label: string; currentId?: string; meId: string; disabled: boolean; onPick: (p: SupportAssignee) => void }) {
  const [open, setOpen] = useState(false);
  const [people, setPeople] = useState<SupportAssignee[] | null>(null);
  const [error, setError] = useState('');
  const [q, setQ] = useState('');
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    setError('');
    loadAssignees().then(setPeople).catch((e) => setError(errText(e, 'Could not load support people')));
    const onDown = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);

  const needle = q.trim().toLowerCase();
  const shown = (people ?? [])
    .filter((p) => !needle || p.name.toLowerCase().includes(needle))
    .sort((a, b) => (a.role === b.role ? a.name.localeCompare(b.name) : a.role === 'staff' ? -1 : 1));

  return (
    <div ref={box} style={{ position: 'relative' }}>
      <button type="button" disabled={disabled} onClick={() => setOpen((o) => !o)} className={btnClass('primary')} style={primaryBtn}>
        {label} <IconChevronDown stroke="var(--on-accent)" />
      </button>
      {open && (
        <div style={{ position: 'absolute', top: 'calc(100% + 6px)', left: 0, zIndex: 40, width: 300, background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 'var(--r)', boxShadow: 'var(--shadow-lg)', overflow: 'hidden', animation: 'pop .16s ease both' }}>
          {(people?.length ?? 0) > 7 && (
            <div style={{ padding: 10, borderBottom: '1px solid var(--line)' }}>
              <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search people"
                className="ds-inp" style={{ ...inp, height: 36, borderRadius: 10 }} />
            </div>
          )}
          <div className="scry" style={{ maxHeight: 300, overflowY: 'auto' }}>
            {error && <div style={{ padding: 14, fontSize: 13, color: 'var(--bad)' }}>{error}</div>}
            {!error && people === null && <SkeletonRows rows={3} cols={1} rowHeight={46} pad={14} />}
            {!error && people !== null && shown.length === 0 && (
              <div style={{ padding: 14, fontSize: 13, color: 'var(--ink-3)', lineHeight: 1.45 }}>
                {people.length === 0 ? 'Nobody has a Support role yet. A dashboard admin gives roles in People › Accesses.' : 'Nobody matches.'}
              </div>
            )}
            {shown.map((p) => {
              const current = p.userId === currentId;
              return (
                <button key={p.userId} type="button" disabled={current} onClick={() => { setOpen(false); onPick(p); }}
                  style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '9px 14px', border: 'none', borderBottom: '1px solid var(--line)', background: 'var(--surface)', cursor: current ? 'default' : 'pointer', textAlign: 'left', fontFamily: 'inherit', opacity: current ? 0.55 : 1 }}>
                  <PersonAvatar name={p.name} userId={p.userId} size={30} font={11} />
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: 'block', fontSize: 13, fontWeight: 500, color: 'var(--ink)' }}>{p.name}{p.userId === meId && <span style={{ color: 'var(--ink-4)', fontWeight: 400 }}> · you</span>}</span>
                    <span style={{ display: 'block', fontSize: 12, color: 'var(--ink-3)' }}>{p.role === 'head' ? 'Support head' : 'Support staff'}{current ? ' · has it now' : ''}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// —— History ————————————————————————————————————————————————————————————————

function eventActor(e: SupportEvent, meId: string): string {
  if (e.actorUserId && e.actorUserId === meId) return 'you';
  return e.actorName || 'the support team';
}
function eventTarget(e: SupportEvent, meId: string): string {
  if (e.toUserId && e.toUserId === meId) return 'you';
  return e.toName || 'a support person';
}

function eventLine(e: SupportEvent, meId: string): { text: string; detail?: string; tone: string } {
  const by = eventActor(e, meId);
  switch (e.type) {
    case 'created': return { text: 'Raised by the employee', tone: 'var(--ink-4)' };
    case 'assigned': return { text: `Assigned to ${eventTarget(e, meId)} by ${by}`, tone: 'var(--t-sky-i)' };
    case 'reassigned': return { text: `Reassigned to ${eventTarget(e, meId)} by ${by}`, tone: 'var(--t-sky-i)' };
    case 'kept': return { text: `Kept by ${by}`, tone: 'var(--t-sky-i)' };
    case 'sent_back': return { text: `Sent back to the head by ${by}`, detail: e.note ? `Note: ${e.note}` : undefined, tone: 'var(--warn)' };
    case 'resolved': return { text: `Resolved by ${by}`, tone: 'var(--ok)' };
    case 'returned_on_exit': return { text: `Back in the queue: ${e.fromName || 'the assignee'} left or lost their Support role`, tone: 'var(--warn)' };
    default: return { text: String(e.type).replace(/_/g, ' '), tone: 'var(--ink-4)' };
  }
}

function HistoryPanel({ events, meId }: { events: SupportEvent[]; meId: string }) {
  return (
    <div className="scry" style={{ maxHeight: 210, overflowY: 'auto', padding: '12px 20px', borderBottom: '1px solid var(--line)', background: 'var(--surface-2)', animation: 'fade .16s ease both' }}>
      <div style={{ ...eyebrow, marginBottom: 8 }}>HISTORY</div>
      {events.length === 0 && <div style={{ fontSize: 13, color: 'var(--ink-4)' }}>Nothing yet.</div>}
      {events.map((e, i) => {
        const line = eventLine(e, meId);
        return (
          <div key={e.id || i} style={{ display: 'flex', gap: 10, padding: '5px 0' }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: line.tone, marginTop: 6, flexShrink: 0 }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 400, color: 'var(--ink)' }}>{line.text}</div>
              {line.detail && <div style={{ fontSize: 12.5, color: 'var(--ink-2)', marginTop: 1, whiteSpace: 'pre-wrap' }}>{line.detail}</div>}
            </div>
            <span style={{ fontSize: 12, color: 'var(--ink-4)', fontWeight: 400, whiteSpace: 'nowrap' }}>{fullDate(e.createdAt)}</span>
          </div>
        );
      })}
    </div>
  );
}

// —— Thread ————————————————————————————————————————————————————————————————

/**
 * A reply on its way: shown as sent straight away, flagged only on failure.
 * `serverId` is the message the server stored, once the send has returned.
 */
type PendingMessage = SupportMessage & { ticketId: string; files: File[]; failed: boolean; serverId?: string };

/** Frees the in-browser image previews a local reply was shown with. */
function revokePreviews(item: PendingMessage) {
  for (const a of item.attachments) if (a.url) URL.revokeObjectURL(a.url);
}

function Thread({ messages, pending, onRetry, onDiscard }: {
  messages: SupportMessage[];
  pending: PendingMessage[];
  onRetry: (item: PendingMessage) => void;
  onDiscard: (item: PendingMessage) => void;
}) {
  const end = useRef<HTMLDivElement>(null);
  const last = pending[pending.length - 1]?.id ?? messages[messages.length - 1]?.id;
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }); }, [last]);
  let prevDay = '';
  return (
    <div className="scry" style={{ flex: 1, overflowY: 'auto', padding: '16px 20px', background: 'var(--surface-2)', minHeight: 0 }}>
      {messages.length === 0 && pending.length === 0 && <div style={{ textAlign: 'center', color: 'var(--ink-4)', fontSize: 13, fontWeight: 400, padding: 30 }}>No messages yet.</div>}
      {messages.map((m) => {
        const day = new Date(m.createdAt).toDateString();
        const divider = day !== prevDay ? dayLabel(m.createdAt) : null;
        prevDay = day;
        return (
          <div key={m.id}>
            {divider && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '10px 0 12px', color: 'var(--ink-4)', fontSize: 11.5, fontWeight: 500, letterSpacing: '.04em' }}>
                <span style={{ flex: 1, height: 1, background: 'var(--line)' }} />{divider.toUpperCase()}<span style={{ flex: 1, height: 1, background: 'var(--line)' }} />
              </div>
            )}
            <Bubble m={m} />
          </div>
        );
      })}
      {pending.map((p) => (
        <div key={p.id}>
          <Bubble m={p} />
          {p.failed && (
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, margin: '-6px 4px 12px', fontSize: 12, fontWeight: 500 }}>
              <span style={{ color: 'var(--bad)' }}>Not sent</span>
              <button type="button" onClick={() => onRetry(p)} style={{ border: 'none', background: 'none', color: 'var(--accent-ink)', fontWeight: 500, cursor: 'pointer', padding: 0, fontFamily: 'inherit' }}>Retry</button>
              <button type="button" onClick={() => onDiscard(p)} style={{ border: 'none', background: 'none', color: 'var(--ink-3)', fontWeight: 500, cursor: 'pointer', padding: 0, fontFamily: 'inherit' }}>Delete</button>
            </div>
          )}
        </div>
      ))}
      <div ref={end} />
    </div>
  );
}

function Bubble({ m }: { m: SupportMessage }) {
  if (m.side === 'system') {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', margin: '8px 0 12px' }}>
        <div style={{ maxWidth: '82%', textAlign: 'center', background: 'var(--surface-2)', color: 'var(--ink-2)', borderRadius: 12, padding: '8px 13px', fontSize: 12.5, fontWeight: 400, lineHeight: 1.45, whiteSpace: 'pre-wrap' }}>
          {m.text}
          <span style={{ display: 'block', fontSize: 11.5, color: 'var(--ink-4)', marginTop: 3 }}>{clock(m.createdAt)}</span>
        </div>
      </div>
    );
  }
  const ours = m.side === 'staff';
  const who = m.senderLabel || (ours ? 'Support' : 'Employee');
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: ours ? 'flex-end' : 'flex-start', margin: '0 0 12px' }}>
      <div style={{ fontSize: 11.5, fontWeight: 500, color: ours ? 'var(--accent-ink)' : 'var(--ink-3)', margin: '0 4px 3px' }}>
        {who} · <span style={{ fontWeight: 400, color: 'var(--ink-4)' }}>{clock(m.createdAt)}</span>
      </div>
      <div style={{ maxWidth: '74%', background: ours ? 'var(--accent-grad)' : 'var(--surface)', color: ours ? 'var(--on-accent)' : 'var(--ink)', border: ours ? 'none' : '1px solid var(--line)', borderRadius: 16, borderTopRightRadius: ours ? 4 : 14, borderTopLeftRadius: ours ? 14 : 4, padding: '10px 13px', fontSize: 13.5, lineHeight: 1.5, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
        {m.text}
        {m.attachments?.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: m.text ? 9 : 0 }}>
            {m.attachments.map((a, i) => <AttachmentView key={`${a.url}-${i}`} a={a} ours={ours} />)}
          </div>
        )}
      </div>
    </div>
  );
}

function AttachmentView({ a, ours }: { a: SupportAttachment; ours: boolean }) {
  const image = a.contentType?.startsWith('image/');
  if (image && a.url) {
    return (
      <a href={a.url} target="_blank" rel="noreferrer" title={a.name} style={{ display: 'block', borderRadius: 10, overflow: 'hidden', border: '1px solid rgba(0,0,0,.08)', background: 'var(--surface-2)' }}>
        <img src={a.url} alt={a.name} style={{ display: 'block', width: 150, height: 110, objectFit: 'cover' }} />
      </a>
    );
  }
  return (
    <a href={a.url || undefined} target="_blank" rel="noreferrer"
      style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '8px 11px', borderRadius: 10, background: ours ? 'rgba(255,255,255,.16)' : 'var(--accent-soft)', color: ours ? 'var(--on-accent)' : 'var(--accent-ink)', textDecoration: 'none', fontSize: 12.5, fontWeight: 500, maxWidth: 240 }}>
      <IconFile size={16} stroke={ours ? 'var(--on-accent)' : 'var(--accent-ink)'} />
      <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.name}</span>
      {a.size ? <span style={{ fontWeight: 400, opacity: 0.75, whiteSpace: 'nowrap' }}>{fileSize(a.size)}</span> : null}
    </a>
  );
}

// —— Composer ——————————————————————————————————————————————————————————————

const ACCEPT = 'image/*,application/pdf';
const allowedFile = (f: File) => f.type.startsWith('image/') || f.type === 'application/pdf' || /\.pdf$/i.test(f.name);

function Composer({ onSend }: { onSend: (text: string, files: File[]) => void }) {
  const { flash } = useStore();
  const [text, setText] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const picker = useRef<HTMLInputElement>(null);

  const add = (list: FileList | null) => {
    if (!list) return;
    const next = [...files];
    for (const f of Array.from(list)) {
      if (!allowedFile(f)) { flash(`${f.name}: only images and PDFs`, 'error'); continue; }
      if (f.size > SUPPORT_MAX_FILE_BYTES) { flash(`${f.name} is over 10 MB`, 'error'); continue; }
      if (next.length >= SUPPORT_MAX_FILES) { flash(`Up to ${SUPPORT_MAX_FILES} files per message`, 'error'); break; }
      next.push(f);
    }
    setFiles(next);
    if (picker.current) picker.current.value = '';
  };

  const canSend = text.trim().length > 0 || files.length > 0;
  // Handed to the thread, which shows it as sent at once; the box is free
  // for the next reply straight away.
  const send = () => {
    if (!canSend) return;
    onSend(text.trim(), files);
    setText('');
    setFiles([]);
  };

  return (
    <div style={{ borderTop: '1px solid var(--line)', padding: '12px 16px 14px', background: 'var(--surface)' }}>
      {files.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7, marginBottom: 9 }}>
          {files.map((f, i) => (
            <span key={`${f.name}-${i}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'var(--accent-soft)', border: '1px solid var(--accent-line)', color: 'var(--accent-ink)', borderRadius: 9, padding: '5px 6px 5px 10px', fontSize: 12.5, fontWeight: 500, maxWidth: 240 }}>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</span>
              <span style={{ fontWeight: 400, color: 'var(--ink-3)', whiteSpace: 'nowrap' }}>{fileSize(f.size)}</span>
              <button type="button" title="Remove" onClick={() => setFiles(files.filter((_, j) => j !== i))} style={{ border: 'none', background: 'none', cursor: 'pointer', padding: 2, display: 'inline-flex' }}>
                <IconClose size={13} stroke="var(--ink-3)" />
              </button>
            </span>
          ))}
        </div>
      )}
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 9 }}>
        <input ref={picker} type="file" accept={ACCEPT} multiple hidden onChange={(e) => add(e.target.files)} />
        <button type="button" title="Attach images or PDFs (up to 5, 10 MB each)" onClick={() => picker.current?.click()} disabled={files.length >= SUPPORT_MAX_FILES}
          className="ds-icon-btn" style={iconBtn(42)}>
          <IconClip />
        </button>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(); } }}
          placeholder="Write a reply… (Enter to send, Shift+Enter for a new line)"
          rows={2}
          maxLength={4000}
          className="ds-inp"
          style={{ ...inp, flex: 1, height: 'auto', minHeight: 42, resize: 'none', padding: '10px 12px', fontSize: 13.5, maxHeight: 140 }}
        />
        <button type="button" disabled={!canSend} onClick={send} className={btnClass('primary')} style={{ ...primaryBtn, height: 42, opacity: canSend ? 1 : 0.5, cursor: canSend ? 'pointer' : 'not-allowed' }}>
          Send
        </button>
      </div>
    </div>
  );
}

// The prototype's 40px pill buttons.
const primaryBtn: CSSProperties = { ...btn('primary'), fontFamily: 'inherit' };
const ghostBtn: CSSProperties = { ...btn(), fontFamily: 'inherit' };
const linkBtn: CSSProperties = { background: 'none', border: 'none', color: 'var(--accent-ink)', fontWeight: 500, fontSize: 'inherit', cursor: 'pointer', padding: 0, fontFamily: 'inherit' };
