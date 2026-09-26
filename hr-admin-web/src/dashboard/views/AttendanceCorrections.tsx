// Requests › Attendance — corrections employees raised against a day.
//
// The same queue a manager sees in the app, but org-wide: HR is asking what is
// outstanding anywhere, not what is waiting on them, so every row names the
// manager it actually belongs to. Deciding from here is an override, which is
// why it goes through the confirm modal the overtime queue uses.
import { useStore } from '../store';
import { STAT } from '../theme';
import type { ReqStatus } from '../theme';
import type { Correction } from '../seed';
import { inDateRange } from '../adapters';
import { downloadCsv } from '../export';
import { Avatar, Card, DateRange, EmptyRow, Pill, SearchInput, StatusTabs, SummaryCard } from '../ui';
import { IconDownload } from '../icons';

const COLS = '1.8fr .9fr .9fr 1fr 1fr 1.6fr 1fr 1.3fr';

const DAY_TONE = { bg: '#E7F2F7', fg: '#0571A6' };

export function AttendanceCorrections() {
  const s = useStore();
  const ranged = s.corrs.filter((r) => inDateRange(r.refISO, s.corrFrom, s.corrTo));
  const summary = {
    total: ranged.length,
    pending: ranged.filter((r) => r.status === 'Pending').length,
    approved: ranged.filter((r) => r.status === 'Approved').length,
    declined: ranged.filter((r) => r.status === 'Declined').length,
  };

  let rows = ranged.slice();
  const q = s.corrSearch.trim().toLowerCase();
  if (q) {
    rows = rows.filter(
      (r) => r.name.toLowerCase().includes(q)
        || r.employeeCode.toLowerCase().includes(q)
        || r.manager.toLowerCase().includes(q),
    );
  }
  if (s.corrStatus !== 'all') rows = rows.filter((r) => r.status === s.corrStatus);
  rows.sort((a, b) => b.ord - a.ord);

  const exportRows = () =>
    downloadCsv<Correction>(
      'attendance-corrections',
      [
        { header: 'Employee', value: (r) => r.name },
        { header: 'Employee ID', value: (r) => r.employeeCode },
        { header: 'Team', value: (r) => r.team },
        { header: 'Raised on', value: (r) => r.appliedOn },
        { header: 'Work date', value: (r) => r.workDate },
        { header: 'Day', value: (r) => r.day },
        { header: 'Requested as', value: (r) => r.dayType },
        { header: 'Recorded punches', value: (r) => r.recorded },
        { header: 'Reason', value: (r) => r.eRemark },
        { header: 'Manager', value: (r) => r.manager },
        { header: 'Status', value: (r) => r.status },
        { header: 'Decision note', value: (r) => r.mRemark },
        { header: 'Decided by', value: (r) => (r.byAdmin ? 'admin' : 'manager') },
      ],
      rows,
    );

  return (
    <div style={{ animation: 'fade .3s ease both' }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 14, marginBottom: 20 }}>
        <SummaryCard label="Total corrections" value={summary.total} />
        <SummaryCard label="Pending" value={summary.pending} color="#9A6B25" />
        <SummaryCard label="Approved" value={summary.approved} color="#4F7A52" />
        <SummaryCard label="Declined" value={summary.declined} color="#A8475F" />
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 11, marginBottom: 14, flexWrap: 'wrap' }}>
        <SearchInput value={s.corrSearch} onChange={s.setCorrSearch} placeholder="Search employee or manager…" />
        <StatusTabs<ReqStatus | 'all'>
          options={['all', 'Pending', 'Approved', 'Declined']}
          active={s.corrStatus}
          onSelect={s.setCorrStatus}
        />
        <DateRange from={s.corrFrom} to={s.corrTo} onFrom={s.setCorrFrom} onTo={s.setCorrTo} />
        <button
          onClick={exportRows}
          disabled={rows.length === 0}
          style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8, background: '#222222', border: 'none', color: '#fff', borderRadius: 11, padding: '9px 15px', fontSize: 14, fontWeight: 700, fontFamily: 'inherit', cursor: rows.length ? 'pointer' : 'not-allowed', opacity: rows.length ? 1 : 0.5 }}
        >
          <IconDownload /> Export
        </button>
      </div>

      <Card>
        <div style={{ display: 'grid', gridTemplateColumns: COLS, gap: 12, padding: '14px 22px', borderBottom: '1px solid #F0F0F2', fontSize: 12, fontWeight: 700, letterSpacing: '.5px', color: '#717171' }}>
          <div>EMPLOYEE</div>
          <div>RAISED ON</div>
          <div>WORK DATE</div>
          <div>REQUESTED AS</div>
          <div>RECORDED</div>
          <div>REASON</div>
          <div>MANAGER</div>
          <div>STATUS</div>
        </div>
        {rows.map((r) => (
          <div
            key={r.id}
            style={{ display: 'grid', gridTemplateColumns: COLS, gap: 12, padding: '14px 22px', borderBottom: '1px solid #F0F0F2', alignItems: 'center' }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 11, minWidth: 0 }}>
              <Avatar name={r.name} />
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 16, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.name}</div>
                <div style={{ fontSize: 14, color: '#717171', fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {r.employeeCode} · {r.team}
                </div>
              </div>
            </div>
            <div style={{ fontSize: 16, fontWeight: 600, color: '#484848' }}>{r.appliedOn}</div>
            <div style={{ fontSize: 16, fontWeight: 600, color: '#484848' }}>
              {r.workDate}
              <div style={{ fontSize: 13, color: '#9197A2', fontWeight: 500 }}>{r.day}</div>
            </div>
            <div><Pill label={r.dayType} tone={DAY_TONE} /></div>
            <div style={{ fontSize: 14, fontWeight: 600, color: r.recorded === 'No punch' ? '#B25A1B' : '#484848' }}>{r.recorded}</div>
            <div style={{ fontSize: 14, fontWeight: 500, color: r.eRemark ? '#484848' : '#9197A2', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={r.eRemark || ''}>
              {r.eRemark || '—'}
            </div>
            <div style={{ fontSize: 15, fontWeight: 600, color: '#484848', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={r.manager}>
              {r.manager || '—'}
            </div>
            {r.status === 'Pending' ? (
              <div style={{ display: 'flex', gap: 7 }}>
                <DecideButton label="Approve" tone="approve" onClick={() => s.corrAsk(r.id, 'approve')} />
                <DecideButton label="Decline" tone="decline" onClick={() => s.corrAsk(r.id, 'decline')} />
              </div>
            ) : (
              <div title={r.mRemark || ''}>
                <Pill label={r.byAdmin ? `${r.status} · by admin` : r.status} tone={STAT[r.status]} />
              </div>
            )}
          </div>
        ))}
        {rows.length === 0 && <EmptyRow text="No attendance corrections match your filters." />}
      </Card>

      {s.corrConfirm && <ConfirmOverride />}
    </div>
  );
}

function DecideButton({ label, tone, onClick }: { label: string; tone: 'approve' | 'decline'; onClick: () => void }) {
  const approve = tone === 'approve';
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        border: `1px solid ${approve ? '#CADFC9' : '#EED6DC'}`,
        background: approve ? '#E6F1E7' : '#F8E3E7',
        color: approve ? '#4F7A52' : '#A8475F',
        borderRadius: 9, padding: '6px 12px', fontSize: 13, fontWeight: 700,
        fontFamily: 'inherit', cursor: 'pointer',
      }}
    >
      {label}
    </button>
  );
}

