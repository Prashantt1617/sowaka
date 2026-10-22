// Payroll Runs — create a monthly run, review and correct the payslips, then
// submit it: a submitted run is final (no second approval). Loss of pay comes
// from the attendance calendar; HR corrects the days there, not on the run.
import { useEffect, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { useStore } from '../store';
import { ApiError } from '../../services/http';
import {
  createRun,
  getRun,
  inr,
  listRuns,
  listPayHeads,
  recallRun,
  recomputeRun,
  rupeesToPaise,
  submitRun,
} from '../../services/payroll';
import type { PayHeadDTO, PayrollRunDTO, PayslipDTO, RunStatus } from '../../services/payroll';

import { Card, EmptyRow, SummaryCard } from '../ui';
import { downloadPayslipPdf } from '../payslip';
import { downloadTdsSheetPdf } from '../tdsSheet';
import { LossOfPayExplainer } from '../LossOfPayExplainer';
import { EmployeeCalendar } from './EmployeeProfile';
import { exportReport } from './PayrollReports';
import { getSalaryRegister } from '../../services/payroll';
import * as L from './look';
import './look.css';

const STATUS_TONE: Record<RunStatus, { tone: L.Tone; label: string }> = {
  draft: { tone: 'mute', label: 'Draft' },
  pending_approval: { tone: 'warn', label: 'Pending approval' },
  approved: { tone: 'ok', label: 'Approved' },
  rejected: { tone: 'bad', label: 'Rejected' },
  paid: { tone: 'ok', label: 'Submitted' },
};

function StatusPill({ status }: { status: RunStatus }) {
  const t = STATUS_TONE[status];
  return <span style={L.pill(t.tone)}><span aria-hidden style={L.pillDot} />{t.label}</span>;
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
        <button onClick={() => setOpenId(null)} className="lk-ghost" style={{ ...L.btnGhost, fontSize: 13, marginBottom: 12, marginLeft: -12 }}>← All runs</button>
        <Card style={L.cardPad}><EmptyRow text={`Opening ${runs.find((r) => r.id === openId)?.period ?? 'run'}…`} /></Card>
      </div>
    );
  }

  // —— Run list ——
  return (
    <div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', marginBottom: 20 }}>
        <div>
          <label style={labelStyle}>Pay period</label>
          <input type="month" value={period} onChange={(e) => setPeriod(e.target.value)} className="lk-in" style={inputStyle} />
        </div>
        <button onClick={create} disabled={creating} className="lk-btn-p" style={primaryBtn}>{creating ? 'Creating…' : '+ Create run'}</button>
      </div>

      <Card style={L.cardPad}>
        {loading ? (
          <EmptyRow text="Loading…" />
        ) : runs.length === 0 ? (
          <EmptyRow text="No payroll runs yet — create one for the current period." />
        ) : (
          <table className="lk-t" style={tableStyle}>
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
                <tr key={r.id} className="lk-click" onClick={() => setOpenId(r.id)} style={{ cursor: 'pointer' }}>
                  <Td><strong style={L.cellName}>{r.period}</strong></Td>
                  <Td><StatusPill status={r.status} /></Td>
                  <Td right mono>{r.employeeCount}</Td>
                  <Td right mono>{inr(r.totals.netPaise + r.totals.reimbursementsPaise)}</Td>
                  <Td right><span style={{ color: 'var(--accent-ink)', fontWeight: 500, fontSize: 13, whiteSpace: 'nowrap' }}>Open →</span></Td>
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
type Edit = { paidDays?: string; tax?: string; overtime?: string; amounts?: Record<string, string> };

const money2 = (paise: number) => '₹' + (paise / 100).toLocaleString('en-IN', { minimumFractionDigits: paise % 100 ? 2 : 0, maximumFractionDigits: 2 });

// One run: every person's paid days (prefilled from attendance, editable),
// income tax, and the whole payslip, then submit (final).
function RunDetail({ detail, busy, onBack, onAct, onExplain, explain, onReload }: {
  detail: Detail;
  busy: boolean;
  onBack: () => void;
  onAct: (fn: () => Promise<PayrollRunDTO>, msg: string) => Promise<void>;
  onExplain: (p: PayslipDTO | null) => void;
  explain: PayslipDTO | null;
  onReload: () => Promise<void>;
}) {
  const { flash } = useStore();
  const { run, payslips } = detail;
  const isDraft = run.status === 'draft';
  // One-time earnings (Bonus…) and deductions (Hold Amount, Salary Advance…)
  // that can be entered for this month only.
  const [oneTime, setOneTime] = useState<PayHeadDTO[]>([]);
  useEffect(() => {
    listPayHeads()
      .then((heads) => setOneTime(heads.filter((h) => h.active && ((h.category === 'earning' && h.recurrence === 'one_time') || h.category === 'deduction'))))
      .catch(() => setOneTime([]));
  }, []);
  const [edits, setEdits] = useState<Record<string, Edit>>({});
  const [open, setOpen] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => setEdits({}), [detail]);
  const dirty = Object.keys(edits).length > 0;

  const setEdit = (userId: string, patch: Edit) => setEdits((e) => ({ ...e, [userId]: { ...e[userId], ...patch } }));
  const recalc = async (reset?: { userId: string; what: 'lop' | 'tax' }) => {
    const lopDays: Record<string, number | null> = {};
    const incomeTaxPaise: Record<string, number | null> = {};
    const overtimePaise: Record<string, number | null> = {};
    const componentAmounts: Record<string, Record<string, number | null>> = {};
    for (const p of payslips) {
      const e = edits[p.userId];
      if (e?.overtime !== undefined) {
        if (e.overtime === '') overtimePaise[p.userId] = null;
        else if (!(Number(e.overtime) >= 0)) return flash(`${p.employeeName}: overtime must be 0 or more`, 'error');
        else overtimePaise[p.userId] = rupeesToPaise(e.overtime);
      }
      for (const [code, v] of Object.entries(e?.amounts ?? {})) {
        if (v !== '' && !(Number(v) >= 0)) return flash(`${p.employeeName}: amounts must be 0 or more`, 'error');
        (componentAmounts[p.userId] ??= {})[code] = v === '' ? null : rupeesToPaise(v);
      }
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
      await recomputeRun(run.id, { lopDays, incomeTaxPaise, overtimePaise, componentAmounts });
      flash('Payslips recalculated');
      await onReload();
    } catch (e) {
      flash(e instanceof ApiError ? e.message : 'Could not recalculate', 'error');
    } finally {
      setSaving(false);
    }
  };

  // The whole run in Excel, every column (the month's Salary Register).
  const [exporting, setExporting] = useState(false);
  const exportRun = async () => {
    setExporting(true);
    try {
      exportReport('register', await getSalaryRegister(run.period, true));
    } catch (e) {
      flash(e instanceof ApiError ? e.message : 'Could not export', 'error');
    } finally {
      setExporting(false);
    }
  };
  // Whose loss-of-pay days are open in the calendar, and whether a day was changed there.
  const [lopFor, setLopFor] = useState<PayslipDTO | null>(null);
  const [lopChanged, setLopChanged] = useState(false);
  const closeLop = async () => {
    setLopFor(null);
    if (!lopChanged) return;
    setLopChanged(false);
    if (!isDraft) return flash('Days saved. This run is not a draft: reopen it to apply them.');
    setSaving(true);
    try {
      await recomputeRun(run.id, {});
      flash('Days saved and payslips recalculated');
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
      <button onClick={onBack} className="lk-ghost" style={{ ...L.btnGhost, fontSize: 13, marginBottom: 12, marginLeft: -12 }}>← All runs</button>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 6 }}>
        <h2 style={{ fontSize: 22, fontWeight: 600, letterSpacing: '-.02em', lineHeight: 1.2, margin: 0 }}>{run.period}</h2>
        <StatusPill status={run.status} />
        <span style={{ color: 'var(--ink-3)', fontSize: 13 }}>{run.employeeCount} employee{run.employeeCount === 1 ? '' : 's'}</span>
      </div>
      {run.note && <p style={{ color: 'var(--bad)', fontSize: 13, margin: '0 0 12px' }}>Note: {run.note}</p>}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, margin: '16px 0 20px' }}>
        <SummaryCard label="Gross pay" value={inr(t.grossPaise)} />
        <SummaryCard label="Employee deductions" value={inr(t.employeeDeductionsPaise)} color="var(--bad)" />
        <SummaryCard label="Net payout" value={inr(t.netPaise + t.reimbursementsPaise)} color="var(--ok)" />
        <SummaryCard label="Cost to company" value={inr(t.employerCostPaise)} />
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap', alignItems: 'center' }}>
        {isDraft && (
          <>
            <button onClick={() => void recalc()} disabled={saving} title="Recalculate from the latest attendance, claims and salaries, with what you typed" className="lk-btn-p" style={{ ...primaryBtn, opacity: saving ? 0.55 : 1 }}>{saving ? 'Recalculating…' : dirty ? 'Save & recalculate' : 'Recalculate'}</button>
            {dirty && <button onClick={() => setEdits({})} disabled={saving} className="lk-btn" style={ghostBtn}>Discard changes</button>}
          </>
        )}
        {run.status !== 'paid' && run.status !== 'rejected' && (
          <button onClick={() => void onAct(() => submitRun(run.id), 'Run submitted: payslips are out')} disabled={busy || dirty || saving} title={dirty ? 'Save your changes first' : 'Final: payslips go to employees and the month is locked'} className="lk-btn-p" style={{ ...approveBtn, opacity: busy || dirty ? 0.55 : 1 }}>Submit</button>
        )}
        <button onClick={() => void exportRun()} disabled={exporting} className="lk-btn" style={ghostBtn}>{exporting ? 'Exporting…' : 'Export (Excel)'}</button>
        {run.status !== 'draft' && (
          <button onClick={() => void onAct(() => recallRun(run.id), 'Reopened as a draft')} disabled={busy} className="lk-btn" style={{ ...ghostBtn, color: 'var(--ink-2)' }}>Reopen for changes</button>
        )}
        <span style={{ color: 'var(--ink-3)', fontSize: 12, lineHeight: 1.5 }}>
          {run.status === 'paid' ? '✓ Submitted: payslips are with employees.' : 'LOP comes from attendance: click a person’s LOP days to see or change the days. Submit is final.'}
        </span>
      </div>

      <Card style={L.cardPad}>
        <table className="lk-t" style={tableStyle}>
          <thead>
            <tr>
              <Th>Name</Th>
              <Th right>Days</Th>
              <Th right>LOP days</Th>
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
              const taxPaise = p.deductions.find((d) => d.key === 'income_tax')?.amountPaise ?? 0;
              const tax = e.tax ?? String(taxPaise / 100);
              const fromAttendance = p.inputs.workingDays - (p.inputs.attendanceLopDays ?? p.inputs.lopDays);
              const expanded = open === p.userId;
              return (
                <FragmentRows key={p.userId}>
                  <tr>
                    <Td>
                      <div style={L.cellName}>{p.employeeName}</div>
                      <div style={L.cellSub}>{[p.employeeId, p.department].filter(Boolean).join(' · ') || '—'}</div>
                    </Td>
                    <Td right mono>{p.inputs.workingDays}</Td>
                    <Td right>
                      <button type="button" onClick={() => { setLopChanged(false); setLopFor(p); }} title="See the days in the calendar, and change them" style={{ ...lopLink, fontSize: 14, fontWeight: 500, color: p.inputs.lopDays > 0 ? 'var(--bad)' : 'var(--ok)' }}>{p.inputs.lopDays}</button>
                      <div style={{ fontSize: 11.5, color: 'var(--ink-3)', marginTop: 2 }}>
                        {p.inputs.lopEnteredByHr ? (
                          <>Typed earlier · calendar {p.inputs.workingDays - fromAttendance}{isDraft && <button type="button" onClick={() => void recalc({ userId: p.userId, what: 'lop' })} style={linkBtn}>use calendar</button>}</>
                        ) : `of ${p.inputs.workingDays} · ${p.inputs.payableDays} paid`}
                      </div>
                    </Td>
                    <Td right mono>{money2(p.grossPaise)}</Td>
                    <Td right>
                      {isDraft ? (
                        <input type="number" min={0} value={tax} onChange={(ev) => setEdit(p.userId, { tax: ev.target.value })} className="lk-in" style={{ ...cellInput, width: 110, borderColor: e.tax !== undefined ? 'var(--accent)' : 'var(--line-2)' }} />
                      ) : (
                        <span>{money2(taxPaise)}</span>
                      )}
                      <div style={{ fontSize: 11.5, color: 'var(--ink-3)', marginTop: 2 }}>
                        {p.inputs.incomeTaxEnteredByHr ? (
                          <>Entered{isDraft && <button type="button" onClick={() => void recalc({ userId: p.userId, what: 'tax' })} style={linkBtn}>clear</button>}</>
                        ) : p.inputs.tds ? `TDS engine · ${p.inputs.tds.regime} regime${p.inputs.tds.configStatus === 'to_confirm' ? ' · slabs to confirm' : ''}` : 'None'}
                      </div>
                    </Td>
                    <Td right mono><span style={{ color: 'var(--bad)' }}>{money2(p.employeeDeductionsPaise)}</span></Td>
                    <Td right mono><strong style={{ fontWeight: 500 }}>{money2(p.netPayablePaise)}</strong></Td>
                    <Td right>
                      <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                        <button type="button" onClick={() => setOpen(expanded ? null : p.userId)} className="lk-btn" style={slipBtn}>{expanded ? 'Hide' : 'Details'}</button>
                        <button type="button" onClick={() => void downloadPayslipPdf(p, detail.company)} className="lk-btn" style={slipBtn}>Payslip</button>
                        {p.id && <button type="button" onClick={() => void downloadTdsSheetPdf(p.id!).catch((e) => alert(e instanceof Error ? e.message : String(e)))} className="lk-btn" style={slipBtn}>TDS sheet</button>}
                      </div>
                    </Td>
                  </tr>
                  {expanded && (
                    <tr>
                      <td colSpan={8} style={{ background: 'var(--surface-2)', padding: '16px 20px', borderBottom: '1px solid var(--line)', borderRadius: 14 }}>
                        {isDraft && (
                          <ThisMonthOnly
                            p={p}
                            items={oneTime}
                            edit={e}
                            onChange={(patch) => setEdit(p.userId, patch)}
                          />
                        )}
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
      {lopFor && (
        <LopCalendar
          slip={lopFor}
          period={run.period}
          editable={isDraft || run.status === 'pending_approval'}
          onMarked={() => setLopChanged(true)}
          onExplain={() => onExplain(lopFor)}
          onClose={() => void closeLop()}
        />
      )}
    </div>
  );
}

/**
 * One person's loss of pay for the run's month on their attendance calendar:
 * the days that cost pay ringed, and any day can be marked from here (while the
 * run is open). The run recalculates from the calendar when this closes.
 */
function LopCalendar({ slip, period, editable, onMarked, onExplain, onClose }: {
  slip: PayslipDTO; period: string; editable: boolean; onMarked: () => void; onExplain: () => void; onClose: () => void;
}) {
  const month = new Date(`${period}-01T00:00:00Z`).toLocaleString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  const rules = (slip.inputs.attendanceDeductions ?? []).filter((l) => l.days > 0);
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'var(--scrim)', zIndex: 60, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '40px 16px', overflowY: 'auto' }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: 'var(--surface)', borderRadius: 'var(--r-lg)', width: 'min(1040px, 100%)', boxShadow: 'var(--shadow-lg)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '16px 20px', borderBottom: '1px solid var(--line)' }}>
          <div style={{ flex: 1 }}>
            <div style={L.modalTitle}>{slip.employeeName} · loss of pay, {month}</div>
            <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 2 }}>
              <strong style={{ color: 'var(--bad)', fontWeight: 500 }}>{slip.inputs.lopDays} LOP {slip.inputs.lopDays === 1 ? 'day' : 'days'}</strong> of {slip.inputs.workingDays}
              {rules.length > 0 && <> · {rules.map((l) => `${l.label} ${l.count} → ${l.days}`).join(' · ')}</>}
              {' · '}<button type="button" onClick={onExplain} style={{ ...linkBtn, marginLeft: 0 }}>how it adds up</button>
            </div>
          </div>
          <button type="button" onClick={onClose} className="lk-btn" style={ghostBtn}>Done</button>
        </div>
        <div style={{ padding: 20 }}>
          <EmployeeCalendar
            userId={slip.userId}
            initial={null}
            onChanged={() => undefined}
            startMonth={period}
            editableMonth={editable ? period : undefined}
            highlight={(d) => (d.status === 'absent' ? 'LOP' : d.status === 'half_day' ? 'LOP ½' : null)}
            onMarked={onMarked}
          />
          {!editable && <div style={{ fontSize: 11.5, color: 'var(--ink-3)', marginTop: 12 }}>This run is submitted, so its days are locked. Reopen it to change them.</div>}
        </div>
      </div>
    </div>
  );
}

