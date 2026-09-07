import { useStore } from '../store';
import { STAT, TYPE } from '../theme';
import type { LeaveType, ReqStatus } from '../theme';
import type { Leave } from '../seed';
import { inDateRange } from '../adapters';
import { downloadCsv } from '../export';
import { Avatar, Card, DateRange, EmptyRow, Pill, SearchInput, SelectBox, StatusTabs, SummaryCard } from '../ui';
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
        <SummaryCard label="Total requests" value={summary.total} />
        <SummaryCard label="Pending" value={summary.pending} color="#9A6B25" />
        <SummaryCard label="Approved" value={summary.approved} color="#4F7A52" />
        <SummaryCard label="Declined" value={summary.declined} color="#A8475F" />
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
          <option value="Sick">Sick</option>
          <option value="Casual">Casual</option>
          <option value="Earned">Earned</option>
          <option value="WFH">WFH</option>
          <option value="Unpaid">Unpaid</option>
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
          style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8, background: '#222222', border: 'none', color: '#fff', borderRadius: 11, padding: '9px 15px', fontSize: 14, fontWeight: 700, cursor: rows.length ? 'pointer' : 'not-allowed', opacity: rows.length ? 1 : 0.5 }}
        >
          <IconDownload /> Export
        </button>
      </div>

      <Card>
        <div style={{ display: 'grid', gridTemplateColumns: COLS, gap: 12, padding: '14px 22px', borderBottom: '1px solid #F0F0F2', fontSize: 12, fontWeight: 700, letterSpacing: '.5px', color: '#717171' }}>
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
            style={{ position: 'relative', display: 'grid', gridTemplateColumns: COLS, gap: 12, padding: '14px 22px', borderBottom: '1px solid #F0F0F2', alignItems: 'center', cursor: 'pointer', transition: 'background .12s' }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 11, minWidth: 0 }}>
              <Avatar name={r.name} />
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 16, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.name}</div>
                <div style={{ fontSize: 14, color: '#717171', fontWeight: 500 }}>{r.team}</div>
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', flexShrink: 0, background: TYPE[r.type as LeaveType] }} />
              <span style={{ fontSize: 16, fontWeight: 600, color: '#484848' }}>{r.type}</span>
            </div>
            <div style={{ fontSize: 16, fontWeight: 600, color: '#484848' }}>{r.from === r.to ? r.from : `${r.from} – ${r.to}`}</div>
            <div style={{ fontSize: 16, fontWeight: 600, color: '#484848' }}>{r.days}</div>
            <div style={{ fontSize: 14, fontWeight: 500, color: r.eRemark ? '#484848' : '#9197A2', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={r.eRemark || ''}>{r.eRemark || '—'}</div>
            <div style={{ fontSize: 16, fontWeight: 600, color: '#484848', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.manager}</div>
            <div>
              <Pill label={r.byAdmin ? `${r.status} · by admin` : r.status} tone={STAT[r.status]} />
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end' }} onClick={(e) => e.stopPropagation()}>
              <button
                onClick={() => s.setDrawerId(r.id)}
                title="View details"
                style={{ width: 33, height: 33, borderRadius: 9, border: '1px solid #EBEBEB', background: '#F7F7F9', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
              >
                <IconEye />
              </button>
            </div>
          </div>
        ))}
        {rows.length === 0 && <EmptyRow text="No requests match your filters." />}
      </Card>
    </div>
  );
}
