import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { portal, type OfferSource } from '../api/portal';
import { ApiError, getSession, mediaUrl } from '../api/client';
import type { PortalOfferView } from '../api/types';
import { Page, rememberClient } from '../components/Shell';
import { Icon } from '../components/Icon';
import { PdfViewer, type PdfReady } from '../components/PdfViewer';
import { AskHrRow, BackLink, BottomBar, ErrorNote, Eyebrow, PrimaryButton, Sheet, Spinner, Steps } from '../components/ui';
import { countChanges, describeChanges, firstName, fmtShort, fmtWeekday } from '../lib/format';
import { useFocusHeading, useReducedMotion, useWide } from '../lib/hooks';
import { offerSubject } from '../lib/links';
import { ClosedScreen } from './Closed';

/** /o/:token and /o/:token/letter — the offer link from HR's email (no login). */
export function OfferLink({ letter }: { letter?: boolean }) {
  const { token = '' } = useParams();
  const src = useMemo<OfferSource>(() => ({ kind: 'link', token }), [token]);
  return <OfferFlow src={src} letter={!!letter} base={`/o/${encodeURIComponent(token)}`} />;
}

/** /offer — the signed-in candidate reviewing a revised offer (P7b → P3 v2). */
export function OfferSession() {
  const src = useMemo<OfferSource>(() => ({ kind: 'session' }), []);
  return <OfferFlow src={src} letter base="/" />;
}

function OfferFlow({ src, letter, base }: { src: OfferSource; letter: boolean; base: string }) {
  const [view, setView] = useState<PortalOfferView>();
  const [error, setError] = useState<Error>();
  const load = useCallback(() => {
    setError(undefined);
    portal.offer(src).then((v) => {
      rememberClient(v.company, v.hrContact);
      setView(v);
    }, setError);
  }, [src]);
  useEffect(load, [load]);

  // Accepted, waiting for HR (P4 / W4): notice HR's finalise without a reload. A quiet
  // check every 30 s while the tab is visible, and when the candidate comes back to it
  // (at most every 10 s: the offer link is rate-limited per IP, 60 calls in 15 minutes).
  const waiting = view?.state === 'accepted';
  useEffect(() => {
    if (!waiting) return;
    let live = true;
    let last = Date.now();
    const check = () => {
      if (document.visibilityState !== 'visible' || Date.now() - last < 10_000) return;
      last = Date.now();
      portal.offer(src).then(
        (v) => live && v.state !== 'accepted' && setView(v),
        () => undefined,
      );
    };
    const timer = window.setInterval(check, 30_000);
    const onVisible = () => document.visibilityState === 'visible' && check();
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', check);
    return () => {
      live = false;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', check);
    };
  }, [waiting, src]);

  if (error)
    return (
      <Page header={{}} layout="narrow">
        {error instanceof ApiError && error.status === 404 && /another company/i.test(error.message) ? (
          <section className="closed">
            <Eyebrow>Wrong address</Eyebrow>
            <h1 className="display">This link is for another company</h1>
            <p className="body sub">{error.message}</p>
          </section>
        ) : error instanceof ApiError && error.status === 404 ? (
          <section className="closed">
            <Eyebrow>Link not found</Eyebrow>
            <h1 className="display">This link doesn’t work</h1>
            <p className="body sub">It may be mistyped or out of date. Open the latest email from HR and try its link again.</p>
          </section>
        ) : (
          <ErrorNote error={error} onRetry={load} />
        )}
      </Page>
    );
  if (!view)
    return (
      <Page header={{}} layout="narrow">
        <Spinner />
      </Page>
    );

  switch (view.state) {
    case 'offer':
      return letter ? <OfferLetter view={view} src={src} onAccepted={setView} back={src.kind === 'link' ? base : '/'} /> : <Congratulations view={view} next={`${base}/letter`} />;
    case 'accepted':
    case 'finalised':
      return <Accepted view={view} src={src} signedIn={src.kind === 'session'} />;
    case 'declined':
    case 'expired':
    case 'replaced':
    case 'not_joining':
      return <ClosedScreen state={view.state} company={view.company} hr={view.hrContact} validTill={view.validTill} />;
    case 'closed':
    default:
      return <ClosedScreen state="moved_to_app" company={view.company} hr={view.hrContact} />;
  }
}

// ── P2 / W2 · Congratulations ─────────────────────────────────────────────

