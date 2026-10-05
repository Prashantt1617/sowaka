// Requests › OOL check-ins — every punch taken away from every office.
//
// Two kinds of row sit together, because HR asked "who punched from where",
// not "what is waiting on whom": days the shift's policy marked present with a
// remark, and out-of-location requests that went to a manager, whatever became
// of them. Each row carries the reason the employee gave, the pin, and how far
// from the nearest office it was.
import { useEffect, useMemo, useState } from 'react';
import { useStore } from '../store';
import { STAT } from '../theme';
import { downloadCsv } from '../export';
import { Avatar, Card, DateRange, EmptyRow, Pill, SearchInput, SummaryCard } from '../ui';
import { IconDownload } from '../icons';
import { getOutOfLocation, type OutOfLocationDTO } from '../../services/hrms';

const COLS = '1.8fr 1.1fr .7fr 1.2fr 1.5fr 1.2fr 1.3fr';

const PRESENT_TONE = { bg: '#E4EDE0', fg: '#4F7A52' };

const todayIso = () => new Date().toISOString().slice(0, 10);
const monthStartIso = () => `${todayIso().slice(0, 7)}-01`;

const fmtDay = (iso: string) =>
  new Date(`${iso}T00:00:00`).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
const clock = (iso: string) =>
  new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });

/** How the row reads under Status: what HR's policy did, then what the manager decided. */
function statusOf(row: OutOfLocationDTO): { label: string; tone: { bg: string; fg: string } } {
  if (row.outcome === 'present') return { label: 'Marked present', tone: PRESENT_TONE };
  if (row.status === 'pending') return { label: 'Pending', tone: STAT.Pending };
  if (row.status === 'approved') return { label: row.decidedByRole === 'admin' ? 'Approved · by admin' : 'Approved', tone: STAT.Approved };
  return { label: row.decidedByRole === 'admin' ? 'Rejected · by admin' : 'Rejected', tone: STAT.Declined };
}

