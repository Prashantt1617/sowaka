// Final settlement · emailed as a PDF (O3, canvas HRSettlement). The figures are the live exit's
// settlement (payroll, leave, gratuity, notice, clearance): check them, change or add a line with a
// reason, approve, then email the statement to the personal email as a PDF made here
// (settlementDoc.ts), previewed on the right. It is never shown in the app. Before sending: the last
// month's attendance and payroll, clearance n of 4, the salary status and a personal email. The first
// three stop the send until they pass, unless HR says why it goes anyway (the server keeps the
// reason). The email (to, subject, message) opens from the personal email check's Edit email; Save
// draft keeps it; the lines are kept on the settlement as they change.
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { LoadError, PageActions, SkeletonForm } from '../../../ui';
import { usePageHead } from '../../../pageHead';
import { btn, btnClass, note as noteBox } from '../../../ds';
import { IconCheck, IconDownload, IconPlus } from '../../../icons';
import { useStore } from '../../../store';
import { getExitDetail, settlementAction } from '../../../../services/hrms';
import type { ExitDetailDTO, SettlementLine } from '../../../../services/hrms';
import { emailSettlementPdf, getOffboardingDetail, getSettlementChecks, saveSettlementDraft } from '../../../../services/lifecycleOffboarding';
import type { DrawerDTO, SettlementChecksDTO } from '../../../../services/lifecycleOffboarding';
import { downloadSettlementPdf, settlementHtml } from '../../../settlementDoc';
import type { StatementFooter } from '../../../settlementDoc';
import { htmlToPdfBase64 } from '../../../pdf';
import { ApiError } from '../../../../services/http';
import { SettlementStatement } from './SettlementStatement';
import { ClockIcon, firstName, inrPaise, istKey, longDay, todayKey } from './parts';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** The envelope on the email actions (HRSettlement). */
const IconMail = () => (
  <svg aria-hidden width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><path d="M3 5h18v14H3zM3 7l9 6 9-6" /></svg>
);

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
  // The server's "already emailed" answer, waiting for HR to say send again.
  const [resendAsk, setResendAsk] = useState<{ at: string | null; to: string; message: string } | null>(null);
  // HRSettlement: "Final settlement · <name>" is the page's own title, with the way back beside it.
  usePageHead({ title: data?.exit.name ? `Final settlement · ${data.exit.name}` : 'Final settlement', eyebrow: 'Employee lifecycle · Offboarding', onBack, backLabel: 'Back to offboarding' });
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState('');
  const [to, setTo] = useState('');
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [override, setOverride] = useState('');
  const [adding, setAdding] = useState(false);
  const [editingEmail, setEditingEmail] = useState(false);

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
  const previewHtml = useMemo(() => (data?.settlement && !data.settlement.notSetUp && footer ? settlementHtml(data.exit, data.settlement, data.company, footer) : ''), [data, footer?.payBy, footer?.hrEmail]); // eslint-disable-line react-hooks/exhaustive-deps

  if (error) return <div><section className="pd-card"><LoadError text={error} onRetry={() => setAttempt((n) => n + 1)} /></section></div>;
  if (!data || !checks) return <div><section className="pd-card"><SkeletonForm fields={8} /></section></div>;

  const { exit, settlement, company } = data;
  const name = firstName(exit.name);
  const emailed = drawer?.settlement?.emailedAt ? { to: drawer.settlement.emailedTo, at: drawer.settlement.emailedAt } : null;
  const emailOk = EMAIL.test(to.trim());
  const blocked = checks.blocking.length > 0;
  const reason = override.trim();
  // No salary structure: no figures, so nothing to approve or email (the server refuses it too).
  const notSetUp = settlement?.notSetUp || '';
  const canSend = !!settlement && !notSetUp && emailOk && (!blocked || !!reason);

  const send = async (resend = false) => {
    if (!settlement || notSetUp) return;
    setBusy('email');
    setResendAsk(null);
    try {
      let detail = data;
      // "Approve and email": a draft is approved first (with the same reason when clearance is open).
      if (settlement.status === 'draft' && !resend) detail = await settlementAction(userId, 'approve', exit.clearanceDone ? {} : { clearanceOverrideReason: reason });
      const filename = `Settlement_${detail.exit.employeeId || detail.exit.name.replace(/\s+/g, '_')}.pdf`;
      const pdfBase64 = await htmlToPdfBase64(settlementHtml(detail.exit, detail.settlement!, detail.company, footer), filename);
      const out = await emailSettlementPdf(userId, { pdfBase64, to: to.trim(), subject: subject.trim(), message: message.trim(), ...(blocked ? { overrideReason: reason } : {}), ...(resend ? { resend: true } : {}) });
      setDrawer(out);
      setData(detail);
      setChecks(await getSettlementChecks(userId));
      s.flash(`The settlement PDF is emailed to ${to.trim()}`);
    } catch (e) {
      // Emailed a few minutes ago (a double click, another tab): ask before sending it again.
      if (e instanceof ApiError && e.status === 409 && /already emailed/i.test(e.message)) {
        const fresh = await getOffboardingDetail(userId).catch(() => null);
        if (fresh) setDrawer(fresh);
        const at = fresh?.settlement?.emailedAt ?? drawer?.settlement?.emailedAt;
        setResendAsk({ at: at ?? null, to: fresh?.settlement?.emailedTo ?? drawer?.settlement?.emailedTo ?? to.trim(), message: e.message });
        // A draft approved just before this send is approved now: reload, so Send again does not approve twice.
        setAttempt((n) => n + 1);
        return;
      }
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

  const rows: { label: string; ok: boolean; status: string; edit?: boolean }[] = [
    { label: 'Attendance and payroll for the last month', ok: checks.attendance.ok, status: checks.attendance.label },
    { label: 'Clearance: IT, Admin, Finance, handover', ok: checks.clearance.ok, status: `${checks.clearance.done} of ${checks.clearance.total} done` },
    { label: 'Salary status from payroll', ok: checks.salary.ok, status: checks.salary.label },
    { label: 'Personal email for the PDF', ok: emailOk, status: to.trim() || 'Not on their profile', edit: true },
  ];
  const zeroLines = settlement?.lines.filter((l) => l.amountPaise === 0) ?? [];

  // Where the PDF goes, as the preview's header says it.
  const goesTo = emailed ? emailed.to : emailOk ? to.trim() : '';

  return (
    <div style={{ animation: 'fade .3s ease both', display: 'flex', flexDirection: 'column', gap: 20 }}>
      <PageActions>
        <button type="button" id="ob-save-draft" disabled={!!busy || !!emailed} onClick={() => void saveDraft()} className={btnClass()} style={btn()}>{busy === 'draft' ? 'Saving…' : 'Save draft'}</button>
        <button type="button" id="ob-email-settlement" disabled={!canSend || !!busy} title={notSetUp ? 'Set up their salary details first' : !emailOk ? 'Add their personal email' : blocked && !reason ? 'Resolve the checks, or say why you are sending anyway' : undefined} onClick={() => void send()} className={btnClass('primary')} style={btn('primary')}>
          <IconMail />{busy === 'email' ? 'Sending…' : notSetUp ? 'Email PDF' : settlement?.status === 'draft' ? 'Approve and email PDF' : emailed ? 'Email the PDF again' : 'Email PDF'}
        </button>
      </PageActions>
      {/* HRSettlement: the lead line sits under the page's title. */}
      <p className="pd-lead" style={{ margin: '-14px 4px 0', maxWidth: '76ch' }}>
        Figures come from payroll and clearance. Check them, then email the statement to {name} as a PDF. It is not shown in the app.
        {emailed ? ` Emailed to ${emailed.to} on ${longDay(istKey(emailed.at))}.` : checks.draft ? ` Draft saved ${longDay(istKey(checks.draft.savedAt))}${checks.draft.byName ? ` by ${checks.draft.byName}` : ''}.` : ''}
      </p>

      <div className="ob-banner" style={{ marginBottom: 0 }}><ClockIcon /><span><b>Due {longDay(checks.dueOn)}</b> · 2 working days after the last day ({longDay(exit.lastWorkingDay)}). Gratuity, when eligible, is due within 30 days.</span></div>

      <div className="ob-settle">
        <div className="ob-settle-l">
          <section className="pd-card ob-sends" aria-label="Before you send">
            <div className="ob-eyebrow"><span>Before you send</span>{blocked && <small>Sending waits for these</small>}</div>
            {rows.map((r) => (
              <div key={r.label} className={`ob-send${r.ok ? '' : ' no'}`}>
                <span className="dot" aria-label={r.ok ? 'Done' : 'Not yet'}>{r.ok ? <IconCheck size={11} stroke="currentColor" /> : '!'}</span>
                <span className="t">{r.label}</span>
                <span className="s">{r.status}</span>
                {r.edit && <button type="button" id="ob-edit-email" className="pd-btn ghost sm" disabled={!!busy} onClick={() => setEditingEmail(true)}>{emailOk ? 'Edit email' : 'Add email'}</button>}
              </div>
            ))}
            {/* Open checks need a reason on every send, a resend too (it was hidden once emailed, leaving Send disabled). */}
            {blocked && (
              <label className="pd-label" style={{ display: 'grid', gap: 6, marginTop: 8 }}>
                <span>Send anyway? Say why (kept with the settlement)</span>
                <input id="ob-send-override" className="pd-inp" value={override} onChange={(e) => setOverride(e.target.value)} placeholder="e.g. November paid off-cycle on 2 Dec" />
              </label>
            )}
          </section>

          <section className="pd-card" aria-label="Statement">
            {!settlement && <div style={noteBox}>{exit.caseOpen ? `${name} stopped coming: the settlement starts once the case is closed (People › ${exit.name} › Exit).` : `The settlement starts the day after ${name}'s last day (${longDay(exit.lastWorkingDay)}).`}</div>}
            {settlement && (
              <SettlementStatement exit={exit} settlement={settlement} busy={busy} run={run} userId={userId} sourceOf={sourceOf}
                addLine={<div style={{ marginTop: 12 }}><button type="button" id="ob-add-line" className="pd-btn sm" disabled={!!busy} onClick={() => setAdding(true)}><IconPlus size={14} stroke="currentColor" /> Add a line</button></div>} />
            )}
          </section>
        </div>

        <section className="pd-card ob-preview" aria-label="PDF preview">
          <div className="ob-preview-h">
            <span>PDF preview{goesTo ? <> · {emailed ? 'emailed to' : 'goes to'} <b>{goesTo}</b></> : ' · not sent'}</span>
            <span className="acts">
              {settlement && previewHtml && (
                <button type="button" id="ob-download-settlement" className="pd-btn sm" onClick={() => void downloadSettlementPdf(exit, settlement, company, footer).catch((e) => s.flash(e instanceof Error ? e.message : 'Could not make the PDF', 'error'))}><IconDownload stroke="currentColor" /> Download</button>
              )}
            </span>
          </div>
          {settlement && previewHtml
            ? <ScaledPage html={previewHtml} />
            : <div style={{ ...noteBox, background: 'var(--surface)' }}>{notSetUp ? 'The preview shows once the salary details are set up and the settlement is worked out.' : 'The preview shows once the settlement has started.'}</div>}
        </section>
      </div>

      {editingEmail && (
        <EmailDialog to={to} subject={subject} message={message} sent={emailed ? `Sent to ${emailed.to} on ${longDay(istKey(emailed.at))}` : ''}
          onClose={() => setEditingEmail(false)}
          onDone={(v) => { setTo(v.to); setSubject(v.subject); setMessage(v.message); setEditingEmail(false); }} />
      )}
      {resendAsk && (
        <ResendDialog ask={resendAsk} busy={busy === 'email'} onClose={() => setResendAsk(null)} onSend={() => void send(true)} />
      )}
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
 * The email that carries the PDF: to their personal email, the subject and the message. HRSettlement
 * has no place for it on the page, so it opens from the personal email check (Edit email).
 * Done keeps it for this send; Save draft keeps it on the settlement.
 */
function EmailDialog({ to, subject, message, sent, onClose, onDone }: { to: string; subject: string; message: string; sent: string; onClose: () => void; onDone: (v: { to: string; subject: string; message: string }) => void }) {
  const [v, setV] = useState({ to, subject, message });
  const ok = EMAIL.test(v.to.trim());
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onClose]);
  return createPortal(
    <div onClick={onClose} className="pd-scrim" style={{ zIndex: 90, background: 'var(--scrim)' }}>
      <div onClick={(e) => e.stopPropagation()} className="pd-modal" role="dialog" aria-label="Email" style={{ width: 'min(520px, 100%)' }}>
        <div className="pd-md-h"><div><h3>Email</h3><div className="pd-md-sub">{sent || 'The PDF goes to their personal email. It is not shown in the app.'}</div></div></div>
        <div className="pd-md-b">
          <div className="ob-form">
            <label className="f">To<input id="ob-email-to" className="pd-inp" type="email" value={v.to} onChange={(e) => setV({ ...v, to: e.target.value })} placeholder="name@example.com" /></label>
            <label className="f">Subject<input id="ob-email-subject" className="pd-inp" value={v.subject} onChange={(e) => setV({ ...v, subject: e.target.value })} /></label>
            <label className="f">Message<textarea id="ob-email-message" className="pd-inp" rows={6} value={v.message} onChange={(e) => setV({ ...v, message: e.target.value })} /></label>
          </div>
        </div>
        <div className="pd-md-f">
          <button type="button" className="pd-btn" onClick={onClose}>Cancel</button>
          <button type="button" id="ob-email-done" className="pd-btn primary" disabled={!ok} onClick={() => onDone({ to: v.to.trim(), subject: v.subject, message: v.message })}>Done</button>
        </div>
      </div>
    </div>,
    document.body,
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

/** The PDF page at its real width, scaled down to fit the card: the whole page shows, nothing is cut off. */
function ScaledPage({ html }: { html: string }) {
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = box.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const PAGE_W = 856; // the statement's 800px page and its padding
  const PAGE_H = 1120;
  const scale = width ? Math.min(1, width / PAGE_W) : 1;
  return (
    <div ref={box} style={{ width: '100%', height: Math.round(PAGE_H * scale), overflow: 'hidden', borderRadius: 'var(--r-sm)', background: '#fff', boxShadow: 'var(--shadow)' }}>
      <iframe title="Settlement PDF preview" sandbox="" srcDoc={html}
        style={{ width: PAGE_W, height: PAGE_H, border: 0, display: 'block', transform: `scale(${scale})`, transformOrigin: '0 0' }} />
    </div>
  );
}

/** "Sent at 3:42 pm. Send again?" — a second email within 10 minutes goes only when HR says so. */
function ResendDialog({ ask, busy, onClose, onSend }: { ask: { at: string | null; to: string; message: string }; busy: boolean; onClose: () => void; onSend: () => void }) {
  const time = ask.at ? new Date(ask.at).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' }) : '';
  return createPortal(
    <div onClick={onClose} className="pd-scrim" style={{ zIndex: 90, background: 'rgba(20, 16, 50, 0.38)' }}>
      <div onClick={(e) => e.stopPropagation()} className="pd-modal" role="dialog" aria-label="Send the settlement again?" style={{ width: 'min(440px, 100%)' }}>
        <div className="pd-md-h"><div><h3>{time ? `Sent at ${time}. Send again?` : 'Send again?'}</h3><div className="pd-md-sub">{time ? `The settlement went to ${ask.to} a few minutes ago. Sending again emails the PDF a second time.` : ask.message}</div></div></div>
        <div className="pd-md-f">
          <button type="button" className={btnClass()} style={btn()} onClick={onClose} disabled={busy}>Don’t send</button>
          <button type="button" id="ob-resend-settlement" className={btnClass('primary')} style={btn('primary')} onClick={onSend} disabled={busy}>{busy ? 'Sending…' : 'Send again'}</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
