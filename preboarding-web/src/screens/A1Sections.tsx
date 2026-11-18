// A1 sections (18 Nov design, "Section content used by every screen"): the offer
// letter and the joining details, each under the section header (Back, title).
// A revised offer still to accept keeps the offer flow (OfferSession).
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { portal, type OfferSource } from '../api/portal';
import type { JoiningDetails, PortalLetter, PortalOfferView } from '../api/types';
import { A1Icon, A1Loading, Breadcrumb } from '../components/A1';
import { WebPage } from './A1Shell';
import { PdfViewer } from '../components/PdfViewer';
import { Sheet } from '../components/ui';
import { fmtTime, fmtWeekday, fmtWeekdayYear, initials } from '../lib/format';
import { downloadBlob, mailto } from '../lib/links';
import { useMe } from '../session';
import { OfferSession } from './Offer';

const EMPLOYEE_TYPE: Record<string, string> = { full_time: 'Full-time', intern: 'Internship', contract: 'Contract' };

/** /offer · the offer HR sent, as it was accepted: the PDF, the offer at a glance, and any letters to sign. */
export function A1Offer() {
  const { me } = useMe();
  const src = useMemo<OfferSource>(() => ({ kind: 'session' }), []);
  const [view, setView] = useState<PortalOfferView>();
  const [letters, setLetters] = useState<PortalLetter[]>([]);
  const [error, setError] = useState('');
  const [pdf, setPdf] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    portal.offer(src).then(setView, (e: Error) => setError(e.message));
    portal.letters().then((r) => setLetters(r.letters), () => undefined);
  }, [src]);
  const load = useCallback(() => portal.offerPdf(src), [src]);

  // A revised offer waiting for their yes: the offer flow (review, accept).
  if (view && view.state === 'offer') return <OfferSession />;

  const download = async () => {
    setBusy(true);
    try { downloadBlob(await portal.offerPdf(src), 'application/pdf', `Offer letter · ${view?.candidateName ?? 'you'}.pdf`); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  const f = view?.fields;
  const rows: Array<[string, string | undefined]> = f ? [
    ['Role', f.designation], ['Team', f.department],
    ['Reporting to', f.managerName ? `${f.managerName}${f.managerDesignation ? `, ${f.managerDesignation}` : ''}` : undefined],
    ['Joining date', f.tj ? fmtWeekdayYear(f.tj) : undefined], ['Work location', f.location],
    ['Employment type', f.employeeType ? EMPLOYEE_TYPE[f.employeeType] : undefined],
    ['Yearly CTC', typeof f.ctc === 'number' && f.ctc > 0 ? `₹${Math.round(f.ctc).toLocaleString('en-IN')}` : undefined],
    ['Probation', f.probationMonths ? `${f.probationMonths} months` : undefined],
  ] : [];
  const shown = rows.filter((r): r is [string, string] => Boolean(r[1]));
  const toSign = letters.filter((l) => l.state === 'ready' || l.state === 'opened');
  const accepted = view && ['accepted', 'finalised'].includes(view.state);

  return (
    <WebPage>
      <Breadcrumb title="Offer letter" />
      {!view && !error ? <A1Loading /> : (
        <div className="a1-body">
          <p className="a1-intro">This is the offer letter HR sent you{accepted ? '. You’ve accepted it, so there is nothing more to do here.' : '.'}</p>
          {error && <p className="a1-error" role="alert">{error}</p>}
          {view && (
            <>
              <div className="a1-card">
                <div className="a1-row" style={{ gap: 8, flexWrap: 'wrap' }}>
                  {accepted
                    ? <span className="a1-chip a1-chip--green"><A1Icon name="check" size={14} width={2.4} />Accepted</span>
                    : <span className="a1-chip a1-chip--grey">{view.state === 'replaced' ? 'Replaced by a new version' : 'Sent'}</span>}
                  {view.acceptedAt && <span className="a1-small">You accepted on {fmtWeekday(view.acceptedAt)}</span>}
                </div>
                <div className="a1-row">
                  <span className="a1-pdf">PDF</span>
                  <span className="a1-stack">
                    <span className="a1-strong">Offer letter · {view.candidateName}</span>
                    <span className="a1-small">{['Version ' + view.version, view.pdfPages ? `${view.pdfPages} ${view.pdfPages === 1 ? 'page' : 'pages'}` : ''].filter(Boolean).join(' · ')}</span>
                  </span>
                </div>
                <div className="a1-btns">
                  <button type="button" className="a1-btn" onClick={() => setPdf(true)}><A1Icon name="eye" size={18} />View letter</button>
                  <button type="button" className="a1-btn" onClick={() => void download()} disabled={busy}><A1Icon name="download" size={18} />{busy ? 'Downloading…' : 'Download'}</button>
                </div>
              </div>

              {toSign.length > 0 && (
                <Link to="/letters" className="a1-card" style={{ textDecoration: 'none', color: 'inherit', background: 'var(--a1-brand-tint)', borderColor: 'transparent' }}>
                  <span className="a1-row">
                    <span className="a1-stack"><span className="a1-strong">{toSign.length === 1 ? `${toSign[0].title ?? 'A letter'} to sign` : `${toSign.length} letters to sign`}</span><span className="a1-small">Read and sign before you join</span></span>
                    <A1Icon name="chevron" size={20} />
                  </span>
                </Link>
              )}

              {shown.length > 0 && <span className="a1-h2">Your offer at a glance</span>}
              {shown.length > 0 && (
                <dl className="a1-list" style={{ margin: 0 }}>
                  {shown.map(([k, v]) => <div key={k} className="a1-kv"><dt>{k}</dt><dd>{v}</dd></div>)}
                </dl>
              )}
              <div className="a1-info"><A1Icon name="info" size={16} /><span>Something doesn’t look right? Write to <a className="a1-link" style={{ fontSize: 12 }} href={mailto(me.hrContact.email, 'About my offer letter')}>{me.hrContact.email}</a> and HR will send you a revised letter.</span></div>
            </>
          )}
        </div>
      )}
      <Sheet open={pdf} onClose={() => setPdf(false)} title="Your offer letter" wide>
        <PdfViewer load={load} fileName="Offer letter.pdf" toolbar label="Your offer letter" className="pdf--sheet" />
      </Sheet>
    </WebPage>
  );
}

/** /joining · the first day: date, time and place, who to report to, the Day-1 pass, what to bring. */
export function A1Joining() {
  const { me } = useMe();
  const [j, setJ] = useState<JoiningDetails>();
  const [error, setError] = useState('');
  useEffect(() => { portal.joining().then(setJ, (e: Error) => setError(e.message)); }, []);
  const time = fmtTime(j?.reportingTime);
  const days = j?.daysToGo;
  const directions = j?.mapLink ?? (j?.place ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(j.place)}` : undefined);
  const addToCalendar = async () => {
    try { downloadBlob(await portal.joiningIcs(), 'text/calendar', 'day-1.ics'); } catch (e) { setError((e as Error).message); }
  };
  return (
    <WebPage>
      <Breadcrumb title="Joining details" />
      {!j && !error ? <A1Loading /> : (
        <div className="a1-body">
          <p className="a1-intro">Everything you need for your first day. HR will email you if anything changes.</p>
          {error && <p className="a1-error" role="alert">{error}</p>}
          {j && (
            <>
              <div className="a1-first">
                <span className="a1-first__eyebrow">YOUR FIRST DAY</span>
                <span className="a1-first__day">{j.date ? fmtWeekdayYear(j.date) : 'To be confirmed'}</span>
                {j.date && <span className="a1-intro">{days === undefined ? '' : days > 1 ? `In ${days} days` : days === 1 ? 'Tomorrow' : days === 0 ? 'Today' : 'Started'}{time ? ` · please arrive by ${time}` : ''}</span>}
                {j.date && <button type="button" className="a1-btn a1-btn--inline" style={{ marginTop: 8 }} onClick={() => void addToCalendar()}><A1Icon name="calendar" size={18} />Add to calendar</button>}
              </div>

              <div className="a1-list">
                <div className="a1-detail"><span className="a1-detail__icon"><A1Icon name="clock" /></span><span className="a1-stack"><span className="a1-small">Reporting time</span><span className="a1-strong">{time ?? 'HR will share it soon'}</span></span></div>
                <div className="a1-detail">
                  <span className="a1-detail__icon"><A1Icon name="pin" /></span>
                  <span className="a1-stack">
                    <span className="a1-small">Reporting place</span>
                    <span className="a1-strong">{j.place ?? (j.meetingLink ? 'Online' : 'HR will share it soon')}</span>
                    {directions && <a className="a1-link" style={{ fontSize: 12, paddingTop: 2 }} href={directions} target="_blank" rel="noreferrer">Get directions</a>}
                    {!j.place && j.meetingLink && <a className="a1-link" style={{ fontSize: 12, paddingTop: 2 }} href={j.meetingLink} target="_blank" rel="noreferrer">Meeting link</a>}
                  </span>
                </div>
                {j.manager && (
                  <div className="a1-detail"><span className="a1-detail__icon a1-detail__icon--brand">{initials(j.manager.name)}</span><span className="a1-stack"><span className="a1-small">Report to</span><span className="a1-strong">{j.manager.name}{j.manager.designation ? `, ${j.manager.designation}` : ''}</span></span></div>
                )}
                {j.buddy && (
                  <div className="a1-detail"><span className="a1-detail__icon a1-detail__icon--brand">{initials(j.buddy.name)}</span><span className="a1-stack"><span className="a1-small">Your buddy</span><span className="a1-strong">{j.buddy.name}{j.buddy.designation ? `, ${j.buddy.designation}` : ''}</span></span></div>
                )}
                <div className="a1-detail">
                  <span className="a1-detail__icon"><A1Icon name="badge" /></span>
                  <span className="a1-stack">
                    <span className="a1-small">Day-1 pass</span>
                    {j.passOpen
                      ? <Link to="/pass" className="a1-strong" style={{ color: 'var(--a1-brand)', textDecoration: 'none' }}>Open your Day-1 pass</Link>
                      : <span className="a1-strong">{j.passOpensOn ? `Arrives on ${fmtWeekday(j.passOpensOn)}, a week before you join` : 'Arrives a week before you join'}</span>}
                  </span>
                </div>
              </div>

              {j.bring.length > 0 && <span className="a1-h2">What to bring</span>}
              {j.bring.length > 0 && (
                <ul className="a1-list">
                  {j.bring.map((b) => <li key={b} className="a1-row" style={{ padding: 12, fontSize: 14, lineHeight: '20px' }}><span className="a1-dot" />{b}</li>)}
                </ul>
              )}
              {j.pendingDateRequest
                ? <p className="a1-small" role="status">You asked to join on {fmtWeekday(j.pendingDateRequest.requestedTj)}. HR will reply soon.</p>
                : j.date && <p className="a1-small">Can’t make it on {fmtWeekday(j.date)}? <Link to="/date-request" className="a1-link" style={{ fontSize: 12 }}>Ask HR for another date</Link></p>}
              {me.batch.count > 0 && <p className="a1-small">{me.batch.count === 1 ? '1 person joins with you' : `${me.batch.count} people join with you`}.</p>}
            </>
          )}
        </div>
      )}
    </WebPage>
  );
}

