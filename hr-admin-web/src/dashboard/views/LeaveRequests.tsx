import { useStore } from '../store';
import { STAT, typeColor } from '../theme';
import type { ReqStatus } from '../theme';
import type { Leave } from '../seed';
import { inDateRange } from '../adapters';
import { downloadCsv } from '../export';
import { Avatar, Card, DateRange, EmptyRow, ListPending, LoadingFigure, Pill, SearchInput, SelectBox, StatusTabs, SummaryCard } from '../ui';
import { IconDownload, IconEye } from '../icons';

const COLS = '1.7fr 1fr 1.3fr .6fr 1.7fr 1.3fr 1.1fr .7fr';

function computeRows(s: ReturnType<typeof useStore>): Leave[] {
  let rows = s.leaves.slice();
  const q = s.leaveSearch.trim().toLowerCase();
  if (q) rows = rows.filter((r) => r.name.toLowerCase().includes(q));
  if (s.leaveStatus !== 'all') rows = rows.filter((r) => r.status === s.leaveStatus);
  if (s.leaveType !== 'all') rows = rows.filter((r) => r.type === s.leaveType);
  rows = rows.filter((r) => inDateRange(r.refISO, s.leaveFrom, s.leaveTo));
  const sort = s.leaveSort;
  if (sort === 'recent') rows.sort((a, b) => b.ord - a.ord);
  else if (sort === 'oldest') rows.sort((a, b) => a.ord - b.ord);
  else if (sort === 'name') rows.sort((a, b) => a.name.localeCompare(b.name));
  else if (sort === 'days') rows.sort((a, b) => b.dayN - a.dayN);
  return rows;
}

