// People › Exits: everyone HR has recorded an exit for, from the server (users.exit),
// through the three stages of leaving: On notice (still working), Settlement due
// (gone; the final settlement is waiting for HR) and Left (settled). Open a row
// for that person's exit: clearance, exit interview and the settlement.
import { useEffect, useMemo, useState } from 'react';
import { Card, EmptyRow, ListPending, LoadError, Pill, SearchInput, Th } from '../ui';
import type { LoadState } from '../ui';
import { btn, btnClass, cellName, cellSub, TH, toolbar, TR } from '../ds';
import { IconDownload } from '../icons';
import { downloadCsv } from '../export';
import { listExits } from '../../services/hrms';
import type { ExitDTO } from '../../services/hrms';
import { StatTile } from './leaveParts';
import { Pager, usePaged } from './Pager';
import { FiltersButton, FiltersPanel, LabeledSelect } from './LabeledSelect';
import { useFilterDraft } from './useFilterDraft';
import { EXIT_KINDS, longDay } from './ExitDialog';
import { ExitDetail } from './ExitDetail';
import { inr } from '../../services/payroll';

const COLS = '1.8fr 0.9fr 1fr 1fr 0.7fr 1.3fr 1fr';
type Pick = 'all' | 'notice' | 'settlement_due' | 'left';
const STAGE_TONE = {
  notice: { label: 'On notice', tone: { bg: 'var(--warn-bg)', fg: 'var(--warn)' } },
  settlement_due: { label: 'Settlement due', tone: { bg: 'var(--accent-soft)', fg: 'var(--accent-ink)' } },
  left: { label: 'Left', tone: { bg: 'var(--surface-2)', fg: 'var(--ink-2)' } },
} as const;
/** Where the settlement stands, in a few words, for the row. */
const settlementText = (r: ExitDTO) => {
  if (r.stage === 'notice') return { main: '—', sub: 'Starts after the last day' };
  if (r.caseOpen) return { main: 'On hold', sub: 'Close the case to start it' };
  if (!r.settlement) return { main: 'Draft', sub: 'Open to work it out' };
  const amount = `${r.settlement.payablePaise < 0 ? 'Recover ' : ''}${inr(Math.abs(r.settlement.payablePaise))}`;
  return { main: amount, sub: r.settlement.status === 'draft' ? (r.clearanceDone ? 'Draft · ready to approve' : 'Draft · clearance open') : r.settlement.status === 'approved' ? 'Approved · not paid yet' : 'Paid' };
};

