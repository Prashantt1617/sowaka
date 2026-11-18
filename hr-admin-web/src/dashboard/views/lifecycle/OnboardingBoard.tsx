// H1 · Onboarding: every joiner as a card, from the offer to confirmation.
// One white panel holds the phase tabs, the filters and the columns (the
// design's layout). Each tab is a phase (Pre-boarding, First week, Probation)
// and its columns are the steps; Closed is the last tab and lists the offers
// that ended before joining. Quick filters dim the cards that do not match;
// search and the joining-date range narrow the board on the server. A card
// opens the joiner panel (H1b); New offer letter starts an offer.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../../store';
import { canSeePay } from '../../access';
import { Card, LoadError, PageActions, SearchInput, Skeleton, SkeletonFrame } from '../../ui';
import { IconDownload, IconPlus } from '../../icons';
import { downloadCsv } from '../../export';
import { getBoard, getClosedJourneys, isNotAvailable } from '../../../services/lifecycle';
import type { BoardCard, BoardDTO, BoardTab, ClosedJourneyRow, JourneyFlag } from '../../../services/lifecycle';
import { FlagPill, NotSwitchedOn, OwnerChip, Plant } from './shared';
import { ClockIcon } from './offboarding/parts';
import { OWNER_LABEL, dueText, errText, firstName, flagLabel, longDay } from './format';
import { refreshOnboardingBadge } from '../../onboardingBadge';
import { JoinerPanel } from './JoinerPanel';
import { OfferWizard } from './OfferDialogs';
import '../people.css';
// The two boards share one look: lanes, cards and the filter row come from the offboarding board's sheet.
import './offboarding/offboarding.css';

type View = BoardTab | 'closed';
const TABS: BoardTab[] = ['pre_boarding', 'first_week', 'probation'];
const VIEWS: View[] = [...TABS, 'closed'];
const TAB_LABELS: Record<View, string> = { pre_boarding: 'Pre-boarding', first_week: 'First week', probation: 'Probation', closed: 'Closed' };
const TAB_NOTES: Record<View, string> = {
  pre_boarding: 'From the offer to the joining day',
  first_week: 'Joining day to Day 7',
  probation: 'Monthly, until confirmation',
  closed: 'Offers declined, expired or not joining',
};
// The design's three quick filters (6Zs §7.1). Needs attention takes every risk flag
// (needs you, late, quiet, joining risk, needs attention), as the design's filter does.
type Quick = 'mine' | 'late' | 'attention';
const FILTERS: [Quick, string][] = [['mine', 'Waiting on me'], ['late', 'Late'], ['attention', 'Needs attention']];
const RISK_FLAGS: JourneyFlag[] = ['needs_you', 'late', 'quiet', 'joining_risk', 'needs_attention'];
// The one flag a card shows (the design draws one): the most telling first; Late last, as the red due date already says it.
const FLAG_ORDER: JourneyFlag[] = ['needs_you', 'quiet', 'joining_risk', 'expires_soon', 'decide', 'needs_attention', 'due_soon', 'late', 'all_set', 'confirmed', 'done'];
const TAB_KEY = 'sowaka.onboarding.tab';
// The plant's tile on a card, by phase (the design's tints, in the system's colours).
const TINT: Record<BoardTab, string> = { pre_boarding: 'var(--surface-2)', first_week: 'var(--accent-soft)', probation: 'var(--ok-bg)' };

/** Whether a card answers a quick filter. Waiting on me = a step that waits on HR. */
function matches(card: BoardCard, f: Quick): boolean {
  if (f === 'mine') return card.waitingOn.some((w) => w.ownerRole === 'hr' || w.ownerRole === 'hr_manager');
  if (f === 'late') return card.flags.includes('late');
  return card.flags.some((x) => RISK_FLAGS.includes(x));
}

