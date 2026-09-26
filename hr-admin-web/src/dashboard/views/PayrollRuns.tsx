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
  submitRun,
} from '../../services/payroll';
import type { PayrollRunDTO, PayslipDTO, RunStatus } from '../../services/payroll';

import { Card, EmptyRow, SummaryCard } from '../ui';
import { printPayslip } from '../payslip';
import { LossOfPayExplainer } from '../LossOfPayExplainer';

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
  const [explain, setExplain] = useState<PayslipDTO | null>(null);
  const [detail, setDetail] = useState<{ run: PayrollRunDTO; payslips: PayslipDTO[]; company: { name: string; address: string } } | null>(null);
  const [busy, setBusy] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [rejectNote, setRejectNote] = useState('');

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
          <SummaryCard label="Net payout" value={inr(run.totals.netPaise + run.totals.reimbursementsPaise)} color="#4F7A52" />
        </div>

        <div style={{ display: 'flex', gap: 9, marginBottom: 18, flexWrap: 'wrap', alignItems: 'center' }}>
          {isDraft && (
            <>
              <button onClick={() => act(() => submitRun(run.id), 'Submitted for approval')} disabled={busy} style={primaryBtn}>Submit for approval</button>
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
                <Th>Name</Th>
                <Th>Department</Th>
                <Th right>LOP days</Th>
                <Th right>Monthly salary</Th>
                <Th right>Deduction (LOP)</Th>
                <Th right>Net salary</Th>
                <Th right> </Th>
              </tr>
            </thead>
            <tbody>
              {payslips.length === 0 && <tr><td colSpan={7}><EmptyRow text="No payslips in this run." /></td></tr>}
              {payslips.map((p) => {
                const monthly = p.earnings.reduce((t, e) => t + e.fullPaise, 0);
                const lopPaise = p.earnings.reduce((t, e) => t + (e.fullPaise - e.paidPaise), 0);
                return (
                  <tr key={p.userId}>
                    <Td><div style={{ fontWeight: 700 }}>{p.employeeName}</div></Td>
                    <Td><span style={{ color: '#717171' }}>{p.department || '—'}</span></Td>
                    <Td right>
                      {p.inputs.lopDays > 0 && (p.inputs.attendanceDeductions ?? []).some((l) => l.count > 0) ? (
                        <button type="button" onClick={() => setExplain(p)} title="Why is there a loss of pay?" style={lopLink}>{p.inputs.lopDays}</button>
                      ) : (
                        <span style={{ color: p.inputs.lopDays ? '#A8475F' : '#9197A2', fontWeight: 700 }}>{p.inputs.lopDays}</span>
                      )}
                    </Td>
                    <Td right mono>{inr(monthly)}</Td>
                    <Td right mono><span style={{ color: lopPaise ? '#A8475F' : '#9197A2' }}>{lopPaise ? `−${inr(lopPaise)}` : '—'}</span></Td>
                    <Td right mono><strong>{inr(p.netPayablePaise)}</strong></Td>
                    <Td right><button type="button" onClick={() => printPayslip(p, detail.company)} style={slipBtn}>Payslip</button></Td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
        {explain && <LossOfPayExplainer userId={explain.userId} payslip={explain} onClose={() => setExplain(null)} />}
      </div>
    );
  }

  // Opening: the detail is on its way. Say so at once — on a slow link the
  // list sitting unchanged for ten seconds reads as a dead button.
  if (openId) {
    return (
      <div>
        <button onClick={() => setOpenId(null)} style={{ ...ghostBtn, marginBottom: 16 }}>← All runs</button>
        <Card><EmptyRow text={`Opening ${runs.find((r) => r.id === openId)?.period ?? 'run'}…`} /></Card>
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
const tableStyle: CSSProperties = { width: '100%', borderCollapse: 'collapse', fontSize: 16 };
const primaryBtn: CSSProperties = { background: '#0571A6', color: '#fff', border: 'none', padding: '9px 16px', borderRadius: 11, fontSize: 16, fontWeight: 700, cursor: 'pointer' };
const approveBtn: CSSProperties = { background: '#4F7A52', color: '#fff', border: 'none', padding: '9px 16px', borderRadius: 11, fontSize: 16, fontWeight: 700, cursor: 'pointer' };
const rejectBtn: CSSProperties = { background: '#FBF1F3', color: '#A8475F', border: '1px solid #EBD9DE', padding: '9px 16px', borderRadius: 11, fontSize: 16, fontWeight: 700, cursor: 'pointer' };
const ghostBtn: CSSProperties = { background: '#fff', color: '#484848', border: '1px solid #EBEBEB', padding: '9px 15px', borderRadius: 11, fontSize: 16, fontWeight: 700, cursor: 'pointer' };

const slipBtn: CSSProperties = { background: '#fff', color: '#0571A6', border: '1px solid #CFE3EE', padding: '6px 12px', borderRadius: 9, fontSize: 14, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' };

const lopLink: CSSProperties = { background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: '#A8475F', fontWeight: 700, fontSize: 16, fontFamily: 'inherit', textDecoration: 'underline', textDecorationStyle: 'dotted', textUnderlineOffset: 3 };
