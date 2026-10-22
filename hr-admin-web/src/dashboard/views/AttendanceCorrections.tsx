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
import { Card, DateRange, EmptyRow, ListPending, LoadingFigure, PageActions, Pill, SearchInput, StatusTabs, SummaryCard, Th } from '../ui';
import { PersonAvatar } from '../PersonAvatar';
import { btn, btnClass, cellName, cellSub, textareaStyle, TH, toolbar, TR } from '../ds';
import { IconDownload } from '../icons';
import { SuwiInsight } from '../suwi/SuwiInsight';

const COLS = '1.8fr .9fr .9fr 1fr 1fr 1.6fr 1fr 1.3fr';

const DAY_TONE = { bg: 'var(--accent-soft)', fg: 'var(--accent-ink)' };

export function AttendanceCorrections() {
  const s = useStore();
  const st = s.listState('corrections');
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
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 16, marginBottom: 20 }}>
        <SummaryCard label="Total corrections" value={<LoadingFigure state={st}>{summary.total}</LoadingFigure>} />
        <SummaryCard label="Pending" value={<LoadingFigure state={st}>{summary.pending}</LoadingFigure>} color="var(--warn)" />
        <SummaryCard label="Approved" value={<LoadingFigure state={st}>{summary.approved}</LoadingFigure>} color="var(--ok)" />
        <SummaryCard label="Declined" value={<LoadingFigure state={st}>{summary.declined}</LoadingFigure>} color="var(--bad)" />
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
          active={s.corrStatus}
          onSelect={s.setCorrStatus}
        />
      </div>
      <div style={toolbar}>
        <div style={{ flex: 1, minWidth: 262, display: 'flex' }}>
          <SearchInput value={s.corrSearch} onChange={s.setCorrSearch} placeholder="Search employee or manager…" width="100%" />
        </div>
        <DateRange from={s.corrFrom} to={s.corrTo} onFrom={s.setCorrFrom} onTo={s.setCorrTo} />
      </div>

        <div style={TH(COLS)}>
          <Th>EMPLOYEE</Th>
          <Th>RAISED ON</Th>
          <Th>WORK DATE</Th>
          <Th>REQUESTED AS</Th>
          <Th>RECORDED</Th>
          <Th>REASON</Th>
          <Th>MANAGER</Th>
          <Th>STATUS</Th>
        </div>
        {rows.map((r, i) => (
          <div
            key={r.id}
            style={{ ...TR(COLS, i === rows.length - 1) }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
              <PersonAvatar name={r.name} userId={r.submitterId} />
              <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
                <div style={{ ...cellName, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.name}</div>
                <div style={{ ...cellSub, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {r.employeeCode} · {r.team}
                </div>
              </div>
            </div>
            <div style={{ fontWeight: 400 }}>{r.appliedOn}</div>
            <div style={{ fontWeight: 400 }}>
              {r.workDate}
              <div style={cellSub}>{r.day}</div>
            </div>
            <div><Pill label={r.dayType} tone={DAY_TONE} /></div>
            <div style={{ fontSize: 13, fontWeight: 400, color: r.recorded === 'No punch' ? 'var(--warn)' : 'var(--ink-2)' }}>{r.recorded}</div>
            <div style={{ fontWeight: 400, color: r.eRemark ? 'var(--ink)' : 'var(--ink-3)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={r.eRemark || ''}>
              {r.eRemark || '—'}
            </div>
            <div style={{ fontWeight: 400, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={r.manager}>
              {r.manager || '—'}
            </div>
            {r.status === 'Pending' ? (
              <div style={{ display: 'flex', gap: 6 }}>
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
        <ListPending state={st} onRetry={() => void s.reload()} cols={7} />
        {st === 'ready' && rows.length === 0 && <EmptyRow text="No attendance corrections match your filters." />}
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
      className={btnClass(approve ? 'ok' : 'no')}
      style={btn(approve ? 'ok' : 'no', 'sm')}
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
      style={{ position: 'fixed', inset: 0, background: 'var(--scrim)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 60, animation: 'ovl .2s ease both' }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ width: 'min(520px, calc(100% - 32px))', background: 'var(--surface)', borderRadius: 'var(--r-lg)', padding: 20, boxShadow: 'var(--shadow-drawer)', animation: 'pop .2s ease both' }}
      >
        <div style={{ fontSize: 16, fontWeight: 600, lineHeight: 1.5, marginBottom: 4 }}>
          {approve ? 'Approve' : 'Decline'} this correction?
        </div>
        <div style={{ fontSize: 13.5, color: 'var(--ink-2)', fontWeight: 400, lineHeight: 1.55, marginBottom: 16 }}>
          {row
            ? `${row.name}’s ${row.workDate} will be ${approve ? `recorded as ${row.dayType.toLowerCase()}` : 'left as it is'}. ${row.manager ? `${row.manager} is the approver — this overrides them.` : ''}`
            : ''}
        </div>
        {row && <SuwiInsight kind="correction" id={row.id} pending={row.status === 'Pending'} />}
        <textarea
          value={s.corrNote}
          onChange={(e) => s.setCorrNote(e.target.value)}
          placeholder="Add a note for the employee (optional)"
          rows={3}
          className="ds-inp"
          style={{ ...textareaStyle, marginBottom: 20 }}
        />
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button
            type="button"
            onClick={s.corrCloseConfirm}
            className={btnClass()}
            style={btn()}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={s.corrDecide}
            className={btnClass(approve ? 'primary' : 'danger')}
            style={btn(approve ? 'primary' : 'danger')}
          >
            {approve ? 'Approve' : 'Decline'}
          </button>
        </div>
      </div>
    </div>
  );
}
