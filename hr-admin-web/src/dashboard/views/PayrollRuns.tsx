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
      flash(e instanceof ApiError ? e.message : 'Could not load runs', 'error');
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
      flash(e instanceof ApiError ? e.message : 'Could not load run', 'error');
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
      flash(e instanceof ApiError ? e.message : 'Could not create run', 'error');
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
      flash(e instanceof ApiError ? e.message : 'Action failed', 'error');
    } finally {
      setBusy(false);
    }
  };

  // —— Run detail ——
  if (detail) {
    return (
      <RunDetail
        detail={detail}
        busy={busy}
        rejecting={rejecting}
        rejectNote={rejectNote}
        setRejecting={setRejecting}
        setRejectNote={setRejectNote}
        onBack={() => setOpenId(null)}
        onAct={act}
        onExplain={setExplain}
        explain={explain}
        onReload={async () => { await loadDetail(detail.run.id); await loadRuns(); }}
      />
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

type Detail = { run: PayrollRunDTO; payslips: PayslipDTO[]; company: { name: string; address: string } };
type Edit = { paidDays?: string; tax?: string };

const money2 = (paise: number) => '₹' + (paise / 100).toLocaleString('en-IN', { minimumFractionDigits: paise % 100 ? 2 : 0, maximumFractionDigits: 2 });

// One run: every person's paid days (prefilled from attendance, editable),
// income tax, and the whole payslip, then submit → approve → paid.
function RunDetail({ detail, busy, rejecting, rejectNote, setRejecting, setRejectNote, onBack, onAct, onExplain, explain, onReload }: {
  detail: Detail;
  busy: boolean;
  rejecting: boolean;
  rejectNote: string;
  setRejecting: (v: boolean) => void;
  setRejectNote: (v: string) => void;
  onBack: () => void;
  onAct: (fn: () => Promise<PayrollRunDTO>, msg: string) => Promise<void>;
  onExplain: (p: PayslipDTO | null) => void;
  explain: PayslipDTO | null;
  onReload: () => Promise<void>;
}) {
  const { flash } = useStore();
  const { run, payslips } = detail;
  const isDraft = run.status === 'draft';
  const [edits, setEdits] = useState<Record<string, Edit>>({});
  const [open, setOpen] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => setEdits({}), [detail]);
  const dirty = Object.keys(edits).length > 0;

  const setEdit = (userId: string, patch: Edit) => setEdits((e) => ({ ...e, [userId]: { ...e[userId], ...patch } }));
  const recalc = async (reset?: { userId: string; what: 'lop' | 'tax' }) => {
    const lopDays: Record<string, number | null> = {};
    const incomeTaxPaise: Record<string, number | null> = {};
    for (const p of payslips) {
      const e = edits[p.userId];
      if (e?.paidDays !== undefined) {
        const paid = Number(e.paidDays);
        if (!Number.isFinite(paid) || paid < 0 || paid > p.inputs.workingDays) return flash(`${p.employeeName}: paid days must be 0 to ${p.inputs.workingDays}`, 'error');
        lopDays[p.userId] = Math.round((p.inputs.workingDays - paid) * 2) / 2;
      }
      if (e?.tax !== undefined) {
        const tax = Number(e.tax);
        if (!Number.isFinite(tax) || tax < 0) return flash(`${p.employeeName}: income tax must be 0 or more`, 'error');
        incomeTaxPaise[p.userId] = rupeesToPaise(e.tax);
      }
    }
    if (reset?.what === 'lop') lopDays[reset.userId] = null;
    if (reset?.what === 'tax') incomeTaxPaise[reset.userId] = null;
    setSaving(true);
    try {
      await recomputeRun(run.id, { lopDays, incomeTaxPaise });
      flash('Payslips recalculated');
      await onReload();
    } catch (e) {
      flash(e instanceof ApiError ? e.message : 'Could not recalculate', 'error');
    } finally {
      setSaving(false);
    }
  };

  const t = run.totals;
  return (
    <div>
      <button onClick={onBack} style={{ ...ghostBtn, marginBottom: 16 }}>← All runs</button>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 6 }}>
        <h2 style={{ fontSize: 24, fontWeight: 800, margin: 0 }}>{run.period}</h2>
        <StatusPill status={run.status} />
        <span style={{ color: '#717171', fontSize: 16 }}>{run.employeeCount} employee{run.employeeCount === 1 ? '' : 's'}</span>
      </div>
      {run.note && <p style={{ color: '#A8475F', fontSize: 16, margin: '0 0 12px' }}>Note: {run.note}</p>}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, margin: '14px 0 18px' }}>
        <SummaryCard label="Gross pay" value={inr(t.grossPaise)} />
        <SummaryCard label="Employee deductions" value={inr(t.employeeDeductionsPaise)} color="#A8475F" />
        <SummaryCard label="Net payout" value={inr(t.netPaise + t.reimbursementsPaise)} color="#4F7A52" />
        <SummaryCard label="Cost to company" value={inr(t.employerCostPaise)} />
      </div>

      <div style={{ display: 'flex', gap: 9, marginBottom: 18, flexWrap: 'wrap', alignItems: 'center' }}>
        {isDraft && (
          <>
            <button onClick={() => void recalc()} disabled={!dirty || saving} style={{ ...primaryBtn, opacity: !dirty || saving ? 0.55 : 1 }}>{saving ? 'Recalculating…' : 'Save & recalculate'}</button>
            {dirty && <button onClick={() => setEdits({})} disabled={saving} style={ghostBtn}>Discard changes</button>}
            <button onClick={() => void onAct(() => submitRun(run.id), 'Submitted for approval')} disabled={busy || dirty || saving} title={dirty ? 'Save your changes first' : undefined} style={{ ...approveBtn, opacity: busy || dirty ? 0.55 : 1 }}>Submit for approval</button>
            <span style={{ color: '#717171', fontSize: 14 }}>Paid days come from attendance; type a figure to change it. A second person approves.</span>
          </>
        )}
        {run.status === 'pending_approval' && !rejecting && (
          <>
            <button onClick={() => void onAct(() => decideRun(run.id, 'approved'), 'Run approved')} disabled={busy} style={approveBtn}>Approve</button>
            <button onClick={() => setRejecting(true)} disabled={busy} style={rejectBtn}>Reject</button>
            <button onClick={() => void onAct(() => recallRun(run.id), 'Recalled to draft')} disabled={busy} style={ghostBtn}>Recall</button>
          </>
        )}
        {run.status === 'pending_approval' && rejecting && (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flex: 1 }}>
            <input value={rejectNote} onChange={(e) => setRejectNote(e.target.value)} placeholder="Reason to recall and amend…" style={{ ...inputStyle, flex: 1, maxWidth: 380 }} />
            <button onClick={() => { setRejecting(false); void onAct(() => decideRun(run.id, 'rejected', rejectNote.trim() || undefined), 'Run rejected'); setRejectNote(''); }} disabled={busy} style={rejectBtn}>Confirm reject</button>
            <button onClick={() => { setRejecting(false); setRejectNote(''); }} style={ghostBtn}>Cancel</button>
          </div>
        )}
        {run.status === 'approved' && (
          <>
            <button onClick={() => void onAct(() => markRunPaid(run.id), 'Run marked paid — reimbursements settled')} disabled={busy} style={approveBtn}>Mark paid</button>
            <button onClick={() => void onAct(() => recallRun(run.id), 'Recalled to draft')} disabled={busy} style={ghostBtn}>Recall to draft</button>
          </>
        )}
        {run.status === 'rejected' && <button onClick={() => void onAct(() => recallRun(run.id), 'Recalled to draft')} disabled={busy} style={primaryBtn}>Recall to draft</button>}
        {run.status === 'paid' && <span style={{ color: '#4F7A52', fontWeight: 700, fontSize: 16 }}>✓ Payout complete</span>}
      </div>

      <Card>
        <table style={tableStyle}>
          <thead>
            <tr>
              <Th>Name</Th>
              <Th right>Days</Th>
              <Th right>Paid days</Th>
              <Th right>Gross</Th>
              <Th right>Income tax</Th>
              <Th right>Deductions</Th>
              <Th right>Net pay</Th>
              <Th right> </Th>
            </tr>
          </thead>
          <tbody>
            {payslips.length === 0 && <tr><td colSpan={8}><EmptyRow text="No payslips in this run." /></td></tr>}
            {payslips.map((p) => {
              const e = edits[p.userId] ?? {};
              const paidDays = e.paidDays ?? String(p.inputs.payableDays);
              const taxPaise = p.deductions.find((d) => d.key === 'income_tax')?.amountPaise ?? 0;
              const tax = e.tax ?? String(taxPaise / 100);
              const fromAttendance = p.inputs.workingDays - (p.inputs.attendanceLopDays ?? p.inputs.lopDays);
              const expanded = open === p.userId;
              return (
                <FragmentRows key={p.userId}>
                  <tr>
                    <Td>
                      <div style={{ fontWeight: 700 }}>{p.employeeName}</div>
                      <div style={{ color: '#717171', fontSize: 13 }}>{[p.employeeId, p.department].filter(Boolean).join(' · ') || '—'}</div>
                    </Td>
                    <Td right mono>{p.inputs.workingDays}</Td>
                    <Td right>
                      {isDraft ? (
                        <input type="number" step="0.5" min={0} max={p.inputs.workingDays} value={paidDays} onChange={(ev) => setEdit(p.userId, { paidDays: ev.target.value })} style={{ ...cellInput, borderColor: e.paidDays !== undefined ? '#0571A6' : '#EBEBEB' }} />
                      ) : (
                        <span style={{ fontWeight: 700 }}>{p.inputs.payableDays}</span>
                      )}
                      <div style={{ fontSize: 12, color: '#717171', marginTop: 3 }}>
                        {p.inputs.lopEnteredByHr ? (
                          <>Entered · attendance {fromAttendance}{isDraft && <button type="button" onClick={() => void recalc({ userId: p.userId, what: 'lop' })} style={linkBtn}>use</button>}</>
                        ) : p.inputs.lopDays > 0 && (p.inputs.attendanceDeductions ?? []).some((l) => l.days > 0) ? (
                          <button type="button" onClick={() => onExplain(p)} style={lopLink}>{p.inputs.lopDays} LOP from attendance</button>
                        ) : 'From attendance'}
                      </div>
                    </Td>
                    <Td right mono>{money2(p.grossPaise)}</Td>
                    <Td right>
                      {isDraft ? (
                        <input type="number" min={0} value={tax} onChange={(ev) => setEdit(p.userId, { tax: ev.target.value })} style={{ ...cellInput, width: 110, borderColor: e.tax !== undefined ? '#0571A6' : '#EBEBEB' }} />
                      ) : (
                        <span>{money2(taxPaise)}</span>
                      )}
                    </Td>
                    <Td right mono><span style={{ color: '#A8475F' }}>{money2(p.employeeDeductionsPaise)}</span></Td>
                    <Td right mono><strong>{money2(p.netPayablePaise)}</strong></Td>
                    <Td right>
                      <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                        <button type="button" onClick={() => setOpen(expanded ? null : p.userId)} style={slipBtn}>{expanded ? 'Hide' : 'Details'}</button>
                        <button type="button" onClick={() => printPayslip(p, detail.company)} style={slipBtn}>Payslip</button>
                      </div>
                    </Td>
                  </tr>
                  {expanded && (
                    <tr>
                      <td colSpan={8} style={{ background: '#FAFAFB', padding: '14px 18px', borderBottom: '1px solid #F0F0F2' }}>
                        <SlipNumbers p={p} />
                      </td>
                    </tr>
                  )}
                </FragmentRows>
              );
            })}
          </tbody>
        </table>
      </Card>
      {explain && <LossOfPayExplainer userId={explain.userId} payslip={explain} onClose={() => onExplain(null)} />}
    </div>
  );
}

