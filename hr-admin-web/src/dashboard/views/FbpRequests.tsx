// Payroll › FBP requests: the bills employees upload on the app's FBP page,
// one per month for each FBP head (Fuel, Internet…). FBP is part of salary:
// the head is paid every month with the salary, so a bill is never paid
// again. Approving it makes that much of the head tax-free; a month without
// an approved bill stays taxable. Rejecting needs a reason, which the
// employee reads on the app and can upload again.
//
// These bills used to sit among Reimbursement requests; they are kept as
// claims of a bill type linked to the head, and now listed only here.
import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useStore } from '../store';
import { ApiError } from '../../services/http';
import { decideFbpRequest, listFbpRequests } from '../../services/payroll';
import type { FbpRequestDTO, FbpRequestsDTO, FbpRequestStatus } from '../../services/payroll';
import { useLoad } from '../useLoad';
import { Card, EmptyRow, ListPending, Pill, SearchInput, SelectBox, StatusTabs, SummaryCard, Th } from '../ui';
import { PersonAvatar } from '../PersonAvatar';
import { STAT } from '../theme';
import type { Pill as PillTone } from '../theme';
import { btn, btnClass, cellName, cellSub, eyebrow, hint, iconBtn, TH, textareaStyle, toolbar, TR } from '../ds';
import { IconCheck, IconFile, IconX } from '../icons';
import { refreshFbpBadge } from '../fbpBadge';

const COLS = '1.6fr 1.3fr 0.9fr 0.9fr 1.4fr 0.9fr 1.2fr 1fr';

type Filter = 'all' | FbpRequestStatus;
const LABEL: Record<FbpRequestStatus, string> = { pending: 'Pending', approved: 'Approved', rejected: 'Rejected' };
const TONE: Record<FbpRequestStatus, PillTone> = { pending: STAT.Pending, approved: STAT.Approved, rejected: STAT.Declined };

/** "2026-27" for a day in April 2026 to March 2027. */
export function fyOfDate(d: Date): string {
  const y = d.getFullYear();
  const start = d.getMonth() >= 3 ? y : y - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
}
export function previousFy(fy: string): string {
  const start = Number(fy.slice(0, 4)) - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
}
export const money = (paise: number) => '₹' + (paise / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 });
export const dateLabel = (iso: string) => new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
export const monthLabel = (period: string) => new Date(`${period}-01T00:00:00Z`).toLocaleDateString('en-IN', { month: 'short', year: 'numeric', timeZone: 'UTC' });