export function LeaveRequests() {
  const s = useStore();
  const st = s.listState('leaves');
  // Summary reflects the selected date range (entries + summary for that range).
  const ranged = s.leaves.filter((r) => inDateRange(r.refISO, s.leaveFrom, s.leaveTo));
  const summary = {
    total: ranged.length,
    pending: ranged.filter((r) => r.status === 'Pending').length,
    approved: ranged.filter((r) => r.status === 'Approved').length,
    declined: ranged.filter((r) => r.status === 'Declined').length,
  };
  const rows = computeRows(s);
  const exportRows = () =>
    downloadCsv<Leave>(
      'leaves',
      [
        { header: 'Employee', value: (r) => r.name },
        { header: 'Team', value: (r) => r.team },
        { header: 'Type', value: (r) => r.type },
        { header: 'From', value: (r) => r.from },
        { header: 'To', value: (r) => r.to },
        { header: 'Days', value: (r) => r.dayN },
        { header: 'Reason', value: (r) => r.eRemark },
        { header: 'Manager', value: (r) => r.manager },
        { header: 'Status', value: (r) => r.status },
        { header: 'Decided by', value: (r) => (r.byAdmin ? 'admin' : 'manager') },
        { header: 'Applied', value: (r) => r.applied },
      ],
      rows,
    );

  return (
    <div style={{ animation: 'fade .3s ease both' }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 14, marginBottom: 20 }}>
        <SummaryCard label="Total requests" value={<LoadingFigure state={st}>{summary.total}</LoadingFigure>} />
        <SummaryCard label="Pending" value={<LoadingFigure state={st}>{summary.pending}</LoadingFigure>} color="var(--warn)" />
        <SummaryCard label="Approved" value={<LoadingFigure state={st}>{summary.approved}</LoadingFigure>} color="var(--ok)" />
        <SummaryCard label="Declined" value={<LoadingFigure state={st}>{summary.declined}</LoadingFigure>} color="var(--bad)" />
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 11, marginBottom: 14, flexWrap: 'wrap' }}>
        <SearchInput value={s.leaveSearch} onChange={s.setLeaveSearch} placeholder="Search by employee…" />
        <StatusTabs<ReqStatus | 'all'>
          options={['all', 'Pending', 'Approved', 'Declined']}
          active={s.leaveStatus}
          onSelect={s.setLeaveStatus}
        />
        <SelectBox value={s.leaveType} onChange={s.setLeaveType}>
          <option value="all">All types</option>
          {/* The types that actually appear, so one HR adds shows up here too. */}
          {[...new Set(s.leaves.map((r) => r.type))].sort().map((type) => (
            <option key={type} value={type}>{type}</option>
          ))}
        </SelectBox>
        <SelectBox value={s.leaveSort} onChange={s.setLeaveSort}>
          <option value="recent">Most recent</option>
          <option value="oldest">Oldest first</option>
          <option value="name">Name A–Z</option>
          <option value="days">Most days</option>
        </SelectBox>
        <DateRange from={s.leaveFrom} to={s.leaveTo} onFrom={s.setLeaveFrom} onTo={s.setLeaveTo} />
        <button
          onClick={exportRows}
          disabled={rows.length === 0}
          style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8, background: 'var(--ink)', border: 'none', color: 'var(--on-sel)', borderRadius: 999, padding: '9px 15px', fontSize: 13, fontWeight: 500, cursor: rows.length ? 'pointer' : 'not-allowed', opacity: rows.length ? 1 : 0.5 }}
        >
          <IconDownload /> Export
        </button>
      </div>

      <Card>
        <div style={{ display: 'grid', background: 'var(--surface-2)', gridTemplateColumns: COLS, gap: 12, padding: '14px 22px', borderBottom: '1px solid var(--line)', fontSize: 11.5, fontWeight: 500, letterSpacing: '.5px', color: 'var(--ink-3)' }}>
          <div>EMPLOYEE</div>
          <div>TYPE</div>
          <div>DATES</div>
          <div>DAYS</div>
          <div>REASON</div>
          <div>MANAGER</div>
          <div>STATUS</div>
          <div style={{ textAlign: 'right' }}>ACTION</div>
        </div>
        {rows.map((r) => (
          <div
            key={r.id}
            className="dc-row"
            onClick={() => s.setDrawerId(r.id)}
            style={{ position: 'relative', display: 'grid', gridTemplateColumns: COLS, gap: 12, padding: '14px 22px', borderBottom: '1px solid var(--line)', alignItems: 'center', cursor: 'pointer', transition: 'background .12s' }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 11, minWidth: 0 }}>
              <Avatar name={r.name} />
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.name}</div>
                <div style={{ fontSize: 13, color: 'var(--ink-3)', fontWeight: 400 }}>{r.team}</div>
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', flexShrink: 0, background: typeColor(r.type) }} />
              <span style={{ fontSize: 14, fontWeight: 400, color: 'var(--ink-2)' }}>{r.type}</span>
            </div>
            <div style={{ fontSize: 14, fontWeight: 400, color: 'var(--ink-2)' }}>{r.from === r.to ? r.from : `${r.from} – ${r.to}`}</div>
            <div style={{ fontSize: 14, fontWeight: 400, color: 'var(--ink-2)' }}>{r.days}</div>
            <div style={{ fontSize: 13, fontWeight: 400, color: r.eRemark ? 'var(--ink-2)' : 'var(--ink-4)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={r.eRemark || ''}>{r.eRemark || '—'}</div>
            <div style={{ fontSize: 14, fontWeight: 400, color: 'var(--ink-2)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.manager}</div>
            <div>
              <Pill label={r.byAdmin ? `${r.status} · by admin` : r.status} tone={STAT[r.status]} />
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end' }} onClick={(e) => e.stopPropagation()}>
              <button
                onClick={() => s.setDrawerId(r.id)}
                title="View details"
                style={{ width: 33, height: 33, borderRadius: 999, border: '1px solid var(--line)', background: 'var(--surface-2)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
              >
                <IconEye />
              </button>
            </div>
          </div>
        ))}
        <ListPending state={st} onRetry={() => void s.reload()} cols={8} />
        {st === 'ready' && rows.length === 0 && <EmptyRow text="No requests match your filters." />}
      </Card>
    </div>
  );
}
