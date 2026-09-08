// Payroll Runs — create a monthly run, review the generated payslips, and move it
// through its lifecycle: draft -> submit -> approve/reject -> paid (PRD §6).
import { useEffect, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { useStore } from '../store';
import { ApiError } from '../../services/http';
import {
  createRun,
  decideRun,
  getRun,
  inr,
  listRuns,
  markRunPaid,
  recallRun,
  recomputeRun,
  rupeesToPaise,
  submitRun,
} from '../../services/payroll';
import type { PayrollRunDTO, PayslipDTO, RunStatus } from '../../services/payroll';

type Override = { lop: string; ot: string };
const overridesFrom = (payslips: PayslipDTO[]): Record<string, Override> =>
  Object.fromEntries(
    payslips.map((p) => [p.userId, { lop: String(p.inputs.lopDays), ot: String(p.inputs.overtimePaise / 100) }]),
  );
import { Card, EmptyRow, SummaryCard } from '../ui';

const STATUS_TONE: Record<RunStatus, { bg: string; fg: string; label: string }> = {
  draft: { bg: '#F7F7F9', fg: '#717171', label: 'Draft' },
  pending_approval: { bg: '#E7ECF4', fg: '#4A6FA5', label: 'Pending approval' },
  approved: { bg: '#E4EDE0', fg: '#4F7A52', label: 'Approved' },
  rejected: { bg: '#F4DEE2', fg: '#A8475F', label: 'Rejected' },
  paid: { bg: '#E7ECF4', fg: '#4A6FA5', label: 'Paid' },
};

function StatusPill({ status }: { status: RunStatus }) {
  const t = STATUS_TONE[status];
  return <span style={{ fontSize: 14, fontWeight: 700, padding: '3px 11px', borderRadius: 20, background: t.bg, color: t.fg }}>{t.label}</span>;
}

function thisMonth(): string {
  // Avoid new Date() month math issues by reading the ISO date string.
  return new Date().toISOString().slice(0, 7);
}

export function PayrollRuns() {
  const { flash } = useStore();
  const [runs, setRuns] = useState<PayrollRunDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState(thisMonth());
  const [creating, setCreating] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [detail, setDetail] = useState<{ run: PayrollRunDTO; payslips: PayslipDTO[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [rejectNote, setRejectNote] = useState('');
  const [overrides, setOverrides] = useState<Record<string, Override>>({});
  const [recomputing, setRecomputing] = useState(false);

  const loadRuns = async () => {
    setLoading(true);
    try {
      setRuns(await listRuns());
    } catch (e) {
      flash(e instanceof ApiError ? e.message : 'Could not load runs');
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void loadRuns();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadDetail = async (id: string) => {
    const d = await getRun(id);
    setDetail(d);
    setOverrides(overridesFrom(d.payslips));
  };

  useEffect(() => {
    if (!openId) {
      setDetail(null);
      return;
    }
    loadDetail(openId).catch((e) => {
      flash(e instanceof ApiError ? e.message : 'Could not load run');
      setOpenId(null);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openId]);

  const recompute = async () => {
    if (!detail) return;
    setRecomputing(true);
    try {
      const lopDays: Record<string, number> = {};
      const overtimePaise: Record<string, number> = {};
      for (const [userId, o] of Object.entries(overrides)) {
        const lop = Math.max(0, Math.floor(Number(o.lop) || 0));
        const ot = rupeesToPaise(o.ot);
        if (lop > 0) lopDays[userId] = lop;
        if (ot > 0) overtimePaise[userId] = ot;
      }
      await recomputeRun(detail.run.id, { lopDays, overtimePaise });
      await loadDetail(detail.run.id);
      await loadRuns();
      flash('Run recomputed with the updated LOP and overtime');
    } catch (e) {
      flash(e instanceof ApiError ? e.message : 'Could not recompute run');
    } finally {
      setRecomputing(false);
    }
  };

  const setOv = (userId: string, patch: Partial<Override>) =>
    setOverrides((s) => ({ ...s, [userId]: { ...(s[userId] ?? { lop: '0', ot: '0' }), ...patch } }));

  const create = async () => {
    setCreating(true);
    try {
      const { run, payslipCount } = await createRun({ period });
      flash(`Draft run created — ${payslipCount} payslip${payslipCount === 1 ? '' : 's'}`);
      await loadRuns();
      setOpenId(run.id);
    } catch (e) {
      flash(e instanceof ApiError ? e.message : 'Could not create run');
    } finally {
      setCreating(false);
    }
  };

  const act = async (fn: () => Promise<PayrollRunDTO>, msg: string) => {
    setBusy(true);
    try {
      const run = await fn();
      flash(msg);
      setDetail((d) => (d ? { ...d, run } : d));
      await loadRuns();
    } catch (e) {
      flash(e instanceof ApiError ? e.message : 'Action failed');
    } finally {
      setBusy(false);
    }
  };

  // —— Run detail ——
  if (detail) {
    const { run, payslips } = detail;
    const isDraft = run.status === 'draft';
    return (
      <div>
        <button onClick={() => setOpenId(null)} style={{ ...ghostBtn, marginBottom: 16 }}>← All runs</button>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 6 }}>
          <h2 style={{ fontSize: 24, fontWeight: 800, margin: 0 }}>{run.period}</h2>
          <StatusPill status={run.status} />
          <span style={{ color: '#717171', fontSize: 16 }}>{run.employeeCount} employee{run.employeeCount === 1 ? '' : 's'}</span>
        </div>
        {run.note && <p style={{ color: '#A8475F', fontSize: 16, margin: '0 0 12px' }}>Note: {run.note}</p>}

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, margin: '14px 0 18px' }}>
          <SummaryCard label="Gross" value={inr(run.totals.grossPaise)} />
          <SummaryCard label="Deductions" value={inr(run.totals.employeeDeductionsPaise)} color="#A8475F" />
          <SummaryCard label="Reimbursements" value={inr(run.totals.reimbursementsPaise)} />
          <SummaryCard label="Net payout" value={inr(run.totals.netPaise + run.totals.reimbursementsPaise)} color="#4F7A52" />
        </div>

        <div style={{ display: 'flex', gap: 9, marginBottom: 18, flexWrap: 'wrap', alignItems: 'center' }}>
          {isDraft && (
            <>
              <button onClick={recompute} disabled={recomputing || busy} style={ghostBtn}>{recomputing ? 'Recomputing…' : 'Recompute'}</button>
              <button onClick={() => act(() => submitRun(run.id), 'Submitted for approval')} disabled={busy || recomputing} style={primaryBtn}>Submit for approval</button>
              <span style={{ fontSize: 14, color: '#717171', alignSelf: 'center' }}>Set LOP days / overtime below, then recompute.</span>
            </>
          )}
          {run.status === 'pending_approval' && !rejecting && (
            <>
              <button onClick={() => act(() => decideRun(run.id, 'approved'), 'Run approved')} disabled={busy} style={approveBtn}>Approve</button>
              <button onClick={() => setRejecting(true)} disabled={busy} style={rejectBtn}>Reject</button>
              <button onClick={() => act(() => recallRun(run.id), 'Recalled to draft')} disabled={busy} style={ghostBtn}>Recall</button>
            </>
          )}
          {run.status === 'pending_approval' && rejecting && (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flex: 1 }}>
              <input value={rejectNote} onChange={(e) => setRejectNote(e.target.value)} placeholder="Reason to recall and amend…" style={{ ...inputStyle, flex: 1, maxWidth: 380 }} />
              <button onClick={() => { setRejecting(false); void act(() => decideRun(run.id, 'rejected', rejectNote.trim() || undefined), 'Run rejected'); setRejectNote(''); }} disabled={busy} style={rejectBtn}>Confirm reject</button>
              <button onClick={() => { setRejecting(false); setRejectNote(''); }} style={ghostBtn}>Cancel</button>
            </div>
          )}
          {run.status === 'approved' && <button onClick={() => act(() => markRunPaid(run.id), 'Run marked paid — reimbursements settled')} disabled={busy} style={approveBtn}>Mark paid</button>}
          {run.status === 'rejected' && <button onClick={() => act(() => recallRun(run.id), 'Recalled to draft')} disabled={busy} style={primaryBtn}>Recall to draft</button>}
          {run.status === 'paid' && <span style={{ color: '#4F7A52', fontWeight: 700, fontSize: 16 }}>✓ Payout complete</span>}
        </div>

        <Card>
          <table style={tableStyle}>
            <thead>
              <tr>
                <Th>Employee</Th>
                {isDraft && <Th right>LOP days</Th>}
                {isDraft && <Th right>Overtime (₹)</Th>}
                <Th right>Payable days</Th>
                <Th right>Gross</Th>
                <Th right>Deductions</Th>
                <Th right>Reimb.</Th>
                <Th right>Net payable</Th>
              </tr>
            </thead>
            <tbody>
              {payslips.length === 0 && <tr><td colSpan={isDraft ? 8 : 6}><EmptyRow text="No payslips in this run." /></td></tr>}
              {payslips.map((p) => (
                <tr key={p.userId}>
                  <Td>
                    <div style={{ fontWeight: 700 }}>{p.employeeName}</div>
                    {p.department && <div style={{ fontSize: 14, color: '#717171' }}>{p.department}</div>}
                  </Td>
                  {isDraft && (
                    <Td right>
                      <input
                        type="number"
                        min={0}
                        value={overrides[p.userId]?.lop ?? '0'}
                        onChange={(e) => setOv(p.userId, { lop: e.target.value })}
                        style={editInput}
                      />
                      <div style={hintStyle}>{p.inputs.approvedLeaveDays} leave day{p.inputs.approvedLeaveDays === 1 ? '' : 's'} approved</div>
                    </Td>
                  )}
                  {isDraft && (
                    <Td right>
                      <input
                        type="number"
                        min={0}
                        value={overrides[p.userId]?.ot ?? '0'}
                        onChange={(e) => setOv(p.userId, { ot: e.target.value })}
                        style={editInput}
                      />
                      <div style={hintStyle}>{p.inputs.approvedOtHours} OT hr{p.inputs.approvedOtHours === 1 ? '' : 's'} approved</div>
                    </Td>
                  )}
                  <Td right mono>
                    {p.inputs.payableDays}/{p.inputs.workingDays}
                    {p.inputs.lopDays > 0 && <span style={{ color: '#A8475F', fontSize: 14 }}> · {p.inputs.lopDays} LOP</span>}
                  </Td>
                  <Td right mono>{inr(p.grossPaise)}</Td>
                  <Td right mono>−{inr(p.employeeDeductionsPaise)}</Td>
                  <Td right mono>{p.reimbursementsPaise > 0 ? inr(p.reimbursementsPaise) : '—'}</Td>
                  <Td right mono><strong>{inr(p.netPayablePaise)}</strong></Td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </div>
    );
  }

  // —— Run list ——
  return (
    <div>
      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', marginBottom: 18 }}>
        <div>
          <label style={labelStyle}>Pay period</label>
          <input type="month" value={period} onChange={(e) => setPeriod(e.target.value)} style={inputStyle} />
        </div>
        <button onClick={create} disabled={creating} style={primaryBtn}>{creating ? 'Creating…' : '+ Create run'}</button>
        <span style={{ fontSize: 14, color: '#717171', paddingBottom: 9 }}>Computes a draft payslip for every employee with an active salary structure.</span>
      </div>

      <Card>
        {loading ? (
          <EmptyRow text="Loading…" />
        ) : runs.length === 0 ? (
          <EmptyRow text="No payroll runs yet — create one for the current period." />
        ) : (
          <table style={tableStyle}>
            <thead>
              <tr>
                <Th>Period</Th>
                <Th>Status</Th>
                <Th right>Employees</Th>
                <Th right>Gross</Th>
                <Th right>Net payout</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {runs.map((r) => (
                <tr key={r.id} onClick={() => setOpenId(r.id)} style={{ cursor: 'pointer' }}>
                  <Td><strong>{r.period}</strong></Td>
                  <Td><StatusPill status={r.status} /></Td>
                  <Td right mono>{r.employeeCount}</Td>
                  <Td right mono>{inr(r.totals.grossPaise)}</Td>
                  <Td right mono>{inr(r.totals.netPaise + r.totals.reimbursementsPaise)}</Td>
                  <Td right><span style={{ color: '#0571A6', fontWeight: 700, fontSize: 14 }}>Open →</span></Td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}

function Th({ children, right }: { children?: ReactNode; right?: boolean }) {
  return <th style={{ textAlign: right ? 'right' : 'left', fontSize: 12, textTransform: 'uppercase', letterSpacing: '.03em', color: '#717171', fontWeight: 700, padding: '11px 16px', borderBottom: '1px solid #EBEBEB' }}>{children}</th>;
}
function Td({ children, right, mono }: { children: ReactNode; right?: boolean; mono?: boolean }) {
  return <td style={{ padding: '11px 16px', borderBottom: '1px solid #F0F0F2', color: '#222222', textAlign: right ? 'right' : 'left', fontVariantNumeric: mono ? 'tabular-nums' : undefined }}>{children}</td>;
}

const labelStyle: CSSProperties = { display: 'block', fontSize: 14, fontWeight: 700, marginBottom: 5, color: '#484848' };
const inputStyle: CSSProperties = { padding: '9px 11px', border: '1px solid #EBEBEB', borderRadius: 10, fontSize: 16, fontFamily: 'inherit', background: '#fff', color: '#222222' };
const editInput: CSSProperties = { width: 80, padding: '6px 8px', border: '1px solid #EBEBEB', borderRadius: 8, fontSize: 16, fontFamily: 'inherit', background: '#fff', color: '#222222', textAlign: 'right' };
const hintStyle: CSSProperties = { fontSize: 12, color: '#717171', marginTop: 3, fontWeight: 600 };
const tableStyle: CSSProperties = { width: '100%', borderCollapse: 'collapse', fontSize: 16 };
const primaryBtn: CSSProperties = { background: '#0571A6', color: '#fff', border: 'none', padding: '9px 16px', borderRadius: 11, fontSize: 16, fontWeight: 700, cursor: 'pointer' };
const approveBtn: CSSProperties = { background: '#4F7A52', color: '#fff', border: 'none', padding: '9px 16px', borderRadius: 11, fontSize: 16, fontWeight: 700, cursor: 'pointer' };
const rejectBtn: CSSProperties = { background: '#FBF1F3', color: '#A8475F', border: '1px solid #EBD9DE', padding: '9px 16px', borderRadius: 11, fontSize: 16, fontWeight: 700, cursor: 'pointer' };
const ghostBtn: CSSProperties = { background: '#fff', color: '#484848', border: '1px solid #EBEBEB', padding: '9px 15px', borderRadius: 11, fontSize: 16, fontWeight: 700, cursor: 'pointer' };