export function FbpRequests() {
  const { flash } = useStore();
  const thisFy = fyOfDate(new Date());
  const [fy, setFy] = useState(thisFy);
  const [filter, setFilter] = useState<Filter>('pending');
  const [search, setSearch] = useState('');
  const [head, setHead] = useState('all');
  const [deciding, setDeciding] = useState<{ bill: FbpRequestDTO; decision: 'approve' | 'reject' } | null>(null);
  const [preview, setPreview] = useState<FbpRequestDTO | null>(null);

  // Every bill of the year at once: the counts per status come from the same list.
  const list = useLoad(() => listFbpRequests(fy), [fy]);
  const bills = useMemo(() => list.data?.requests ?? [], [list.data]);
  useEffect(() => {
    if (list.state === 'error') flash(list.error instanceof ApiError ? list.error.message : 'Could not load the FBP bills', 'error');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list.state]);

  const counts = useMemo(() => {
    const c: Record<Filter, number> = { all: bills.length, pending: 0, approved: 0, rejected: 0 };
    for (const b of bills) c[b.status] += 1;
    return c;
  }, [bills]);
  const heads = useMemo(() => [...new Map(bills.map((b) => [b.headCode, b.headName])).entries()].sort((a, b) => a[1].localeCompare(b[1])), [bills]);
  const q = search.trim().toLowerCase();
  const rows = bills.filter((b) =>
    (filter === 'all' || b.status === filter)
    && (head === 'all' || b.headCode === head)
    && (!q || b.employee.name.toLowerCase().includes(q) || (b.employee.employeeId ?? '').toLowerCase().includes(q)));
  const pendingValue = bills.filter((b) => b.status === 'pending').reduce((t, b) => t + b.amountPaise, 0);
  const approvedValue = bills.filter((b) => b.status === 'approved').reduce((t, b) => t + b.amountPaise, 0);
  const fyOptions = [thisFy, previousFy(thisFy), previousFy(previousFy(thisFy))];
  const ready = list.state === 'ready';
  const otherYears = list.data?.pendingOtherYears ?? 0;

  const decided = (bill: FbpRequestDTO) => {
    list.setData((d): FbpRequestsDTO => {
      const requests = (d?.requests ?? []).map((x) => (x.id === bill.id ? bill : x));
      const c = { pending: 0, approved: 0, rejected: 0 };
      for (const r of requests) c[r.status] += 1;
      return { fy: d?.fy ?? fy, requests, counts: c, pendingOtherYears: d?.pendingOtherYears ?? 0 };
    });
    setDeciding(null);
    refreshFbpBadge();
    flash(bill.status === 'approved'
      ? `${bill.headName} bill for ${monthLabel(bill.period)} approved for ${bill.employee.name}`
      : `${bill.headName} bill for ${monthLabel(bill.period)} sent back to ${bill.employee.name}`);
  };

  return (
    <div style={{ animation: 'fade .3s ease both' }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 16, marginBottom: 20 }}>
        <SummaryCard label="To review" value={ready ? counts.pending : '—'} sub={ready ? money(pendingValue) : undefined} onClick={() => setFilter('pending')} active={filter === 'pending'} color="var(--warn)" />
        <SummaryCard label="Approved" value={ready ? counts.approved : '—'} sub={ready ? `${money(approvedValue)} tax-free` : undefined} onClick={() => setFilter('approved')} active={filter === 'approved'} />
        <SummaryCard label="Rejected" value={ready ? counts.rejected : '—'} sub="Waiting for the employee to upload again" onClick={() => setFilter('rejected')} active={filter === 'rejected'} />
        <SummaryCard label="All bills" value={ready ? counts.all : '—'} sub={`FY ${fy}`} onClick={() => setFilter('all')} active={filter === 'all'} />
      </div>

      <Card padded>
        <div style={toolbar}>
          <StatusTabs<Filter>
            options={['pending', 'approved', 'rejected', 'all']}
            active={filter}
            onSelect={setFilter}
            labels={{ pending: 'Pending', approved: 'Approved', rejected: 'Rejected', all: 'All' }}
            counts={ready ? counts : undefined}
          />
        </div>
        <div style={toolbar}>
          <div style={{ flex: 1, minWidth: 262, display: 'flex' }}>
            <SearchInput value={search} onChange={setSearch} placeholder="Search by employee name or ID…" width="100%" />
          </div>
          <SelectBox value={head} onChange={setHead}>
            <option value="all">All FBP heads</option>
            {heads.map(([code, name]) => <option key={code} value={code}>{name}</option>)}
          </SelectBox>
          <SelectBox value={fy} onChange={setFy}>
            {fyOptions.map((f) => <option key={f} value={f}>FY {f}</option>)}
          </SelectBox>
        </div>
        {ready && otherYears > 0 && (
          <div style={{ ...hint, marginBottom: 12, color: 'var(--warn)' }}>
            {otherYears} more pending {otherYears === 1 ? 'bill is' : 'bills are'} dated in another FY. Pick that FY above to see {otherYears === 1 ? 'it' : 'them'}.
          </div>
        )}

        <div style={TH(COLS)}>
          <Th>EMPLOYEE</Th>
          <Th>FBP HEAD</Th>
          <Th>MONTH</Th>
          <Th align="right">AMOUNT</Th>
          <Th>FILE</Th>
          <Th>UPLOADED</Th>
          <Th>STATUS</Th>
          <Th align="right">ACTION</Th>
        </div>
        {ready && rows.map((b, i) => (
          <div key={b.id} className="dc-row" style={TR(COLS, i === rows.length - 1)}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
              <PersonAvatar name={b.employee.name} userId={b.userId} />
              <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
                <div style={{ ...cellName, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{b.employee.name}</div>
                <div style={cellSub}>{[b.employee.employeeId, b.employee.department].filter(Boolean).join(' · ') || '—'}</div>
              </div>
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={b.headName}>{b.headName}</div>
              <div style={cellSub}>{b.billType} bills</div>
            </div>
            <div>{monthLabel(b.period)}</div>
            <div style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 500 }}>{money(b.amountPaise)}</div>
            {b.hasFile ? (
              <button onClick={() => setPreview(b)} title="Preview the bill" style={fileLink}>
                <span style={{ display: 'inline-flex', flexShrink: 0 }}><IconFile size={15} /></span>
                <span style={{ minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{b.fileName || 'Bill'}</span>
              </button>
            ) : <div style={{ color: 'var(--ink-3)' }}>No file</div>}
            <div>{dateLabel(b.uploadedAt)}</div>
            <div style={{ minWidth: 0 }}>
              <Pill label={LABEL[b.status]} tone={TONE[b.status]} />
              {b.status === 'rejected' && b.reason && <div style={{ ...cellSub, marginTop: 4, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={b.reason}>{b.reason}</div>}
              {b.status !== 'pending' && b.decidedAt && <div style={{ ...cellSub, marginTop: 2 }}>{dateLabel(b.decidedAt)}</div>}
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 7 }}>
              {b.status === 'pending' ? (
                <>
                  <button onClick={() => setDeciding({ bill: b, decision: 'reject' })} title="Reject" className={btnClass('no')} style={btn('no', 'sm')}><IconX /></button>
                  <button onClick={() => setDeciding({ bill: b, decision: 'approve' })} title="Approve" className={btnClass('ok')} style={btn('ok', 'sm')}><IconCheck /></button>
                </>
              ) : b.hasFile ? (
                <button onClick={() => setPreview(b)} title="Preview the bill" className="ds-icon-btn" style={iconBtn(34)}><IconFile /></button>
              ) : null}
            </div>
          </div>
        ))}
        <ListPending state={list.state} onRetry={list.retry} cols={6} />
        {ready && rows.length === 0 && (
          <EmptyRow text={bills.length === 0 ? `No FBP bills uploaded for FY ${fy} yet.` : filter === 'pending' && !q && head === 'all' ? 'Nothing waiting for review.' : 'No bills match your filters.'} />
        )}
        <div style={{ ...hint, marginTop: 12 }}>
          FBP heads are paid with the salary every month. An approved bill is not paid again: it makes that much of the head tax-free. A month without an approved bill stays taxable.
        </div>
      </Card>

      {deciding && <DecisionModal bill={deciding.bill} decision={deciding.decision} onCancel={() => setDeciding(null)} onDone={decided} />}
      {preview && <PreviewModal bill={preview} onClose={() => setPreview(null)} onDecide={(decision) => { setPreview(null); setDeciding({ bill: preview, decision }); }} />}
    </div>
  );
}

function Overlay({ children, onClose, width }: { children: React.ReactNode; onClose: () => void; width: number }) {
  return createPortal(
    <div style={{ position: 'fixed', inset: 0, zIndex: 85, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div onClick={onClose} style={{ position: 'absolute', inset: 0, background: 'var(--scrim)', animation: 'ovl .2s ease both' }} />
      <div role="dialog" aria-modal="true" style={{ position: 'relative', width: `min(${width}px, calc(100% - 32px))`, maxHeight: 'calc(100% - 48px)', overflow: 'auto', background: 'var(--surface)', borderRadius: 'var(--r-lg)', boxShadow: 'var(--shadow-drawer)', animation: 'pop .2s ease both', padding: 20 }}>
        {children}
      </div>
    </div>,
    document.body,
  );
}

function PreviewModal({ bill, onClose, onDecide }: { bill: FbpRequestDTO; onClose: () => void; onDecide: (d: 'approve' | 'reject') => void }) {
  const isPdf = (bill.fileType ?? '').includes('pdf') || /\.pdf$/i.test(bill.fileName ?? '');
  const isImage = (bill.fileType ?? '').startsWith('image/') || /\.(jpe?g|png|webp|gif|heic)$/i.test(bill.fileName ?? '');
  return (
    <Overlay onClose={onClose} width={760}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 14 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 16, fontWeight: 600, lineHeight: 1.5 }}>{bill.headName} · {monthLabel(bill.period)}</div>
          <div style={{ fontSize: 13.5, color: 'var(--ink-2)', marginTop: 2 }}>
            {bill.employee.name} · {money(bill.amountPaise)} on the bill · uploaded {dateLabel(bill.uploadedAt)}
          </div>
        </div>
        <button onClick={onClose} title="Close" className="ds-icon-btn" style={iconBtn(34)}><IconX /></button>
      </div>
      <div style={{ border: '1px solid var(--line)', borderRadius: 'var(--r)', overflow: 'hidden', background: 'var(--surface-2, var(--surface))', minHeight: 200, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {!bill.fileUrl ? (
          <div style={{ ...hint, padding: 32 }}>The file can't be shown here: storage is not reachable from this server.</div>
        ) : isImage ? (
          <img src={bill.fileUrl} alt={bill.fileName ?? 'Bill'} style={{ maxWidth: '100%', maxHeight: '60vh', display: 'block' }} />
        ) : isPdf ? (
          <iframe src={bill.fileUrl} title={bill.fileName ?? 'Bill'} style={{ width: '100%', height: '60vh', border: 0 }} />
        ) : (
          <div style={{ ...hint, padding: 32 }}>This file type can't be previewed. Open it instead.</div>
        )}
      </div>
      {bill.status === 'rejected' && bill.reason && <div style={{ ...hint, marginTop: 10 }}>Rejected: {bill.reason}</div>}
      <div style={{ display: 'flex', gap: 8, marginTop: 16, justifyContent: 'flex-end' }}>
        {bill.fileUrl && <a href={bill.fileUrl} target="_blank" rel="noopener noreferrer" className={btnClass()} style={{ ...btn(), textDecoration: 'none' }}>Open in a new tab</a>}
        {bill.status === 'pending' && (
          <>
            <button onClick={() => onDecide('reject')} className={btnClass('danger')} style={btn('danger')}>Reject</button>
            <button onClick={() => onDecide('approve')} className={btnClass('primary')} style={btn('primary')}>Approve</button>
          </>
        )}
      </div>
    </Overlay>
  );
}

function DecisionModal({ bill, decision, onCancel, onDone }: {
  bill: FbpRequestDTO;
  decision: 'approve' | 'reject';
  onCancel: () => void;
  onDone: (b: FbpRequestDTO) => void;
}) {
  const { flash } = useStore();
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const approve = decision === 'approve';
  const trimmed = reason.trim();
  const valid = approve || (trimmed.length >= 3 && trimmed.length <= 500);
  const confirm = async () => {
    if (!valid || saving) return;
    setSaving(true);
    try {
      onDone(await decideFbpRequest(bill.id, decision, approve ? undefined : trimmed));
    } catch (e) {
      flash(e instanceof ApiError ? e.message : 'Could not save the decision', 'error');
      setSaving(false);
    }
  };
  return (
    <Overlay onClose={onCancel} width={520}>
      <div style={{ width: 40, height: 40, borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 12, background: approve ? 'var(--ok-bg)' : 'var(--bad-bg)' }}>
        {approve ? <IconCheck /> : <IconX />}
      </div>
      <div style={{ fontSize: 16, fontWeight: 600, lineHeight: 1.5 }}>{approve ? 'Approve this FBP bill?' : 'Reject this FBP bill?'}</div>
      <div style={{ fontSize: 13.5, color: 'var(--ink-2)', marginTop: 4, lineHeight: 1.55 }}>
        {bill.employee.name} · {bill.headName} for {monthLabel(bill.period)} · {money(bill.amountPaise)} on the bill.
        {approve
          ? ' It is not paid again: that much of the head becomes tax-free from the next payroll run.'
          : ' The employee sees your reason on the app and can upload the bill again.'}
      </div>
      {!approve && (
        <>
          <div style={{ ...eyebrow, marginTop: 16, marginBottom: 8 }}>REASON — THE EMPLOYEE READS THIS</div>
          <textarea
            autoFocus
            value={reason}
            maxLength={500}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. The total on the bill isn't readable. Upload a clearer photo where the amount and date can be seen."
            className="ds-inp"
            style={{ ...textareaStyle, resize: 'none' }}
          />
          <div style={{ ...hint, marginTop: 6 }}>{trimmed.length < 3 ? 'Required: at least 3 characters.' : `${trimmed.length} / 500`}</div>
        </>
      )}
      <div style={{ display: 'flex', gap: 8, marginTop: 20, justifyContent: 'flex-end' }}>
        <button onClick={onCancel} className={btnClass()} style={btn()}>Cancel</button>
        <button onClick={() => void confirm()} disabled={!valid || saving} className={btnClass(approve ? 'primary' : 'danger')} style={{ ...btn(approve ? 'primary' : 'danger'), opacity: !valid || saving ? 0.55 : 1, cursor: !valid || saving ? 'default' : 'pointer' }}>
          {saving ? 'Saving…' : approve ? 'Approve' : 'Reject'}
        </button>
      </div>
    </Overlay>
  );
}

const fileLink = {
  display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, background: 'none', border: 'none', padding: 0, cursor: 'pointer',
  color: 'var(--accent-ink)', fontSize: 13, fontFamily: 'inherit', textAlign: 'left' as const,
};