function Confetti() {
  const reduce = useReducedMotion();
  const pieces = useMemo(() => {
    const colours = ['#FFFFFF', '#BEEDFF', '#30D158', '#FFC93C', '#F28CA8', '#7FD3FF'];
    return Array.from({ length: 44 }, (_, i) => ({
      left: (i * 37) % 100,
      delay: ((i * 53) % 100) / 100,
      dur: 2.4 + ((i * 17) % 10) / 10,
      rot: (i * 47) % 360,
      colour: colours[i % colours.length],
      w: 6 + (i % 3) * 2,
    }));
  }, []);
  if (reduce) return null;
  return (
    <div className="confetti" aria-hidden="true">
      {pieces.map((p, i) => (
        <span
          key={i}
          style={{
            left: `${p.left}%`,
            background: p.colour,
            width: p.w,
            height: p.w * 1.6,
            animationDelay: `${p.delay}s`,
            animationDuration: `${p.dur}s`,
            transform: `rotate(${p.rot}deg)`,
          }}
        />
      ))}
    </div>
  );
}

function Congratulations({ view, next }: { view: PortalOfferView; next: string }) {
  const wide = useWide();
  const h1 = useFocusHeading<HTMLHeadingElement>('congrats');
  const first = firstName(view.candidateName);
  if (wide)
    return (
      <Page header={{ company: view.company, hr: view.hrContact }} layout="wide">
        <section className="web-hero rise">
          <Confetti />
          <div className="web-hero__text">
            <Eyebrow>Your offer from {view.company.name}</Eyebrow>
            <h1 className="display-xl" ref={h1} tabIndex={-1}>
              Congratulations, {first}!
            </h1>
            <p className="h1">Welcome to {view.company.name}</p>
            <p className="body">We’re so happy to have you.</p>
            <Link to={next} className="link-card">
              <span>
                <span className="body-strong">View your offer letter</span>
                <span className="label">Read it, then accept when you’re ready</span>
              </span>
              <span className="round-btn" aria-hidden="true">
                <Icon name="arrow" />
              </span>
            </Link>
          </div>
          <div className="web-hero__art" aria-hidden="true">
            <div className="letter-art">
              <span className="letter-art__line" />
              <span className="letter-art__line" />
              <span className="letter-art__line short" />
              <span className="letter-art__stamp">
                <Icon name="check" size={38} />
              </span>
            </div>
          </div>
        </section>
      </Page>
    );
  return (
    <Page header={{ company: view.company, tone: 'dark' }} layout="narrow" bg="brand" tone="dark">
      <Confetti />
      <section className="congrats rise">
        <Eyebrow className="eyebrow--light">Congratulations, {first}!</Eyebrow>
        <h1 className="display-xl" ref={h1} tabIndex={-1}>
          Welcome
          <br />
          to {view.company.name}.
        </h1>
        <p className="body">We’re so happy to have you.</p>
      </section>
      <BottomBar className="bottom-bar--clear">
        <Link to={next} className="link-card link-card--on-brand">
          <span className="body-strong">View your offer letter</span>
          <span className="round-btn" aria-hidden="true">
            <Icon name="arrow" />
          </span>
        </Link>
      </BottomBar>
    </Page>
  );
}

// ── P3 / W3 · Offer letter (PDF + agree) ──────────────────────────────────

function OfferBanner({ view }: { view: PortalOfferView }) {
  if (view.version < 2) return null;
  const n = countChanges(view.changedFields);
  const what = describeChanges(view.changedFields);
  return (
    <div className="banner banner--orange" role="note">
      <p className="eyebrow">
        Updated offer · {n} {n === 1 ? 'change' : 'changes'}
      </p>
      {/* The PDF HR uploads does not mark the changed fields, so the banner names them instead of promising orange marks. */}
      <p className="body">
        {what ? `${what} changed. ` : ''}Reply by {fmtShort(view.validTill)}.
      </p>
    </div>
  );
}

