// Final settlement · emailed as a PDF (O3). The figures are the live exit's settlement (payroll,
// leave, gratuity, notice, clearance): check them, change or add a line with a reason, approve, then
// email the statement to the personal email as a PDF made here (settlementDoc.ts), previewed on the
// page. It is never shown in the app. Before sending: the last month's attendance and payroll,
// clearance n of 4, the salary status and a personal email. The first three stop the send until
// they pass, unless HR says why it goes anyway (the server keeps the reason). Save draft keeps the
// email; the lines are kept on the settlement as they change.
import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Avatar, Card, LoadError, PageActions, Pill, SkeletonForm } from '../../../ui';
import { btn, btnClass, note as noteBox } from '../../../ds';
import { IconDownload, IconPlus } from '../../../icons';
import { useStore } from '../../../store';
import { getExitDetail, settlementAction } from '../../../../services/hrms';
import type { ExitDetailDTO, SettlementLine } from '../../../../services/hrms';
import { emailSettlementPdf, getOffboardingDetail, getSettlementChecks, saveSettlementDraft } from '../../../../services/lifecycleOffboarding';
import type { DrawerDTO, SettlementChecksDTO } from '../../../../services/lifecycleOffboarding';
import { downloadSettlementPdf, settlementHtml } from '../../../settlementDoc';
import type { StatementFooter } from '../../../settlementDoc';
import { htmlToPdfBase64 } from '../../../pdf';
import { Statement } from '../../ExitDetail';
import { IconCheck } from '../../../icons';
import { ClockIcon, firstName, inrPaise, istKey, longDay, todayKey } from './parts';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Where a line comes from (6Zs §10: Payroll, Leave, Claims, Rule, Clearance, Offboarding, manual). */
function sourceOf(line: SettlementLine): string {
  if (line.changedReason !== undefined) return 'HR';
  if (line.key.startsWith('salary:') || line.key === 'pf' || line.key === 'other_deductions' || line.key === 'income_tax') return 'Payroll';
  if (line.key === 'leave_encashment') return 'Leave';
  if (line.key === 'gratuity') return 'Rule';
  if (line.key === 'notice_pay' || line.key === 'notice_recovery') return 'Offboarding';
  if (/claim|reimburse/.test(line.key)) return 'Claims';
  if (/clearance|advance|recover/.test(line.key)) return 'Clearance';
  return 'Payroll';
}

