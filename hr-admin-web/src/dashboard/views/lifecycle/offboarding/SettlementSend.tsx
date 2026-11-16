// Final settlement · emailed as a PDF (O3). The figures are the live exit's settlement (payroll,
// leave, gratuity, notice, clearance): check them, change a line with a reason, approve, then email
// the statement to the personal email as a PDF made here (settlementDoc.ts). It is never shown in
// the app. Before sending: the last month's payroll run, clearance n of 4, the salary status, and a
// personal email to send it to.
import { useEffect, useState } from 'react';
import { Avatar, Card, LoadError, PageActions, Pill, SkeletonForm } from '../../../ui';
import { btn, btnClass, note as noteBox } from '../../../ds';
import { IconDownload } from '../../../icons';
import { useStore } from '../../../store';
import { getExitDetail, settlementAction } from '../../../../services/hrms';
import type { ExitDetailDTO } from '../../../../services/hrms';
import { emailSettlementPdf, getOffboardingDetail, getSettlementChecks } from '../../../../services/lifecycleOffboarding';
import type { DrawerDTO, SettlementChecksDTO } from '../../../../services/lifecycleOffboarding';
import { downloadSettlementPdf, settlementHtml } from '../../../settlementDoc';
import { htmlToPdfBase64 } from '../../../pdf';
import { Statement } from '../../ExitDetail';
import { IconCheck } from '../../../icons';
import { ClockIcon, firstName, istKey, longDay } from './parts';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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

  useEffect(() => {
    let live = true;
    setError('');
    Promise.all([getExitDetail(userId), getSettlementChecks(userId), getOffboardingDetail(userId)])
      .then(([d, c, o]) => {
        if (!live) return;
        setData(d); setChecks(c); setDrawer(o);
        setTo((t) => t || c.personalEmail.value);
        const first = firstName(d.exit.name);
        setSubject((x) => x || `Your full and final settlement · ${d.company.name}`);
        setMessage((x) => x || `Dear ${first},\n\nYour full and final settlement statement is attached.\n\nFor any question, reply to this email or write to HR.\n\n${d.company.name}`);
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

  const top = <div className="pd-prof-top"><button type="button" onClick={onBack} className="pd-btn ghost sm" style={{ marginLeft: -12 }}>← Back to offboarding</button></div>;
  if (error) return <div>{top}<section className="pd-card"><LoadError text={error} onRetry={() => setAttempt((n) => n + 1)} /></section></div>;
  if (!data || !checks) return <div>{top}<section className="pd-card"><SkeletonForm fields={8} /></section></div>;

  const { exit, settlement, company } = data;
  const name = firstName(exit.name);
  const emailed = drawer?.settlement?.emailedAt ? { to: drawer.settlement.emailedTo, at: drawer.settlement.emailedAt } : null;
  const canSend = !!settlement && EMAIL.test(to.trim()) && (settlement.status !== 'draft' || exit.clearanceDone);

  const send = async () => {
    if (!settlement) return;
    setBusy('email');
    try {
      let detail = data;
      // "Approve and email": a draft with the clearance done is approved first.
      if (settlement.status === 'draft') detail = await settlementAction(userId, 'approve');
      const filename = `Settlement_${detail.exit.employeeId || detail.exit.name.replace(/\s+/g, '_')}.pdf`;
      const pdfBase64 = await htmlToPdfBase64(settlementHtml(detail.exit, detail.settlement!, detail.company), filename);
      const out = await emailSettlementPdf(userId, { pdfBase64, to: to.trim(), subject: subject.trim(), message: message.trim() });
      setDrawer(out);
      setData(detail);
      s.flash(`The settlement PDF is emailed to ${to.trim()}`);
    } catch (e) {
      s.flash(e instanceof Error ? e.message : 'Could not send', 'error');
    } finally {
      setBusy('');
    }
  };

  const rows: { label: string; ok: boolean; status: string }[] = [
    { label: 'Attendance and payroll for the last month', ok: checks.attendance.ok, status: checks.attendance.label },
    { label: 'Clearance: IT, Admin, Finance, handover', ok: checks.clearance.ok, status: `${checks.clearance.done} of ${checks.clearance.total} done` },
    { label: 'Salary status from payroll', ok: checks.salary.ok, status: checks.salary.label },
    { label: 'Personal email for the PDF', ok: EMAIL.test(to.trim()), status: to.trim() || 'Not on their profile: add it below' },
  ];

  return (
    <div style={{ animation: 'fade .3s ease both' }}>
      <PageActions>
        {settlement && <button type="button" onClick={() => void downloadSettlementPdf(exit, settlement, company).catch((e) => s.flash(e instanceof Error ? e.message : 'Could not make the PDF', 'error'))} className={btnClass()} style={btn()}><IconDownload stroke="currentColor" /> Download</button>}
        <button type="button" id="ob-email-settlement" disabled={!canSend || !!busy} onClick={() => void send()} className={btnClass('primary')} style={btn('primary')}>
          {busy === 'email' ? 'Sending…' : settlement?.status === 'draft' ? 'Approve and email PDF' : emailed ? 'Email the PDF again' : 'Email PDF'}
        </button>
      </PageActions>
      {top}
      <section className="pd-card pd-phead">
        <div className="ph-id">
          <Avatar name={exit.name} size={52} font={21} />
          <div style={{ minWidth: 0, flex: 1 }}>
            <div className="pn"><h1>Final settlement · {exit.name}</h1>{emailed && <Pill label={`Emailed ${longDay(istKey(emailed.at))}`} tone={{ bg: 'var(--ok-bg)', fg: 'var(--ok)' }} />}</div>
            <span className="sub">Figures come from payroll and clearance. Check them, then email the statement to {name} as a PDF. It is not shown in the app.</span>
          </div>
        </div>
      </section>

      <div className="ob-banner"><ClockIcon /><span><b>Due {longDay(checks.dueOn)}</b> · 2 working days after the last day ({longDay(exit.lastWorkingDay)}). Gratuity, when eligible, is due within 30 days.</span></div>

      <div className="ob-two" style={{ marginBottom: 20 }}>
        <Card padded>
          <div className="pd-card-h"><h3>Before you send</h3></div>
          {rows.map((r) => (
            <div key={r.label} className="ob-check">
              <span aria-label={r.ok ? 'Done' : 'Not yet'} style={{ width: 16, display: 'inline-flex' }}>{r.ok ? <IconCheck /> : <span style={{ color: 'var(--warn)' }}>!</span>}</span>
              <span>{r.label}</span>
              <span className="s" style={{ color: r.ok ? undefined : 'var(--warn)' }}>{r.status}</span>
            </div>
          ))}
        </Card>
        <Card padded>
          <div className="pd-card-h"><h3>Email</h3><small>{emailed ? `Sent to ${emailed.to} on ${longDay(istKey(emailed.at))}` : 'To their personal email'}</small></div>
          <div className="ob-form">
            <label className="f">To<input className="pd-inp" type="email" value={to} onChange={(e) => setTo(e.target.value)} placeholder="name@example.com" /></label>
            <label className="f">Subject<input className="pd-inp" value={subject} onChange={(e) => setSubject(e.target.value)} /></label>
            <label className="f">Message<textarea className="pd-inp" rows={5} value={message} onChange={(e) => setMessage(e.target.value)} /></label>
            {settlement?.status === 'draft' && !exit.clearanceDone && <div className="hint" style={{ color: 'var(--warn)' }}>Clearance is open: approve the statement below with a reason first.</div>}
          </div>
        </Card>
      </div>

      <section className="pd-card">
        <div className="pd-card-h"><h3>Statement</h3></div>
        {!settlement && <div style={noteBox}>{exit.caseOpen ? `${name} stopped coming: the settlement starts once the case is closed (People › ${exit.name} › Exit).` : `The settlement starts the day after ${name}'s last day (${longDay(exit.lastWorkingDay)}).`}</div>}
        {settlement && <Statement exit={exit} settlement={settlement} busy={busy} run={run} userId={userId} />}
      </section>
    </div>
  );
}
