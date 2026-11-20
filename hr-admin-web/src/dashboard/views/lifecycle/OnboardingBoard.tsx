// H1 · Onboarding: every joiner as a card, from the offer to confirmation (the
// board design of 18 Nov). One white panel holds the phase tabs and the columns.
// Each tab is a phase (Pre-boarding, First week, Probation) and its columns are
// the steps; Closed lists the offers that ended before joining. Search keeps the
// board whole: a match moves to the top of its column, and a name that is in
// another tab says which. A column shows 15 cards; View all opens the column (or
// the whole tab) as a list with filters. A card opens the joiner panel (H1b).
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useStore } from '../../store';
import { canSeePay } from '../../access';
import { Card, LoadError, PageActions, Pill, SearchInput, Skeleton, SkeletonFrame } from '../../ui';
import { IconChevronLeft, IconDownload, IconPlus, IconSearch } from '../../icons';
import { downloadCsv } from '../../export';
import { getBoard, getClosedJourneys, isNotAvailable } from '../../../services/lifecycle';
import type { BoardCard, BoardDTO, BoardTab, ClosedJourneyRow, JourneyFlag } from '../../../services/lifecycle';
import { FlagPill, NotSwitchedOn, OwnerChip, PlantFace } from './shared';
import { ClockIcon } from './offboarding/parts';
import { DOCS_OPEN_KEY, OWNER_LABEL, daysTo, dueText, errText, firstName, flagLabel, inputStyle, labelStyle, longDay, shortDay } from './format';
import { OFFER_STATES, TAB_LABELS, TONE, columnsOf, offerOf, pctColour, pctOf, weekOf } from './boardModel';
import type { ColumnDef, OfferState, Tone } from './boardModel';
import { refreshOnboardingBadge } from '../../onboardingBadge';
import { JoinerPanel } from './JoinerPanel';
import '../people.css';
// The two boards share one look: lanes, cards and the filter row come from the offboarding board's sheet.
import './offboarding/offboarding.css';

type View = BoardTab | 'closed';
const TABS: BoardTab[] = ['pre_boarding', 'first_week', 'probation'];
const VIEWS: View[] = [...TABS, 'closed'];
const TAB_NOTES: Record<View, string> = {
  pre_boarding: 'Offer, confirmation, employee profile, joining day',
  first_week: 'Joining day to Day 7',
  probation: 'Monthly, until confirmation',
  closed: 'Offers declined, expired or not joining',
};
// The one flag a card shows (the design draws one): the most telling first; Late last, as the red due date already says it.
const FLAG_ORDER: JourneyFlag[] = ['needs_you', 'quiet', 'joining_risk', 'expires_soon', 'decide', 'needs_attention', 'due_soon', 'late', 'all_set', 'confirmed', 'done'];
const TAB_KEY = 'sowaka.onboarding.tab';
// The plant's tile on a card, by phase (the design's tints, in the system's colours).
const TINT: Record<BoardTab, string> = { pre_boarding: 'var(--surface-2)', first_week: 'var(--accent-soft)', probation: 'var(--ok-bg)' };
const PER_COLUMN = 15;
const CLOSED_LABEL: Record<ClosedJourneyRow['status'], string> = { declined: 'Declined', expired: 'Offer expired', not_joining: 'Not joining' };
const CLOSED_TONE: Record<ClosedJourneyRow['status'], Tone> = { declined: TONE.wait, expired: TONE.risk, not_joining: TONE.wait };

/** A card in its tab, with the step (column) it sits in. */
interface Placed { card: BoardCard; tab: BoardTab; col: number }

const hay = (c: { name: string; department?: string; designation?: string; managerName?: string }) =>
  [c.name, c.department, c.designation, c.managerName].filter(Boolean).join(' ').toLowerCase();

/** The list view's filters (View all). */
interface ListFilters { col: string; q: string; offer: OfferState | 'all' | 'revised'; from: string; to: string }
const NO_FILTERS: Omit<ListFilters, 'col'> = { q: '', offer: 'all', from: '', to: '' };

