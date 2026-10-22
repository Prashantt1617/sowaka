import { useStore } from '../store';
import { OTDUR, STAT } from '../theme';
import type { ReqStatus } from '../theme';
import type { Overtime as OvertimeRow } from '../seed';
import { inDateRange } from '../adapters';
import { downloadCsv } from '../export';
import { Avatar, Card, DateRange, EmptyRow, Pill, SearchInput, StatusTabs, SummaryCard } from '../ui';
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
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 14, marginBottom: 20 }}>
        <SummaryCard label="Total requests" value={summary.total} />
        <SummaryCard label="Pending" value={summary.pending} color="var(--warn)" />
        <SummaryCard label="Approved" value={summary.approved} color="var(--ok)" />
        <SummaryCard label="Declined" value={summary.declined} color="var(--bad)" />
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 11, marginBottom: 14, flexWrap: 'wrap' }}>
        <SearchInput value={s.otSearch} onChange={s.setOtSearch} placeholder="Search by employee…" />
        <StatusTabs<ReqStatus | 'all'>
          options={['all', 'Pending', 'Approved', 'Declined']}
          active={s.otStatus}
          onSelect={s.setOtStatus}
        />
        <DateRange from={s.otFrom} to={s.otTo} onFrom={s.setOtFrom} onTo={s.setOtTo} />
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
          <div>APPLIED ON</div>
          <div>OVERTIME DATE</div>
          <div>DURATION</div>
          <div>DAY</div>
          <div>NOTE</div>
          <div>STATUS</div>
        </div>
        {rows.map((r) => (
          <div
            key={r.id}
            className="dc-row"
            onClick={() => s.setOtDrawerId(r.id)}
            style={{ display: 'grid', gridTemplateColumns: COLS, gap: 12, padding: '14px 22px', borderBottom: '1px solid var(--line)', alignItems: 'center', cursor: 'pointer', transition: 'background .12s' }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 11, minWidth: 0 }}>
              <Avatar name={r.name} />
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.name}</div>
                <div style={{ fontSize: 13, color: 'var(--ink-3)', fontWeight: 400 }}>{r.team}</div>
              </div>
            </div>
            <div style={{ fontSize: 14, fontWeight: 400, color: 'var(--ink-2)' }}>{r.appliedOn}</div>
            <div style={{ fontSize: 14, fontWeight: 400, color: 'var(--ink-2)' }}>{r.otDate}</div>
            <div>
              <Pill label={r.duration} tone={OTDUR[r.duration]} />
            </div>
            <div style={{ fontSize: 14, fontWeight: 400, color: 'var(--ink-2)' }}>{r.day}</div>
            <div style={{ fontSize: 13, fontWeight: 400, color: r.eRemark ? 'var(--ink-2)' : 'var(--ink-4)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={r.eRemark || ''}>{r.eRemark || '—'}</div>
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
