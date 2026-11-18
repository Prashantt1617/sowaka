// H1 · Onboarding: every joiner as a card, from the offer to confirmation.
// Each tab is a phase (Pre-boarding, First week, Probation) and its columns
// are the steps. Quick filters dim the cards that do not match; search and the
// joining-date range narrow the board on the server. A card opens the joiner
// panel (H1b); New offer letter starts an offer.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useStore } from '../../store';
import { canSeePay } from '../../access';
import { DateRange, LoadError, PageActions, SearchInput, Skeleton, SkeletonFrame, StatusTabs } from '../../ui';
import { IconDownload } from '../../icons';
import { downloadCsv } from '../../export';
import { getBoard, getClosedJourneys, isNotAvailable } from '../../../services/lifecycle';
import type { BoardCard, BoardDTO, BoardFilter, BoardTab, ClosedJourneyRow } from '../../../services/lifecycle';
import { FlagPill, NotSwitchedOn, NudgeButton, OwnerChip, Plant } from './shared';
import { OWNER_LABEL, dueText, errText, firstName, flagLabel, longDay } from './format';
import { refreshOnboardingBadge } from '../../onboardingBadge';
import { JoinerPanel } from './JoinerPanel';
import { OfferWizard } from './OfferDialogs';
import '../people.css';

const TABS: BoardTab[] = ['pre_boarding', 'first_week', 'probation'];
const TAB_LABELS: Record<BoardTab, string> = { pre_boarding: 'Pre-boarding', first_week: 'First week', probation: 'Probation' };
const TAB_NOTES: Record<BoardTab, string> = {
  pre_boarding: 'From the offer to the joining day',
  first_week: 'Joining day to Day 7',
  probation: 'Monthly, until confirmation',
};
// The spec's three first (6Zs §7.1: Waiting on me · Late · Needs attention), then the finer ones.
const FILTERS: [BoardFilter, string][] = [
  ['mine', 'Waiting on me'], ['late', 'Late'], ['needs_attention', 'Needs attention'],
];
const MORE_FILTERS: [BoardFilter, string][] = [
  ['needs_you', 'Needs you'], ['quiet', 'Quiet'], ['joining_risk', 'Joining risk'], ['due_soon', 'Due soon'],
];
const TAB_KEY = 'sowaka.onboarding.tab';

/** Whether a card answers a quick filter. Waiting on me = a step that waits on HR. */
function matches(card: BoardCard, f: BoardFilter): boolean {
  if (f === 'mine') return card.waitingOn.some((w) => w.ownerRole === 'hr' || w.ownerRole === 'hr_manager');
  return card.flags.includes(f);
}