export function Exits() {
  const [rows, setRows] = useState<ExitDTO[] | null>(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [pick, setPick] = useState<Pick>('all');
  const [kind, setKind] = useState('all');
  const [search, setSearch] = useState('');
  const [openId, setOpenId] = useState('');
  const filters = useFilterDraft({ kind }, (v) => setKind(v.kind), { kind: 'all' });

  useEffect(() => {
    let live = true;
    setError('');
    listExits().then((r) => { if (live) setRows(r); }).catch((e) => { if (live) setError(e instanceof Error ? e.message : 'Could not load exits'); });
    return () => { live = false; };
  }, [attempt, openId]);

  const state: LoadState = error ? 'error' : rows ? 'ready' : 'loading';
  const all = useMemo(() => rows ?? [], [rows]);
  const stats = useMemo(() => ({
    notice: all.filter((r) => r.stage === 'notice').length,
    due: all.filter((r) => r.stage === 'settlement_due').length,
    left: all.filter((r) => r.stage === 'left').length,
  }), [all]);

  const shown = useMemo(() => {
    let out = all;
    if (pick !== 'all') out = out.filter((r) => r.stage === pick);
    if (kind !== 'all') out = out.filter((r) => r.kind === kind);
    const q = search.trim().toLowerCase();
    if (q) out = out.filter((r) => r.name.toLowerCase().includes(q) || r.employeeId.toLowerCase().includes(q) || r.department.toLowerCase().includes(q));
    return out;
  }, [all, pick, kind, search]);
  const paged = usePaged(shown, `${pick}|${kind}|${search}|${all.length}`);

  const exportRows = () => downloadCsv<ExitDTO>('exits', [
    { header: 'Employee', value: (r) => r.name },
    { header: 'Employee ID', value: (r) => r.employeeId },
    { header: 'Department', value: (r) => r.department },
    { header: 'Designation', value: (r) => r.designation },
    { header: 'Joined', value: (r) => r.joiningDate ?? '' },
    { header: 'Exit', value: (r) => r.kindLabel },
    { header: 'Notice from', value: (r) => r.noticeFrom ?? '' },
    { header: 'Notice period (days)', value: (r) => (r.noticeDays ?? '') as string | number },
    { header: 'Last working day', value: (r) => r.lastWorkingDay },
    { header: 'Status', value: (r) => STAGE_TONE[r.stage].label },
    { header: 'Settlement', value: (r) => (r.settlement ? r.settlement.status : r.caseOpen ? 'on hold' : '') },
    { header: 'Settlement amount', value: (r) => (r.settlement ? Math.round(r.settlement.payablePaise / 100) : '') as string | number },
    { header: 'Clearance', value: (r) => `${r.clearance.filter((c) => c.done).length} of ${r.clearance.length}` },
    { header: 'Recorded by', value: (r) => r.recordedByName },
    { header: 'Note', value: (r) => r.note },
  ], shown);

  if (openId) return <ExitDetail userId={openId} onBack={() => setOpenId('')} />;

  return (
    <Card padded>
      <section style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
          <StatTile state={state} label="All exits" value={all.length} onPick={() => setPick('all')} picked={pick === 'all'} />
          <StatTile state={state} label="On notice" value={stats.notice} sub="Still working until their last day" onPick={() => setPick('notice')} picked={pick === 'notice'} color="var(--warn)" />
          <StatTile state={state} label="Settlement due" value={stats.due} sub="Gone; check, approve and pay" onPick={() => setPick('settlement_due')} picked={pick === 'settlement_due'} color="var(--accent-ink)" attn={stats.due > 0 && pick !== 'settlement_due'} />
          <StatTile state={state} label="Left" value={stats.left} sub="Settled and paid" onPick={() => setPick('left')} picked={pick === 'left'} />
        </div>

        {error && <LoadError compact text={error} onRetry={() => setAttempt((n) => n + 1)} />}

        <div>
          <div style={toolbar}>
            <div style={{ flex: 1, minWidth: 240, display: 'flex' }}>
              <SearchInput value={search} onChange={setSearch} placeholder="Search employee or department…" width="100%" />
            </div>
            <FiltersButton open={filters.open} active={filters.active} onClick={filters.toggle} />
            <button onClick={exportRows} disabled={shown.length === 0} className={btnClass()} style={btn()}>
              <IconDownload stroke="currentColor" /> Export
            </button>
          </div>
          {filters.open && (
            <FiltersPanel active={filters.active} dirty={filters.dirty} onApply={filters.apply} onClear={filters.clear}>
              <LabeledSelect label="Exit" value={filters.draft.kind} onChange={(v) => filters.set('kind', v)} options={[['all', 'Every kind'], ...EXIT_KINDS]} />
            </FiltersPanel>
          )}

          <div style={{ overflowX: 'auto' }}>
            <div style={{ minWidth: 900 }}>
              <div style={TH(COLS)}>
                <Th>EMPLOYEE</Th>
                <Th>EXIT</Th>
                <Th>NOTICE FROM</Th>
                <Th>LAST WORKING DAY</Th>
                <Th>NOTICE</Th>
                <Th>SETTLEMENT</Th>
                <Th>STATUS</Th>
              </div>
              {state === 'loading' && <ListPending state="loading" cols={7} />}
              {state === 'ready' && shown.length === 0 && (
                <EmptyRow text={all.length === 0 ? 'No exits yet. Record one from an employee’s profile (Record exit).' : 'No exits match these filters.'} />
              )}
              {paged.rows.map((r, i) => (
                <div key={r.userId} id={`exit-row-${r.employeeId}`} className="dc-row" onClick={() => setOpenId(r.userId)} style={{ ...TR(COLS, i === paged.rows.length - 1), cursor: 'pointer' }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={cellName}>{r.name}</div>
                    <div style={cellSub}>{[r.employeeId, r.designation || r.department].filter(Boolean).join(' · ')}</div>
                  </div>
                  <div>{r.kindLabel}</div>
                  <div style={{ color: r.noticeFrom ? 'var(--ink)' : 'var(--ink-3)' }}>{r.noticeFrom ? longDay(r.noticeFrom) : '—'}</div>
                  <div style={{ fontWeight: 500 }}>{longDay(r.lastWorkingDay)}</div>
                  <div style={{ color: r.noticeDays != null ? 'var(--ink)' : 'var(--ink-3)' }}>{r.noticeDays != null ? `${r.noticeDays} days` : '—'}</div>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: r.settlement ? 500 : 400, color: r.settlement && r.settlement.payablePaise < 0 ? 'var(--bad)' : r.settlement ? 'var(--ink)' : 'var(--ink-3)' }}>{settlementText(r).main}</div>
                    <div style={cellSub}>{settlementText(r).sub}</div>
                  </div>
                  <div><Pill label={STAGE_TONE[r.stage].label} tone={STAGE_TONE[r.stage].tone} /></div>
                </div>
              ))}
              <Pager p={paged} />
            </div>
          </div>
        </div>
      </section>
    </Card>
  );
}