export function SettlementSend({ userId, onBack }: { userId: string; onBack: () => void }) {
  const s = useStore();
  const [data, setData] = useState<ExitDetailDTO | null>(null);
  const [checks, setChecks] = useState<SettlementChecksDTO | null>(null);
  const [drawer, setDrawer] = useState<DrawerDTO | null>(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState('');
  const [to, setTo] = useState('');
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [override, setOverride] = useState('');
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    let live = true;
    setError('');
    Promise.all([getExitDetail(userId), getSettlementChecks(userId), getOffboardingDetail(userId)])
      .then(([d, c, o]) => {
        if (!live) return;
        setData(d); setChecks(c); setDrawer(o);
        const first = firstName(d.exit.name);
        // A saved draft wins over the defaults.
        setTo((t) => t || c.draft?.to || c.personalEmail.value);
        setSubject((x) => x || c.draft?.subject || `Your full and final settlement · ${d.company.name}`);
        setMessage((x) => x || c.draft?.message || `Dear ${first},\n\nYour full and final settlement statement is attached.\n\nFor any question, reply to this email or write to HR.\n\n${d.company.name}`);
      })
      .catch((e) => { if (live) setError(e instanceof Error ? e.message : 'Could not load the settlement'); });
    return () => { live = false; };
  }, [userId, attempt]);

  /** The Statement's own actions (change a line, approve, reopen, paid). */
  const run = async (what: string, work: () => Promise<ExitDetailDTO>, done?: string) => {
    setBusy(what);
    try {
      setData(await work());
      setChecks(await getSettlementChecks(userId));
      if (done) s.flash(done);
      return true;
    } catch (e) {
      s.flash(e instanceof Error ? e.message : 'Could not save', 'error');
      return false;
    } finally {
      setBusy('');
    }
  };

  const footer: StatementFooter | undefined = checks ? { issuedOn: todayKey(), payBy: checks.dueOn, hrEmail: checks.hrEmail || undefined } : undefined;
  const previewHtml = useMemo(() => (data?.settlement && footer ? settlementHtml(data.exit, data.settlement, data.company, footer) : ''), [data, footer?.payBy, footer?.hrEmail]); // eslint-disable-line react-hooks/exhaustive-deps

  const top = <div className="pd-prof-top"><button type="button" onClick={onBack} className="pd-btn ghost sm" style={{ marginLeft: -12 }}>← Back to offboarding</button></div>;
  if (error) return <div>{top}<section className="pd-card"><LoadError text={error} onRetry={() => setAttempt((n) => n + 1)} /></section></div>;
  if (!data || !checks) return <div>{top}<section className="pd-card"><SkeletonForm fields={8} /></section></div>;

  const { exit, settlement, company } = data;
  const name = firstName(exit.name);
  const emailed = drawer?.settlement?.emailedAt ? { to: drawer.settlement.emailedTo, at: drawer.settlement.emailedAt } : null;
  const emailOk = EMAIL.test(to.trim());
  const blocked = checks.blocking.length > 0;
  const reason = override.trim();
  const canSend = !!settlement && emailOk && (!blocked || !!reason);

  const send = async () => {
    if (!settlement) return;
    setBusy('email');
    try {
      let detail = data;
      // "Approve and email": a draft is approved first (with the same reason when clearance is open).
      if (settlement.status === 'draft') detail = await settlementAction(userId, 'approve', exit.clearanceDone ? {} : { clearanceOverrideReason: reason });
      const filename = `Settlement_${detail.exit.employeeId || detail.exit.name.replace(/\s+/g, '_')}.pdf`;
      const pdfBase64 = await htmlToPdfBase64(settlementHtml(detail.exit, detail.settlement!, detail.company, footer), filename);
      const out = await emailSettlementPdf(userId, { pdfBase64, to: to.trim(), subject: subject.trim(), message: message.trim(), ...(blocked ? { overrideReason: reason } : {}) });
      setDrawer(out);
      setData(detail);
      setChecks(await getSettlementChecks(userId));
      s.flash(`The settlement PDF is emailed to ${to.trim()}`);
    } catch (e) {
      s.flash(e instanceof Error ? e.message : 'Could not send', 'error');
      // An approval that went through before the send failed still shows.
      setAttempt((n) => n + 1);
    } finally {
      setBusy('');
    }
  };

  const saveDraft = async () => {
    setBusy('draft');
    try {
      setChecks(await saveSettlementDraft(userId, { to: to.trim(), subject: subject.trim(), message: message.trim() }));
      s.flash('Draft saved. The lines are kept on the settlement as you change them.');
    } catch (e) {
      s.flash(e instanceof Error ? e.message : 'Could not save the draft', 'error');
    } finally {
      setBusy('');
    }
  };

  const rows: { label: string; ok: boolean; status: string }[] = [
    { label: 'Attendance and payroll for the last month', ok: checks.attendance.ok, status: checks.attendance.label },
    { label: 'Clearance: IT, Admin, Finance, handover', ok: checks.clearance.ok, status: `${checks.clearance.done} of ${checks.clearance.total} done` },
    { label: 'Salary status from payroll', ok: checks.salary.ok, status: checks.salary.label },
    { label: 'Personal email for the PDF', ok: emailOk, status: to.trim() || 'Not on their profile: add it below' },
  ];
  const zeroLines = settlement?.lines.filter((l) => l.amountPaise === 0) ?? [];

  return (
    <div style={{ animation: 'fade .3s ease both' }}>
      <PageActions>
        <button type="button" id="ob-save-draft" disabled={!!busy || !!emailed} onClick={() => void saveDraft()} className={btnClass()} style={btn()}>{busy === 'draft' ? 'Saving…' : 'Save draft'}</button>
        <button type="button" id="ob-email-settlement" disabled={!canSend || !!busy} title={!emailOk ? 'Add their personal email' : blocked && !reason ? 'Resolve the checks, or say why you are sending anyway' : undefined} onClick={() => void send()} className={btnClass('primary')} style={btn('primary')}>
          {busy === 'email' ? 'Sending…' : settlement?.status === 'draft' ? 'Approve and email PDF' : emailed ? 'Email the PDF again' : 'Email PDF'}
        </button>
      </PageActions>
      {top}
      <section className="pd-card pd-phead">
        <div className="ph-id">
          <Avatar name={exit.name} size={52} font={21} />
          <div style={{ minWidth: 0, flex: 1 }}>
            <div className="pn"><h1>Final settlement · {exit.name}</h1>{emailed && <Pill label={`Emailed ${longDay(istKey(emailed.at))}`} tone={{ bg: 'var(--ok-bg)', fg: 'var(--ok)' }} />}</div>
            <span className="sub">Figures come from payroll and clearance. Check them, then email the statement to {name} as a PDF. It is not shown in the app.{checks.draft ? ` Draft saved ${longDay(istKey(checks.draft.savedAt))}${checks.draft.byName ? ` by ${checks.draft.byName}` : ''}.` : ''}</span>
          </div>
        </div>
      </section>

      <div className="ob-banner"><ClockIcon /><span><b>Due {longDay(checks.dueOn)}</b> · 2 working days after the last day ({longDay(exit.lastWorkingDay)}). Gratuity, when eligible, is due within 30 days.</span></div>

      <div className="ob-two" style={{ marginBottom: 20 }}>
        <Card padded>
          <div className="pd-card-h"><h3>Before you send</h3>{blocked && <small style={{ color: 'var(--warn)' }}>Sending waits for these</small>}</div>
          {rows.map((r) => (
            <div key={r.label} className="ob-check">
              <span aria-label={r.ok ? 'Done' : 'Not yet'} style={{ width: 16, display: 'inline-flex' }}>{r.ok ? <IconCheck /> : <span style={{ color: 'var(--warn)' }}>!</span>}</span>
              <span>{r.label}</span>
              <span className="s" style={{ color: r.ok ? undefined : 'var(--warn)' }}>{r.status}</span>
            </div>
          ))}
          {blocked && !emailed && (
            <label className="pd-label" style={{ display: 'grid', gap: 6, marginTop: 12 }}>
              <span>Send anyway? Say why (kept with the settlement)</span>
              <input id="ob-send-override" className="pd-inp" value={override} onChange={(e) => setOverride(e.target.value)} placeholder="e.g. November paid off-cycle on 2 Dec" />
            </label>
          )}
        </Card>
        <Card padded>
          <div className="pd-card-h"><h3>Email</h3><small>{emailed ? `Sent to ${emailed.to} on ${longDay(istKey(emailed.at))}` : 'To their personal email'}</small></div>
          <div className="ob-form">
            <label className="f">To<input className="pd-inp" type="email" value={to} onChange={(e) => setTo(e.target.value)} placeholder="name@example.com" /></label>
            <label className="f">Subject<input className="pd-inp" value={subject} onChange={(e) => setSubject(e.target.value)} /></label>
            <label className="f">Message<textarea className="pd-inp" rows={5} value={message} onChange={(e) => setMessage(e.target.value)} /></label>
          </div>
        </Card>
      </div>

      <div className="ob-two" style={{ alignItems: 'start' }}>
        <section className="pd-card" style={{ minWidth: 0 }}>
          <div className="pd-card-h"><h3>Statement</h3></div>
          {!settlement && <div style={noteBox}>{exit.caseOpen ? `${name} stopped coming: the settlement starts once the case is closed (People › ${exit.name} › Exit).` : `The settlement starts the day after ${name}'s last day (${longDay(exit.lastWorkingDay)}).`}</div>}
          {settlement && (
            <Statement exit={exit} settlement={settlement} busy={busy} run={run} userId={userId} sourceOf={sourceOf}
              extra={settlement.status === 'draft' ? (
                <div><button type="button" id="ob-add-line" className="pd-btn sm" disabled={!!busy} onClick={() => setAdding(true)}><IconPlus size={14} /> Add a line</button></div>
              ) : undefined} />
          )}
        </section>
        <section className="pd-card" style={{ minWidth: 0 }}>
          <div className="pd-card-h">
            <h3>PDF preview</h3>
            <small>{emailed ? `Emailed to ${emailed.to}` : emailOk ? `To ${to.trim()}` : 'Not sent'}</small>
          </div>
          {settlement && previewHtml ? (
            <>
              <iframe title="Settlement PDF preview" sandbox="" srcDoc={previewHtml} style={{ width: '100%', height: 640, border: '1px solid var(--line)', borderRadius: 12, background: '#fff' }} />
              <div style={{ marginTop: 10 }}>
                <button type="button" onClick={() => void downloadSettlementPdf(exit, settlement, company, footer).catch((e) => s.flash(e instanceof Error ? e.message : 'Could not make the PDF', 'error'))} className={btnClass()} style={btn()}><IconDownload stroke="currentColor" /> Download</button>
              </div>
            </>
          ) : <div style={noteBox}>The preview shows once the settlement has started.</div>}
        </section>
      </div>

      {adding && settlement && (
        <AddLineDialog lines={zeroLines} busy={!!busy} onClose={() => setAdding(false)}
          onSave={async (key, amountPaise, why) => {
            if (await run(`line-${key}`, () => settlementAction(userId, 'line', { key, amountPaise, reason: why }), 'Line added to the statement')) setAdding(false);
          }} />
      )}
    </div>
  );
}

