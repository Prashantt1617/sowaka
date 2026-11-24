// Employee lifecycle › Offboarding (O1, O1b, O1c): everyone leaving, from the resignation to the
// final settlement. Each tab is one phase and its columns are the steps; a card opens the drawer
// (O1d). Start an exit (O2) and the final settlement (O3) open in place of the board. Exit
// interview answers never show here: they go to Exit insights, anonymised.
// Where the company has the lifecycle on, this replaces People › Exits.
import { useEffect, useMemo, useState } from 'react';
import { Card, LoadError, PageActions, SearchInput, SkeletonCards } from '../../../ui';
import { PersonAvatar } from '../../../PersonAvatar';
import { btn, btnClass } from '../../../ds';
import { IconDownload, IconPlus } from '../../../icons';
import { downloadCsv } from '../../../export';
import { getOffboardingBoard, sendNudge } from '../../../../services/lifecycleOffboarding';
import { useStore } from '../../../store';
import { refreshOffboardingBadge } from './badge';
import type { BoardCard, BoardDTO, BoardTab } from '../../../../services/lifecycleOffboarding';
import { ClockIcon, FlagPill, OwnerChip, addDays, dueText } from './parts';
import { OffboardingDrawer } from './OffboardingDrawer';
import { StartExit } from './StartExit';
import { SettlementSend } from './SettlementSend';
import '../../people.css';
import './offboarding.css';

const TABS: { key: BoardTab; label: string; note: string }[] = [
  { key: 'resignations', label: 'Resignations', note: 'From resignation to HR accepting it' },
  { key: 'notice', label: 'Leaving soon', note: 'Accepted, working till the last day' },
  { key: 'exit', label: 'Exit and settlement', note: 'Last day to settlement and letters' },
];
type Quick = '' | 'mine' | 'late' | 'week';
type Page = { kind: 'board' } | { kind: 'start' } | { kind: 'settlement'; userId: string };

/** Sunday of this week (the week runs Monday to Sunday). */
const endOfWeek = (today: string) => addDays(today, (7 - new Date(`${today}T00:00:00Z`).getUTCDay()) % 7);

