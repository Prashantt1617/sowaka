// Why the pay was docked: the rule on top, then every day that counted
// towards it, from the same calendar the attendance report grades. Opened
// from a payslip row on the profile and on a payroll run.
import { useEffect, useState } from 'react';
import { getEmployeeCalendar, getPayCycle } from '../services/hrms';
import type { CalendarDayDTO, EmployeeCalendarDTO } from '../services/hrms';
import { DEDUCTION_TRIGGER_LABELS, inr, type DeductionTrigger, type PayslipDTO } from '../services/payroll';
import { employedDaysOf, isNotEmployedLine, lossOfPayDaysOf, lossOfPayPaiseOf, notEmployedNote, notEmployedOf, notEmployedPaiseOf } from './payslipDays';

const periodTitle = (period: string) =>
  new Date(`${period}-01T00:00:00Z`).toLocaleString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' });

const TRIGGER_DAY: Record<DeductionTrigger, (d: CalendarDayDTO) => boolean> = {
  late: (d) => d.lateByMinutes > 0,
  early: (d) => (d.earlyByMinutes ?? 0) > 0,
  absent: (d) => d.status === 'absent',
  half_day: (d) => d.status === 'half_day' || d.status === 'missed_punch',
  leave: (d) => d.status === 'on_leave',
  missed_punch: (d) => d.status === 'missed_punch',
  unpaid_leave: (d) => d.status === 'unpaid_leave',
};
const clock = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Kolkata' }) : '—');
const dayLabel = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-IN', { weekday: 'short', day: '2-digit', month: 'short', timeZone: 'UTC' });
const mins = (m: number) => (m >= 60 ? `${Math.floor(m / 60)}h ${m % 60 ? `${m % 60}m` : ''}`.trim() : `${m} min`);

const addMonths = (period: string, n: number) => {
  const [y, m] = period.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
};

/**
 * The days a payslip pays for (24 Nov 2026: Convrse pays 26th to 25th, and the explainer listed only the
 * calendar month, so 26–31 Oct's absences were missing from November's). The run's own window when known,
 * else the company's pay cycle (its start day), else the calendar month.
 */
async function windowOf(period: string, known?: { from?: string; to?: string }): Promise<{ from: string; to: string }> {
  if (known?.from && known.to) return { from: known.from, to: known.to };
  const monthEnd = (p: string) => new Date(Date.UTC(Number(p.slice(0, 4)), Number(p.slice(5, 7)), 0)).toISOString().slice(0, 10);
  try {
    const cycle = await getPayCycle();
    const start = Number((cycle.current ?? cycle.previous)?.from.slice(8, 10) ?? 1);
    if (start > 1) {
      const prev = addMonths(period, -1);
      return { from: `${prev}-${String(start).padStart(2, '0')}`, to: `${period}-${String(start - 1).padStart(2, '0')}` };
    }
  } catch { /* the calendar month */ }
  return { from: `${period}-01`, to: monthEnd(period) };
}