function OfferLetter({ view, src, onAccepted, back }: { view: PortalOfferView; src: OfferSource; onAccepted: (v: PortalOfferView) => void; back: string }) {
  const wide = useWide();
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string>();
  const [pdf, setPdf] = useState<PdfReady>();
  const [zoom, setZoom] = useState(false);
  const h1 = useFocusHeading<HTMLHeadingElement>('letter');
  const v2 = view.version > 1;
  const subject = offerSubject(view.company.name);
  const fileName = v2 ? `Offer letter · version ${view.version}.pdf` : 'Offer letter.pdf';
  const load = useCallback(() => portal.offerPdf(src), [src]);

  // One accept per press sequence: the ref holds from the first press, before React re-renders the
  // button as disabled, so quick double presses never send a second request.
  const accepting = useRef(false);
  const accept = async () => {
    if (accepting.current) return;
    accepting.current = true;
    setBusy(true);
    setErr(undefined);
    try {
      const next = await portal.acceptOffer(src);
      onAccepted(next);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      accepting.current = false;
      setBusy(false);
    }
  };

  const agree = (
    <label className="agree">
      <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} required />
      <span className="agree__box" aria-hidden="true">
        <Icon name="check" size={16} />
      </span>
      <span className="body">I have read my offer letter and agree to its terms</span>
    </label>
  );
  const acceptBtn = (
    <PrimaryButton onClick={accept} disabled={!agreed || busy} aria-busy={busy || undefined} aria-describedby={err ? 'accept-err' : undefined}>
      {busy && <span className="spinner spinner--inline" aria-hidden="true" />}
      {busy ? 'Accepting…' : v2 ? 'Accept updated offer' : 'Accept offer'}
    </PrimaryButton>
  );
  const errNote = err && (
    <p id="accept-err" className="field__error" role="alert">
      {err}
    </p>
  );

  if (wide)
    return (
      <Page header={{ company: view.company, hr: view.hrContact }} layout="wide">
        <OfferBanner view={view} />
        <BackLink to={back}>Back</BackLink>
        <h1 className="display" ref={h1} tabIndex={-1}>
          Your offer letter
        </h1>
        <div className="two-col">
          <PdfViewer load={load} fileName={fileName} toolbar label="Your offer letter" />
          <aside className="side-panel card">
            <h2 className="h1">Ready to say yes?</h2>
            <p className="body">Read the full letter first. Accepting tells HR you agree to these terms.</p>
            {agree}
            {errNote}
            {acceptBtn}
            <AskHrRow email={view.hrContact.email} subject={subject} />
          </aside>
        </div>
      </Page>
    );

  const pagesLine = pdf?.pages ? `${pdf.pages} ${pdf.pages === 1 ? 'page' : 'pages'} · PDF` : 'PDF';
  return (
    <Page header={{ company: view.company, hr: view.hrContact, back }} layout="narrow" bg="white">
      <div className="title-row">
        <div>
          <h1 className="h1" ref={h1} tabIndex={-1}>
            Your offer letter
          </h1>
          <p className="label">{v2 ? `Version ${view.version} · ${pagesLine}` : pagesLine}</p>
        </div>
        <div className="title-row__actions">
          <button type="button" className="icon-btn" aria-label={zoom ? 'Zoom out' : 'Zoom in'} aria-pressed={zoom} onClick={() => setZoom((z) => !z)}>
            <Icon name={zoom ? 'zoomOut' : 'zoomIn'} />
          </button>
          <button type="button" className="icon-btn" aria-label="Download PDF" onClick={() => pdf?.download()} disabled={!pdf}>
            <Icon name="download" />
          </button>
        </div>
      </div>
      <OfferBanner view={view} />
      <PdfViewer load={load} fileName={fileName} zoom={zoom} onReady={setPdf} className="pdf--inline" label="Your offer letter" />
      <BottomBar className="bottom-bar--panel">
        {agree}
        {errNote}
        {acceptBtn}
        <AskHrRow email={view.hrContact.email} subject={subject} />
      </BottomBar>
    </Page>
  );
}

// ── P4 / P5 / W4 · Accepted · waiting for HR / HR finalised ───────────────

function VideoCard({ url, company, sub }: { url: string; company: string; sub: string }) {
  const [playing, setPlaying] = useState(false);
  const [dur, setDur] = useState<number>();
  const ref = useRef<HTMLVideoElement>(null);
  const mmss = dur ? `${Math.floor(dur / 60)}:${String(Math.round(dur % 60)).padStart(2, '0')}` : undefined;
  const spoken = dur ? `${Math.floor(dur / 60)} minute${Math.floor(dur / 60) === 1 ? '' : 's'} ${Math.round(dur % 60)} seconds` : '';
  return (
    <div className="video-card card">
      <div className="video-card__frame">
        <video
          ref={ref}
          src={mediaUrl(url)}
          preload="metadata"
          controls={playing}
          playsInline
          onLoadedMetadata={(e) => setDur(e.currentTarget.duration)}
          onEnded={() => setPlaying(false)}
        />
        {!playing && (
          <button
            type="button"
            className="video-card__play"
            aria-label={`Play video about ${company}${spoken ? `, ${spoken}` : ''}`}
            onClick={() => {
              setPlaying(true);
              ref.current?.play().catch(() => undefined);
            }}
          >
            <span className="round-btn round-btn--white">
              <Icon name="play" />
            </span>
          </button>
        )}
      </div>
      <div className="video-card__meta">
        <span>
          <span className="body-strong">Life at {company}</span>
          <span className="label">{sub}</span>
        </span>
        {mmss && <span className="label">{mmss}</span>}
      </div>
    </div>
  );
}

