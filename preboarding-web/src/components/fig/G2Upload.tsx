// The upload tile and the uploaded-file row (Figma "Button" upload tile and the "aadhaar-front.jpg ·
// Uploaded · HR will check it · Replace" row, in App · Profile · Bank account / Education / ID documents).
// Built by G2, shared. `G2UploadTile` is the dashed canvas tile (40 px white disc with the upload arrow,
// brand title, caption); `G2FileRow` is a done file with an action; `G2DocUpload` wires a template
// document to the portal API (upload, HR's note, replace) inside a labelled field.
import { useState, type ReactNode } from 'react';
import { portal } from '../../api/portal';
import type { CandidateDocumentView } from '../../api/types';
import { fmtBytes } from '../../lib/format';
import { FigCheckSmall, FigInfo } from './icons';
import { G2Upload } from './icons/g2-upload';
import '../../styles/fig-g2.css';

export const G2_UPLOAD_HINT = 'JPG, PNG or PDF, up to 10 MB';

export function G2UploadTile({ title, hint = G2_UPLOAD_HINT, onFiles, busy, multiple, accept = 'image/jpeg,image/png,application/pdf', label }: {
  title: ReactNode; hint?: ReactNode; onFiles: (files: File[]) => void; busy?: boolean; multiple?: boolean; accept?: string; label?: string;
}) {
  return (
    <label className="g2-upload">
      <input type="file" accept={accept} multiple={multiple} disabled={busy} aria-label={label}
        onChange={(e) => { const f = Array.from(e.target.files ?? []); e.target.value = ''; if (f.length) onFiles(f); }} />
      <span className="g2-upload__disc"><G2Upload /></span>
      <span className="g2-upload__text"><span className="g2-upload__title">{busy ? 'Uploading…' : title}</span><span className="g2-upload__hint">{hint}</span></span>
    </label>
  );
}

export function G2FileRow({ name, status, done = true, action }: { name: ReactNode; status?: ReactNode; done?: boolean; action?: ReactNode }) {
  return (
    <div className="g2-file">
      <span className={`g2-file__mark${done ? '' : ' g2-file__mark--todo'}`}>{done && <FigCheckSmall />}</span>
      <span className="g2-file__text"><span className="g2-file__name">{name}</span>{status && <span className="g2-file__status">{status}</span>}</span>
      {action}
    </div>
  );
}

const DOC_STATE: Record<string, string> = { in_review: 'Uploaded · HR will check it', approved: 'Approved by HR', sent_back: 'Sent back by HR', todo: '' };

/** A template document as a field: its label, HR's note, the files (Replace), and the tile while it can change. */
/** `readOnly`: the section is approved by HR, so its documents can no longer be replaced or added to. */
export function G2DocUpload({ doc, onChange, title, readOnly }: { doc: CandidateDocumentView; onChange: (d: CandidateDocumentView[]) => void; title?: string; readOnly?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const send = async (files: File[]) => {
    setBusy(true);
    setError('');
    try { onChange((await portal.uploadDocument(doc.id, files)).documents); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  const locked = doc.status === 'approved' || readOnly === true;
  const label = `${doc.label}${doc.required ? '' : ' (optional)'}`;
  const replace = (
    <label className="g2-file__action">
      <input type="file" accept="image/jpeg,image/png,application/pdf" disabled={busy} aria-label={`Replace ${doc.label}`}
        onChange={(e) => { const f = Array.from(e.target.files ?? []); e.target.value = ''; if (f.length) void send(f); }} />
      {busy ? 'Uploading…' : 'Replace'}
    </label>
  );
  return (
    <div className="g2-docfield">
      <span className="g2-docfield__label">{label}</span>
      {doc.status === 'sent_back' && doc.hrNote && <p className="fig-note"><FigInfo /><span>{doc.hrNote}</span></p>}
      {doc.files.map((f) => (
        <G2FileRow key={f.id} name={f.name} done={doc.status === 'approved' || doc.status === 'in_review'}
          status={DOC_STATE[doc.status] || fmtBytes(f.size)} action={!locked && doc.files.length === 1 ? replace : undefined} />
      ))}
      {!locked && (doc.files.length === 0 || doc.files.length > 1 || doc.status === 'sent_back') && (
        <G2UploadTile title={doc.files.length ? 'Add another file' : title ?? doc.title ?? 'Upload the file'}
          onFiles={(f) => void send(f)} busy={busy} multiple label={`Upload ${doc.label}`} />
      )}
      {error && <span className="fig-field__error" role="alert">{error}</span>}
    </div>
  );
}
