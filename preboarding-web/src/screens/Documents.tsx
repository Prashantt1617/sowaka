import { useEffect, useId, useMemo, useRef, useState, type DragEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { portal } from '../api/portal';
import type { CandidateDocumentView } from '../api/types';
import { Page } from '../components/Shell';
import { Icon } from '../components/Icon';
import { BackLink, BottomBar, ErrorNote, PrimaryButton, SecondaryButton, Spinner, StoryBar } from '../components/ui';
import { fmtBytes, fmtShort, fmtWeekday } from '../lib/format';
import { useAsync, useFocusHeading, useWide } from '../lib/hooks';
import { useMe } from '../session';

const MAX_BYTES = 10 * 1024 * 1024;
const TYPES = ['application/pdf', 'image/jpeg', 'image/png'];
const ACCEPT = '.pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png';

/** Reel copy for the documents HR's default template lists (3Rb §5 · 8, W8). The server's title/hint win. */
const DOC_COPY: Record<string, { title: string; hint: string; meta: string }> = {
  id_proof: { title: 'Upload your PAN and Aadhaar', hint: 'Both sides, in good light, with no glare.', meta: 'PAN and Aadhaar, both sides' },
  address_proof: { title: 'Upload an address proof', hint: 'A utility bill, rent agreement or passport page.', meta: 'Utility bill, rent agreement or passport' },
  education: { title: 'Upload your highest degree', hint: 'Degree certificate and final mark sheet.', meta: 'Highest degree and mark sheet' },
  payslips: { title: 'Upload your last 3 payslips', hint: 'From your current or last employer.', meta: 'From your current or last employer' },
  relieving_letter: { title: 'Upload your relieving letter', hint: 'From your last employer.', meta: 'From your last employer' },
  photo: { title: 'Upload a passport photo', hint: 'Plain background, face clearly visible.', meta: 'Plain background, face clearly visible' },
};

function copyFor(d: CandidateDocumentView) {
  const c = DOC_COPY[d.docKey];
  return {
    title: d.title ?? c?.title ?? `Upload your ${d.label.charAt(0).toLowerCase()}${d.label.slice(1)}`,
    hint: d.hint ?? c?.hint ?? '',
    meta: c?.meta ?? d.hint ?? '',
  };
}

const ORDER: Record<CandidateDocumentView['status'], number> = { sent_back: 0, todo: 1, in_review: 2, approved: 3 };
const sentOrDone = (d: CandidateDocumentView) => d.status === 'in_review' || d.status === 'approved';

/** Client-side check before uploading: PDF/JPG/PNG up to 10 MB. */
export function checkFile(f: File): string | null {
  const okType = TYPES.includes(f.type) || /\.(pdf|jpe?g|png)$/i.test(f.name);
  if (!okType) return `${f.name} isn’t a PDF, JPG or PNG.`;
  if (f.size > MAX_BYTES) return `${f.name} is ${fmtBytes(f.size)}. Files can be up to 10 MB.`;
  return null;
}

function StatusPill({ status }: { status: CandidateDocumentView['status'] }) {
  const map = {
    sent_back: ['back', 'Sent back'],
    todo: ['todo', 'To do'],
    in_review: ['review', 'With HR'],
    approved: ['done', 'Approved'],
  } as const;
  const [kind, text] = map[status];
  return <span className={`tag tag--${kind}`}>{text}</span>;
}

/** Picked-but-not-sent files + the two inputs (camera / file). */
function usePicker() {
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState<string>();
  const add = (list: FileList | File[] | null) => {
    if (!list) return;
    const arr = Array.from(list);
    for (const f of arr) {
      const e = checkFile(f);
      if (e) {
        setError(e);
        return;
      }
    }
    setError(undefined);
    setFiles((cur) => [...cur, ...arr].slice(0, 6));
  };
  const clear = () => {
    setFiles([]);
    setError(undefined);
  };
  return { files, error, add, clear, setError };
}

function ExistingFiles({ doc, onRemove, busy }: { doc: CandidateDocumentView; onRemove: (fileId: string) => void; busy: boolean }) {
  if (doc.files.length === 0) return null;
  const canRemove = doc.status !== 'approved';
  return (
    <ul className="file-list" aria-label="Files you sent">
      {doc.files.map((f) => (
        <li key={f.id} className="file-list__item">
          <Icon name="file" size={18} />
          <span className="file-list__name">
            <span className="body-strong">{f.name}</span>
            <span className="label">{fmtBytes(f.size)}</span>
          </span>
          {canRemove && (
            <button type="button" className="icon-btn" aria-label={`Remove ${f.name}`} onClick={() => onRemove(f.id)} disabled={busy}>
              <Icon name="trash" size={18} />
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}

function Progress({ value }: { value: number | undefined }) {
  if (value === undefined) return null;
  return (
    <div className="upload-progress" role="progressbar" aria-label="Uploading" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(value * 100)}>
      <span style={{ width: `${Math.round(value * 100)}%` }} />
      <span className="label">Uploading… {Math.round(value * 100)}%</span>
    </div>
  );
}

export function Documents() {
  const { header, me, reload } = useMe();
  const wide = useWide();
  const state = useAsync(() => portal.documents(), []);
  const docs = useMemo(
    () => [...(state.data?.documents ?? [])].sort((a, b) => ORDER[a.status] - ORDER[b.status]),
    // keep the order stable while the candidate works through the reels
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state.data === undefined],
  );
  const live = state.data?.documents ?? [];
  const ordered = docs.map((d) => live.find((x) => x.id === d.id)).filter((d): d is CandidateDocumentView => !!d);
  const update = (next: CandidateDocumentView[]) => {
    state.setData({ documents: next });
    reload();
  };
  const due = live.find((d) => d.dueAt)?.dueAt ?? me.tasks.find((t) => t.systemKey === 'upload_documents')?.dueAt ?? undefined;

  if (state.error)
    return (
      <Page header={header({ close: '/' })}>
        <ErrorNote error={state.error} onRetry={state.reload} />
      </Page>
    );
  if (!state.data)
    return (
      <Page header={header({ close: '/' })}>
        <Spinner />
      </Page>
    );
  if (wide) return <DocsWeb docs={ordered} update={update} due={due ?? undefined} header={header()} />;
  return <DocsReels docs={ordered} update={update} header={header({ close: '/' })} />;
}

// ── P8 · Documents reel (mobile) ──────────────────────────────────────────

function DocsReels({ docs, update, header }: { docs: CandidateDocumentView[]; update: (d: CandidateDocumentView[]) => void; header: ReturnType<ReturnType<typeof useMe>['header']> }) {
  const navigate = useNavigate();
  const total = docs.length;
  const firstOpen = docs.findIndex((d) => !sentOrDone(d));
  const [i, setI] = useState(firstOpen === -1 ? total : firstOpen);
  const picker = usePicker();
  const [progress, setProgress] = useState<number>();
  const [busy, setBusy] = useState(false);
  const camId = useId();
  const fileId = useId();
  const h1 = useFocusHeading<HTMLHeadingElement>(i);
  const sent = docs.filter(sentOrDone).length;

  useEffect(() => picker.clear(), [i]); // eslint-disable-line react-hooks/exhaustive-deps

  if (total === 0)
    return (
      <Page header={header}>
        <section className="closed">
          <h1 className="display">No documents needed</h1>
          <p className="body sub">HR hasn’t asked for any documents.</p>
        </section>
        <BottomBar>
          <PrimaryButton onClick={() => navigate('/')}>Back to home</PrimaryButton>
        </BottomBar>
      </Page>
    );

  if (i >= total) {
    const all = sent === total;
    return (
      <Page header={header}>
        <StoryBar total={total} current={total} />
        <section className="reel-end rise" role="status">
          <p className="display-xl pop">
            {sent}/{total}
          </p>
          <h1 className="display" ref={h1} tabIndex={-1}>
            {all ? 'All documents sent' : 'Good progress'}
          </h1>
          <p className="body sub">
            {all
              ? 'HR will check them within 1 working day. If anything needs fixing, you’ll see it on your home screen.'
              : 'You can finish the rest later. They’re due 5 days before you join.'}
          </p>
        </section>
        <BottomBar>
          <PrimaryButton onClick={() => navigate('/')}>Back to home</PrimaryButton>
        </BottomBar>
      </Page>
    );
  }

  const doc = docs[i];
  const c = copyFor(doc);
  const already = sentOrDone(doc);
  const picked = picker.files.length > 0;
  const allImages = picker.files.every((f) => f.type.startsWith('image/'));

  const next = async () => {
    if (!picked) {
      setI(i + 1);
      return;
    }
    setBusy(true);
    setProgress(0);
    try {
      const r = await portal.uploadDocument(doc.id, picker.files, setProgress);
      update(r.documents);
      setI(i + 1);
    } catch (e) {
      picker.setError((e as Error).message);
    } finally {
      setBusy(false);
      setProgress(undefined);
    }
  };
  const remove = async (fid: string) => {
    setBusy(true);
    try {
      update((await portal.removeDocumentFile(doc.id, fid)).documents);
    } catch (e) {
      picker.setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Page header={header} bg="white">
      <StoryBar total={total} current={i} done={docs.map(sentOrDone)} />
      <p className="label reel-count">
        <span className="body-strong">Your documents</span> {sent}/{total}
      </p>
      <section className="reel rise" key={doc.id} aria-labelledby={`doc-${doc.id}`}>
        <p className={`eyebrow ${doc.status === 'sent_back' ? 'eyebrow--orange' : ''}`}>
          {doc.label.toUpperCase()}
          {doc.status === 'sent_back' ? ' · PLEASE REDO' : ''}
        </p>
        <h1 id={`doc-${doc.id}`} className="display" ref={h1} tabIndex={-1}>
          {c.title}
        </h1>
        {c.hint && <p className="body sub">{c.hint}</p>}
        {doc.status === 'sent_back' && doc.hrNote && (
          <div className="hr-note" role="note">
            <p className="eyebrow">Note from HR</p>
            <p className="body">{doc.hrNote}</p>
          </div>
        )}
        {already && (
          <p className="reel__status">
            <StatusPill status={doc.status} />{' '}
            <span className="label">{doc.status === 'approved' ? 'Approved by HR' : 'HR is checking it'}</span>
          </p>
        )}
        <ExistingFiles doc={doc} onRemove={remove} busy={busy} />

        {doc.status !== 'approved' &&
          (picked ? (
            <div className="captured pop">
              <span className="captured__icon" aria-hidden="true">
                <Icon name="check" size={20} />
              </span>
              <span className="captured__text">
                <span className="body-strong">{allImages ? 'Photo added' : 'File added'}</span>
                <span className="label">{picker.files.map((f) => f.name).join(', ')}</span>
              </span>
              <button type="button" className="pill-btn" onClick={picker.clear} disabled={busy}>
                Retake
              </button>
            </div>
          ) : (
            <div className="capture">
              <label htmlFor={camId} className="capture__big">
                <Icon name="camera" size={28} />
                <span className="body-strong">Take a photo</span>
              </label>
              <input id={camId} className="sr-only" type="file" accept="image/*" capture="environment" onChange={(e) => (picker.add(e.target.files), (e.target.value = ''))} />
              <label htmlFor={fileId} className="text-link capture__file">
                or upload a file
              </label>
              <input id={fileId} className="sr-only" type="file" accept={ACCEPT} multiple onChange={(e) => (picker.add(e.target.files), (e.target.value = ''))} />
              <p className="label">PDF, JPG or PNG up to 10 MB</p>
            </div>
          ))}
        {picker.error && (
          <p className="field__error" role="alert">
            {picker.error}
          </p>
        )}
        <Progress value={progress} />
      </section>
      <BottomBar className="bottom-bar--split">
        <SecondaryButton onClick={() => setI(i + 1)} disabled={busy}>
          Skip for now
        </SecondaryButton>
        <PrimaryButton onClick={next} disabled={busy || (!picked && !already)}>
          {busy ? 'Sending…' : 'Next'}
        </PrimaryButton>
      </BottomBar>
    </Page>
  );
}

// ── W8 · Documents (desktop) ──────────────────────────────────────────────

function DocsWeb({
  docs,
  update,
  due,
  header,
}: {
  docs: CandidateDocumentView[];
  update: (d: CandidateDocumentView[]) => void;
  due?: string;
  header: ReturnType<ReturnType<typeof useMe>['header']>;
}) {
  const firstOpen = docs.find((d) => !sentOrDone(d)) ?? docs[0];
  const [sel, setSel] = useState(firstOpen?.id);
  const picker = usePicker();
  const [progress, setProgress] = useState<number>();
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(false);
  const [sentMsg, setSentMsg] = useState<string>();
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const h1 = useFocusHeading<HTMLHeadingElement>('docs');
  const approved = docs.filter((d) => d.status === 'approved').length;
  const doc = docs.find((d) => d.id === sel) ?? docs[0];

  useEffect(() => picker.clear(), [sel]); // eslint-disable-line react-hooks/exhaustive-deps

  const send = async () => {
    if (!doc || picker.files.length === 0) return;
    setBusy(true);
    setProgress(0);
    try {
      const r = await portal.uploadDocument(doc.id, picker.files, setProgress);
      update(r.documents);
      picker.clear();
      setSentMsg(`${doc.label} sent to HR.`);
      const nextOpen = r.documents.find((d) => d.id !== doc.id && (d.status === 'sent_back' || d.status === 'todo'));
      if (nextOpen) setSel(nextOpen.id);
    } catch (e) {
      picker.setError((e as Error).message);
    } finally {
      setBusy(false);
      setProgress(undefined);
    }
  };
  const remove = async (fid: string) => {
    if (!doc) return;
    setBusy(true);
    try {
      update((await portal.removeDocumentFile(doc.id, fid)).documents);
    } catch (e) {
      picker.setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDrag(false);
    picker.add(e.dataTransfer.files);
  };

  return (
    <Page header={header} layout="wide">
      <BackLink to="/" />
      <h1 className="display" ref={h1} tabIndex={-1}>
        Your documents
      </h1>
      <p className="body sub">
        <span className="body-strong">
          {approved} of {docs.length} approved
        </span>
        {due ? ` · due ${fmtWeekday(due)}` : ''}
      </p>
      {sentMsg && (
        <p className="banner banner--green body" role="status">
          {sentMsg}
        </p>
      )}
      <div className="two-col two-col--docs">
        <ul className="doc-list card" aria-label="Documents">
          {docs.map((d) => {
            const c = copyFor(d);
            const meta =
              d.status === 'sent_back'
                ? 'HR asked for a new copy'
                : d.status === 'in_review'
                  ? d.uploadedAt
                    ? `Uploaded ${fmtWeekday(d.uploadedAt)}`
                    : 'With HR'
                  : d.status === 'approved'
                    ? d.reviewedAt
                      ? `Approved ${fmtWeekday(d.reviewedAt)}`
                      : 'Approved'
                    : c.meta;
            return (
              <li key={d.id}>
                <button type="button" className={`doc-row ${d.id === doc?.id ? 'is-on' : ''}`} aria-current={d.id === doc?.id} onClick={() => setSel(d.id)}>
                  <span className="doc-row__text">
                    <span className="body-strong">{d.label}</span>
                    <span className={`label ${d.status === 'sent_back' ? 'text-orange' : ''}`}>{meta}</span>
                  </span>
                  <StatusPill status={d.status} />
                </button>
              </li>
            );
          })}
        </ul>
        {doc && (
          <section className="side-panel card" aria-labelledby="doc-title">
            {doc.status === 'sent_back' && doc.hrNote && (
              <div className="hr-note" role="note">
                <p className="eyebrow">Note from HR</p>
                <p className="body">{doc.hrNote}</p>
              </div>
            )}
            <h2 id="doc-title" className="h1">
              {doc.label}
            </h2>
            {copyFor(doc).hint && <p className="body sub">{copyFor(doc).hint}</p>}
            <ExistingFiles doc={doc} onRemove={remove} busy={busy} />
            {doc.status === 'approved' ? (
              <p className="body">
                <StatusPill status="approved" /> Approved{doc.reviewedAt ? ` ${fmtShort(doc.reviewedAt)}` : ''}. Nothing more to do.
              </p>
            ) : (
              <>
                <label
                  htmlFor={inputId}
                  className={`dropzone ${drag ? 'is-drag' : ''}`}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDrag(true);
                  }}
                  onDragLeave={() => setDrag(false)}
                  onDrop={onDrop}
                >
                  <Icon name="upload" size={28} />
                  <span className="body-strong">Drop your file here, or choose a file</span>
                  <span className="label">PDF, JPG or PNG up to 10 MB · on your phone you can take a photo</span>
                </label>
                <input id={inputId} ref={inputRef} className="sr-only" type="file" accept={ACCEPT} multiple onChange={(e) => (picker.add(e.target.files), (e.target.value = ''))} />
                {picker.files.length > 0 && (
                  <ul className="file-list" aria-label="Ready to send">
                    {picker.files.map((f, k) => (
                      <li key={`${f.name}-${k}`} className="file-list__item">
                        <Icon name="file" size={18} />
                        <span className="file-list__name">
                          <span className="body-strong">{f.name}</span>
                          <span className="label">{fmtBytes(f.size)}</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
                {picker.error && (
                  <p className="field__error" role="alert">
                    {picker.error}
                  </p>
                )}
                <Progress value={progress} />
                <div className="panel-actions">
                  <Link to="/" className="btn btn--secondary">
                    Do this later
                  </Link>
                  <PrimaryButton onClick={send} disabled={busy || picker.files.length === 0}>
                    {busy ? 'Sending…' : 'Upload and send to HR'}
                  </PrimaryButton>
                </div>
              </>
            )}
          </section>
        )}
      </div>
    </Page>
  );
}
