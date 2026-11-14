// People › Exits: everyone HR has recorded an exit for, from the server (users.exit).
// On notice until their last working day; Left once their app access has ended
// (the day after, or when HR ended it). Open a row for their profile, where the
// exit is changed, withdrawn or ended.
import { useEffect, useMemo, useState } from 'react';
import { useStore } from '../store';
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

const COLS = '1.8fr 1fr 1fr 1fr 0.8fr 1.1fr 0.9fr';
type Pick = 'all' | 'notice' | 'month' | 'left';
const STATE_TONE = {
  notice: { label: 'On notice', tone: { bg: 'var(--warn-bg)', fg: 'var(--warn)' } },
  leaving: { label: 'Access ending', tone: { bg: 'var(--warn-bg)', fg: 'var(--warn)' } },
  left: { label: 'Left', tone: { bg: 'var(--surface-2)', fg: 'var(--ink-2)' } },
} as const;

export function Exits() {
  const s = useStore();
  const [rows, setRows] = useState<ExitDTO[] | null>(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [pick, setPick] = useState<Pick>('all');
  const [kind, setKind] = useState('all');
  const [search, setSearch] = useState('');
  const filters = useFilterDraft({ kind }, (v) => setKind(v.kind), { kind: 'all' });

  useEffect(() => {
    let live = true;
    setError('');
    listExits().then((r) => { if (live) setRows(r); }).catch((e) => { if (live) setError(e instanceof Error ? e.message : 'Could not load exits'); });
    return () => { live = false; };
  }, [attempt]);

  const state: LoadState = error ? 'error' : rows ? 'ready' : 'loading';
  const thisMonth = new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 7);
  const all = useMemo(() => rows ?? [], [rows]);
  const stats = useMemo(() => ({
    notice: all.filter((r) => r.state !== 'left').length,
    month: all.filter((r) => r.lastWorkingDay.slice(0, 7) === thisMonth).length,
    left: all.filter((r) => r.state === 'left').length,
  }), [all, thisMonth]);

  const shown = useMemo(() => {
    let out = all;
    if (pick === 'notice') out = out.filter((r) => r.state !== 'left');
    if (pick === 'month') out = out.filter((r) => r.lastWorkingDay.slice(0, 7) === thisMonth);
    if (pick === 'left') out = out.filter((r) => r.state === 'left');
    if (kind !== 'all') out = out.filter((r) => r.kind === kind);
    const q = search.trim().toLowerCase();
    if (q) out = out.filter((r) => r.name.toLowerCase().includes(q) || r.employeeId.toLowerCase().includes(q) || r.department.toLowerCase().includes(q));
    return out;
  }, [all, pick, kind, search, thisMonth]);
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
    { header: 'Status', value: (r) => STATE_TONE[r.state].label },
    { header: 'Recorded by', value: (r) => r.recordedByName },
    { header: 'Note', value: (r) => r.note },
  ], shown);

  return (
    <Card padded>
      <section style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
          <StatTile state={state} label="All exits" value={all.length} onPick={() => setPick('all')} picked={pick === 'all'} />
          <StatTile state={state} label="On notice" value={stats.notice} sub="Still working; access ends the day after" onPick={() => setPick('notice')} picked={pick === 'notice'} color="var(--warn)" />
          <StatTile state={state} label="Leaving this month" value={stats.month} onPick={() => setPick('month')} picked={pick === 'month'} />
          <StatTile state={state} label="Left" value={stats.left} sub="App access has ended" onPick={() => setPick('left')} picked={pick === 'left'} />
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
                <Th>RECORDED BY</Th>
                <Th>STATUS</Th>
              </div>
              {state === 'loading' && <ListPending state="loading" cols={7} />}
              {state === 'ready' && shown.length === 0 && (
                <EmptyRow text={all.length === 0 ? 'No exits yet. Record one from an employee’s profile (Record exit).' : 'No exits match these filters.'} />
              )}
              {paged.rows.map((r, i) => (
                <div key={r.userId} className="dc-row" onClick={() => s.openProfile(r.userId)} style={{ ...TR(COLS, i === paged.rows.length - 1), cursor: 'pointer' }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={cellName}>{r.name}</div>
                    <div style={cellSub}>{[r.employeeId, r.designation || r.department].filter(Boolean).join(' · ')}</div>
                  </div>
                  <div>{r.kindLabel}</div>
                  <div style={{ color: r.noticeFrom ? 'var(--ink)' : 'var(--ink-3)' }}>{r.noticeFrom ? longDay(r.noticeFrom) : '—'}</div>
                  <div style={{ fontWeight: 500 }}>{longDay(r.lastWorkingDay)}</div>
                  <div style={{ color: r.noticeDays != null ? 'var(--ink)' : 'var(--ink-3)' }}>{r.noticeDays != null ? `${r.noticeDays} days` : '—'}</div>
                  <div style={cellSub}>{r.recordedByName || '—'}</div>
                  <div><Pill label={STATE_TONE[r.state].label} tone={STATE_TONE[r.state].tone} /></div>
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