/**
 * Add a line: an amount, with the reason the statement shows, on a line the settlement rules know but
 * left at ₹0 (notice pay HR decides on, leave encashment, income tax…). The settlement's own lines are
 * all it carries: a line of a kind it does not know cannot be added here.
 */
function AddLineDialog({ lines, busy, onClose, onSave }: { lines: SettlementLine[]; busy: boolean; onClose: () => void; onSave: (key: string, amountPaise: number, reason: string) => Promise<void> }) {
  const [key, setKey] = useState(lines[0]?.key ?? '');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const line = lines.find((l) => l.key === key);
  const ok = !!line && Number(amount) > 0 && !!reason.trim();
  return createPortal(
    <div onClick={onClose} className="pd-scrim" style={{ zIndex: 90, background: 'rgba(20, 16, 50, 0.38)' }}>
      <div onClick={(e) => e.stopPropagation()} className="pd-modal" role="dialog" aria-label="Add a line" style={{ width: 'min(480px, 100%)' }}>
        <div className="pd-md-h"><div><h3>Add a line</h3><div className="pd-md-sub">The amount and why show on the statement and the PDF.</div></div></div>
        <div className="pd-md-b" style={{ display: 'grid', gap: 14 }}>
          {lines.length === 0 ? (
            <div style={noteBox}>Every line the settlement rules know already has an amount. Change one with its Change button, with the reason.</div>
          ) : (
            <>
              <label style={{ display: 'grid', gap: 6, fontWeight: 600, color: 'var(--ink)' }}>Line
                <span className="pd-pick">
                  <select className="pd-inp" value={key} onChange={(e) => setKey(e.target.value)}>
                    {lines.map((l) => <option key={l.key} value={l.key}>{l.side === 'deduction' ? 'Deduction' : 'Earning'} · {l.label}{l.computedPaise ? ` (works out to ${inrPaise(l.computedPaise)})` : ''}</option>)}
                  </select>
                </span>
              </label>
              <label style={{ display: 'grid', gap: 6, fontWeight: 600, color: 'var(--ink)' }}>Amount (₹)
                <input className="pd-inp" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9]/g, '').slice(0, 9))} placeholder={line?.computedPaise ? String(Math.round(line.computedPaise / 100)) : '0'} />
              </label>
              <label style={{ display: 'grid', gap: 6, fontWeight: 600, color: 'var(--ink)' }}>Why (shows on the statement)
                <input className="pd-inp" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. HR chose to pay the notice period" />
              </label>
            </>
          )}
        </div>
        <div className="pd-md-f">
          <button type="button" className="pd-btn" onClick={onClose}>Cancel</button>
          {lines.length > 0 && <button type="button" className="pd-btn primary" disabled={!ok || busy} onClick={() => void onSave(key, Number(amount) * 100, reason.trim())}>{busy ? 'Saving…' : 'Add the line'}</button>}
        </div>
      </div>
    </div>,
    document.body,
  );
}
