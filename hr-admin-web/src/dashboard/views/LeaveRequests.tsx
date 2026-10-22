import { useStore } from '../store';
import { STAT, typeColor } from '../theme';
import type { ReqStatus } from '../theme';
import type { Leave } from '../seed';
import { inDateRange } from '../adapters';
import { downloadCsv } from '../export';
import { Avatar, Card, DateRange, EmptyRow, PageActions, Pill, SearchInput, SelectBox, StatusTabs, SummaryCard, Th } from '../ui';
import { TH, TR, btn, btnClass, cellName, cellSub, iconBtn, toolbar } from '../ds';
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
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 16, marginBottom: 20 }}>
        <SummaryCard label="Total requests" value={summary.total} />
        <SummaryCard label="Pending" value={summary.pending} color="var(--warn)" />
        <SummaryCard label="Approved" value={summary.approved} color="var(--ok)" />
        <SummaryCard label="Declined" value={summary.declined} color="var(--bad)" />
      </div>

      <PageActions>
        <button onClick={exportRows} disabled={rows.length === 0} className={btnClass()} style={btn()}>
          <IconDownload stroke="currentColor" /> Export
        </button>
      </PageActions>

      <Card padded>
      <div style={toolbar}>
        <StatusTabs<ReqStatus | 'all'>
          options={['all', 'Pending', 'Approved', 'Declined']}
          active={s.leaveStatus}
          onSelect={s.setLeaveStatus}
        />
      </div>
      <div style={toolbar}>
        <div style={{ flex: 1, minWidth: 262, display: 'flex' }}>
          <SearchInput value={s.leaveSearch} onChange={s.setLeaveSearch} placeholder="Search by employee…" width="100%" />
        </div>
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
      </div>

        <div style={TH(COLS)}>
          <Th>EMPLOYEE</Th>
          <Th>TYPE</Th>
          <Th>DATES</Th>
          <Th>DAYS</Th>
          <Th>REASON</Th>
          <Th>MANAGER</Th>
          <Th>STATUS</Th>
          <Th align="right">ACTION</Th>
        </div>
        {rows.map((r, i) => (
          <div
            key={r.id}
            className="dc-row"
            onClick={() => s.setDrawerId(r.id)}
            style={{ ...TR(COLS, i === rows.length - 1), position: 'relative', cursor: 'pointer' }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
              <Avatar name={r.name} />
              <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
                <div style={{ ...cellName, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.name}</div>
                <div style={cellSub}>{r.team}</div>
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', flexShrink: 0, background: typeColor(r.type) }} />
              <span>{r.type}</span>
            </div>
            <div style={{ whiteSpace: 'nowrap' }}>{r.from === r.to ? r.from : `${r.from} – ${r.to}`}</div>
            <div style={{ whiteSpace: 'nowrap' }}>{r.days}</div>
            <div style={{ color: r.eRemark ? 'var(--ink)' : 'var(--ink-3)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={r.eRemark || ''}>{r.eRemark || '—'}</div>
            <div style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.manager}</div>
            <div>
              <Pill label={r.byAdmin ? `${r.status} · by admin` : r.status} tone={STAT[r.status]} />
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end' }} onClick={(e) => e.stopPropagation()}>
              <button onClick={() => s.setDrawerId(r.id)} title="View details" className="ds-icon-btn" style={iconBtn(34)}>
                <IconEye stroke="currentColor" />
              </button>
            </div>
          </div>
        ))}
        {rows.length === 0 && <EmptyRow text="No requests match your filters." />}
      </Card>
    </div>
  );
}