export function OnboardingBoard() {
  const { user } = useStore();
  const pay = canSeePay(user);
  const [tab, setTabRaw] = useState<BoardTab>(() => {
    try { const t = sessionStorage.getItem(TAB_KEY) as BoardTab | null; return t && TABS.includes(t) ? t : 'pre_boarding'; } catch { return 'pre_boarding'; }
  });
  const setTab = (t: BoardTab) => { setTabRaw(t); try { sessionStorage.setItem(TAB_KEY, t); } catch { /* not remembered */ } };
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [filter, setFilter] = useState<BoardFilter | null>(null);
  const [board, setBoard] = useState<BoardDTO | null>(null);
  const [error, setError] = useState('');
  const [off, setOff] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [openId, setOpenId] = useState('');
  const [newOffer, setNewOffer] = useState(false);
  // The Closed view: offers that ended before joining (off the board).
  const [showClosed, setShowClosed] = useState(false);
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
  // H1c shows the spec's three quick filters only; the finer ones stay on the other tabs.
  const chips = tab === 'probation' ? FILTERS : [...FILTERS, ...MORE_FILTERS];
  // A finer filter left on from another tab would dim cards with no chip to turn it off.
  useEffect(() => { if (filter && !chips.some(([f]) => f === filter)) setFilter(null); }, [tab]); // eslint-disable-line react-hooks/exhaustive-deps
  const shownTab = board?.tab === tab ? board : null;
  const cards = useMemo(() => shownTab?.columns.flatMap((c) => c.cards) ?? [], [shownTab]);
  const matching = filter ? cards.filter((c) => matches(c, filter)).length : cards.length;

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
        <button type="button" className="pd-btn" onClick={exportBoard} disabled={!cards.length}><IconDownload stroke="currentColor" /> Export</button>
        <button type="button" className="pd-btn primary" onClick={() => setNewOffer(true)} disabled={!pay} title={pay ? undefined : 'Only people with payroll access can set the CTC on an offer'}>New offer letter</button>
      </PageActions>

      <div className="pd-head" style={{ marginBottom: 16 }}>
        <p className="pd-lead">Every joiner as a card, from offer to confirmation. Each tab is one phase; columns are its steps.</p>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
        <StatusTabs<BoardTab> options={TABS} active={showClosed ? ('' as BoardTab) : tab} onSelect={(t) => { setTab(t); setShowClosed(false); setOpenId(''); }} labels={TAB_LABELS} counts={board?.counts} />
        <button type="button" aria-pressed={showClosed} className={`pd-chip sm${showClosed ? ' on' : ''}`} onClick={() => { setShowClosed(!showClosed); setOpenId(''); }}>Closed</button>
        <span style={{ fontSize: 12.5, color: 'var(--ink-3)' }}>{showClosed ? 'Offers declined, expired or not joining' : TAB_NOTES[tab]}</span>
      </div>

      <div className="pd-toolbar">
        <SearchInput value={search} onChange={setSearch} placeholder={showClosed ? 'Search closed offers' : 'Search this board'} width={260} />
        <div className="pd-chips" role="group" aria-label="Quick filters">
          {!showClosed && chips.map(([f, label], i) => (
            <button key={f} type="button" aria-pressed={filter === f} className={`pd-chip sm${filter === f ? ' on' : ''}`} onClick={() => setFilter(filter === f ? null : f)}
              style={i === FILTERS.length ? { marginLeft: 8 } : undefined}>
              {label}
              {shownTab && <span className="c">{cards.filter((c) => matches(c, f)).length}</span>}
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 'auto' }}>
          <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>Joining date</span>
          <DateRange from={from} to={to} onFrom={setFrom} onTo={setTo} />
        </div>
      </div>

      {filter && shownTab && !showClosed && (
        <div style={{ fontSize: 12.5, color: 'var(--ink-3)', margin: '-6px 0 12px' }}>
          {matching} of {cards.length} match “{chips.find(([f]) => f === filter)?.[1]}”. The rest are dimmed.{' '}
          <button type="button" className="pd-lnk" onClick={() => setFilter(null)} style={{ background: 'none', border: 0, padding: 0, color: 'var(--accent-ink)', cursor: 'pointer', font: 'inherit', fontWeight: 500 }}>Show all</button>
        </div>
      )}

      {showClosed ? (
        <ClosedList rows={closedRows} error={closedError} searching={Boolean(q)} openId={openId} onOpen={setOpenId} onRetry={reload} />
      ) : error && !shownTab ? (
        <section className="pd-card"><LoadError text={error} onRetry={reload} /></section>
      ) : !shownTab ? (
        <BoardSkeleton columns={tab === 'pre_boarding' ? 5 : 4} />
      ) : (
        <>
          {error && <LoadError compact text={error} onRetry={reload} />}
          {cards.length === 0 && !q && !from && !to && tab === 'pre_boarding' && (
            <div className="pd-note" style={{ marginBottom: 14 }}>No joiners yet. Start with <b>New offer letter</b>: the candidate gets the offer by email and accepts it on their portal, and their card moves along this board from there.</div>
          )}
          <div className="scry" style={{ display: 'grid', gridAutoFlow: 'column', gridAutoColumns: 'minmax(200px, 1fr)', gap: 12, overflowX: 'auto', paddingBottom: 8, alignItems: 'start' }}>
            {shownTab.columns.map((col) => (
              <section key={col.key} aria-label={col.label} style={{ background: 'var(--surface-2)', border: '1px solid var(--line)', borderRadius: 16, padding: 10, display: 'flex', flexDirection: 'column', gap: 8, minHeight: 160 }}>
                <header style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '2px 4px 4px' }}>
                  <h2 style={{ margin: 0, fontSize: 11.5, fontWeight: 600, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--ink-2)', flex: 1 }}>{col.label}</h2>
                  <span style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--ink-3)', fontVariantNumeric: 'tabular-nums' }}>{col.cards.length}</span>
                </header>
                {col.cards.length === 0 && <div style={{ fontSize: 12.5, color: 'var(--ink-3)', textAlign: 'center', padding: '18px 6px' }}>{q || from || to ? 'Nobody matches here' : 'Nobody here'}</div>}
                {col.cards.map((c) => (
                  <JoinerCard key={c.journeyId} card={c} stage={tab === 'probation' && c.dayLabel !== col.label ? col.label : undefined} selected={openId === c.journeyId} dim={filter ? !matches(c, filter) : false} onOpen={() => setOpenId(c.journeyId)} onNudged={reload} />
                ))}
              </section>
            ))}
          </div>
        </>
      )}

      {openId && <JoinerPanel journeyId={openId} onClose={closePanel} onChanged={reload} />}
      {newOffer && (
        <OfferWizard mode="new" onClose={() => setNewOffer(false)}
          onDone={(id) => { setNewOffer(false); setTab('pre_boarding'); reload(); setOpenId(id); }} />
      )}
    </div>
  );
}

