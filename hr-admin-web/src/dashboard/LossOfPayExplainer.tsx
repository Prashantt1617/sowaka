// Why the pay was docked: the rule on top, then every day that counted
// towards it, from the same calendar the attendance report grades. Opened
// from a payslip row on the profile and on a payroll run.
import { useEffect, useState } from 'react';
import { getEmployeeCalendar } from '../services/hrms';
import type { CalendarDayDTO, EmployeeCalendarDTO } from '../services/hrms';
import { DEDUCTION_TRIGGER_LABELS, inr, type DeductionTrigger, type PayslipDTO } from '../services/payroll';

const periodTitle = (period: string) =>
  new Date(`${period}-01T00:00:00Z`).toLocaleString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' });

const TRIGGER_DAY: Record<DeductionTrigger, (d: CalendarDayDTO) => boolean> = {
  late: (d) => d.lateByMinutes > 0,
  early: (d) => (d.earlyByMinutes ?? 0) > 0,
  absent: (d) => d.status === 'absent',
  half_day: (d) => d.status === 'half_day' || d.status === 'missed_punch',
  leave: (d) => d.status === 'on_leave',
  missed_punch: (d) => d.status === 'missed_punch',
};
const clock = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Kolkata' }) : '—');
const dayLabel = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-IN', { weekday: 'short', day: '2-digit', month: 'short', timeZone: 'UTC' });
const mins = (m: number) => (m >= 60 ? `${Math.floor(m / 60)}h ${m % 60 ? `${m % 60}m` : ''}`.trim() : `${m} min`);

export function LossOfPayExplainer({ userId, payslip, onClose }: { userId: string; payslip: PayslipDTO; onClose: () => void }) {
  const [cal, setCal] = useState<EmployeeCalendarDTO | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    getEmployeeCalendar(userId, payslip.period)
      .then((c) => { if (live) setCal(c); })
      .catch((e: Error) => { if (live) setError(e.message); });
    return () => { live = false; };
  }, [userId, payslip.period]);
  const lines = (payslip.inputs.attendanceDeductions ?? []).filter((l) => l.days > 0);
  const lopPaise = payslip.earnings.reduce((t, e) => t + (e.fullPaise - e.paidPaise), 0);
  const totalDeducted = lines.reduce((t, l) => t + l.days, 0);
  const covered = payslip.inputs.paidLeaveDaysApplied ?? 0;

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(20,20,30,.45)', zIndex: 60, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: '#fff', borderRadius: 16, width: 'min(680px, 100%)', maxHeight: '86vh', display: 'flex', flexDirection: 'column', boxShadow: '0 24px 60px rgba(0,0,0,.25)' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '18px 22px', borderBottom: '1px solid #EBEBEB' }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 19, fontWeight: 800, letterSpacing: '-.3px' }}>Loss of pay · {periodTitle(payslip.period)}</div>
            <div style={{ fontSize: 14, color: '#717171', marginTop: 3 }}>
              {payslip.inputs.lopDays} of {payslip.inputs.workingDays} paid days deducted · {inr(lopPaise)}
              {(payslip.inputs.paidLeaveDaysApplied ?? 0) > 0 && ` · ${payslip.inputs.paidLeaveDaysApplied} ${payslip.inputs.paidLeaveDaysApplied === 1 ? 'day' : 'days'} covered by paid leave`}
            </div>
          </div>
          <button type="button" onClick={onClose} style={{ background: '#F7F7F9', border: 'none', borderRadius: 9, width: 34, height: 34, cursor: 'pointer', fontSize: 18, color: '#484848' }}>×</button>
        </div>
        <div style={{ overflowY: 'auto', padding: '6px 22px 18px' }}>
          {error && <div style={{ color: '#A8475F', fontWeight: 600, padding: '14px 0' }}>{error}</div>}
          {lines.map((line) => {
            const trigger = line.trigger;
            // Named from the rule, not the slip: a label saved with an older run stays current.
            const label = trigger ? DEDUCTION_TRIGGER_LABELS[trigger] : line.label;
            const days = cal && trigger ? cal.days.filter(TRIGGER_DAY[trigger]) : null;
            return (
              <div key={line.trigger ?? line.label} style={{ marginTop: 16 }}>
                <div style={{ background: '#FBF1DD', border: '1px solid #F1DDB2', borderRadius: 12, padding: '12px 14px' }}>
                  <div style={{ fontSize: 15, fontWeight: 800, color: '#222222' }}>
                    {label}: every {line.every ?? '—'} → {line.deductDays ?? '—'} paid {line.deductDays === 1 ? 'day' : 'days'}
                  </div>
                </div>
                {!days ? (
                  <div style={{ padding: '12px 4px', color: '#717171', fontSize: 14 }}>{error ? '' : 'Loading the days…'}</div>
                ) : days.length === 0 ? (
                  <div style={{ padding: '12px 4px', color: '#717171', fontSize: 14 }}>No matching days on the calendar.</div>
                ) : (
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 15, marginTop: 8 }}>
                    <tbody>
                      {days.map((d) => (
                        <tr key={d.date}>
                          <td style={{ padding: '9px 4px', borderBottom: '1px solid #F4F4F6', fontWeight: 600, width: 150 }}>{dayLabel(d.date)}</td>
                          <td style={{ padding: '9px 4px', borderBottom: '1px solid #F4F4F6', color: '#717171' }}>
                            {trigger === 'late' && `In at ${clock(d.punchIn)} · late by ${mins(d.lateByMinutes)}`}
                            {trigger === 'early' && `Out at ${clock(d.punchOut)} · left ${mins(d.earlyByMinutes ?? 0)} early`}
                            {trigger === 'absent' && 'Absent'}
                            {trigger === 'half_day' && (d.status === 'missed_punch' ? `Single punch · ${d.label ?? 'missed punch'} · in ${clock(d.punchIn)}` : `Half day · ${clock(d.punchIn)} – ${clock(d.punchOut)}`)}
                            {trigger === 'leave' && (d.label ?? 'On leave')}
                            {trigger === 'missed_punch' && (d.label ?? 'Missed punch')}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            );
          })}
        </div>
        <div style={{ borderTop: '1px solid #EBEBEB', padding: '14px 22px', display: 'flex', flexDirection: 'column', gap: 6, background: '#FBFBFC', borderRadius: '0 0 16px 16px' }}>
          <TotalRow label="Total deducted" value={`${fmt(totalDeducted)} ${totalDeducted === 1 ? 'day' : 'days'}`} />
          {covered > 0 && <TotalRow label="Covered by paid leave" value={`−${fmt(Math.min(covered, totalDeducted))} ${Math.min(covered, totalDeducted) === 1 ? 'day' : 'days'}`} />}
          <TotalRow strong label="Loss of pay" value={`${fmt(payslip.inputs.lopDays)} ${payslip.inputs.lopDays === 1 ? 'day' : 'days'} · ${inr(lopPaise)}`} />
        </div>
      </div>
    </div>
  );
}

const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

function TotalRow({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: strong ? 16 : 15, fontWeight: strong ? 800 : 600, color: strong ? '#A8475F' : '#484848' }}>
      <span>{label}</span>
      <span>{value}</span>
    </div>
  );
}

