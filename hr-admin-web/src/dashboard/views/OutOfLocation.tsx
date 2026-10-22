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
import { Avatar, Card, DateRange, EmptyRow, PageActions, Pill, SearchInput, SummaryCard, Th } from '../ui';
import { btn, btnClass, cellName, cellSub, SEG, segBtn, TH, toolbar, TR } from '../ds';
import { IconDownload } from '../icons';
import { getOutOfLocation, type OutOfLocationDTO } from '../../services/hrms';

const COLS = '1.8fr 1.1fr .7fr 1.2fr 1.5fr 1.2fr 1.3fr';

const PRESENT_TONE = { bg: 'var(--ok-bg)', fg: 'var(--ok)' };

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
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 16, marginBottom: 20 }}>
        <SummaryCard label="Out-of-location punches" value={summary.total} />
        <SummaryCard label="Marked present" value={summary.present} color="var(--ok)" />
        <SummaryCard label="Awaiting a manager" value={summary.pending} color="var(--warn)" />
        <SummaryCard label="Rejected" value={summary.declined} color="var(--bad)" />
      </div>

      <PageActions>
        <button onClick={exportRows} disabled={shown.length === 0} className={btnClass()} style={btn()}>
          <IconDownload stroke="currentColor" /> Export
        </button>
      </PageActions>

      <Card padded>
      <div style={toolbar}>
        <div style={SEG}>
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => setFilter(t.key)}
              style={segBtn(filter === t.key)}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>
      <div style={toolbar}>
        <div style={{ flex: 1, minWidth: 262, display: 'flex' }}>
          <SearchInput value={search} onChange={setSearch} placeholder="Search employee or manager…" width="100%" />
        </div>
        <DateRange from={from} to={to} onFrom={setFrom} onTo={setTo} />
      </div>

        <div style={TH(COLS)}>
          <Th>EMPLOYEE</Th>
          <Th>DATE &amp; TIME</Th>
          <Th>PUNCH</Th>
          <Th>REASON</Th>
          <Th>LOCATION</Th>
          <Th>MANAGER</Th>
          <Th>STATUS</Th>
        </div>
        {shown.map((r, i) => {
          const status = statusOf(r);
          return (
            <div key={r.id} style={{ ...TR(COLS, i === shown.length - 1) }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
                <Avatar name={r.name} />
                <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <div style={{ ...cellName, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.name}</div>
                  <div style={{ ...cellSub, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {r.employeeCode}{r.department ? ` · ${r.department}` : ''}
                  </div>
                </div>
              </div>
              <div style={{ fontWeight: 400 }}>
                {fmtDay(r.workDate)}
                <div style={cellSub}>{clock(r.at)}</div>
              </div>
              <div style={{ fontWeight: 400 }}>{r.punchType === 'in' ? 'In' : 'Out'}</div>
              <div style={{ fontWeight: 400 }}>{r.reason}</div>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 400, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.place}</div>
                <a
                  href={`https://maps.google.com/?q=${r.latitude},${r.longitude}`}
                  target="_blank"
                  rel="noreferrer"
                  style={{ fontSize: 11.5, color: 'var(--accent-ink)', textDecoration: 'none', fontVariantNumeric: 'tabular-nums' }}
                >
                  {r.latitude.toFixed(5)}, {r.longitude.toFixed(5)} ↗
                </a>
              </div>
              <div style={{ fontWeight: 400, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={r.manager}>
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