export function OffboardingBoard() {
  const s = useStore();
  const [nudging, setNudging] = useState('');
  const [page, setPage] = useState<Page>({ kind: 'board' });
  const [tab, setTab] = useState<BoardTab>('resignations');
  const [data, setData] = useState<BoardDTO | null>(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [search, setSearch] = useState('');
  const [quick, setQuick] = useState<Quick>('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [open, setOpen] = useState<BoardCard | null>(null);

  useEffect(() => {
    let live = true;
    setError('');
    getOffboardingBoard(tab, { from: from || undefined, to: to || undefined })
      .then((d) => { if (live) { setData(d); refreshOffboardingBadge(); } })
      .catch((e) => { if (live) setError(e instanceof Error ? e.message : 'Could not load the board'); });
    return () => { live = false; };
  }, [tab, from, to, attempt]);

  const reload = () => setAttempt((n) => n + 1);
  const hr = data?.viewer.kind === 'hr';
  const today = data?.today ?? '';
  const q = search.trim().toLowerCase();
  const columns = useMemo(() => (data?.columns ?? []).map((c) => ({
    ...c, cards: c.cards.filter((x) => !q || [x.name, x.employeeId, x.department, x.designation].some((v) => v.toLowerCase().includes(q))),
  })), [data, q]);
  // Quick filters dim the cards that do not match; nothing is removed.
  const matches = (c: BoardCard) => quick === '' ? true
    : quick === 'mine' ? (hr ? c.waitingOnHr : c.owner.role === (data?.viewer.kind === 'team' ? data.viewer.team : ''))
    : quick === 'late' ? c.late
    : !!c.due && c.due >= today && c.due <= endOfWeek(today);
  const remind = async (c: BoardCard) => {
    if (!c.nudge) return;
    setNudging(c.key);
    try {
      await sendNudge(c.userId, c.nudge.item);
      s.flash(`${c.nudge.to} is reminded`);
      reload();
    } catch (e) {
      s.flash(e instanceof Error ? e.message : 'Could not send the reminder', 'error');
    } finally {
      setNudging('');
    }
  };

  const exportRows = () => downloadCsv<BoardCard>(`offboarding-${tab}`, [
    { header: 'Employee', value: (r) => r.name },
    { header: 'Employee ID', value: (r) => r.employeeId },
    { header: 'Designation', value: (r) => r.designation },
    { header: 'Department', value: (r) => r.department },
    { header: 'Exit type', value: (r) => r.exitTypeLabel },
    { header: 'Step', value: (r) => columns.find((c) => c.key === r.column)?.label ?? r.column },
    { header: 'Last working day', value: (r) => r.tl ?? '' },
    { header: 'Next step', value: (r) => r.nextStep },
    { header: 'Waiting on', value: (r) => r.owner.name ?? r.owner.role },
    { header: 'Due', value: (r) => r.due ?? '' },
    { header: 'Flag', value: (r) => r.flag?.label ?? '' },
  ], columns.flatMap((c) => c.cards));

  if (page.kind === 'start') return <StartExit onBack={() => setPage({ kind: 'board' })} onStarted={() => { setPage({ kind: 'board' }); setTab('resignations'); reload(); }} />;
  if (page.kind === 'settlement') return <SettlementSend userId={page.userId} onBack={() => { setPage({ kind: 'board' }); setTab('exit'); reload(); }} />;

  const tabMeta = TABS.find((t) => t.key === tab)!;
  return (
    <>
      <PageActions>
        <button type="button" onClick={exportRows} disabled={!data} className={btnClass()} style={btn()}><IconDownload stroke="currentColor" /> Export</button>
        {hr && <button type="button" id="ob-start" onClick={() => setPage({ kind: 'start' })} className={btnClass('primary')} style={btn('primary')}><IconPlus /> Start an exit</button>}
      </PageActions>
      <Card padded>
        <p className="pd-lead" style={{ marginBottom: 16 }}>
          {hr ? 'Everyone leaving, from resignation to final settlement. Each tab is one phase; columns are its steps. Exit interview answers never show here.'
            : 'The exits with a clearance item for your team. Tick yours when it is done.'}
        </p>
        <div className="ob-tabs">
          <div className="pd-seg" role="tablist" aria-label="Phase">
            {TABS.map((t) => (
              <button key={t.key} type="button" role="tab" aria-selected={tab === t.key} className={tab === t.key ? 'on' : ''} onClick={() => { setTab(t.key); setOpen(null); }}>
                {t.label} {data && <span className="c">{data.counts[t.key]}</span>}
              </button>
            ))}
          </div>
          <span className="ob-tabnote">{tabMeta.note}</span>
        </div>
        <div className="ob-filters">
          <SearchInput value={search} onChange={setSearch} placeholder="Search this board" width={240} />
          <div className="pd-chips">
            {([['mine', 'Waiting on me'], ['late', 'Late'], ['week', 'Due this week']] as [Quick, string][]).map(([k, l]) => (
              <button key={k} type="button" aria-pressed={quick === k} className={`pd-chip sm${quick === k ? ' on' : ''}`} onClick={() => setQuick(quick === k ? '' : k)}>{l}</button>
            ))}
          </div>
          <span className="sp" />
          <label>Last working day</label>
          <label>From <input type="date" className="pd-inp" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="Last working day from" /></label>
          <label>To <input type="date" className="pd-inp" value={to} onChange={(e) => setTo(e.target.value)} aria-label="Last working day to" /></label>
        </div>

        {error && <LoadError compact text={error} onRetry={reload} />}
        {!data && !error && <SkeletonCards count={4} minWidth={240} />}
        {data && (
          <div className="ob-lanes">
            {columns.map((col) => (
              <section key={col.key} className="ob-lane" aria-label={col.label}>
                <div className="ob-lane-h"><span>{col.label}</span><b>{col.cards.length}</b></div>
                {col.cards.length === 0 && <div className="ob-empty">No one here.</div>}
                {col.cards.map((c) => (
                  <div key={c.key} className={`ob-card-wrap${matches(c) ? '' : ' dim'}`}>
                  <button type="button" className={`ob-card${open?.key === c.key ? ' on' : ''}${c.nudge ? ' has-nudge' : ''}`} onClick={() => setOpen(c)}>
                    <div className="ob-who">
                      <PersonAvatar name={c.name} userId={c.userId} size={32} font={12.5} />
                      <div style={{ minWidth: 0 }}><b>{c.name}</b><span>{[c.designation, c.department].filter(Boolean).join(' · ') || c.employeeId}</span></div>
                    </div>
                    <div className="ob-line"><span className="ob-type">{c.exitTypeLabel}</span><span>{c.lastDayLine}</span></div>
                    <div className="ob-next">{c.nextStep}</div>
                    <div className="ob-foot">
                      <OwnerChip owner={c.owner} />
                      {c.due && <span className={`due${c.late ? ' late' : ''}`}><ClockIcon /> {dueText(c.due, today, c.late)}</span>}
                      <FlagPill flag={c.flag} />
                    </div>
                  </button>
                  {/* Beside the card, not inside it: a button cannot hold another. */}
                  {c.nudge && (
                    <button type="button" className={`ob-nudge${c.nudge.late ? ' late' : ''}`} disabled={c.nudge.sentToday || nudging === c.key}
                      title={c.nudge.sentToday ? 'Reminded today. You can remind again tomorrow.' : c.nudge.what} onClick={() => void remind(c)}>
                      {nudging === c.key ? 'Sending…' : c.nudge.sentToday ? 'Reminded today' : c.nudge.label}
                    </button>
                  )}
                  </div>
                ))}
              </section>
            ))}
          </div>
        )}
      </Card>
      {open && (
        <OffboardingDrawer
          key={open.key}
          card={open}
          tabLabel={tabMeta.label}
          columnLabel={columns.find((c) => c.key === open.column)?.label ?? ''}
          onClose={() => setOpen(null)}
          onChanged={reload}
          onOpenSettlement={(userId) => { setOpen(null); setPage({ kind: 'settlement', userId }); }}
        />
      )}
    </>
  );
}
