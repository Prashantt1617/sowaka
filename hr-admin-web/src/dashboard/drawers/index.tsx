import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { useStore } from '../store';
import { getReimbReceiptUrl } from '../../services/hrms';
import { avColor as avColorOf, ETYPE, initials as initialsOf, OTDUR, STAT, TYPE } from '../theme';
import type { LeaveType } from '../theme';
import { DOCS } from '../seed';
import type { Reimb } from '../seed';
import { Pill } from '../ui';
import { IconCheck, IconDownload, IconExternal, IconFile, IconStar, IconX } from '../icons';
import { CloseButton, DrawerHeader, DrawerShell, InfoGrid, RemarkBlock } from './shell';
import { AddUserModal } from './AddUserModal';

// Shared approve/decline footer for the leave / overtime / reimbursement drawers.
function DecisionFooter({
  onDecline,
  onApprove,
  approveLabel,
}: {
  onDecline: () => void;
  onApprove: () => void;
  approveLabel: string;
}) {
  return (
    <div style={{ position: 'sticky', bottom: 0, background: '#F7F7F9', borderTop: '1px solid #EBEBEB', padding: '16px 24px', display: 'flex', gap: 11 }}>
      <button onClick={onDecline} style={{ flex: 1, border: '1px solid #EBD9DE', background: '#FBF1F3', color: '#A8475F', borderRadius: 12, padding: 13, fontSize: 16, fontWeight: 700, cursor: 'pointer' }}>Decline</button>
      <button onClick={onApprove} style={{ flex: 1.4, border: 'none', background: '#4F7A52', color: '#fff', borderRadius: 12, padding: 13, fontSize: 16, fontWeight: 700, cursor: 'pointer' }}>{approveLabel}</button>
    </div>
  );
}

// Confirmation screen shown before an HR dashboard user overrides a request.
// Always offers a note field so the reason for the override is captured.
function ConfirmOverrideModal({
  action,
  title,
  summary,
  note,
  onNote,
  onCancel,
  onConfirm,
  confirmLabel,
}: {
  action: 'approve' | 'decline';
  title: string;
  summary: ReactNode;
  note: string;
  onNote: (v: string) => void;
  onCancel: () => void;
  onConfirm: () => void;
  confirmLabel: string;
}) {
  const isApprove = action === 'approve';
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 85, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div onClick={onCancel} style={{ position: 'absolute', inset: 0, background: 'rgba(34,34,34,.5)', animation: 'ovl .2s ease both' }} />
      <div style={{ position: 'relative', width: 400, background: '#F7F7F9', borderRadius: 18, boxShadow: '0 30px 70px rgba(60,40,24,.32)', animation: 'pop .2s ease both', padding: 24 }}>
        <div style={{ width: 46, height: 46, borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 14, background: isApprove ? '#EDF3E9' : '#FBF1F3' }}>
          {isApprove ? <IconCheck /> : <IconX />}
        </div>
        <div style={{ fontSize: 20, fontWeight: 800, letterSpacing: '-.3px' }}>{title}</div>
        <div style={{ fontSize: 16, color: '#484848', fontWeight: 500, marginTop: 6, lineHeight: 1.55 }}>{summary}</div>
        <div style={{ fontSize: 14, color: '#717171', fontWeight: 700, letterSpacing: '.3px', marginTop: 16, marginBottom: 7 }}>
          NOTE — WHY ARE YOU OVERRIDING THIS?
        </div>
        <textarea
          value={note}
          onChange={(e) => onNote(e.target.value)}
          placeholder={isApprove ? 'e.g. Cleared with finance — approving on their behalf' : 'e.g. Out of policy — resubmit with manager sign-off'}
          style={{ width: '100%', height: 74, resize: 'none', border: '1px solid #EBEBEB', borderRadius: 10, padding: '10px 12px', fontSize: 16, outline: 'none', color: '#222222', boxSizing: 'border-box' }}
        />
        <div style={{ display: 'flex', gap: 10, marginTop: 18 }}>
          <button onClick={onCancel} style={{ flex: 1, border: '1px solid #EBEBEB', background: '#fff', borderRadius: 11, padding: 12, fontSize: 16, fontWeight: 700, color: '#484848', cursor: 'pointer' }}>Cancel</button>
          <button
            onClick={onConfirm}
            style={{ flex: 1.3, border: 'none', color: '#fff', borderRadius: 11, padding: 12, fontSize: 16, fontWeight: 700, cursor: 'pointer', background: isApprove ? '#4F7A52' : '#A8475F' }}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

function LeaveDrawer() {
  const s = useStore();
  const d = s.leaves.find((l) => l.id === s.drawerId);
  if (!d) return null;
  const close = () => s.setDrawerId(null);
  return (
    <DrawerShell onClose={close}>
      <DrawerHeader name={d.name} subtitle={`${d.team} · Applied ${d.applied}`} onClose={close} />
      <div style={{ padding: '20px 24px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
          <Pill label={d.byAdmin ? `${d.status} · by admin` : d.status} tone={STAT[d.status]} fontSize={13} padding="5px 13px" />
          <span style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 16, fontWeight: 600, color: '#484848' }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: TYPE[d.type as LeaveType] }} />
            {d.type} leave
          </span>
        </div>
        <InfoGrid
          cells={[
            { label: 'DATES', value: d.from === d.to ? d.from : `${d.from} – ${d.to}` },
            { label: 'DURATION', value: d.days },
            { label: 'MANAGER', value: d.manager },
            { label: 'APPLIED ON', value: d.applied },
          ]}
        />
        <RemarkBlock label="EMPLOYEE REMARK" text={d.eRemark || 'No remark provided.'} filled={!!d.eRemark} marginBottom={16} />
        <RemarkBlock label="MANAGER REMARK" text={d.mRemark || 'No remark yet.'} filled={!!d.mRemark} marginBottom={8} />
      </div>
      {d.status === 'Pending' && (
        <DecisionFooter onDecline={() => s.lvAsk(d.id, 'decline')} onApprove={() => s.lvAsk(d.id, 'approve')} approveLabel="Approve leave" />
      )}
    </DrawerShell>
  );
}

