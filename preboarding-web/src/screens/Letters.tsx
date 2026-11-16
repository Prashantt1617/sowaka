import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { portal } from '../api/portal';
import type { LetterKind, PortalLetter } from '../api/types';
import { Page } from '../components/Shell';
import { Icon } from '../components/Icon';
import { PdfViewer } from '../components/PdfViewer';
import { SignaturePad, type SignatureValue } from '../components/SignaturePad';
import { BackLink, BottomBar, ErrorNote, PillButton, PrimaryButton, Sheet, Spinner, StoryBar } from '../components/ui';
import { shortName } from '../lib/format';
import { useAsync, useFocusHeading, useWide } from '../lib/hooks';
import { useMe } from '../session';

const TITLES: Record<LetterKind, string> = {
  offer: 'Offer letter',
  appointment: 'Appointment letter',
  nda: 'Non-disclosure agreement',
  confirmation: 'Confirmation letter',
  extension: 'Probation extension letter',
  relieving: 'Relieving letter',
};
const FILES: Record<LetterKind, string> = {
  offer: 'Offer letter.pdf',
  appointment: 'Appointment letter.pdf',
  nda: 'NDA.pdf',
  confirmation: 'Confirmation letter.pdf',
  extension: 'Extension letter.pdf',
  relieving: 'Relieving letter.pdf',
};
const titleOf = (l: PortalLetter) => l.title ?? TITLES[l.kind];
const fileOf = (l: PortalLetter) => l.fileName ?? FILES[l.kind];
const pagesText = (n?: number) => (n ? `${n} ${n === 1 ? 'page' : 'pages'}` : '');

const pdfCache = new Map<string, Promise<ArrayBuffer>>();
function letterBytes(id: string) {
  let p = pdfCache.get(id);
  if (!p) {
    p = portal.letterPdf(id);
    pdfCache.set(id, p);
    p.catch(() => pdfCache.delete(id));
  }
  return p;
}

