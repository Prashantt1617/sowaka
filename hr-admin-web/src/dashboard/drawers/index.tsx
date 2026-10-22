import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { useStore } from '../store';
import { getReimbReceiptUrl } from '../../services/hrms';
import { ETYPE, OTDUR, STAT, typeColor } from '../theme';
import type { Reimb } from '../seed';
import { Pill, Avatar } from '../ui';
import { btn, btnClass, eyebrow, textareaStyle } from '../ds';
import { IconCheck, IconDownload, IconExternal, IconFile, IconStar, IconX } from '../icons';
import { CloseButton, DrawerHeader, DrawerShell, InfoGrid, RemarkBlock } from './shell';
import { AddUserModal } from './AddUserModal';
import { SuwiInsight } from '../suwi/SuwiInsight';

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
    <div style={{ position: 'sticky', bottom: 0, marginTop: 'auto', background: 'var(--surface)', borderTop: '1px solid var(--line)', padding: '16px 20px', display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
      <button onClick={onDecline} className={btnClass('no')} style={btn('no')}>Decline</button>
      <button onClick={onApprove} className={btnClass('primary')} style={btn('primary')}>
        <IconCheck size={15} stroke="currentColor" />
        {approveLabel}
      </button>
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
      <div onClick={onCancel} style={{ position: 'absolute', inset: 0, background: 'var(--scrim)', animation: 'ovl .2s ease both' }} />
      <div style={{ position: 'relative', width: 'min(520px, calc(100% - 32px))', background: 'var(--surface)', borderRadius: 'var(--r-lg)', boxShadow: 'var(--shadow-drawer)', animation: 'pop .2s ease both', padding: 20 }}>
        <div style={{ width: 40, height: 40, borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 12, background: isApprove ? 'var(--ok-bg)' : 'var(--bad-bg)' }}>
          {isApprove ? <IconCheck /> : <IconX />}
        </div>
        <div style={{ fontSize: 16, fontWeight: 600, lineHeight: 1.5 }}>{title}</div>
        <div style={{ fontSize: 13.5, color: 'var(--ink-2)', fontWeight: 400, marginTop: 4, lineHeight: 1.55 }}>{summary}</div>
        <div style={{ ...eyebrow, marginTop: 16, marginBottom: 8 }}>
          NOTE — WHY ARE YOU OVERRIDING THIS?
        </div>
        <textarea
          value={note}
          onChange={(e) => onNote(e.target.value)}
          placeholder={isApprove ? 'e.g. Cleared with finance — approving on their behalf' : 'e.g. Out of policy — resubmit with manager sign-off'}
          className="ds-inp"
          style={{ ...textareaStyle, resize: 'none' }}
        />
        <div style={{ display: 'flex', gap: 8, marginTop: 20, justifyContent: 'flex-end' }}>
          <button onClick={onCancel} className={btnClass()} style={btn()}>Cancel</button>
          <button
            onClick={onConfirm}
            className={btnClass(isApprove ? 'primary' : 'danger')}
            style={btn(isApprove ? 'primary' : 'danger')}
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
      <DrawerHeader name={d.name} userId={d.submitterId} subtitle={`${d.team} · Applied ${d.applied}`} onClose={close} />
      <div style={{ padding: 20 }}>
        <SuwiInsight kind="leave" id={d.id} pending={d.status === 'Pending'} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
          <Pill label={d.byAdmin ? `${d.status} · by admin` : d.status} tone={STAT[d.status]} />
          <span style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 14, fontWeight: 400, color: 'var(--ink-2)' }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: typeColor(d.type) }} />
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
      <DrawerHeader name={d.name} userId={d.submitterId} subtitle={`${d.team} · Applied ${d.appliedOn}`} onClose={close} />
      <div style={{ padding: 20 }}>
        <SuwiInsight kind="overtime" id={d.id} pending={d.status === 'Pending'} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
          <Pill label={d.byAdmin ? `${d.status} · by admin` : d.status} tone={STAT[d.status]} />
          <Pill label={d.duration} tone={OTDUR[d.duration]} />
        </div>
        <InfoGrid
          cells={[
            { label: 'OVERTIME DATE', value: d.otDate },
            { label: 'DAY', value: d.day },
            { label: 'DURATION', value: d.duration, wide: true },
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
      <div style={{ padding: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
          <Pill label={d.isOverall ? 'Overall' : d.parameter} tone={{ bg: 'var(--t-lilac)', fg: 'var(--t-lilac-i)' }} />
          <span style={{ fontSize: 14, fontWeight: 400, color: 'var(--ink-2)' }}>{d.date}</span>
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
          <div style={{ ...eyebrow, marginBottom: 8 }}>{d.isOverall ? 'SUMMARY' : 'PARAMETER NOTE'}</div>
          <div style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 12, padding: '14px 15px', fontSize: 14, color: 'var(--ink-2)', lineHeight: 1.6, fontWeight: 400 }}>{d.note || d.text || '—'}</div>
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
      <DrawerHeader name={d.name} userId={d.submitterId} subtitle={`${d.team} · Applied ${d.applyDate}`} onClose={close} />
      <div style={{ padding: 20 }}>
        <SuwiInsight kind="claim" id={d.id} pending={d.status === 'Pending'} />
        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: 18 }}>
          <div>
            <div style={{ fontSize: 11.5, color: 'var(--ink-3)', fontWeight: 400, marginBottom: 3 }}>{d.type} claim</div>
            <div style={{ fontSize: 30, fontWeight: 400, letterSpacing: '-.03em', lineHeight: 1.15 }}>{d.amount}</div>
          </div>
          <Pill label={d.status} tone={STAT[d.status]} />
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
          <div style={{ ...eyebrow, marginBottom: 8 }}>BILL ATTACHMENT</div>
          <button
            onClick={() => s.setRbBillId(d.id)}
            style={{ width: '100%', textAlign: 'left', display: 'flex', alignItems: 'center', gap: 12, background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 16, padding: 12, cursor: 'pointer', color: 'var(--ink)' }}
          >
            <div style={{ width: 40, height: 40, borderRadius: 12, background: 'var(--t-peach)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <IconFile stroke="var(--t-peach-i)" />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{d.bill}</div>
              <div style={{ fontSize: 12, color: 'var(--ink-3)', fontWeight: 400 }}>Tap to view bill</div>
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
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', fontSize: 13 }}>
      <span style={{ color: 'var(--ink-3)', fontWeight: 400 }}>{k}</span>
      <span style={{ fontWeight: 500, color: 'var(--ink-2)' }}>{v}</span>
    </div>
  );
}