function OvertimeDrawer() {
  const s = useStore();
  const d = s.ots.find((o) => o.id === s.otDrawerId);
  if (!d) return null;
  const close = () => s.setOtDrawerId(null);
  return (
    <DrawerShell onClose={close}>
      <DrawerHeader name={d.name} subtitle={`${d.team} · Applied ${d.appliedOn}`} onClose={close} />
      <div style={{ padding: '20px 24px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
          <Pill label={d.byAdmin ? `${d.status} · by admin` : d.status} tone={STAT[d.status]} fontSize={13} padding="5px 13px" />
          <Pill label={d.duration} tone={OTDUR[d.duration]} fontSize={12.5} padding="5px 13px" />
        </div>
        <InfoGrid
          cells={[
            { label: 'OVERTIME DATE', value: d.otDate },
            { label: 'DAY', value: d.day },
            { label: 'DURATION', value: d.duration },
            { label: 'PROJECT', value: d.project || '—' },
          ]}
        />
        <RemarkBlock label="EMPLOYEE NOTE" text={d.eRemark || 'No note provided.'} filled={!!d.eRemark} marginBottom={16} />
        <RemarkBlock label="MANAGER REMARK" text={d.mRemark || 'No remark yet.'} filled={!!d.mRemark} />
      </div>
      {d.status === 'Pending' && (
        <DecisionFooter onDecline={() => s.otAsk(d.id, 'decline')} onApprove={() => s.otAsk(d.id, 'approve')} approveLabel="Approve overtime" />
      )}
    </DrawerShell>
  );
}

function FeedbackDrawer() {
  const s = useStore();
  const d = s.fbs.find((f) => f.id === s.fbDrawerId);
  if (!d) return null;
  const close = () => s.setFbDrawerId(null);
  return (
    <DrawerShell onClose={close}>
      <DrawerHeader name={d.name} subtitle={`${d.team} · Reviewed by ${d.manager}`} onClose={close} />
      <div style={{ padding: '20px 24px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
          <Pill label={d.isOverall ? 'Overall' : d.parameter} tone={{ bg: '#EFE7F2', fg: '#7E5FB0' }} fontSize={13} padding="5px 13px" />
          <span style={{ fontSize: 16, fontWeight: 600, color: '#484848' }}>{d.date}</span>
        </div>
        <InfoGrid
          cells={[
            { label: 'PARAMETER', value: d.parameter },
            {
              label: 'RATING',
              value: (
                <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <IconStar /> {d.rating > 0 ? `${d.rating.toFixed(1)} / 5` : '—'}
                </span>
              ),
            },
            { label: 'DESCRIPTION', value: d.ratingDesc },
            { label: 'MANAGER', value: d.manager },
          ]}
        />
        <div>
          <div style={{ fontSize: 14, color: '#717171', fontWeight: 700, letterSpacing: '.3px', marginBottom: 7 }}>{d.isOverall ? 'SUMMARY' : 'PARAMETER NOTE'}</div>
          <div style={{ background: '#fff', border: '1px solid #EBEBEB', borderRadius: 12, padding: '14px 15px', fontSize: 16, color: '#484848', lineHeight: 1.6, fontWeight: 500 }}>{d.note || d.text || '—'}</div>
        </div>
      </div>
    </DrawerShell>
  );
}

function ReimbursementDrawer() {
  const s = useStore();
  const d = s.rbs.find((r) => r.id === s.rbDrawerId);
  if (!d) return null;
  const close = () => s.setRbDrawerId(null);
  return (
    <DrawerShell onClose={close}>
      <DrawerHeader name={d.name} subtitle={`${d.team} · Applied ${d.applyDate}`} onClose={close} />
      <div style={{ padding: '20px 24px' }}>
        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: 18 }}>
          <div>
            <div style={{ fontSize: 12, color: '#717171', fontWeight: 600, marginBottom: 3 }}>{d.type} claim</div>
            <div style={{ fontSize: 34.5, fontWeight: 800, letterSpacing: '-1px' }}>{d.amount}</div>
          </div>
          <Pill label={d.status} tone={STAT[d.status]} fontSize={13} padding="5px 13px" />
        </div>
        <InfoGrid
          cells={[
            { label: 'BILL DATE', value: d.billDate },
            { label: 'APPLIED ON', value: d.applyDate },
            { label: 'MANAGER', value: d.manager },
            { label: 'TYPE', value: d.type },
          ]}
        />
        <div style={{ marginBottom: 18 }}>
          <div style={{ fontSize: 14, color: '#717171', fontWeight: 700, letterSpacing: '.3px', marginBottom: 7 }}>BILL ATTACHMENT</div>
          <button
            onClick={() => s.setRbBillId(d.id)}
            style={{ width: '100%', textAlign: 'left', display: 'flex', alignItems: 'center', gap: 12, background: '#fff', border: '1px solid #EBEBEB', borderRadius: 12, padding: '13px 15px', cursor: 'pointer' }}
          >
            <div style={{ width: 38, height: 38, borderRadius: 9, background: '#E7F4FB', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <IconFile />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 16, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{d.bill}</div>
              <div style={{ fontSize: 14, color: '#717171', fontWeight: 500 }}>Tap to view bill</div>
            </div>
            <IconExternal />
          </button>
        </div>
        <RemarkBlock label="EMPLOYEE REMARK" text={d.eRemark || 'No remark provided.'} filled={!!d.eRemark} marginBottom={16} />
        <RemarkBlock label="MANAGER REMARK" text={d.mRemark || 'No remark yet.'} filled={!!d.mRemark} />
      </div>
      {d.status === 'Pending' && (
        <DecisionFooter onDecline={() => s.rbAsk(d.id, 'decline')} onApprove={() => s.rbAsk(d.id, 'approve')} approveLabel="Approve claim" />
      )}
    </DrawerShell>
  );
}

function BillRow({ k, v }: { k: string; v: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', fontSize: 14 }}>
      <span style={{ color: '#717171', fontWeight: 600 }}>{k}</span>
      <span style={{ fontWeight: 700, color: '#3C352E' }}>{v}</span>
    </div>
  );
}

// Fallback receipt rendered from claim data when no real file was uploaded.
function FauxReceipt({ d }: { d: Reimb }) {
  return (
    <div style={{ background: '#fff', border: '1px solid #EBEBEB', borderRadius: 12, padding: '22px 22px 26px', boxShadow: '0 6px 18px rgba(70,50,30,.08)' }}>
      <div style={{ textAlign: 'center', borderBottom: '1px dashed #EBEBEB', paddingBottom: 14, marginBottom: 14 }}>
        <div style={{ fontSize: 20, fontWeight: 800, letterSpacing: '.5px' }}>{d.type.toUpperCase()} RECEIPT</div>
        <div style={{ fontSize: 14, color: '#717171', marginTop: 3, wordBreak: 'break-all' }}>{d.bill}</div>
      </div>
      <BillRow k="Employee" v={d.name} />
      <BillRow k="Bill date" v={d.billDate} />
      <BillRow k="Category" v={d.type} />
      <BillRow k="Submitted" v={d.applyDate} />
      <div style={{ borderTop: '1px dashed #EBEBEB', margin: '14px 0' }} />
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <span style={{ fontSize: 16, fontWeight: 700, color: '#484848' }}>Total</span>
        <span style={{ fontSize: 24, fontWeight: 800, letterSpacing: '-.5px' }}>{d.amount}</span>
      </div>
    </div>
  );
}

// Preview of the bill an employee uploaded against a claim. When a real file
// exists it's fetched via a short-lived presigned URL and rendered inline;
// otherwise a receipt is reconstructed from the claim data.
function RbBillModal() {
  const s = useStore();
  const billId = s.rbBillId;
  const d = s.rbs.find((r) => r.id === billId) ?? null;
  const [url, setUrl] = useState<string | null>(null);
  const [state, setState] = useState<'idle' | 'loading' | 'error'>('idle');

  useEffect(() => {
    let alive = true;
    setUrl(null);
    if (billId && d?.hasBill) {
      setState('loading');
      getReimbReceiptUrl(billId)
        .then((r) => alive && (setUrl(r.url), setState('idle')))
        .catch(() => alive && setState('error'));
    } else {
      setState('idle');
    }
    return () => {
      alive = false;
    };
  }, [billId, d?.hasBill]);

  if (!d) return null;
  const close = () => s.setRbBillId(null);
  const firstName = d.name.split(' ')[0];
  const isPdf = /\.pdf(\?|$)/i.test(d.bill) || /\.pdf(\?|$)/i.test(url ?? '');

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 80, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div onClick={close} style={{ position: 'absolute', inset: 0, background: 'rgba(34,34,34,.5)', animation: 'ovl .2s ease both' }} />
      <div style={{ position: 'relative', width: 440, maxHeight: '92vh', overflowY: 'auto', background: '#F7F7F9', borderRadius: 18, boxShadow: '0 30px 70px rgba(60,40,24,.32)', animation: 'pop .2s ease both' }}>
        <div style={{ padding: '18px 22px', borderBottom: '1px solid #EBEBEB', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontSize: 20, fontWeight: 800, letterSpacing: '-.3px' }}>Bill preview</div>
            <div style={{ fontSize: 14, color: '#717171', fontWeight: 500, marginTop: 2 }}>Uploaded by {firstName} · {d.type}</div>
          </div>
          <CloseButton onClose={close} />
        </div>
        <div style={{ padding: 22 }}>
          {d.hasBill && state === 'loading' && (
            <div style={{ height: 240, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#717171', fontSize: 16, fontWeight: 600, border: '1px solid #EBEBEB', borderRadius: 12, background: '#fff' }}>
              Loading bill…
            </div>
          )}
          {d.hasBill && state !== 'loading' && url && !isPdf && (
            <img src={url} alt={d.bill} style={{ display: 'block', width: '100%', borderRadius: 12, border: '1px solid #EBEBEB', background: '#fff' }} />
          )}
          {d.hasBill && state !== 'loading' && url && isPdf && (
            <iframe title={d.bill} src={url} style={{ display: 'block', width: '100%', height: 460, borderRadius: 12, border: '1px solid #EBEBEB', background: '#fff' }} />
          )}
          {(!d.hasBill || state === 'error') && (
            <>
              {state === 'error' && (
                <div style={{ fontSize: 14, color: '#A8475F', fontWeight: 600, marginBottom: 10 }}>Couldn’t load the uploaded file — showing claim details.</div>
              )}
              <FauxReceipt d={d} />
            </>
          )}
          <a
            href={url ?? undefined}
            target="_blank"
            rel="noreferrer"
            onClick={(e) => {
              if (!url) {
                e.preventDefault();
                s.flash(d.hasBill ? 'Preparing bill…' : 'No file was uploaded for this claim');
              }
            }}
            style={{ marginTop: 14, width: '100%', boxSizing: 'border-box', textDecoration: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, background: url ? '#222222' : '#9197A2', color: '#fff', borderRadius: 11, padding: '11px 15px', fontSize: 16, fontWeight: 700, cursor: url ? 'pointer' : 'not-allowed' }}
          >
            <IconDownload /> {isPdf ? 'Open bill' : 'Open full size'}
          </a>
        </div>
      </div>
    </div>
  );
}

// Confirm screens for overriding a request from the dashboard (rules 6/7).
function LeaveConfirmModal() {
  const s = useStore();
  const c = s.lvConfirm;
  const d = c ? s.leaves.find((l) => l.id === c.id) : null;
  if (!c || !d) return null;
  const approve = c.action === 'approve';
  return (
    <ConfirmOverrideModal
      action={c.action}
      title={approve ? 'Approve this leave?' : 'Decline this leave?'}
      summary={<>You’re {approve ? 'approving' : 'declining'} <b>{d.name}</b>’s {d.type.toLowerCase()} leave ({d.days}) as an admin override.</>}
      note={s.lvNote}
      onNote={s.setLvNote}
      onCancel={s.lvCloseConfirm}
      onConfirm={s.lvDecide}
      confirmLabel={approve ? 'Approve leave' : 'Decline leave'}
    />
  );
}

function OvertimeConfirmModal() {
  const s = useStore();
  const c = s.otConfirm;
  const d = c ? s.ots.find((o) => o.id === c.id) : null;
  if (!c || !d) return null;
  const approve = c.action === 'approve';
  return (
    <ConfirmOverrideModal
      action={c.action}
      title={approve ? 'Approve this overtime?' : 'Decline this overtime?'}
      summary={<>You’re {approve ? 'approving' : 'declining'} <b>{d.name}</b>’s {d.duration.toLowerCase()} overtime on {d.otDate} as an admin override.</>}
      note={s.otNote}
      onNote={s.setOtNote}
      onCancel={s.otCloseConfirm}
      onConfirm={s.otDecide}
      confirmLabel={approve ? 'Approve overtime' : 'Decline overtime'}
    />
  );
}

function RbConfirmModal() {
  const s = useStore();
  const c = s.rbConfirm;
  const d = c ? s.rbs.find((r) => r.id === c.id) : null;
  if (!c || !d) return null;
  const approve = c.action === 'approve';
  return (
    <ConfirmOverrideModal
      action={c.action}
      title={approve ? 'Approve this claim?' : 'Decline this claim?'}
      summary={<>You’re {approve ? 'approving' : 'declining'} <b>{d.name}</b>’s {d.type.toLowerCase()} claim of <b>{d.amount}</b> as an admin override.</>}
      note={s.rbNote}
      onNote={s.setRbNote}
      onCancel={s.rbCloseConfirm}
      onConfirm={() => (approve ? s.rbApprove(d.id) : s.rbConfirmDecline(d.id))}
      confirmLabel={approve ? 'Approve claim' : 'Decline claim'}
    />
  );
}

function EmployeeDrawer() {
  const s = useStore();
  const d = s.emps.find((e) => e.id === s.empDrawerId);
  if (!d) return null;
  const close = () => s.setEmpDrawerId(null);
  const docList = DOCS.slice(0, d.docs);
  return (
    <DrawerShell width={440} onClose={close}>
      <div style={{ padding: 24, borderBottom: '1px solid #EBEBEB' }}>
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: -12 }}>
          <CloseButton onClose={close} />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center' }}>
          <div style={{ width: 78, height: 78, borderRadius: '50%', color: '#fff', fontWeight: 800, fontSize: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', background: avColorOf(d.name), marginBottom: 13 }}>
            {initialsOf(d.name)}
          </div>
          <div style={{ fontSize: 24, fontWeight: 800, letterSpacing: '-.3px' }}>{d.name}</div>
          <div style={{ fontSize: 16, color: '#717171', fontWeight: 600, marginTop: 3 }}>{d.role} · {d.id}</div>
          <span style={{ marginTop: 11 }}>
            <Pill label={d.empType} tone={ETYPE[d.empType]} fontSize={12} padding="5px 13px" />
          </span>
        </div>
      </div>
      <div style={{ padding: '20px 24px' }}>
        <div style={{ marginBottom: 18 }}>
          <InfoGrid
            cells={[
              { label: 'TEAM', value: d.team },
              { label: 'LOCATION', value: d.location },
              { label: 'DATE OF BIRTH', value: d.dob },
              { label: 'JOINED', value: d.joining },
              { label: 'MANAGER', value: d.manager },
              { label: 'MANAGER ID', value: d.managerId },
            ]}
          />
        </div>
        <div>
          <div style={{ fontSize: 14, color: '#717171', fontWeight: 700, letterSpacing: '.3px', marginBottom: 9 }}>DOCUMENTS · {d.docs}</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {docList.map((doc) => (
              <div key={doc} style={{ display: 'flex', alignItems: 'center', gap: 11, background: '#fff', border: '1px solid #EBEBEB', borderRadius: 11, padding: '11px 13px' }}>
                <div style={{ width: 32, height: 32, borderRadius: 8, background: '#EFE7F2', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <IconFile size={16} stroke="#7E5FB0" />
                </div>
                <div style={{ flex: 1, fontSize: 14, fontWeight: 700, color: '#484848', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{doc}</div>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#9197A2" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 3v12M7 10l5 5 5-5M5 21h14" />
                </svg>
              </div>
            ))}
          </div>
        </div>
      </div>
    </DrawerShell>
  );
}

export function Drawers() {
  return (
    <>
      <LeaveDrawer />
      <OvertimeDrawer />
      <FeedbackDrawer />
      <ReimbursementDrawer />
      <RbBillModal />
      <RbConfirmModal />
      <LeaveConfirmModal />
      <OvertimeConfirmModal />
      <EmployeeDrawer />
      <AddUserModal />
    </>
  );
}
