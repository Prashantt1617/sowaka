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
import { getBoard, isNotAvailable } from '../../../services/lifecycle';
import type { BoardCard, BoardDTO, BoardFilter, BoardTab } from '../../../services/lifecycle';
import { FlagPill, NotSwitchedOn, OwnerChip, Plant } from './shared';
import { FLAG, OWNER_LABEL, dueText, errText } from './format';
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
const FILTERS: [BoardFilter, string][] = [
  ['mine', 'Waiting on me'], ['needs_you', 'Needs you'], ['late', 'Late'], ['quiet', 'Quiet'], ['joining_risk', 'Joining risk'], ['due_soon', 'Due soon'],
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

  const reload = useCallback(() => setAttempt((n) => n + 1), []);
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
    { header: 'Flags', value: (c) => c.flags.map((f) => FLAG[f]?.label ?? f).join('; ') },
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
        <StatusTabs<BoardTab> options={TABS} active={tab} onSelect={(t) => { setTab(t); setOpenId(''); }} labels={TAB_LABELS} counts={board?.counts} />
        <span style={{ fontSize: 12.5, color: 'var(--ink-3)' }}>{TAB_NOTES[tab]}</span>
      </div>

      <div className="pd-toolbar">
        <SearchInput value={search} onChange={setSearch} placeholder="Search this board" width={260} />
        <div className="pd-chips" role="group" aria-label="Quick filters">
          {FILTERS.map(([f, label]) => (
            <button key={f} type="button" aria-pressed={filter === f} className={`pd-chip sm${filter === f ? ' on' : ''}`} onClick={() => setFilter(filter === f ? null : f)}>
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

      {filter && shownTab && (
        <div style={{ fontSize: 12.5, color: 'var(--ink-3)', margin: '-6px 0 12px' }}>
          {matching} of {cards.length} match “{FILTERS.find(([f]) => f === filter)?.[1]}”. The rest are dimmed.{' '}
          <button type="button" className="pd-lnk" onClick={() => setFilter(null)} style={{ background: 'none', border: 0, padding: 0, color: 'var(--accent-ink)', cursor: 'pointer', font: 'inherit', fontWeight: 500 }}>Show all</button>
        </div>
      )}

      {error && !shownTab ? (
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
                  <JoinerCard key={c.journeyId} card={c} selected={openId === c.journeyId} dim={filter ? !matches(c, filter) : false} onOpen={() => setOpenId(c.journeyId)} />
                ))}
              </section>
            ))}
          </div>
        </>
      )}

      {openId && <JoinerPanel journeyId={openId} onClose={() => setOpenId('')} onChanged={reload} />}
      {newOffer && (
        <OfferWizard mode="new" onClose={() => setNewOffer(false)}
          onDone={(id) => { setNewOffer(false); setTab('pre_boarding'); reload(); setOpenId(id); }} />
      )}
    </div>
  );
}

function JoinerCard({ card, selected, dim, onOpen }: { card: BoardCard; selected: boolean; dim: boolean; onOpen: () => void }) {
  const next = card.waitingOn[0];
  const late = Boolean(next?.dueAt) && (card.flags.includes('late') || dueText(next?.dueAt).endsWith('late'));
  const role = [card.designation, card.department].filter(Boolean).join(' · ');
  const pct = card.progress.total ? Math.round((card.progress.done / card.progress.total) * 100) : 0;
  return (
    <button type="button" onClick={onOpen} aria-pressed={selected}
      style={{
        textAlign: 'left', font: 'inherit', color: 'inherit', cursor: 'pointer', width: '100%',
        background: 'var(--surface)', borderRadius: 14, padding: 12, display: 'grid', gap: 8,
        border: `1px solid ${selected ? 'var(--accent)' : 'var(--line)'}`,
        boxShadow: selected ? '0 0 0 3px var(--accent-soft)' : '0 1px 2px rgba(20,20,22,.04)',
        opacity: dim ? 0.35 : 1, transition: 'opacity .15s, box-shadow .15s',
      }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', minWidth: 0 }}>
        <Plant plant={card.plant} size={30} />
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 13.5, fontWeight: 600, lineHeight: 1.3, overflowWrap: 'anywhere' }}>{card.name}</div>
          {role && <div style={{ fontSize: 11.5, color: 'var(--ink-3)', lineHeight: 1.35, overflowWrap: 'anywhere' }}>{role}</div>}
        </div>
      </div>
      <div style={{ fontSize: 11.5, color: 'var(--ink-3)' }}>{card.dayLabel}</div>
      {next ? (
        <>
          <div style={{ fontSize: 13, color: 'var(--ink)', lineHeight: 1.4, overflowWrap: 'anywhere' }}>{next.title}</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', justifyContent: 'space-between' }}>
            <OwnerChip role={next.ownerRole} name={next.ownerRole === 'hr' ? undefined : next.ownerName} you={next.ownerRole === 'hr'} />
            <span style={{ fontSize: 11.5, fontWeight: late ? 600 : 400, color: late ? 'var(--bad)' : 'var(--ink-3)', whiteSpace: 'nowrap' }}>{dueText(next.dueAt, late)}</span>
          </div>
        </>
      ) : <div style={{ fontSize: 12.5, color: 'var(--ink-3)' }}>Nothing waiting</div>}
      {card.flags.length > 0 && <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>{card.flags.slice(0, 3).map((f) => <FlagPill key={f} flag={f} />)}</div>}
      {card.progress.total > 0 && (
        <div title={`${card.progress.done} of ${card.progress.total} tasks done`} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span aria-hidden style={{ flex: 1, height: 4, borderRadius: 99, background: 'var(--surface-2)', overflow: 'hidden' }}><i style={{ display: 'block', height: '100%', width: `${pct}%`, background: 'var(--ok-solid)', borderRadius: 99 }} /></span>
          <span style={{ fontSize: 11, color: 'var(--ink-3)', fontVariantNumeric: 'tabular-nums' }}>{card.progress.done}/{card.progress.total}</span>
        </div>
      )}
    </button>
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