export function OnboardingBoard() {
  const { user } = useStore();
  const pay = canSeePay(user);
  const [view, setViewRaw] = useState<View>(() => {
    try { const t = sessionStorage.getItem(TAB_KEY) as View | null; return t && VIEWS.includes(t) ? t : 'pre_boarding'; } catch { return 'pre_boarding'; }
  });
  const setView = (t: View) => { setViewRaw(t); try { sessionStorage.setItem(TAB_KEY, t); } catch { /* not remembered */ } };
  // The board tab the board shows (Closed keeps the last phase's board loaded behind it).
  const [lastTab, setLastTab] = useState<BoardTab>(() => (view === 'closed' ? 'pre_boarding' : view));
  const tab: BoardTab = view === 'closed' ? lastTab : view;
  const showClosed = view === 'closed';
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [filter, setFilter] = useState<Quick | null>(null);
  const [board, setBoard] = useState<BoardDTO | null>(null);
  const [error, setError] = useState('');
  const [off, setOff] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [openId, setOpenId] = useState('');
  const [newOffer, setNewOffer] = useState(false);
  const [closedRows, setClosedRows] = useState<ClosedJourneyRow[] | null>(null);
  const [closedError, setClosedError] = useState('');

  // The search goes to the server a moment after typing stops.
  useEffect(() => {
    const t = setTimeout(() => setQ(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    let live = true;
    setError('');
    getBoard({ tab, q: q || undefined, from: from || undefined, to: to || undefined })
      .then((b) => { if (live) { setBoard(b); setOff(false); } })
      .catch((e) => {
        if (!live) return;
        if (isNotAvailable(e)) setOff(true);
        else setError(errText(e, 'Could not load the board'));
      });
    return () => { live = false; };
  }, [tab, q, from, to, attempt]);

  useEffect(() => {
    if (!showClosed) return undefined;
    let live = true;
    setClosedError('');
    getClosedJourneys(q || undefined)
      .then((rows) => { if (live) setClosedRows(rows); })
      .catch((e) => { if (live) setClosedError(errText(e, 'Could not load closed offers')); });
    return () => { live = false; };
  }, [showClosed, q, attempt]);

  const reload = useCallback(() => { setAttempt((n) => n + 1); refreshOnboardingBadge(); }, []);
  // Closing the panel puts focus back on the card (or row) that opened it.
  const closePanel = () => {
    const id = openId;
    setOpenId('');
    requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-journey-card="${id}"]`)?.focus());
  };
  const pick = (v: View) => { setView(v); if (v !== 'closed') setLastTab(v); setOpenId(''); };
  const shownTab = board?.tab === tab ? board : null;
  const cards = useMemo(() => shownTab?.columns.flatMap((c) => c.cards) ?? [], [shownTab]);
  // The dates the board covers: the range boxes show them until a range is picked.
  const span = useMemo(() => {
    const days = cards.map((c) => c.tj).filter((d): d is string => Boolean(d)).sort();
    return { first: days[0] ?? '', last: days[days.length - 1] ?? '' };
  }, [cards]);
  const counts: Partial<Record<View, number>> = { ...(board?.counts ?? {}), ...(closedRows ? { closed: closedRows.length } : {}) };

  const exportBoard = () => downloadCsv<BoardCard & { columnLabel: string }>(`onboarding-${tab.replace('_', '-')}`, [
    { header: 'Name', value: (c) => c.name },
    { header: 'Designation', value: (c) => c.designation ?? '' },
    { header: 'Department', value: (c) => c.department ?? '' },
    { header: 'Manager', value: (c) => c.managerName ?? '' },
    { header: 'Joining date', value: (c) => c.tj ?? '' },
    { header: 'Step', value: (c) => c.columnLabel },
    { header: 'Where they are', value: (c) => c.dayLabel },
    { header: 'Next step', value: (c) => c.waitingOn[0]?.title ?? '' },
    { header: 'Waiting on', value: (c) => (c.waitingOn[0] ? `${OWNER_LABEL[c.waitingOn[0].ownerRole]}${c.waitingOn[0].ownerName ? ` (${c.waitingOn[0].ownerName})` : ''}` : '') },
    { header: 'Due', value: (c) => (c.waitingOn[0]?.dueAt ?? '').slice(0, 10) },
    { header: 'Flags', value: (c) => c.flags.map((f) => flagLabel(f, c)).join('; ') },
    { header: 'Tasks done', value: (c) => `${c.progress.done} of ${c.progress.total}` },
  ], (shownTab?.columns ?? []).flatMap((col) => col.cards.map((c) => ({ ...c, columnLabel: col.label }))));

  if (off) return <NotSwitchedOn />;

  return (
    <div className="pd-form" style={{ animation: 'fade .3s ease both' }}>
      <PageActions>
        <button type="button" className="pd-btn" onClick={exportBoard} disabled={!cards.length || showClosed}><IconDownload stroke="currentColor" /> Export</button>
        <button type="button" className="pd-btn primary" onClick={() => setNewOffer(true)} disabled={!pay} title={pay ? undefined : 'Only people with payroll access can set the CTC on an offer'}><IconPlus /> New offer letter</button>
      </PageActions>

      <p className="pd-lead" style={{ margin: '-8px 4px 20px', maxWidth: '70ch' }}>Every joiner as a card, from offer to confirmation. Each tab is one phase; columns are its steps.</p>

      <Card padded>
        <div className="ob-tabs">
          <div className="pd-seg" role="tablist" aria-label="Phase">
            {VIEWS.map((v) => (
              <button key={v} type="button" role="tab" aria-selected={view === v} className={view === v ? 'on' : ''} onClick={() => pick(v)}>
                {TAB_LABELS[v]}{counts[v] != null && <span className="c">{counts[v]}</span>}
              </button>
            ))}
          </div>
          <span className="ob-tabnote">{TAB_NOTES[view]}</span>
        </div>

        <div className="ob-filters">
          <SearchInput value={search} onChange={setSearch} placeholder={showClosed ? 'Search closed offers' : 'Search this board'} width={240} />
          {!showClosed && (
            <div className="pd-chips" role="group" aria-label="Quick filters">
              {FILTERS.map(([f, label]) => (
                <button key={f} type="button" aria-pressed={filter === f} className={`pd-chip sm${filter === f ? ' on' : ''}`} onClick={() => setFilter(filter === f ? null : f)}>{label}</button>
              ))}
            </div>
          )}
          {!showClosed && (
            <>
              <span className="sp" />
              {/* The label and its two boxes wrap as one. */}
              <span role="group" aria-label="Joining date" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <label aria-hidden>Joining date</label>
                <DateBox label="From" value={from} hint={span.first} max={to || undefined} onChange={setFrom} />
                <DateBox label="To" value={to} hint={span.last} min={from || undefined} onChange={setTo} />
              </span>
            </>
          )}
        </div>

        {showClosed ? (
          <ClosedList rows={closedRows} error={closedError} searching={Boolean(q)} openId={openId} onOpen={setOpenId} onRetry={reload} />
        ) : error && !shownTab ? (
          <LoadError text={error} onRetry={reload} />
        ) : !shownTab ? (
          <BoardSkeleton columns={tab === 'pre_boarding' ? 5 : 4} />
        ) : (
          <>
            {error && <LoadError compact text={error} onRetry={reload} />}
            {cards.length === 0 && !q && !from && !to && tab === 'pre_boarding' && (
              <div className="pd-note" style={{ marginBottom: 14 }}>No joiners yet. Start with <b>New offer letter</b>: the candidate gets the offer by email and accepts it on their portal, and their card moves along this board from there.</div>
            )}
            <div className="ob-lanes scry" style={{ gridAutoColumns: 'minmax(200px, 1fr)' }}>
              {shownTab.columns.map((col) => (
                <section key={col.key} className="ob-lane" aria-label={col.label} style={{ minHeight: 560, gap: 8 }}>
                  <div className="ob-lane-h"><span>{col.label}</span><b>{col.cards.length}</b></div>
                  {col.cards.length === 0 && <div className="ob-empty">{q || from || to ? 'Nobody matches here' : 'Nobody here'}</div>}
                  {col.cards.map((c) => (
                    <JoinerCard key={c.journeyId} card={c} tint={TINT[tab]} where={tab === 'probation' && c.dayLabel !== col.label ? `${c.dayLabel} · ${col.label}` : c.dayLabel}
                      selected={openId === c.journeyId} dim={filter ? !matches(c, filter) : false} onOpen={() => setOpenId(c.journeyId)} />
                  ))}
                </section>
              ))}
            </div>
          </>
        )}
      </Card>

      {openId && <JoinerPanel journeyId={openId} onClose={closePanel} onChanged={reload} />}
      {newOffer && (
        <OfferWizard mode="new" onClose={() => setNewOffer(false)}
          onDone={(id) => { setNewOffer(false); pick('pre_boarding'); reload(); setOpenId(id); }} />
      )}
    </div>
  );
}

const boxDate = (key: string) => new Date(`${key}T00:00:00Z`).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });

/**
 * One end of the joining-date range: "From 01 Nov 2026". Until a day is picked it shows the
 * board's own first (or last) joining day in grey; a click opens the browser's date picker.
 */
function DateBox({ label, value, hint, min, max, onChange }: { label: string; value: string; hint: string; min?: string; max?: string; onChange: (v: string) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const open = () => { try { input.current?.showPicker?.(); } catch { input.current?.focus(); } };
  return (
    <span className="ds-field" onClick={open}
      style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', gap: 6, height: 40, padding: '0 12px', border: '1px solid var(--line-2)', borderRadius: 999, background: 'var(--surface)', cursor: 'pointer', fontSize: 12, color: 'var(--ink-3)' }}>
      {label}
      <span style={{ fontSize: 13, fontWeight: 500, color: value ? 'var(--ink)' : 'var(--ink-4)', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{value ? boxDate(value) : hint ? boxDate(hint) : 'Any day'}</span>
      {value && (
        <button type="button" aria-label={`Clear the ${label.toLowerCase()} date`} title="Clear" onClick={(e) => { e.stopPropagation(); onChange(''); }}
          style={{ position: 'relative', zIndex: 1, border: 0, background: 'none', padding: '0 0 0 2px', cursor: 'pointer', color: 'var(--ink-3)', fontSize: 16, lineHeight: 1 }}>×</button>
      )}
      {/* The real control, under the words: keyboard users tab to it, and the picker writes to it. */}
      <input ref={input} type="date" value={value} min={min} max={max} aria-label={`Joining date ${label.toLowerCase()}`} onChange={(e) => onChange(e.target.value)}
        style={{ position: 'absolute', inset: 0, opacity: 0, width: '100%', height: '100%', border: 0, padding: 0, cursor: 'pointer' }} />
    </span>
  );
}

function JoinerCard({ card, tint, where, selected, dim, onOpen }: { card: BoardCard; tint: string; where: string; selected: boolean; dim: boolean; onOpen: () => void }) {
  const next = card.waitingOn[0];
  // The lead step's own lateness: a card flagged late for an older task can lead with a step not yet due.
  const late = Boolean(next?.dueAt) && (Boolean(next?.late) || dueText(next?.dueAt).endsWith('late'));
  const role = [card.designation, card.department].filter(Boolean).join(' · ');
  const flag = FLAG_ORDER.find((f) => card.flags.includes(f));
  // Who it waits on, by first name (the chip's colour says the role); HR's own steps read "HR · you".
  const owner = next ? (next.ownerRole === 'hr' ? undefined : next.ownerName ? firstName(next.ownerName) : undefined) : undefined;
  const tip = [where, ...card.flags.map((f) => flagLabel(f, card)), card.progress.total ? `${card.progress.done} of ${card.progress.total} tasks done` : ''].filter(Boolean).join(' · ');
  return (
    <div className={`ob-card-wrap${dim ? ' dim' : ''}`}>
      <button type="button" className={`ob-card${selected ? ' on' : ''}`} onClick={onOpen} aria-pressed={selected} data-journey-card={card.journeyId} title={tip} style={{ gap: 10 }}>
        <div className="ob-who">
          <span aria-hidden style={{ width: 32, height: 36, borderRadius: 10, background: tint, display: 'flex', alignItems: 'flex-end', justifyContent: 'center', flex: 'none' }}><Plant plant={card.plant} size={26} /></span>
          <div style={{ minWidth: 0 }}><b>{card.name}</b>{role && <span>{role}</span>}</div>
        </div>
        <div className="ob-next">{next ? next.title : <span style={{ color: 'var(--ink-3)' }}>Nothing waiting</span>}</div>
        <div className="ob-foot">
          {next && (
            <span style={{ minWidth: 0, maxWidth: '100%', display: 'inline-flex' }}>
              {owner
                ? <OwnerChip role={next.ownerRole} label={owner} title={`${OWNER_LABEL[next.ownerRole]} (${next.ownerName})`} />
                : <OwnerChip role={next.ownerRole} you={next.ownerRole === 'hr'} />}
            </span>
          )}
          {next?.dueAt && <span className={`due${late ? ' late' : ''}`}><ClockIcon /> {dueText(next.dueAt, late)}</span>}
          {flag && <span style={{ marginLeft: 'auto' }}><FlagPill flag={flag} card={card} /></span>}
        </div>
      </button>
    </div>
  );
}

const CLOSED_LABEL: Record<ClosedJourneyRow['status'], string> = { declined: 'Declined', expired: 'Offer expired', not_joining: 'Not joining' };

/** The Closed tab: one row per offer that ended before joining; a row opens the panel with the outcome. */
function ClosedList({ rows, error, searching, openId, onOpen, onRetry }: { rows: ClosedJourneyRow[] | null; error: string; searching: boolean; openId: string; onOpen: (id: string) => void; onRetry: () => void }) {
  if (error && !rows) return <LoadError text={error} onRetry={onRetry} />;
  if (!rows) return <div style={{ padding: 16 }}><Skeleton w="60%" h={12} /></div>;
  if (!rows.length) return <div className="pd-note">{searching ? 'No closed offer matches this search.' : 'No closed offers. Declined, expired and not-joining offers show here.'}</div>;
  return (
    <div role="list" style={{ display: 'grid', background: 'var(--surface-2)', border: '1px solid var(--line)', borderRadius: 18, padding: 6, gap: 6 }}>
      {rows.map((r) => (
        <button key={r.journeyId} type="button" role="listitem" data-journey-card={r.journeyId} onClick={() => onOpen(r.journeyId)} aria-pressed={openId === r.journeyId}
          className={`ob-card${openId === r.journeyId ? ' on' : ''}`}
          style={{ gridTemplateColumns: 'minmax(0, 2fr) auto minmax(0, 2fr) auto', gap: 12, alignItems: 'center', padding: '10px 14px' }}>
          <span className="ob-who" style={{ display: 'block' }}>
            <b>{r.name}</b>
            <span>{[r.designation, r.department].filter(Boolean).join(' · ')}</span>
          </span>
          <span className="ob-type">{CLOSED_LABEL[r.status] ?? r.status}</span>
          <span style={{ fontSize: 12.5, color: 'var(--ink-2)', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.closedReason}>{r.closedReason ?? ''}</span>
          <span style={{ fontSize: 12, color: 'var(--ink-3)', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>{r.closedAt ? longDay(r.closedAt.slice(0, 10)) : ''}</span>
        </button>
      ))}
    </div>
  );
}

function BoardSkeleton({ columns }: { columns: number }) {
  return (
    <SkeletonFrame style={{ display: 'grid', gridTemplateColumns: `repeat(${columns}, minmax(200px, 1fr))`, gap: 12, overflow: 'hidden' }}>
      {Array.from({ length: columns }, (_, i) => (
        <div key={i} style={{ background: 'var(--surface-2)', borderRadius: 18, padding: 10, display: 'grid', gap: 8, alignContent: 'start', minHeight: 560 }}>
          <Skeleton w="50%" h={10} />
          {Array.from({ length: 2 + (i % 2) }, (_, n) => (
            <div key={n} style={{ background: 'var(--surface)', borderRadius: 14, padding: 12, display: 'grid', gap: 8 }}>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}><Skeleton w={32} h={36} r={10} /><Skeleton w="60%" h={11} /></div>
              <Skeleton w="80%" h={10} />
              <Skeleton w="40%" h={18} r={99} />
            </div>
          ))}
        </div>
      ))}
    </SkeletonFrame>
  );
}