export function LossOfPayExplainer({ userId, payslip, onClose, window: known }: { userId: string; payslip: PayslipDTO; onClose: () => void; window?: { from?: string; to?: string } }) {
  const [cal, setCal] = useState<EmployeeCalendarDTO | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    (async () => {
      const w = await windowOf(payslip.period, known);
      // Every month the window touches (two for a 26th–25th cycle), cut to the window.
      const months = [...new Set([w.from.slice(0, 7), w.to.slice(0, 7)])];
      const cals = await Promise.all(months.map((m) => getEmployeeCalendar(userId, m)));
      const days = cals.flatMap((c) => c.days).filter((d) => d.date >= w.from && d.date <= w.to);
      if (live) setCal({ ...cals[cals.length - 1], days });
    })().catch((e: Error) => { if (live) setError(e.message); });
    return () => { live = false; };
  }, [userId, payslip.period, known?.from, known?.to]);
  // The days before joining / after leaving are listed apart: not loss of pay, the person was not employed.
  const lines = (payslip.inputs.attendanceDeductions ?? []).filter((l) => l.days > 0 && !isNotEmployedLine(payslip.inputs, l));
  const lopDays = lossOfPayDaysOf(payslip.inputs);
  const lopPaise = lossOfPayPaiseOf(payslip);
  const notEmployed = notEmployedOf(payslip.inputs);
  const notEmployedPaise = notEmployedPaiseOf(payslip);
  const totalDeducted = lines.reduce((t, l) => t + l.days, 0);
  const covered = payslip.inputs.paidLeaveDaysApplied ?? 0;

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'var(--scrim)', zIndex: 60, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: 'var(--surface)', borderRadius: 'var(--r-lg)', width: 'min(680px, 100%)', maxHeight: '86vh', display: 'flex', flexDirection: 'column', boxShadow: 'var(--shadow-lg)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '16px 20px', borderBottom: '1px solid var(--line)' }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 16, fontWeight: 600, letterSpacing: '-.01em' }}>Loss of pay · {periodTitle(payslip.period)}</div>
            <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 2 }}>
              {lopDays} of {employedDaysOf(payslip.inputs)} days employed deducted · {inr(lopPaise)}
              {(payslip.inputs.paidLeaveDaysApplied ?? 0) > 0 && ` · ${payslip.inputs.paidLeaveDaysApplied} ${payslip.inputs.paidLeaveDaysApplied === 1 ? 'day' : 'days'} covered by paid leave`}
              {notEmployed.days > 0 && ` · ${notEmployedNote(payslip)}`}
            </div>
          </div>
          <button type="button" onClick={onClose} style={{ background: 'var(--surface)', border: '1px solid var(--line-2)', borderRadius: 999, width: 32, height: 32, cursor: 'pointer', fontSize: 16, color: 'var(--ink-2)' }}>×</button>
        </div>
        <div style={{ overflowY: 'auto', padding: '4px 20px 20px' }}>
          {error && <div style={{ color: 'var(--bad)', fontWeight: 400, padding: '14px 0' }}>{error}</div>}
          {notEmployed.days > 0 && (
            <div style={{ marginTop: 16, background: 'var(--surface-2)', border: '1px solid var(--line)', borderRadius: 14, padding: '12px 14px' }}>
              <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--ink)' }}>Not employed · {notEmployed.days} {notEmployed.days === 1 ? 'day' : 'days'} · {notEmployedNote(payslip)}</div>
              <div style={{ fontSize: 13, color: 'var(--ink-3)', marginTop: 4 }}>
                Not paid, and not loss of pay: they were not with the company on these days. {inr(notEmployedPaise)}.
              </div>
            </div>
          )}
          {lines.map((line) => {
            const trigger = line.trigger;
            // Named from the rule, not the slip: a label saved with an older run stays current.
            const label = trigger ? DEDUCTION_TRIGGER_LABELS[trigger] : line.label;
            const days = cal && trigger ? cal.days.filter(TRIGGER_DAY[trigger]) : null;
            return (
              <div key={line.trigger ?? line.label} style={{ marginTop: 16 }}>
                <div style={{ background: 'var(--warn-bg)', border: '1px solid var(--warn-line)', borderRadius: 14, padding: '12px 14px' }}>
                  <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--ink)' }}>
                    {trigger === 'unpaid_leave'
                      ? `${label}: every day unpaid, a half day half · ${line.count} ${line.count === 1 ? 'day' : 'days'} taken`
                      : `${label}: every ${line.every ?? '—'} → ${line.deductDays ?? '—'} paid ${line.deductDays === 1 ? 'day' : 'days'}`}
                  </div>
                  <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--bad)', marginTop: 4 }}>
                    Total deducted days → {fmt(line.days)}
                  </div>
                </div>
                {!days ? (
                  <div style={{ padding: '12px 4px', color: 'var(--ink-3)', fontSize: 13 }}>{error ? '' : 'Loading the days…'}</div>
                ) : days.length === 0 ? (
                  <div style={{ padding: '12px 4px', color: 'var(--ink-3)', fontSize: 13 }}>No matching days on the calendar.</div>
                ) : (
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13.5, marginTop: 8 }}>
                    <tbody>
                      {days.map((d) => (
                        <tr key={d.date}>
                          <td style={{ padding: '10px 4px', borderBottom: '1px solid var(--line)', fontWeight: 400, width: 150 }}>{dayLabel(d.date)}</td>
                          <td style={{ padding: '10px 4px', borderBottom: '1px solid var(--line)', color: 'var(--ink-3)' }}>
                            {trigger === 'late' && `In at ${clock(d.punchIn)} · late by ${mins(d.lateByMinutes)}`}
                            {trigger === 'early' && `Out at ${clock(d.punchOut)} · left ${mins(d.earlyByMinutes ?? 0)} early`}
                            {trigger === 'absent' && 'Absent'}
                            {trigger === 'half_day' && (d.status === 'missed_punch' ? `Single punch · ${d.label ?? 'missed punch'} · in ${clock(d.punchIn)}` : `Half day · ${clock(d.punchIn)} – ${clock(d.punchOut)}`)}
                            {trigger === 'leave' && (d.label ?? 'On leave')}
                            {trigger === 'missed_punch' && (d.label ?? 'Missed punch')}
                            {trigger === 'unpaid_leave' && `Leave without pay${d.halfDay ? ' · half day' : ''}`}
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
        <div style={{ borderTop: '1px solid var(--line)', padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 6, background: 'var(--surface-2)', borderRadius: '0 0 var(--r-lg) var(--r-lg)' }}>
          <TotalRow label="Total deducted" value={`${fmt(totalDeducted)} ${totalDeducted === 1 ? 'day' : 'days'}`} />
          {covered > 0 && <TotalRow label="Covered by paid leave" value={`−${fmt(Math.min(covered, totalDeducted))} ${Math.min(covered, totalDeducted) === 1 ? 'day' : 'days'}`} />}
          <TotalRow strong label="Loss of pay" value={`${fmt(lopDays)} ${lopDays === 1 ? 'day' : 'days'} · ${inr(lopPaise)}`} />
          {notEmployed.days > 0 && <TotalRow label="Not employed (not loss of pay)" value={`${fmt(notEmployed.days)} ${notEmployed.days === 1 ? 'day' : 'days'} · ${inr(notEmployedPaise)}`} />}
        </div>
      </div>
    </div>
  );
}

const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

function TotalRow({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: strong ? 14 : 13.5, fontWeight: strong ? 600 : 400, color: strong ? 'var(--bad)' : 'var(--ink-2)' }}>
      <span>{label}</span>
      <span>{value}</span>
    </div>
  );
}