export function OnboardingBoard() {
  const { user, setView: goTo } = useStore();
  const pay = canSeePay(user);
  const [view, setViewRaw] = useState<View>(() => {
    try { const t = sessionStorage.getItem(TAB_KEY) as View | null; return t && VIEWS.includes(t) ? t : 'pre_boarding'; } catch { return 'pre_boarding'; }
  });
  const setView = (t: View) => { setViewRaw(t); try { sessionStorage.setItem(TAB_KEY, t); } catch { /* not remembered */ } };
  const [search, setSearch] = useState('');
  const [boards, setBoards] = useState<Partial<Record<BoardTab, BoardDTO>>>({});
  const [closedRows, setClosedRows] = useState<ClosedJourneyRow[] | null>(null);
  const [error, setError] = useState('');
  const [closedError, setClosedError] = useState('');
  const [off, setOff] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [openId, setOpenId] = useState('');
  const [list, setList] = useState<ListFilters | null>(null);
  // New offer letter opens Documents › Offer letter for a new joiner (H3): the form beside the letter.
  const newOffer = () => {
    try { sessionStorage.setItem(DOCS_OPEN_KEY, JSON.stringify({ kind: 'offer', newOffer: true })); } catch { /* Documents opens on the offer letter anyway */ }
    goTo('lifecycle_documents');
  };

  // Every tab at once (the server keeps one board in memory, so the three are one read): switching
  // tabs is instant, and a search can say which other tab a name is in.
  useEffect(() => {
    let live = true;
    setError('');
    Promise.all(TABS.map((tab) => getBoard({ tab })))
      .then((all) => { if (live) { setBoards(Object.fromEntries(all.map((b) => [b.tab, b]))); setOff(false); } })
      .catch((e) => {
        if (!live) return;
        if (isNotAvailable(e)) setOff(true);
        else setError(errText(e, 'Could not load the board'));
      });
    setClosedError('');
    getClosedJourneys()
      .then((rows) => { if (live) setClosedRows(rows); })
      .catch((e) => { if (live) setClosedError(errText(e, 'Could not load closed offers')); });
    return () => { live = false; };
  }, [attempt]);

  const reload = useCallback(() => { setAttempt((n) => n + 1); refreshOnboardingBadge(); }, []);
  // Closing the panel puts focus back on the card (or row) that opened it.
  const closePanel = () => {
    const id = openId;
    setOpenId('');
    requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-journey-card="${id}"]`)?.focus());
  };
  const pick = (v: View) => { setView(v); setList(null); setOpenId(''); };

  // Every card, placed in the design's columns.
  const placed = useMemo(() => {
    const out: Placed[] = [];
    for (const tab of TABS) {
      const cols = columnsOf(tab);
      for (const column of boards[tab]?.columns ?? []) {
        const col = cols.findIndex((c) => c.from.includes(column.key));
        if (col < 0) continue;
        for (const card of column.cards) out.push({ card, tab, col });
      }
    }
    return out;
  }, [boards]);
  const loaded = TABS.every((t) => boards[t]);
  const counts: Partial<Record<View, number>> = {
    ...(loaded ? Object.fromEntries(TABS.map((t) => [t, placed.filter((p) => p.tab === t).length])) : {}),
    ...(closedRows ? { closed: closedRows.length } : {}),
  };

  const qq = search.trim().toLowerCase();
  const hit = (c: { name: string; department?: string; designation?: string; managerName?: string }) => Boolean(qq) && hay(c).includes(qq);
  const tab: BoardTab | null = view === 'closed' ? null : view;
  const inTab = tab ? placed.filter((p) => p.tab === tab) : [];

  const exportBoard = () => {
    if (!tab) return;
    const cols = columnsOf(tab);
    downloadCsv<Placed>(`onboarding-${tab.replace('_', '-')}`, [
      { header: 'Name', value: (p) => p.card.name },
      { header: 'Designation', value: (p) => p.card.designation ?? '' },
      { header: 'Department', value: (p) => p.card.department ?? '' },
      { header: 'Manager', value: (p) => p.card.managerName ?? '' },
      { header: 'Joining date', value: (p) => p.card.tj ?? '' },
      { header: 'Step', value: (p) => cols[p.col]?.label ?? '' },
      { header: 'Offer sent', value: (p) => (p.card.offerSentAt ?? '').slice(0, 10) },
      { header: 'Offer', value: (p) => offerOf(p.card).label },
      { header: 'Next step', value: (p) => p.card.waitingOn[0]?.title ?? '' },
      { header: 'Waiting on', value: (p) => (p.card.waitingOn[0] ? `${OWNER_LABEL[p.card.waitingOn[0].ownerRole]}${p.card.waitingOn[0].ownerName ? ` (${p.card.waitingOn[0].ownerName})` : ''}` : '') },
      { header: 'Due', value: (p) => (p.card.waitingOn[0]?.dueAt ?? '').slice(0, 10) },
      { header: 'Flags', value: (p) => p.card.flags.map((f) => flagLabel(f, p.card)).join('; ') },
      { header: 'Tasks done', value: (p) => `${p.card.progress.done} of ${p.card.progress.total}` },
    ], inTab);
  };

  if (off) return <NotSwitchedOn />;

  return (
    <div className="pd-form" style={{ animation: 'fade .3s ease both' }}>
      <PageActions>
        <button type="button" className="pd-btn" onClick={exportBoard} disabled={!inTab.length}><IconDownload stroke="currentColor" /> Export</button>
        <button type="button" className="pd-btn primary" onClick={newOffer} disabled={!pay} title={pay ? undefined : 'Only people with payroll access can set the CTC on an offer'}><IconPlus /> New offer letter</button>
      </PageActions>

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

        {view === 'closed' ? (
          <ClosedTable rows={closedRows} error={closedError} q={qq} search={search} onSearch={setSearch} openId={openId} onOpen={setOpenId} onRetry={reload} />
        ) : error && !loaded ? (
          <LoadError text={error} onRetry={reload} />
        ) : !loaded || !tab ? (
          <BoardSkeleton columns={4} />
        ) : list ? (
          <ListView tab={tab} cards={inTab} filters={list} onFilters={setList} onBack={() => setList(null)} openId={openId} onOpen={setOpenId} />
        ) : (
          <>
            {error && <LoadError compact text={error} onRetry={reload} />}
            <div className="ob-filters">
              <SearchInput value={search} onChange={setSearch} placeholder="Search employee" width={280} />
              {qq && <SearchNote here={inTab.filter((p) => hit(p.card)).length} elsewhere={[
                ...TABS.filter((t) => t !== tab && placed.some((p) => p.tab === t && hit(p.card))),
                ...(closedRows?.some((r) => hit(r)) ? ['closed' as const] : []),
              ]} tab={tab} q={search.trim()} onTab={pick} />}
            </div>
            {inTab.length === 0 && tab === 'pre_boarding' && (
              <div className="pd-note" style={{ marginBottom: 14 }}>No joiners yet. Start with <b>New offer letter</b>: the candidate gets the offer by email and accepts it on their portal, and their card moves along this board from there.</div>
            )}
            <div className="ob-lanes scry" style={{ gridAutoColumns: 'minmax(230px, 1fr)' }}>
              {columnsOf(tab).map((col, ci) => {
                const all = inTab.filter((p) => p.col === ci);
                // A match moves to the top of its column; the rest keep the server's order (most urgent first).
                const shown = [...all.filter((p) => hit(p.card)), ...all.filter((p) => !hit(p.card))].slice(0, PER_COLUMN);
                const viewAll = () => setList({ col: String(ci), ...NO_FILTERS });
                return (
                  <section key={col.key} className="ob-lane" aria-label={col.label} style={{ minHeight: 520, maxHeight: 'calc(100vh - 290px)', gap: 8 }}>
                    <div className="ob-lane-h" style={{ gap: 8, justifyContent: 'flex-start' }}>
                      <span>{col.label}</span><b>{all.length}</b>
                      <span style={{ flex: 1 }} />
                      {all.length > 0 && (
                        <button type="button" onClick={viewAll} aria-label={`View all ${all.length} in ${col.label}`}
                          style={{ border: 0, background: 'none', padding: '2px 4px', font: 'inherit', fontSize: 12, fontWeight: 500, letterSpacing: 0, textTransform: 'none', color: 'var(--accent-ink)', cursor: 'pointer' }}>View all</button>
                      )}
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, overflowY: 'auto', flex: 1, padding: 2, margin: '0 -2px' }}>
                      {shown.length === 0 && <div className="ob-empty">Nobody here</div>}
                      {shown.map((p) => (
                        <JoinerCard key={p.card.journeyId} card={p.card} tab={tab} col={ci} tint={TINT[tab]} hit={hit(p.card)}
                          selected={openId === p.card.journeyId} onOpen={() => setOpenId(p.card.journeyId)} />
                      ))}
                    </div>
                    {all.length > PER_COLUMN && (
                      <button type="button" onClick={viewAll}
                        style={{ flex: 'none', height: 34, border: '1px dashed var(--line-2)', background: 'var(--surface)', borderRadius: 10, font: 'inherit', fontSize: 12, fontWeight: 500, color: 'var(--accent-ink)', cursor: 'pointer' }}>
                        Showing {PER_COLUMN} of {all.length} · View all
                      </button>
                    )}
                  </section>
                );
              })}
            </div>
          </>
        )}
      </Card>

      {openId && <JoinerPanel journeyId={openId} onClose={closePanel} onChanged={reload} />}
    </div>
  );
}

/** The line beside the search: how many matched here, or which tab the name is in instead. */
function SearchNote({ here, elsewhere, tab, q, onTab }: { here: number; elsewhere: View[]; tab: BoardTab; q: string; onTab: (v: View) => void }) {
  if (here) return <span style={{ fontSize: 12.5, color: 'var(--accent-ink)' }}>{here} {here === 1 ? 'match, moved to the top of its column' : 'matches, moved to the top of their columns'}</span>;
  return (
    <span style={{ fontSize: 12.5, color: 'var(--bad)' }}>
      {elsewhere.length ? (
        <>Not in {TAB_LABELS[tab]}. Found in {elsewhere.map((t, i) => (
          <span key={t}>{i > 0 && ', '}<button type="button" onClick={() => onTab(t)} style={{ border: 0, background: 'none', padding: 0, font: 'inherit', fontWeight: 500, color: 'var(--accent-ink)', cursor: 'pointer' }}>{TAB_LABELS[t]}</button></span>
        ))}</>
      ) : <>No employee called “{q}”</>}
    </span>
  );
}

/** A card's own rows and flag on Pre-boarding: Joins, then Offer sent / Confirmed / In N days. */
function preRows(card: BoardCard, col: number): { rows: [string, string][]; flag: { label: string; tone: Tone } | null; pct: number | null } {
  const joins: [string, string] = ['Joins', card.tj ? shortDay(card.tj) : 'Not set'];
  if (col === 0) return { rows: [joins, ['Offer sent', card.offerSentAt ? shortDay(card.offerSentAt) : 'Not sent']], flag: offerOf(card), pct: null };
  const confirmed: [string, string] = ['Confirmed', card.acceptedAt ? shortDay(card.acceptedAt) : '—'];
  if (col === 1) return { rows: [joins, confirmed], flag: { label: 'Portal not sent', tone: TONE.warn }, pct: null };
  if (col === 2) {
    const pct = pctOf(card.progress);
    const flag = card.flags.includes('quiet') ? { label: flagLabel('quiet', card), tone: TONE.risk }
      : card.flags.includes('needs_you') ? { label: flagLabel('needs_you'), tone: TONE.risk }
        : pct === 0 ? { label: 'Profile not started', tone: TONE.wait } : null;
    return { rows: [joins, confirmed], flag, pct };
  }
  const n = card.tj ? daysTo(card.tj) : null;
  const w = weekOf(card.tj);
  const flag = card.flags.includes('joining_risk') ? { label: flagLabel('joining_risk'), tone: TONE.risk }
    : w ? { label: w, tone: w === 'This week' || w === 'Today' ? TONE.warn : TONE.soon } : null;
  return { rows: [joins, ['In', n === null ? '—' : n <= 0 ? 'Today' : `${n} day${n === 1 ? '' : 's'}`]], flag, pct: null };
}

function JoinerCard({ card, tab, col, tint, hit, selected, onOpen }: { card: BoardCard; tab: BoardTab; col: number; tint: string; hit: boolean; selected: boolean; onOpen: () => void }) {
  const pre = tab === 'pre_boarding';
  const sub = pre ? card.department ?? card.designation : [card.designation, card.department].filter(Boolean).join(' · ');
  const tip = [card.dayLabel, ...card.flags.map((f) => flagLabel(f, card)), card.progress.total ? `${card.progress.done} of ${card.progress.total} tasks done` : ''].filter(Boolean).join(' · ');
  return (
    <div className="ob-card-wrap" style={{ flex: 'none' }}>
      <button type="button" className={`ob-card${selected || hit ? ' on' : ''}`} onClick={onOpen} aria-pressed={selected} data-journey-card={card.journeyId} title={tip} style={{ gap: 10 }}>
        <div className="ob-who">
          <span aria-hidden style={{ width: 32, height: 36, borderRadius: 10, background: tint, display: 'flex', alignItems: 'flex-end', justifyContent: 'center', flex: 'none', overflow: 'hidden' }}><PlantFace plant={card.plant} size={card.photoUrl ? 32 : 26} name={card.name} photoUrl={card.photoUrl} /></span>
          <div style={{ minWidth: 0 }}><b>{card.name}</b>{sub && <span>{sub}</span>}</div>
        </div>
        {pre ? <PreBody card={card} col={col} /> : <StepBody card={card} />}
      </button>
    </div>
  );
}

function PreBody({ card, col }: { card: BoardCard; col: number }) {
  const { rows, flag, pct } = preRows(card, col);
  return (
    <>
      <dl style={{ display: 'grid', gridTemplateColumns: 'auto minmax(0, 1fr)', gap: '4px 10px', margin: 0, fontSize: 12 }}>
        {rows.map(([k, v]) => (
          <div key={k} style={{ display: 'contents' }}>
            <dt style={{ color: 'var(--ink-3)' }}>{k}</dt>
            <dd style={{ margin: 0, color: 'var(--ink-2)', fontWeight: 500, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{v}</dd>
          </div>
        ))}
      </dl>
      {pct !== null && (
        <span style={{ display: 'grid', gap: 5 }}>
          <span style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11.5 }}>
            <span style={{ color: 'var(--ink-3)' }}>Employee profile</span><b style={{ color: pctColour(pct), fontWeight: 600 }}>{pct}%</b>
          </span>
          <span style={{ height: 6, borderRadius: 99, background: 'var(--line)', overflow: 'hidden' }}><i style={{ display: 'block', height: '100%', width: `${pct}%`, borderRadius: 99, background: pctColour(pct) }} /></span>
        </span>
      )}
      {!!card.optionalWaiting && (
        <div style={{ fontSize: 12, color: 'var(--ink-3)' }}>{card.optionalWaiting === 1 ? 'Optional document waiting' : `${card.optionalWaiting} optional documents waiting`}</div>
      )}
      {flag && <span><Pill dot={false} label={flag.label} tone={flag.tone} fontSize={11} padding="2px 9px" /></span>}
    </>
  );
}

/** First week and Probation: the next step, who it waits on, when, and the one flag. */
function StepBody({ card }: { card: BoardCard }) {
  const next = card.waitingOn[0];
  // The lead step's own lateness: a card flagged late for an older task can lead with a step not yet due.
  const late = Boolean(next?.dueAt) && (Boolean(next?.late) || dueText(next?.dueAt).endsWith('late'));
  const flag = FLAG_ORDER.find((f) => card.flags.includes(f));
  // Who it waits on, by first name (the chip's colour says the role); HR's own steps read "HR · you".
  const owner = next ? (next.ownerRole === 'hr' ? undefined : next.ownerName ? firstName(next.ownerName) : undefined) : undefined;
  return (
    <>
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
        {flag && <span style={{ marginLeft: 'auto' }}><FlagPill flag={flag} card={card} dot={false} /></span>}
      </div>
    </>
  );
}

/** View all: a column (or the whole tab) as a table, with search, step, offer and joining-date filters. */
function ListView({ tab, cards, filters, onFilters, onBack, openId, onOpen }: {
  tab: BoardTab; cards: Placed[]; filters: ListFilters; onFilters: (f: ListFilters) => void; onBack: () => void; openId: string; onOpen: (id: string) => void;
}) {
  const cols: ColumnDef[] = columnsOf(tab);
  const set = (patch: Partial<ListFilters>) => onFilters({ ...filters, ...patch });
  const lq = filters.q.trim().toLowerCase();
  const rows = cards.filter((p) => (filters.col === 'all' || String(p.col) === filters.col)
    && (!lq || hay(p.card).includes(lq))
    && (filters.offer === 'all' || (filters.offer === 'revised' ? (p.card.offerVersion ?? 1) > 1 : offerOf(p.card).state === filters.offer))
    && (!filters.from || (Boolean(p.card.tj) && p.card.tj! >= filters.from)) && (!filters.to || (Boolean(p.card.tj) && p.card.tj! <= filters.to)))
    .sort((a, b) => (a.card.tj ?? '9999').localeCompare(b.card.tj ?? '9999') || a.card.name.localeCompare(b.card.name));
  const filtered = Boolean(filters.q || filters.from || filters.to || filters.offer !== 'all' || filters.col !== 'all');
  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <button type="button" className="pd-btn sm" onClick={onBack}><IconChevronLeft size={15} stroke="currentColor" />Back to board</button>
        <b style={{ fontSize: 15, fontWeight: 600 }}>{TAB_LABELS[tab]} · {filters.col === 'all' ? 'everyone' : cols[Number(filters.col)]?.label}</b>
        <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>{rows.length} {rows.length === 1 ? 'person' : 'people'}</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 10, flexWrap: 'wrap' }}>
        <label style={labelStyle}>Search
          <span style={{ ...inputStyle, display: 'flex', alignItems: 'center', gap: 6, width: 240, height: 40 }}>
            <IconSearch size={15} stroke="var(--ink-3)" />
            <input value={filters.q} onChange={(e) => set({ q: e.target.value })} placeholder="Name or department" className="ds-inp-bare" aria-label="Search by name or department"
              style={{ border: 0, outline: 'none', background: 'none', flex: 1, minWidth: 0, font: 'inherit', fontSize: 13, color: 'var(--ink)', height: '100%', padding: 0 }} />
          </span>
        </label>
        <label style={{ ...labelStyle, width: 190 }}>Step
          <select value={filters.col} onChange={(e) => set({ col: e.target.value })} style={{ ...inputStyle, cursor: 'pointer' }}>
            <option value="all">All steps</option>
            {cols.map((c, i) => <option key={c.key} value={String(i)}>{c.label}</option>)}
          </select>
        </label>
        <label style={{ ...labelStyle, width: 170 }}>Offer
          <select value={filters.offer} onChange={(e) => set({ offer: e.target.value as ListFilters['offer'] })} style={{ ...inputStyle, cursor: 'pointer' }}>
            <option value="all">All offers</option>
            {OFFER_STATES.map((o) => <option key={o} value={o}>{o}</option>)}
            <option value="revised">Revised</option>
          </select>
        </label>
        <DateField label="Joining from" value={filters.from} max={filters.to || undefined} placeholder="01 Dec 2026" onChange={(from) => set({ from })} />
        <DateField label="Joining to" value={filters.to} min={filters.from || undefined} placeholder="31 Jan 2027" onChange={(to) => set({ to })} />
        {filtered && <button type="button" className="pd-btn sm" style={{ marginBottom: 5 }} onClick={() => onFilters({ col: 'all', ...NO_FILTERS })}>Clear filters</button>}
      </div>
      <div style={{ overflowX: 'auto', border: '1px solid var(--line)', borderRadius: 16 }}>
        <table className="pd-t pd-t--boxed" style={{ minWidth: 860 }}>
          <thead><tr><th>Employee</th><th>Department</th><th>Step</th><th>Joining date</th><th>Offer sent</th><th>Offer</th><th aria-label="Open" /></tr></thead>
          <tbody>
            {rows.map((p) => {
              const o = offerOf(p.card);
              const label = o.label + ((p.card.offerVersion ?? 1) > 1 ? ` · v${p.card.offerVersion}` : '');
              return (
                <tr key={p.card.journeyId} className="pd-click" onClick={() => onOpen(p.card.journeyId)} aria-selected={openId === p.card.journeyId}>
                  <td><b>{p.card.name}</b>{p.card.designation && <div style={{ fontSize: 12, color: 'var(--ink-3)' }}>{p.card.designation}</div>}</td>
                  <td>{p.card.department ?? '—'}</td>
                  <td>{cols[p.col]?.label}</td>
                  <td className="num" style={{ whiteSpace: 'nowrap' }}>{p.card.tj ? longDay(p.card.tj) : '—'}</td>
                  <td className="num" style={{ whiteSpace: 'nowrap' }}>{p.card.offerSentAt ? shortDay(p.card.offerSentAt) : '—'}</td>
                  <td><Pill dot={false} label={label} tone={o.tone} fontSize={11} padding="2px 9px" /></td>
                  <td className="r"><button type="button" className="pd-btn sm" data-journey-card={p.card.journeyId} onClick={(e) => { e.stopPropagation(); onOpen(p.card.journeyId); }}>Open</button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!rows.length && <p style={{ margin: 0, padding: 28, textAlign: 'center', color: 'var(--ink-3)' }}>No one matches these filters.</p>}
      </div>
    </div>
  );
}

const boxDate = (key: string) => new Date(`${key}T00:00:00Z`).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });

/** A joining-date filter: the day as "01 Dec 2026" (grey example until one is picked); a click opens the browser's date picker. */
function DateField({ label, value, placeholder, min, max, onChange }: { label: string; value: string; placeholder: string; min?: string; max?: string; onChange: (v: string) => void }) {
  return (
    <label style={{ ...labelStyle, width: 150 }}>{label}
      <span style={{ ...inputStyle, position: 'relative', display: 'flex', alignItems: 'center', height: 40, color: value ? 'var(--ink)' : 'var(--ink-4)', fontVariantNumeric: 'tabular-nums' }}>
        {value ? boxDate(value) : placeholder}
        <input type="date" value={value} min={min} max={max} aria-label={label} onChange={(e) => onChange(e.target.value)}
          onClick={(e) => { try { (e.currentTarget as HTMLInputElement & { showPicker?: () => void }).showPicker?.(); } catch { /* the field still takes typing */ } }}
          style={{ position: 'absolute', inset: 0, opacity: 0, width: '100%', height: '100%', border: 0, padding: 0, cursor: 'pointer' }} />
      </span>
    </label>
  );
}

/** The Closed tab: one row per offer that ended before joining; a row opens the panel with the outcome. */
function ClosedTable({ rows, error, q, search, onSearch, openId, onOpen, onRetry }: {
  rows: ClosedJourneyRow[] | null; error: string; q: string; search: string; onSearch: (v: string) => void; openId: string; onOpen: (id: string) => void; onRetry: () => void;
}) {
  if (error && !rows) return <LoadError text={error} onRetry={onRetry} />;
  if (!rows) return <div style={{ padding: 16 }}><Skeleton w="60%" h={12} /></div>;
  const shown = q ? rows.filter((r) => hay(r).includes(q)) : rows;
  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <div className="ob-filters" style={{ marginBottom: 0 }}><SearchInput value={search} onChange={onSearch} placeholder="Search closed offers" width={280} /></div>
      {!shown.length ? (
        <div className="pd-note">{q ? 'No closed offer matches this search.' : 'No closed offers. Declined, expired and not-joining offers show here.'}</div>
      ) : (
        <div style={{ overflowX: 'auto', border: '1px solid var(--line)', borderRadius: 16 }}>
          <table className="pd-t pd-t--boxed" style={{ minWidth: 760 }}>
            <thead><tr><th>Employee</th><th>Status</th><th>Reason</th><th>Offer sent</th><th>Closed on</th></tr></thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.journeyId} className="pd-click" data-journey-card={r.journeyId} tabIndex={0} aria-selected={openId === r.journeyId}
                  onClick={() => onOpen(r.journeyId)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(r.journeyId); } }}>
                  <td><b>{r.name}</b><div style={{ fontSize: 12, color: 'var(--ink-3)' }}>{[r.designation, r.department].filter(Boolean).join(' · ')}</div></td>
                  <td><Pill dot={false} label={CLOSED_LABEL[r.status] ?? r.status} tone={CLOSED_TONE[r.status] ?? TONE.wait} fontSize={11} padding="2px 9px" /></td>
                  <td style={{ color: 'var(--ink-2)' }}>{r.closedReason ?? '—'}</td>
                  <td className="num" style={{ whiteSpace: 'nowrap' }}>{r.offerSentAt ? shortDay(r.offerSentAt) : '—'}</td>
                  <td className="num" style={{ whiteSpace: 'nowrap' }}>{r.closedAt ? longDay(r.closedAt) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function BoardSkeleton({ columns }: { columns: number }) {
  return (
    <SkeletonFrame style={{ display: 'grid', gridTemplateColumns: `repeat(${columns}, minmax(200px, 1fr))`, gap: 12, overflow: 'hidden' }}>
      {Array.from({ length: columns }, (_, i) => (
        <div key={i} style={{ background: 'var(--surface-2)', borderRadius: 18, padding: 10, display: 'grid', gap: 8, alignContent: 'start', minHeight: 520 }}>
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