export function OutOfLocation() {
  const { flash } = useStore();
  const [from, setFrom] = useState(monthStartIso());
  const [to, setTo] = useState(todayIso());
  const [rows, setRows] = useState<OutOfLocationDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | 'present' | 'pending' | 'approved' | 'declined'>('all');

  useEffect(() => {
    // Empty dates mean the whole month: the range control clears to ''.
    const f = from || monthStartIso();
    const t = to || todayIso();
    setLoading(true);
    getOutOfLocation(f, t)
      .then(setRows)
      .catch((error: Error) => flash(error.message))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to]);

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (q && !r.name.toLowerCase().includes(q) && !r.employeeCode.toLowerCase().includes(q) && !r.manager.toLowerCase().includes(q)) return false;
      if (filter === 'present') return r.outcome === 'present';
      if (filter === 'pending' || filter === 'approved' || filter === 'declined') return r.outcome === 'request' && r.status === filter;
      return true;
    });
  }, [rows, search, filter]);

  const summary = {
    total: rows.length,
    present: rows.filter((r) => r.outcome === 'present').length,
    pending: rows.filter((r) => r.outcome === 'request' && r.status === 'pending').length,
    declined: rows.filter((r) => r.outcome === 'request' && r.status === 'declined').length,
  };

  const exportRows = () =>
    downloadCsv<OutOfLocationDTO>(
      'ool-check-ins',
      [
        { header: 'Employee', value: (r) => r.name },
        { header: 'Employee ID', value: (r) => r.employeeCode },
        { header: 'Team', value: (r) => r.department },
        { header: 'Date', value: (r) => r.workDate },
        { header: 'Time', value: (r) => clock(r.at) },
        { header: 'Punch', value: (r) => (r.punchType === 'in' ? 'Punch in' : 'Punch out') },
        { header: 'Reason', value: (r) => r.reason },
        { header: 'Location', value: (r) => r.place },
        { header: 'Latitude', value: (r) => r.latitude },
        { header: 'Longitude', value: (r) => r.longitude },
        { header: 'Outcome', value: (r) => statusOf(r).label },
        { header: 'Manager', value: (r) => r.manager },
        { header: 'Decision note', value: (r) => r.managerNote },
      ],
      shown,
    );

  const tabs: { key: typeof filter; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'present', label: 'Marked present' },
    { key: 'pending', label: 'Pending' },
    { key: 'approved', label: 'Approved' },
    { key: 'declined', label: 'Rejected' },
  ];

  return (
    <div style={{ animation: 'fade .3s ease both' }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 14, marginBottom: 20 }}>
        <SummaryCard label="Out-of-location punches" value={summary.total} />
        <SummaryCard label="Marked present" value={summary.present} color="#4F7A52" />
        <SummaryCard label="Awaiting a manager" value={summary.pending} color="#9A6B25" />
        <SummaryCard label="Rejected" value={summary.declined} color="#A8475F" />
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 11, marginBottom: 14, flexWrap: 'wrap' }}>
        <SearchInput value={search} onChange={setSearch} placeholder="Search employee or manager…" />
        <div style={{ display: 'inline-flex', border: '1px solid #EBEBEB', borderRadius: 11, overflow: 'hidden', background: '#fff' }}>
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => setFilter(t.key)}
              style={{ padding: '8px 14px', fontSize: 14, fontWeight: 700, border: 'none', borderLeft: t.key === 'all' ? 'none' : '1px solid #EBEBEB', background: filter === t.key ? '#0571A6' : '#fff', color: filter === t.key ? '#fff' : '#484848', cursor: 'pointer', fontFamily: 'inherit' }}
            >
              {t.label}
            </button>
          ))}
        </div>
        <DateRange from={from} to={to} onFrom={setFrom} onTo={setTo} />
        <button
          onClick={exportRows}
          disabled={shown.length === 0}
          style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8, background: '#222222', border: 'none', color: '#fff', borderRadius: 11, padding: '9px 15px', fontSize: 14, fontWeight: 700, fontFamily: 'inherit', cursor: shown.length ? 'pointer' : 'not-allowed', opacity: shown.length ? 1 : 0.5 }}
        >
          <IconDownload /> Export
        </button>
      </div>

      <Card>
        <div style={{ display: 'grid', gridTemplateColumns: COLS, gap: 12, padding: '14px 22px', borderBottom: '1px solid #F0F0F2', fontSize: 12, fontWeight: 700, letterSpacing: '.5px', color: '#717171' }}>
          <div>EMPLOYEE</div>
          <div>DATE &amp; TIME</div>
          <div>PUNCH</div>
          <div>REASON</div>
          <div>LOCATION</div>
          <div>MANAGER</div>
          <div>STATUS</div>
        </div>
        {shown.map((r) => {
          const status = statusOf(r);
          return (
            <div key={r.id} style={{ display: 'grid', gridTemplateColumns: COLS, gap: 12, padding: '14px 22px', borderBottom: '1px solid #F0F0F2', alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 11, minWidth: 0 }}>
                <Avatar name={r.name} />
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 16, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.name}</div>
                  <div style={{ fontSize: 14, color: '#717171', fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {r.employeeCode}{r.department ? ` · ${r.department}` : ''}
                  </div>
                </div>
              </div>
              <div style={{ fontSize: 16, fontWeight: 600, color: '#484848' }}>
                {fmtDay(r.workDate)}
                <div style={{ fontSize: 13, color: '#9197A2', fontWeight: 500 }}>{clock(r.at)}</div>
              </div>
              <div style={{ fontSize: 14, fontWeight: 600, color: '#484848' }}>{r.punchType === 'in' ? 'In' : 'Out'}</div>
              <div style={{ fontSize: 14, fontWeight: 600, color: '#484848' }}>{r.reason}</div>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: '#484848', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.place}</div>
                <a
                  href={`https://maps.google.com/?q=${r.latitude},${r.longitude}`}
                  target="_blank"
                  rel="noreferrer"
                  style={{ fontSize: 12.5, color: '#0571A6', textDecoration: 'none', fontVariantNumeric: 'tabular-nums' }}
                >
                  {r.latitude.toFixed(5)}, {r.longitude.toFixed(5)} ↗
                </a>
              </div>
              <div style={{ fontSize: 15, fontWeight: 600, color: '#484848', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={r.manager}>
                {r.manager || '—'}
              </div>
              <div title={r.managerNote || ''}>
                <Pill label={status.label} tone={status.tone} />
              </div>
            </div>
          );
        })}
        {!loading && shown.length === 0 && <EmptyRow text="No out-of-location punches in this range." />}
        {loading && rows.length === 0 && <EmptyRow text="Loading…" />}
      </Card>
    </div>
  );
}