function Accepted({ view, src, signedIn }: { view: PortalOfferView; src: OfferSource; signedIn: boolean }) {
  const wide = useWide();
  const navigate = useNavigate();
  const [pdfOpen, setPdfOpen] = useState(false);
  const confirmed = view.state === 'finalised';
  const first = firstName(view.candidateName);
  const h1 = useFocusHeading<HTMLHeadingElement>(view.state);
  const load = useCallback(() => portal.offerPdf(src), [src]);
  const hasSession = !!getSession();

  const steps = confirmed
    ? [
        { title: 'You accepted', sub: wide && view.acceptedAt ? fmtWeekday(view.acceptedAt) : undefined, state: 'done' as const },
        { title: 'HR confirms', sub: wide && view.finalisedAt ? fmtWeekday(view.finalisedAt) : undefined, state: 'done' as const },
        { title: wide ? 'Sign-in details emailed' : 'Login details emailed', sub: wide ? 'Check your inbox' : undefined, state: 'done' as const },
      ]
    : [
        { title: 'You accepted', sub: wide && view.acceptedAt ? fmtWeekday(view.acceptedAt) : undefined, state: 'done' as const },
        { title: 'HR confirms', sub: wide ? 'Usually within a day' : undefined, state: 'current' as const },
        { title: wide ? 'Sign-in details emailed' : 'Login details emailed', sub: wide ? 'After HR confirms' : undefined, state: 'todo' as const },
      ];

  const title = wide ? (confirmed ? 'You’re all set' : 'Offer accepted') : confirmed ? 'You’re all set!' : 'Offer accepted!';
  const sub = wide
    ? confirmed
      ? 'HR has confirmed your joining. We’ve emailed your sign-in details for the joining portal.'
      : `Thank you, ${first}. HR will confirm from their side, usually within a working day. We’ll email you the moment they do.`
    : confirmed
      ? `We’ve emailed your login details${view.loginEmailMasked ? ` to ${view.loginEmailMasked}` : ''}.`
      : 'HR will confirm within 1 working day. Then we’ll email you your login details.';

  const signInBtn = signedIn || hasSession ? (
    <PrimaryButton onClick={() => navigate('/')}>Back to home</PrimaryButton>
  ) : confirmed ? (
    <PrimaryButton onClick={() => navigate('/sign-in')}>Sign in</PrimaryButton>
  ) : null;

  const pdfCard = (
    <button type="button" className="file-card card" onClick={() => setPdfOpen(true)} aria-label="Open your accepted offer letter, PDF">
      <span className="pdf__badge" aria-hidden="true">
        PDF
      </span>
      <span className="file-card__text">
        <span className="body-strong">Your offer letter</span>
        <span className="label">
          {['Accepted version', view.pdfPages ? `${view.pdfPages} ${view.pdfPages === 1 ? 'page' : 'pages'}` : '', wide ? 'open or download' : 'tap to open'].filter(Boolean).join(' · ')}
        </span>
      </span>
      <Icon name="arrow" />
    </button>
  );
  const video = view.companyVideoUrl && (
    <section className="section">
      {!wide && <h2 className="h1">{confirmed ? 'Before you sign in, watch this' : 'While you wait, watch this'}</h2>}
      <VideoCard
        url={view.companyVideoUrl}
        company={view.company.name}
        sub={wide ? (confirmed ? 'Watch before Day 1' : 'Watch while you wait') : 'Who we are and what we value'}
      />
    </section>
  );
  const sheet = (
    <Sheet open={pdfOpen} onClose={() => setPdfOpen(false)} title="Your offer letter" wide>
      <PdfViewer load={load} fileName="Offer letter.pdf" toolbar label="Your accepted offer letter" className="pdf--sheet" />
    </Sheet>
  );

  return (
    <Page header={{ company: view.company, hr: view.hrContact, help: true }} layout={wide ? 'wide' : 'narrow'}>
      <div className={wide ? 'two-col two-col--even' : ''}>
        <section className={`accepted-hero ${confirmed ? 'is-confirmed' : ''} rise`}>
          <span className="accepted-hero__tick pop" aria-hidden="true">
            <Icon name="check" size={34} />
            {/* 6Zs P4 draws the HR badge while waiting too (HR is who confirms next). */}
            <span className="accepted-hero__badge">HR</span>
          </span>
          <h1 className="display" ref={h1} tabIndex={-1}>
            {title}
          </h1>
          <p className="body sub">{sub}</p>
          <Steps steps={steps} />
          {wide && signInBtn}
        </section>
        <div className="stack">
          {pdfCard}
          {video}
        </div>
      </div>
      {!wide && signInBtn && <BottomBar>{signInBtn}</BottomBar>}
      {sheet}
    </Page>
  );
}
