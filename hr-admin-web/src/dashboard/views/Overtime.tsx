import { useStore } from '../store';
import { OTDUR, STAT } from '../theme';
import type { ReqStatus } from '../theme';
import type { Overtime as OvertimeRow } from '../seed';
import { inDateRange } from '../adapters';
import { downloadCsv } from '../export';
import { Avatar, Card, DateRange, EmptyRow, PageActions, Pill, SearchInput, StatusTabs, SummaryCard, Th } from '../ui';
import { btn, btnClass, cellName, cellSub, TH, toolbar, TR } from '../ds';
import { IconDownload } from '../icons';

const COLS = '1.7fr 1fr 1.1fr 1fr .7fr 1.7fr 1.1fr';

export function Overtime() {
  const s = useStore();
  const ranged = s.ots.filter((r) => inDateRange(r.refISO, s.otFrom, s.otTo));
  const summary = {
    total: ranged.length,
    pending: ranged.filter((r) => r.status === 'Pending').length,
    approved: ranged.filter((r) => r.status === 'Approved').length,
    declined: ranged.filter((r) => r.status === 'Declined').length,
  };

  let rows = ranged.slice();
  const q = s.otSearch.trim().toLowerCase();
  if (q) rows = rows.filter((r) => r.name.toLowerCase().includes(q));
  if (s.otStatus !== 'all') rows = rows.filter((r) => r.status === s.otStatus);
  rows.sort((a, b) => b.ord - a.ord);
  const exportRows = () =>
    downloadCsv<OvertimeRow>(
      'overtime',
      [
        { header: 'Employee', value: (r) => r.name },
        { header: 'Team', value: (r) => r.team },
        { header: 'Applied on', value: (r) => r.appliedOn },
        { header: 'Overtime date', value: (r) => r.otDate },
        { header: 'Day', value: (r) => r.day },
        { header: 'Duration', value: (r) => r.duration },
        { header: 'Hours', value: (r) => String(r.hours) },
        { header: 'Note', value: (r) => r.eRemark },
        { header: 'Manager', value: (r) => r.manager },
        { header: 'Status', value: (r) => r.status },
        { header: 'Decided by', value: (r) => (r.byAdmin ? 'admin' : 'manager') },
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
          active={s.otStatus}
          onSelect={s.setOtStatus}
        />
      </div>
      <div style={toolbar}>
        <div style={{ flex: 1, minWidth: 262, display: 'flex' }}>
          <SearchInput value={s.otSearch} onChange={s.setOtSearch} placeholder="Search by employee…" width="100%" />
        </div>
        <DateRange from={s.otFrom} to={s.otTo} onFrom={s.setOtFrom} onTo={s.setOtTo} />
      </div>

        <div style={TH(COLS)}>
          <Th>EMPLOYEE</Th>
          <Th>APPLIED ON</Th>
          <Th>OVERTIME DATE</Th>
          <Th>DURATION</Th>
          <Th>DAY</Th>
          <Th>NOTE</Th>
          <Th>STATUS</Th>
        </div>
        {rows.map((r, i) => (
          <div
            key={r.id}
            className="dc-row"
            onClick={() => s.setOtDrawerId(r.id)}
            style={{ ...TR(COLS, i === rows.length - 1), cursor: 'pointer' }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
              <Avatar name={r.name} />
              <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
                <div style={{ ...cellName, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.name}</div>
                <div style={cellSub}>{r.team}</div>
              </div>
            </div>
            <div style={{ fontWeight: 400 }}>{r.appliedOn}</div>
            <div style={{ fontWeight: 400 }}>{r.otDate}</div>
            <div>
              <Pill label={r.duration} tone={OTDUR[r.duration]} />
            </div>
            <div style={{ fontWeight: 400 }}>{r.day}</div>
            <div style={{ fontWeight: 400, color: r.eRemark ? 'var(--ink)' : 'var(--ink-3)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={r.eRemark || ''}>{r.eRemark || '—'}</div>
            <div>
              <Pill label={r.byAdmin ? `${r.status} · by admin` : r.status} tone={STAT[r.status]} />
            </div>
          </div>
        ))}
        {rows.length === 0 && <EmptyRow text="No overtime requests match your filters." />}
      </Card>
    </div>
  );
}