// This month only, for one person: overtime pay, and one-time earnings or
// deductions (a bonus, a hold, an advance recovered). Kept on the run until
// changed; blank clears one.
function ThisMonthOnly({ p, items, edit, onChange }: { p: PayslipDTO; items: PayHeadDTO[]; edit: Edit; onChange: (patch: Edit) => void }) {
  const saved = p.inputs.componentAmounts ?? {};
  const value = (code: string) => edit.amounts?.[code] ?? (saved[code] !== undefined ? String(saved[code] / 100) : '');
  const ot = edit.overtime ?? (p.inputs.overtimePaise ? String(p.inputs.overtimePaise / 100) : '');
  const field = (label: string, v: string, set: (v: string) => void, changed: boolean, hint?: string) => (
    <label key={label} style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 11.5, color: 'var(--ink-2)' }}>
      <span>{label}{hint && <span style={{ color: 'var(--ink-3)' }}> · {hint}</span>}</span>
      <input type="number" min={0} value={v} placeholder="0" onChange={(ev) => set(ev.target.value)} className="lk-in" style={{ ...cellInput, width: 120, textAlign: 'left', borderColor: changed ? 'var(--accent)' : 'var(--line-2)' }} />
    </label>
  );
  return (
    <div style={{ marginBottom: 16, paddingBottom: 16, borderBottom: '1px dashed var(--line-2)' }}>
      <div style={{ ...L.eyebrow, marginBottom: 8 }}>This month only</div>
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        {field('Overtime pay', ot, (v) => onChange({ overtime: v }), edit.overtime !== undefined, p.inputs.approvedOtHours ? `${p.inputs.approvedOtHours} h approved${!p.inputs.overtimeEnteredByHr && p.inputs.overtimePaise > 0 ? ' · paid by the template’s rule' : ''}` : undefined)}
        {items.map((h) => field(h.payslipName ?? h.name, value(h.code), (v) => onChange({ amounts: { ...(edit.amounts ?? {}), [h.code]: v } }), edit.amounts?.[h.code] !== undefined, h.category === 'deduction' ? 'deduction' : 'one-time earning'))}
      </div>
      <div style={{ fontSize: 11.5, color: 'var(--ink-3)', marginTop: 8 }}>Then Save &amp; recalculate. One-time earnings are paid on top of the monthly CTC.</div>
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
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontSize: 13, fontWeight: opts.strong ? 500 : 400, color: opts.muted ? 'var(--ink-3)' : 'var(--ink)' }}>
      <span>{label}{opts.sub && <span style={{ color: 'var(--ink-3)', fontWeight: 400 }}> · {opts.sub}</span>}</span>
      <span style={{ fontVariantNumeric: 'tabular-nums' }}>{money2(value)}</span>
    </div>
  );
  const head = (t: string) => <div style={{ ...L.eyebrow, margin: '0 0 6px' }}>{t}</div>;
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
        {p.deductions.length === 0 && <div style={{ color: 'var(--ink-3)', fontSize: 13 }}>None</div>}
        {p.deductions.map((d) => <div key={d.key}>{row(d.name, d.amountPaise, { muted: d.hidden })}</div>)}
        {row('Total deductions', p.employeeDeductionsPaise, { strong: true })}
        <div style={{ height: 10 }} />
        {row('Net pay', p.netPayablePaise, { strong: true })}
        <div style={{ fontSize: 11.5, color: 'var(--ink-3)', marginTop: 6 }}>
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
      {p.inputs.tds && !p.inputs.incomeTaxEnteredByHr && (
        <div style={{ gridColumn: '1 / -1', borderTop: '1px dashed var(--line-2)', paddingTop: 12 }}>
          {head(`Income tax · FY ${p.inputs.tds.fy} · ${p.inputs.tds.regime} regime${p.inputs.tds.configStatus === 'to_confirm' ? ' · slabs to confirm' : ''}`)}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0 28px' }}>
            {row('Projected salary for the year', p.inputs.tds.grossSalaryPaise)}
            {row('Standard deduction', p.inputs.tds.standardDeductionPaise)}
            {p.inputs.tds.hraExemptPaise > 0 && row('HRA exemption', p.inputs.tds.hraExemptPaise)}
            {p.inputs.tds.chapterVIAPaise > 0 && row('Chapter VI-A (80C, 80D…)', p.inputs.tds.chapterVIAPaise)}
            {p.inputs.tds.homeLoanPaise > 0 && row('Home loan interest', p.inputs.tds.homeLoanPaise)}
            {row('Taxable income', p.inputs.tds.taxableIncomePaise, { strong: true })}
            {row('Tax on slabs', p.inputs.tds.slabTaxPaise)}
            {p.inputs.tds.rebatePaise > 0 && row('Rebate 87A', p.inputs.tds.rebatePaise)}
            {p.inputs.tds.surchargePaise > 0 && row('Surcharge', p.inputs.tds.surchargePaise)}
            {row('Cess 4%', p.inputs.tds.cessPaise)}
            {row('Tax for the year', p.inputs.tds.annualTaxPaise, { strong: true })}
            {row('Already withheld', p.inputs.tds.alreadyDeductedPaise)}
            {row(`This month (÷ ${p.inputs.tds.monthsLeft} months left)`, p.inputs.tds.monthlyTdsPaise, { strong: true })}
          </div>
        </div>
      )}
    </div>
  );
}