// Fallback receipt rendered from claim data when no real file was uploaded.
function FauxReceipt({ d }: { d: Reimb }) {
  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 12, padding: '22px 22px 26px', boxShadow: 'var(--shadow)' }}>
      <div style={{ textAlign: 'center', borderBottom: '1px dashed var(--line)', paddingBottom: 14, marginBottom: 14 }}>
        <div style={{ fontSize: 17, fontWeight: 600, letterSpacing: '.5px' }}>{d.type.toUpperCase()} RECEIPT</div>
        <div style={{ fontSize: 13, color: 'var(--ink-3)', marginTop: 3, wordBreak: 'break-all' }}>{d.bill}</div>
      </div>
      <BillRow k="Employee" v={d.name} />
      <BillRow k="Bill date" v={d.billDate} />
      <BillRow k="Category" v={d.type} />
      <BillRow k="Submitted" v={d.applyDate} />
      <div style={{ borderTop: '1px dashed var(--line)', margin: '14px 0' }} />
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <span style={{ fontSize: 14, fontWeight: 500, color: 'var(--ink-2)' }}>Total</span>
        <span style={{ fontSize: 21, fontWeight: 600, letterSpacing: '-.5px' }}>{d.amount}</span>
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
      <div onClick={close} style={{ position: 'absolute', inset: 0, background: 'var(--scrim)', animation: 'ovl .2s ease both' }} />
      <div className="scry" style={{ position: 'relative', width: 'min(520px, calc(100% - 32px))', maxHeight: 'calc(100% - 48px)', overflowY: 'auto', background: 'var(--surface)', borderRadius: 'var(--r-lg)', boxShadow: 'var(--shadow-drawer)', animation: 'pop .2s ease both' }}>
        <div style={{ position: 'sticky', top: 0, zIndex: 2, background: 'var(--surface)', padding: '16px 20px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 600, lineHeight: 1.5 }}>Bill preview</div>
            <div style={{ fontSize: 12.5, color: 'var(--ink-3)', fontWeight: 400, marginTop: 2 }}>Uploaded by {firstName} · {d.type}</div>
          </div>
          <CloseButton onClose={close} />
        </div>
        <div style={{ padding: 20 }}>
          {d.hasBill && state === 'loading' && (
            <div style={{ height: 240, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--ink-3)', fontSize: 14, fontWeight: 400, border: '1px solid var(--line)', borderRadius: 12, background: 'var(--surface)' }}>
              Loading bill…
            </div>
          )}
          {d.hasBill && state !== 'loading' && url && !isPdf && (
            <img src={url} alt={d.bill} style={{ display: 'block', width: '100%', borderRadius: 12, border: '1px solid var(--line)', background: 'var(--surface)' }} />
          )}
          {d.hasBill && state !== 'loading' && url && isPdf && (
            <iframe title={d.bill} src={url} style={{ display: 'block', width: '100%', height: 460, borderRadius: 12, border: '1px solid var(--line)', background: 'var(--surface)' }} />
          )}
          {(!d.hasBill || state === 'error') && (
            <>
              {state === 'error' && (
                <div style={{ fontSize: 13, color: 'var(--bad)', fontWeight: 400, marginBottom: 10 }}>Couldn’t load the uploaded file — showing claim details.</div>
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
            style={{ ...btn('primary'), marginTop: 14, width: '100%', textDecoration: 'none', opacity: url ? 1 : 0.5, cursor: url ? 'pointer' : 'not-allowed' }}
          >
            <IconDownload stroke="currentColor" /> {isPdf ? 'Open bill' : 'Open full size'}
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
  return (
    <DrawerShell width={440} onClose={close}>
      <div style={{ padding: 24, borderBottom: '1px solid var(--line)' }}>
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: -12 }}>
          <CloseButton onClose={close} />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center' }}>
          <div style={{ marginBottom: 13 }}>
            <Avatar name={d.name} size={78} font={32} src={d.photoUrl} />
          </div>
          <div style={{ fontSize: 21, fontWeight: 600, letterSpacing: '-.3px' }}>{d.name}</div>
          {/* The employee ID is what HR knows them by; the system's UUID is not. */}
          <div style={{ fontSize: 14, color: 'var(--ink-3)', fontWeight: 400, marginTop: 3 }}>
            {d.role}{d.employeeId !== '—' ? ` · ${d.employeeId}` : ''}
          </div>
          <span style={{ marginTop: 11 }}>
            <Pill label={d.empType} tone={ETYPE[d.empType]} />
          </span>
        </div>
      </div>
      <div style={{ padding: 20 }}>
        <div style={{ marginBottom: 18 }}>
          <InfoGrid
            cells={[
              { label: 'TEAM', value: d.team },
              { label: 'LOCATION', value: d.location },
              { label: 'DATE OF BIRTH', value: d.dob },
              { label: 'JOINED', value: d.joining },
              { label: 'MANAGER', value: d.manager },
              // An address is long and has nowhere to break; let it wrap and step down a size.
              { label: 'EMAIL', value: <span style={{ fontSize: 13, wordBreak: 'break-all' }}>{d.email || '—'}</span> },
            ]}
          />
        </div>
        <div>
          <div style={{ ...eyebrow, marginBottom: 8 }}>DOCUMENTS · {d.documents.length}</div>
          {d.documents.length === 0 ? (
            <div style={{ fontSize: 13, color: 'var(--ink-4)', fontWeight: 400 }}>Nothing filed yet.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {d.documents.map((doc) => (
                <a
                  key={doc.id}
                  href={doc.url}
                  target="_blank"
                  rel="noreferrer"
                  title={doc.url ? `Open ${doc.name}` : 'No file stored for this record'}
                  style={{ display: 'flex', alignItems: 'center', gap: 11, background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 12, padding: '11px 13px', textDecoration: 'none', color: 'inherit', pointerEvents: doc.url ? 'auto' : 'none' }}
                >
                  <div style={{ width: 32, height: 32, borderRadius: 8, background: 'var(--t-lilac)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <IconFile size={16} stroke="var(--t-lilac-i)" />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--ink-2)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{doc.type}</div>
                    <div style={{ fontSize: 12.5, color: 'var(--ink-3)', fontWeight: 400, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{doc.name}{doc.uploadedOn ? ` · ${doc.uploadedOn}` : ''}</div>
                  </div>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--ink-4)" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 3v12M7 10l5 5 5-5M5 21h14" />
                  </svg>
                </a>
              ))}
            </div>
          )}
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