/** HR is overriding the reporting manager, so the note is worth capturing. */
function ConfirmOverride() {
  const s = useStore();
  if (!s.corrConfirm) return null;
  const { id, action } = s.corrConfirm;
  const row = s.corrs.find((r) => r.id === id);
  const approve = action === 'approve';
  return (
    <div
      onClick={s.corrCloseConfirm}
      style={{ position: 'fixed', inset: 0, background: 'rgba(20,20,24,.38)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 60 }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ width: 430, background: '#fff', borderRadius: 18, padding: 24, boxShadow: '0 24px 60px rgba(0,0,0,.25)' }}
      >
        <div style={{ fontSize: 19, fontWeight: 800, letterSpacing: '-.3px', marginBottom: 6 }}>
          {approve ? 'Approve' : 'Decline'} this correction?
        </div>
        <div style={{ fontSize: 15, color: '#717171', fontWeight: 500, lineHeight: 1.5, marginBottom: 16 }}>
          {row
            ? `${row.name}’s ${row.workDate} will be ${approve ? `recorded as ${row.dayType.toLowerCase()}` : 'left as it is'}. ${row.manager ? `${row.manager} is the approver — this overrides them.` : ''}`
            : ''}
        </div>
        <textarea
          value={s.corrNote}
          onChange={(e) => s.setCorrNote(e.target.value)}
          placeholder="Add a note for the employee (optional)"
          rows={3}
          style={{ width: '100%', border: '1px solid #EBEBEB', borderRadius: 11, padding: '11px 13px', fontSize: 15, fontFamily: 'inherit', outline: 'none', resize: 'vertical', boxSizing: 'border-box', marginBottom: 16 }}
        />
        <div style={{ display: 'flex', gap: 9, justifyContent: 'flex-end' }}>
          <button
            type="button"
            onClick={s.corrCloseConfirm}
            style={{ border: '1px solid #EBEBEB', background: '#F7F7F9', color: '#484848', borderRadius: 11, padding: '10px 16px', fontSize: 15, fontWeight: 700, fontFamily: 'inherit', cursor: 'pointer' }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={s.corrDecide}
            style={{ border: 'none', background: approve ? '#4F7A52' : '#A8475F', color: '#fff', borderRadius: 11, padding: '10px 18px', fontSize: 15, fontWeight: 700, fontFamily: 'inherit', cursor: 'pointer' }}
          >
            {approve ? 'Approve' : 'Decline'}
          </button>
        </div>
      </div>
    </div>
  );
}