const cellInput: CSSProperties = { width: 76, height: 34, padding: '0 10px', border: '1px solid var(--line-2)', borderRadius: 10, fontSize: 13, fontFamily: 'inherit', textAlign: 'right', background: 'var(--surface)', color: 'var(--ink)' };
const linkBtn: CSSProperties = { background: 'none', border: 'none', color: 'var(--accent-ink)', cursor: 'pointer', fontSize: 11.5, fontWeight: 500, marginLeft: 6, padding: 0 };

function Th({ children, right }: { children?: ReactNode; right?: boolean }) {
  return <th style={{ ...L.th, textAlign: right ? 'right' : 'left' }}>{children}</th>;
}
function Td({ children, right, mono }: { children: ReactNode; right?: boolean; mono?: boolean }) {
  return <td style={{ ...L.td, textAlign: right ? 'right' : 'left', fontVariantNumeric: mono ? 'tabular-nums' : undefined }}>{children}</td>;
}

const labelStyle: CSSProperties = { ...L.label };
const inputStyle: CSSProperties = { ...L.input, width: undefined };
const tableStyle: CSSProperties = { ...L.table };
const primaryBtn: CSSProperties = { ...L.btnPrimary };
const approveBtn: CSSProperties = { ...L.btnPrimary, background: 'var(--ok-solid)', boxShadow: '0 8px 18px -10px var(--ok-solid)' };
const ghostBtn: CSSProperties = { ...L.btn };

const slipBtn: CSSProperties = { ...L.btnSm };

const lopLink: CSSProperties = { background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'var(--bad)', fontWeight: 500, fontSize: 14, fontFamily: 'inherit', textDecoration: 'underline', textDecorationStyle: 'dotted', textUnderlineOffset: 3 };
