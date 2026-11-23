// File chips the pre-boarding profile shares with People › Employees: each file
// opens or downloads.
import { useState } from 'react';
import { useStore } from '../../store';
import { IconDownload } from '../../icons';
import { fetchFileUrl, fetchLifecycleFile } from '../../../services/lifecycle';
import { FilePreview } from './shared';
import { errText, fileSize } from './format';

/** A stored file as the server lists it; `url` may be a full link or an API path, or missing on older records. */
export interface FileLinkItem { id: string; name: string; contentType?: string; size?: number | null; url?: string }

const isFullLink = (url?: string) => Boolean(url && /^(https?:|blob:)/i.test(url));

function saveBlob(blob: Blob, name: string) {
  const href = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = href; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 10_000);
}

/**
 * Each file as a chip that opens it, with a download button beside it. A full link
 * (a short-lived signed one) opens in a new tab; an API path, or a file known only
 * by its id, opens in the preview dialog through the signed-in session.
 */
export function FileChips({ files }: { files: FileLinkItem[] }) {
  const { flash } = useStore();
  const [open, setOpen] = useState<FileLinkItem | null>(null);
  const [saving, setSaving] = useState('');
  if (!files.length) return null;
  const download = async (f: FileLinkItem) => {
    setSaving(f.id);
    try { saveBlob(await (f.url ? fetchFileUrl(f.url) : fetchLifecycleFile(f.id)), f.name); } catch (e) { flash(errText(e, 'Could not download the file'), 'error'); } finally { setSaving(''); }
  };
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
      {files.map((f) => {
        const label = (
          <>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 220 }}>{f.name}</span>
            {f.size ? <span className="c">{fileSize(f.size)}</span> : null}
          </>
        );
        return (
          <span key={f.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, maxWidth: '100%' }}>
            {isFullLink(f.url)
              ? <a className="pd-chip sm" href={f.url} target="_blank" rel="noopener" title={`Open ${f.name}`} style={{ maxWidth: '100%', textDecoration: 'none' }}>{label}</a>
              : <button type="button" className="pd-chip sm" onClick={() => setOpen(f)} title={`Preview ${f.name}`} style={{ maxWidth: '100%' }}>{label}</button>}
            {isFullLink(f.url)
              ? <a className="pd-btn sm ghost" href={f.url} download={f.name} target="_blank" rel="noopener" aria-label={`Download ${f.name}`} title="Download"><IconDownload size={14} stroke="currentColor" /></a>
              : <button type="button" className="pd-btn sm ghost" aria-label={`Download ${f.name}`} title="Download" disabled={saving === f.id} onClick={() => void download(f)}><IconDownload size={14} stroke="currentColor" /></button>}
          </span>
        );
      })}
      {open && <FilePreview fileId={open.id} link={open.url} name={open.name} onClose={() => setOpen(null)} />}
    </div>
  );
}