function FragmentRows({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

// Every number on one payslip: earnings at the monthly rate and as paid,
// reimbursements, deductions, and what the employer pays on top.
function SlipNumbers({ p }: { p: PayslipDTO }) {
  const reimbLines = p.reimbursementLines ?? [];
  const claims = p.reimbursementsPaise - reimbLines.reduce((t, r) => t + r.amountPaise, 0);
  const e = p.employer;
  const row = (label: string, value: number, opts: { strong?: boolean; muted?: boolean; sub?: string } = {}) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontSize: 14, fontWeight: opts.strong ? 700 : 500, color: opts.muted ? '#9197A2' : '#222222' }}>
      <span>{label}{opts.sub && <span style={{ color: '#9197A2', fontWeight: 400 }}> · {opts.sub}</span>}</span>
      <span style={{ fontVariantNumeric: 'tabular-nums' }}>{money2(value)}</span>
    </div>
  );
  const head = (t: string) => <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: '.03em', textTransform: 'uppercase', color: '#717171', margin: '0 0 6px' }}>{t}</div>;
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 28 }}>
      <div>
        {head('Earnings')}
        {p.earnings.map((l) => (
          <div key={l.code}>{row(l.name, l.paidPaise, { muted: l.hidden, sub: [l.fullPaise !== l.paidPaise ? `rate ${money2(l.fullPaise)}` : '', l.hidden ? 'not on payslip' : ''].filter(Boolean).join(' · ') || undefined })}</div>
        ))}
        {p.inputs.overtimePaise > 0 && row('Overtime', p.inputs.overtimePaise)}
        {row('Gross pay', p.grossPaise, { strong: true })}
        {(reimbLines.length > 0 || claims > 0) && <div style={{ height: 10 }} />}
        {reimbLines.map((r) => <div key={r.code}>{row(r.name, r.amountPaise, { muted: r.hidden })}</div>)}
        {claims > 0 && row('Expense claims', claims)}
        {p.reimbursementsPaise > 0 && row('Total reimbursements', p.reimbursementsPaise, { strong: true })}
      </div>
      <div>
        {head('Deductions')}
        {p.deductions.length === 0 && <div style={{ color: '#9197A2', fontSize: 14 }}>None</div>}
        {p.deductions.map((d) => <div key={d.key}>{row(d.name, d.amountPaise, { muted: d.hidden })}</div>)}
        {row('Total deductions', p.employeeDeductionsPaise, { strong: true })}
        <div style={{ height: 10 }} />
        {row('Net pay', p.netPayablePaise, { strong: true })}
        <div style={{ fontSize: 12.5, color: '#717171', marginTop: 6 }}>
          {p.inputs.workingDays} days · {p.inputs.payableDays} paid · {p.inputs.lopDays} loss of pay · PF wage {money2(p.pfWagePaise)}
        </div>
      </div>
      <div>
        {head('Employer contributions')}
        {e ? (
          <>
            {row('EPF employer', e.epfPaise)}
            {row('EPS employer', e.epsPaise)}
            {row('EDLI employer', e.edliPaise)}
            {row('EPF admin charges', e.adminPaise)}
            {row('ESI employer', e.esiPaise)}
            {row('LWF employer', e.lwfPaise)}
            {row('Benefits (gratuity…)', e.benefitsPaise)}
            {row('Total employer contributions', e.totalPaise, { strong: true })}
          </>
        ) : (
          row('EPF + EPS employer', p.epf.employerEpfPaise + p.epf.employerEpsPaise)
        )}
        <div style={{ height: 10 }} />
        {row('Cost to company this month', p.employerCostPaise, { strong: true })}
        {p.monthlyCtcPaise ? row('Monthly CTC', p.monthlyCtcPaise, { muted: true }) : null}
      </div>
    </div>
  );
}

const cellInput: CSSProperties = { width: 76, padding: '6px 8px', border: '1px solid #EBEBEB', borderRadius: 8, fontSize: 15, fontFamily: 'inherit', textAlign: 'right' };
const linkBtn: CSSProperties = { background: 'none', border: 'none', color: '#0571A6', cursor: 'pointer', fontSize: 12, fontWeight: 700, marginLeft: 6, padding: 0 };

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