function JoinerCard({ card, stage, selected, dim, onOpen, onNudged }: { card: BoardCard; stage?: string; selected: boolean; dim: boolean; onOpen: () => void; onNudged: () => void }) {
  const next = card.waitingOn[0];
  // The lead step's own lateness: a card flagged late for an older task can lead with a step not yet due.
  const late = Boolean(next?.dueAt) && (Boolean(next?.late) || dueText(next?.dueAt).endsWith('late'));
  const role = [card.designation, card.department].filter(Boolean).join(' · ');
  const pct = card.progress.total ? Math.round((card.progress.done / card.progress.total) * 100) : 0;
  return (
    // The card opens the panel; the Nudge / Remind under it is its own button (never a button in a button).
    <div style={{
      background: 'var(--surface)', borderRadius: 14, display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', minWidth: 0,
      border: `1px solid ${selected ? 'var(--accent)' : 'var(--line)'}`,
      boxShadow: selected ? '0 0 0 3px var(--accent-soft)' : '0 1px 2px rgba(20,20,22,.04)',
      opacity: dim ? 0.35 : 1, transition: 'opacity .15s, box-shadow .15s',
    }}>
      <button type="button" onClick={onOpen} aria-pressed={selected} data-journey-card={card.journeyId}
        style={{ textAlign: 'left', font: 'inherit', color: 'inherit', cursor: 'pointer', width: '100%', minWidth: 0, background: 'none', border: 0, borderRadius: 14, padding: 12, display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 8 }}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', minWidth: 0 }}>
          <Plant plant={card.plant} size={30} />
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: 13.5, fontWeight: 600, lineHeight: 1.3, overflowWrap: 'anywhere' }}>{card.name}</div>
            {role && <div style={{ fontSize: 11.5, color: 'var(--ink-3)', lineHeight: 1.35, overflowWrap: 'anywhere' }}>{role}</div>}
          </div>
        </div>
        <div style={{ fontSize: 11.5, color: 'var(--ink-3)' }}>{stage ? `${card.dayLabel} · ${stage}` : card.dayLabel}</div>
        {next ? (
          <>
            <div style={{ fontSize: 13, color: 'var(--ink)', lineHeight: 1.4, overflowWrap: 'anywhere' }}>{next.title}</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', justifyContent: 'space-between', minWidth: 0 }}>
              {/* The joiner's own step names them by first name: the card already says who they are. */}
              <OwnerChip role={next.ownerRole} name={next.ownerRole === 'hr' ? undefined : next.ownerRole === 'employee' && next.ownerName ? firstName(next.ownerName) : next.ownerName} you={next.ownerRole === 'hr'} />
              <span style={{ fontSize: 11.5, fontWeight: late ? 600 : 400, color: late ? 'var(--bad)' : 'var(--ink-3)', whiteSpace: 'nowrap' }}>{dueText(next.dueAt, late)}</span>
            </div>
          </>
        ) : <div style={{ fontSize: 12.5, color: 'var(--ink-3)' }}>Nothing waiting</div>}
        {card.flags.length > 0 && <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>{card.flags.slice(0, 3).map((f) => <FlagPill key={f} flag={f} card={card} />)}</div>}
        {card.progress.total > 0 && (
          <div title={`${card.progress.done} of ${card.progress.total} tasks done`} style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
            <span aria-hidden style={{ flex: 1, minWidth: 0, height: 4, borderRadius: 99, background: 'var(--surface-2)', overflow: 'hidden' }}><i style={{ display: 'block', height: '100%', width: `${pct}%`, background: 'var(--ok-solid)', borderRadius: 99 }} /></span>
            <span style={{ fontSize: 11, color: 'var(--ink-3)', fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>{card.progress.done}/{card.progress.total}</span>
          </div>
        )}
      </button>
      {next?.canNudge && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '0 12px 10px', marginTop: -2 }}>
          <NudgeButton compact journeyId={card.journeyId} taskId={next.taskId} role={next.ownerRole} name={next.ownerName} done={next.nudgedToday} onDone={onNudged} />
        </div>
      )}
    </div>
  );
}