/** P12 / W12 · Appointment letter & NDA: the full PDF, signing unlocks once it was opened; draw or type. */
export function Letters() {
  const { header, me, reload } = useMe();
  const { id } = useParams();
  const navigate = useNavigate();
  const wide = useWide();
  const state = useAsync(() => portal.letters(), []);
  const [pages, setPages] = useState<Record<string, number>>({});
  const [sig, setSig] = useState<SignatureValue | null>(null);
  const [sigOpen, setSigOpen] = useState(false);
  const [draft, setDraft] = useState<SignatureValue | null>(null);
  const [pdfOpen, setPdfOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string>();

  const letters = useMemo(() => (state.data?.letters ?? []).filter((l) => l.kind !== 'offer'), [state.data]);
  const active = letters.filter((l) => l.state !== 'locked');
  // A letter HR has not uploaded yet (the server opens them as a set, but a regenerated one can lag behind).
  const waiting = letters.filter((l) => l.state === 'locked');
  const docsApproved = me.path.find((p) => p.key === 'docs')?.state === 'done' || me.status === 'docs_approved';
  const pagesOf = (l: PortalLetter) => pages[l.id] ?? l.pages;
  const current = (id && active.find((l) => l.id === id)) || active.find((l) => l.state !== 'signed');
  const index = current ? active.indexOf(current) : active.length;
  const allSigned = active.length > 0 && active.every((l) => l.state === 'signed');
  const h1 = useFocusHeading<HTMLHeadingElement>(current?.id ?? 'done');

  useEffect(() => {
    setSig(null);
    setDraft(null);
    setErr(undefined);
  }, [current?.id]);

  const setLetter = useCallback(
    (lid: string, patch: Partial<PortalLetter>) => state.setData({ letters: (state.data?.letters ?? []).map((l) => (l.id === lid ? { ...l, ...patch } : l)) }),
    [state],
  );

  const markOpened = useCallback(
    (l: PortalLetter) => {
      if (l.state !== 'ready') return;
      setLetter(l.id, { state: 'opened' });
      portal.letterOpened(l.id).catch(() => undefined);
    },
    [setLetter],
  );

  const sign = async () => {
    if (!current || !sig) return;
    setBusy(true);
    setErr(undefined);
    try {
      await portal.signLetter(current.id, sig);
      const nextLetters = (state.data?.letters ?? []).map((l) => (l.id === current.id ? { ...l, state: 'signed' as const } : l));
      state.setData({ letters: nextLetters });
      pdfCache.delete(current.id);
      const next = nextLetters.find((l) => l.kind !== 'offer' && l.state !== 'signed' && l.state !== 'locked');
      navigate(next ? `/letters/${next.id}` : '/letters', { replace: true });
      if (!next) reload();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const hdr = header({ close: '/' });
  if (state.error)
    return (
      <Page header={hdr}>
        <ErrorNote error={state.error} onRetry={state.reload} />
      </Page>
    );
  if (!state.data)
    return (
      <Page header={hdr}>
        <Spinner />
      </Page>
    );

  if (active.length === 0)
    return (
      <Page header={hdr}>
        <section className="closed">
          <span className="closed__icon" aria-hidden="true">
            <Icon name="lock" size={30} />
          </span>
          <h1 className="display" ref={h1} tabIndex={-1}>
            {docsApproved ? 'HR is preparing your letters' : 'Your letters aren’t ready yet'}
          </h1>
          <p className="body sub">
            {docsApproved
              ? 'Your documents are approved. We’ll email you as soon as your appointment letter and NDA are ready to sign.'
              : 'Your appointment letter and NDA open once HR approves your documents.'}
          </p>
        </section>
        <BottomBar>
          <PrimaryButton onClick={() => navigate('/')}>Back to home</PrimaryButton>
        </BottomBar>
      </Page>
    );

  // done: every letter that can be signed is signed (and says so when another is still on its way)
  if (!current || (allSigned && !id)) {
    const signedCount = active.filter((l) => l.state === 'signed').length;
    return (
      <Page header={hdr}>
        <StoryBar total={letters.length} current={signedCount} done={letters.map((l) => l.state === 'signed')} />
        <section className="reel-end rise" role="status">
          <p className="display-xl pop">
            {signedCount}/{letters.length}
          </p>
          <h1 className="display" ref={h1} tabIndex={-1}>
            {waiting.length ? 'Signed so far' : letters.length === 2 ? 'Both documents signed' : 'All documents signed'}
          </h1>
          <p className="body sub">
            {waiting.length
              ? `Your ${waiting.map((l) => titleOf(l).toLowerCase()).join(' and ')} is still with HR. We’ll email you when it’s ready to sign. Signed copies are saved in your documents.`
              : 'Signed copies are saved in your documents. HR has a copy too.'}
          </p>
          <ul className="file-list">
            {active.map((l) => (
              <li key={l.id} className="file-list__item">
                <Icon name="file" size={18} />
                <span className="file-list__name">
                  <span className="body-strong">{titleOf(l)}</span>
                  <span className="label text-green">Signed</span>
                </span>
                <PillButton onClick={() => navigate(`/letters/${l.id}`)}>Open</PillButton>
              </li>
            ))}
          </ul>
        </section>
        <BottomBar>
          <PrimaryButton onClick={() => navigate('/')}>Back to home</PrimaryButton>
        </BottomBar>
      </Page>
    );
  }

  const opened = current.state === 'opened' || current.state === 'signed';
  const signed = current.state === 'signed';
  const remaining = active.filter((l) => l.state !== 'signed');
  const lastToSign = remaining.length <= 1;
  const signLabel = busy ? 'Signing…' : lastToSign ? 'Sign and finish' : 'Sign and continue';
  const caption = `${shortName(me.candidateName)} · ${signed ? 'Signed' : 'Not signed yet'}`;
  const load = () => letterBytes(current.id);
  const pairTitle = active.length === 2 && active.some((l) => l.kind === 'appointment') && active.some((l) => l.kind === 'nda') ? 'Appointment letter & NDA' : 'Your letters';
  const errNote = err && (
    <p className="field__error" role="alert">
      {err}
    </p>
  );

  if (wide)
    return (
      <Page header={header()} layout="wide">
        <BackLink to="/" />
        <h1 className="display" ref={h1} tabIndex={-1}>
          {pairTitle}
        </h1>
        <p className="body sub">Read each PDF, then sign · about 3 minutes</p>
        <div className="two-col">
          <PdfViewer
            key={current.id}
            load={load}
            fileName={fileOf(current)}
            toolbar
            label={titleOf(current)}
            onReady={(r) => setPages((p) => ({ ...p, [current.id]: r.pages }))}
            onOpened={() => markOpened(current)}
          />
          <aside className="side-panel card">
            <ul className="letter-list" aria-label="Documents to sign">
              {active.map((l) => (
                <li key={l.id}>
                  <button type="button" className={`doc-row ${l.id === current.id ? 'is-on' : ''}`} aria-current={l.id === current.id} onClick={() => navigate(`/letters/${l.id}`)}>
                    <span className="doc-row__text">
                      <span className="body-strong">{titleOf(l)}</span>
                      <span className="label">
                        {[pagesText(pagesOf(l)), l.state === 'signed' ? 'Signed' : l.state === 'opened' ? 'Opened' : 'Not opened yet'].filter(Boolean).join(' · ')}
                      </span>
                    </span>
                    {l.state === 'signed' && <span className="tag tag--done">Signed</span>}
                  </button>
                </li>
              ))}
            </ul>
            {signed ? (
              <p className="body">
                <span className="tag tag--done">Signed</span> You signed this document. The signed PDF is saved to your documents.
              </p>
            ) : (
              <>
                <h2 className="h1">Your signature</h2>
                {!opened && <p className="label">Open the PDF to sign</p>}
                <SignaturePad key={current.id} defaultName={me.candidateName} onChange={setSig} disabled={!opened} />
                <p className="label">Signing records the time and device. The signed PDFs are saved to your documents.</p>
                {errNote}
                <PrimaryButton onClick={sign} disabled={!opened || !sig || busy}>
                  {signLabel}
                </PrimaryButton>
              </>
            )}
          </aside>
        </div>
      </Page>
    );

  return (
    <Page header={hdr} bg="white">
      <StoryBar total={active.length} current={index} done={active.map((l) => l.state === 'signed')} />
      <p className="label reel-count">
        Document {index + 1} of {active.length}
      </p>
      <section className="reel rise" key={current.id}>
        <h1 className="display" ref={h1} tabIndex={-1}>
          {titleOf(current)}
        </h1>
        <button type="button" className="file-card card" onClick={() => setPdfOpen(true)} aria-label={`Open ${fileOf(current)}`}>
          <span className="pdf__badge" aria-hidden="true">
            PDF
          </span>
          <span className="file-card__text">
            <span className="body-strong">{fileOf(current)}</span>
            {opened ? (
              <span className="label text-green">✓ Opened{pagesOf(current) ? ` · ${pagesText(pagesOf(current))}` : ''}</span>
            ) : (
              <span className="label">{pagesOf(current) ? `${pagesText(pagesOf(current))} · ` : ''}read before signing</span>
            )}
          </span>
          <span className="pill-btn" aria-hidden="true">
            {opened ? 'Open again' : 'Open PDF'}
          </span>
        </button>

        {signed ? (
          <p className="body">
            <span className="tag tag--done">Signed</span> The signed PDF is saved to your documents.
          </p>
        ) : (
          <div className="sign-slot">
            <button type="button" className={`sign-slot__pad ${sig ? 'has-sig' : ''}`} disabled={!opened} onClick={() => setSigOpen(true)}>
              {sig ? (
                sig.method === 'draw' && sig.imageDataUrl ? (
                  <img src={sig.imageDataUrl} alt="Your signature" />
                ) : (
                  <span className="sig__preview">{sig.typedName}</span>
                )
              ) : (
                <span className="body-strong">
                  <Icon name="pen" size={18} /> {opened ? 'Tap to sign' : 'Open the PDF to sign'}
                </span>
              )}
            </button>
            <p className="label">{caption}</p>
          </div>
        )}
        {errNote}
      </section>
      {!signed && (
        <BottomBar>
          <PrimaryButton onClick={sign} disabled={!opened || !sig || busy}>
            {signLabel}
          </PrimaryButton>
        </BottomBar>
      )}
      {signed && (
        <BottomBar>
          <PrimaryButton onClick={() => navigate('/letters')}>Back to letters</PrimaryButton>
        </BottomBar>
      )}

      <Sheet open={pdfOpen} onClose={() => setPdfOpen(false)} title={titleOf(current)} wide>
        <PdfViewer
          load={load}
          fileName={fileOf(current)}
          toolbar
          label={titleOf(current)}
          className="pdf--sheet"
          onReady={(r) => setPages((p) => ({ ...p, [current.id]: r.pages }))}
          onOpened={() => markOpened(current)}
        />
      </Sheet>
      <Sheet open={sigOpen} onClose={() => setSigOpen(false)} title="Your signature">
        <SignaturePad defaultName={me.candidateName} onChange={setDraft} />
        <p className="label">Signing records the time and device. The signed PDFs are saved to your documents.</p>
        <PrimaryButton
          disabled={!draft}
          onClick={() => {
            setSig(draft);
            setSigOpen(false);
          }}
        >
          Use this signature
        </PrimaryButton>
      </Sheet>
    </Page>
  );
}
