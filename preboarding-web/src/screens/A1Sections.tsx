// The offer letter and the joining details (Figma "App · 4 Offer letter", "App · 5 Joining details"),
// each under the section header (back, title). A revised offer still to accept keeps the offer flow (OfferSession).
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { portal, type OfferSource } from '../api/portal';
import type { JoiningDetails, PortalLetter, PortalOfferView } from '../api/types';
import { FigLoading, FigPage, isAppHost } from '../components/fig/FigShell';
import { G3SectionHead, G3WebBottom, G3WebTop } from '../components/fig/G3WebShell';
import { FigChip, FigIntro, FigKv, FigList, FigNote, FigPdf } from '../components/fig/FigUi';
import { FigCalendarPlus, FigCheckSmall, FigChevronRight, FigClock, FigDownload, FigEye, FigPass, FigPin } from '../components/fig/icons';
import { PdfViewer } from '../components/PdfViewer';
import { Sheet } from '../components/ui';
import { fmtTime, fmtWeekday, fmtWeekdayYear, initials } from '../lib/format';
import { downloadBlob, mailto } from '../lib/links';
import { useMe } from '../session';
import { OfferSession } from './Offer';
import { dayMonthYear } from './A1Home';
import '../styles/fig-g1.css';

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
    ['Reporting to', f.managerName],
    ['Joining date', f.tj ? fmtWeekdayYear(f.tj) : undefined], ['Work location', f.location],
    ['Employment type', f.employeeType ? EMPLOYEE_TYPE[f.employeeType] : undefined],
    ['Yearly CTC', typeof f.ctc === 'number' && f.ctc > 0 ? `₹${Math.round(f.ctc).toLocaleString('en-IN')}` : undefined],
    ['Probation', f.probationMonths ? `${f.probationMonths} months` : undefined],
  ] : [];
  const shown = rows.filter((r): r is [string, string] => Boolean(r[1]));
  const toSign = letters.filter((l) => l.state === 'ready' || l.state === 'opened');
  const accepted = view && ['accepted', 'finalised'].includes(view.state);
  const app = isAppHost();
  const fileSub = view ? [
    `Version ${view.version}`,
    view.pdfPages ? `${view.pdfPages} ${view.pdfPages === 1 ? 'page' : 'pages'}` : '',
    view.sentAt ? `sent ${fmtWeekday(view.sentAt)}` : '',
  ].filter(Boolean).join(' · ') : '';

  return (
    <FigPage>
      <G3WebTop />
      <G3SectionHead title="Offer letter" />
      <main id="main" className="fig-main">
        {!view && !error ? <FigLoading /> : (
          <div className="fig-body-col">
            <FigIntro icon="document-approved">
              {accepted
                ? 'This is the offer letter HR sent you. You accepted it by replying to the email, so there is nothing to sign here.'
                : 'This is the offer letter HR sent you.'}
            </FigIntro>
            {error && <p className="fig-field__error" role="alert">{error}</p>}
            {view && (
              <>
                <div className="fig-card fig-offer-card">
                  {app ? (
                    <div className="fig-offer-card__top">
                      {accepted
                        ? <FigChip tone="success">Accepted</FigChip>
                        : <FigChip tone="neutral">{view.state === 'replaced' ? 'Replaced by a new version' : 'Sent'}</FigChip>}
                      {view.acceptedAt && <span className="fig-label fig-t3">{fmtWeekday(view.acceptedAt)}</span>}
                    </div>
                  ) : (
                    // Web · 5: a canvas chip with a tick, and "You replied yes on …" beside it.
                    <div className="fig-offer-card__top fig-offer-card__top--web">
                      {accepted
                        ? <span className="fig-chip g1-chip-web"><FigCheckSmall />Accepted</span>
                        : <span className="fig-chip g1-chip-web g1-chip-web--grey">{view.state === 'replaced' ? 'Replaced by a new version' : 'Sent'}</span>}
                      {view.acceptedAt && <span className="fig-label fig-t3">You replied yes on {fmtWeekday(view.acceptedAt)}</span>}
                    </div>
                  )}
                  <div className="fig-offer-card__file">
                    <FigPdf />
                    <span className="fig-row__text">
                      <span className="fig-body-strong">Offer letter · {view.candidateName}</span>
                      <span className="fig-label fig-t3">{fileSub}</span>
                    </span>
                  </div>
                  <div className="fig-offer-card__btns">
                    <button type="button" className="fig-btn fig-btn--outline" onClick={() => setPdf(true)}><FigEye />View letter</button>
                    <button type="button" className="fig-btn fig-btn--outline" onClick={() => void download()} disabled={busy}><FigDownload />{busy ? 'Downloading…' : 'Download'}</button>
                  </div>
                </div>

                {toSign.length > 0 && (
                  <Link to="/letters" className="fig-home-notice" style={{ margin: 0 }}>
                    <span>{toSign.length === 1 ? `${toSign[0].title ?? 'A letter'} to sign` : `${toSign.length} letters to sign`}</span>
                    <FigChevronRight />
                  </Link>
                )}

                {shown.length > 0 && <h2 className="fig-subtitle">Your offer at a glance</h2>}
                {shown.length > 0 && <FigList as="dl">{shown.map(([k, v]) => <FigKv key={k} label={k} value={v} />)}</FigList>}
                <FigNote>
                  Something doesn’t look right? Reply to the offer email or write to{' '}
                  <a href={mailto(me.hrContact.email, 'About my offer letter')}>{me.hrContact.email}</a>, and HR will send you a revised letter.
                </FigNote>
              </>
            )}
          </div>
        )}
      </main>
      <G3WebBottom />
      <Sheet open={pdf} onClose={() => setPdf(false)} title="Your offer letter" wide>
        <PdfViewer load={load} fileName="Offer letter.pdf" toolbar label="Your offer letter" className="pdf--sheet" />
      </Sheet>
    </FigPage>
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
  const when = days === undefined ? '' : days > 1 ? `In ${days} days` : days === 1 ? 'Tomorrow' : days === 0 ? 'Today' : 'Started';
  return (
    <FigPage>
      <G3WebTop />
      <G3SectionHead title="Joining details" />
      <main id="main" className="fig-main">
        {!j && !error ? <FigLoading /> : (
          <div className="fig-body-col">
            <FigIntro icon="calendar">Everything you need for your first day. HR will email you if anything changes.</FigIntro>
            {error && <p className="fig-field__error" role="alert">{error}</p>}
            {j && (
              <>
                <div className="fig-firstday">
                  <div className="fig-firstday__text">
                    <span className="fig-caption-strong fig-brand">YOUR FIRST DAY</span>
                    <span className="fig-display">{j.date ? fmtWeekdayYear(j.date) : 'To be confirmed'}</span>
                    {j.date && <span className="fig-body fig-t2">{[when, time ? `please arrive by ${time}` : ''].filter(Boolean).join(' · ')}</span>}
                  </div>
                  {j.date && <button type="button" className="fig-btn fig-btn--outline fig-btn--inline" onClick={() => void addToCalendar()}><FigCalendarPlus />Add to calendar</button>}
                </div>

                <div className="fig-list">
                  <div className="fig-detail fig-detail--top">
                    <span className="fig-lead"><FigClock /></span>
                    <span className="fig-detail__text"><span className="fig-label fig-t3">Reporting time</span><span className="fig-body-strong">{time ?? 'HR will share it soon'}</span></span>
                  </div>
                  <div className="fig-detail">
                    <span className="fig-lead"><FigPin /></span>
                    <span className="fig-detail__text">
                      <span className="fig-label fig-t3">Reporting place</span>
                      <span className="fig-body-strong">{j.place ?? (j.meetingLink ? 'Online' : 'HR will share it soon')}</span>
                      {directions && <a className="fig-link" href={directions} target="_blank" rel="noreferrer">Get directions</a>}
                      {!j.place && j.meetingLink && <a className="fig-link" href={j.meetingLink} target="_blank" rel="noreferrer">Meeting link</a>}
                    </span>
                  </div>
                  {j.manager && (
                    <div className="fig-detail fig-detail--top">
                      <span className="fig-lead fig-lead--initials">{initials(j.manager.name)}</span>
                      <span className="fig-detail__text"><span className="fig-label fig-t3">Report to</span><span className="fig-body-strong">{j.manager.name}{j.manager.designation ? `, ${j.manager.designation}` : ''}</span></span>
                    </div>
                  )}
                  {j.buddy && (
                    <div className="fig-detail fig-detail--top">
                      <span className="fig-lead fig-lead--initials">{initials(j.buddy.name)}</span>
                      <span className="fig-detail__text"><span className="fig-label fig-t3">Your buddy</span><span className="fig-body-strong">{j.buddy.name}{j.buddy.designation ? `, ${j.buddy.designation}` : ''}</span></span>
                    </div>
                  )}
                  <div className="fig-detail">
                    <span className="fig-lead"><FigPass /></span>
                    <span className="fig-detail__text">
                      <span className="fig-label fig-t3">Day-1 pass</span>
                      {j.passOpen
                        ? <Link to="/pass" className="fig-body-strong fig-brand" style={{ textDecoration: 'none' }}>Open your Day-1 pass</Link>
                        : <span className="fig-body-strong">{j.passOpensOn ? `Arrives on ${fmtWeekday(j.passOpensOn)}, a week before you join` : 'Arrives a week before you join'}</span>}
                    </span>
                  </div>
                </div>

                {j.bring.length > 0 && <h2 className="fig-subtitle">What to bring</h2>}
                {j.bring.length > 0 && (
                  <ul className="fig-list">
                    {j.bring.map((b) => <li key={b} className="fig-bring"><span className="fig-bullet" />{b}</li>)}
                  </ul>
                )}
                {j.pendingDateRequest
                  ? <p className="fig-small-line" role="status">You asked to join on {fmtWeekday(j.pendingDateRequest.requestedTj)}. HR will reply soon.</p>
                  : j.date && <p className="fig-small-line"><span>Can’t make it on {dayMonthYear(j.date).replace(/ \d{4}$/, '')}?</span><Link to="/date-request" className="fig-link">Ask HR for another date</Link></p>}
                {me.batch.count > 0 && <p className="fig-small-line">{me.batch.count === 1 ? '1 person joins with you' : `${me.batch.count} people join with you`}.</p>}
              </>
            )}
          </div>
        )}
      </main>
      <G3WebBottom />
    </FigPage>
  );
}