const CLOSED_LABEL: Record<ClosedJourneyRow['status'], string> = { declined: 'Declined', expired: 'Offer expired', not_joining: 'Not joining' };

/** The Closed view: one row per offer that ended before joining; a row opens the panel with the outcome. */
function ClosedList({ rows, error, searching, openId, onOpen, onRetry }: { rows: ClosedJourneyRow[] | null; error: string; searching: boolean; openId: string; onOpen: (id: string) => void; onRetry: () => void }) {
  if (error && !rows) return <section className="pd-card"><LoadError text={error} onRetry={onRetry} /></section>;
  if (!rows) return <section className="pd-card" style={{ padding: 16 }}><Skeleton w="60%" h={12} /></section>;
  if (!rows.length) return <div className="pd-note">{searching ? 'No closed offer matches this search.' : 'No closed offers. Declined, expired and not-joining offers show here.'}</div>;
  return (
    <section className="pd-card" style={{ padding: 0, overflow: 'hidden' }}>
      <div role="list" style={{ display: 'grid' }}>
        {rows.map((r, i) => (
          <button key={r.journeyId} type="button" role="listitem" data-journey-card={r.journeyId} onClick={() => onOpen(r.journeyId)} aria-pressed={openId === r.journeyId}
            style={{ textAlign: 'left', font: 'inherit', color: 'inherit', cursor: 'pointer', background: openId === r.journeyId ? 'var(--accent-soft)' : 'none', border: 0, borderTop: i ? '1px solid var(--line)' : 0, padding: '12px 16px', display: 'grid', gridTemplateColumns: 'minmax(0, 2fr) auto minmax(0, 2fr) auto', gap: 12, alignItems: 'center' }}>
            <span style={{ minWidth: 0 }}>
              <span style={{ display: 'block', fontSize: 13.5, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name}</span>
              <span style={{ display: 'block', fontSize: 11.5, color: 'var(--ink-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{[r.designation, r.department].filter(Boolean).join(' · ')}</span>
            </span>
            <span style={{ fontSize: 11.5, fontWeight: 500, padding: '2px 9px', borderRadius: 999, background: 'var(--surface-2)', color: 'var(--ink-2)', whiteSpace: 'nowrap' }}>{CLOSED_LABEL[r.status] ?? r.status}</span>
            <span style={{ fontSize: 12.5, color: 'var(--ink-2)', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.closedReason}>{r.closedReason ?? ''}</span>
            <span style={{ fontSize: 12, color: 'var(--ink-3)', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>{r.closedAt ? longDay(r.closedAt.slice(0, 10)) : ''}</span>
          </button>
        ))}
      </div>
    </section>
  );
}

function BoardSkeleton({ columns }: { columns: number }) {
  return (
    <SkeletonFrame style={{ display: 'grid', gridTemplateColumns: `repeat(${columns}, minmax(220px, 1fr))`, gap: 12, overflow: 'hidden' }}>
      {Array.from({ length: columns }, (_, i) => (
        <div key={i} style={{ background: 'var(--surface-2)', borderRadius: 16, padding: 10, display: 'grid', gap: 8 }}>
          <Skeleton w="50%" h={10} />
          {Array.from({ length: 2 + (i % 2) }, (_, n) => (
            <div key={n} style={{ background: 'var(--surface)', borderRadius: 14, padding: 12, display: 'grid', gap: 8 }}>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}><Skeleton w={30} h={30} r="50%" /><Skeleton w="60%" h={11} /></div>
              <Skeleton w="80%" h={10} />
              <Skeleton w="40%" h={18} r={99} />
            </div>
          ))}
        </div>
      ))}
    </SkeletonFrame>
  );
}
