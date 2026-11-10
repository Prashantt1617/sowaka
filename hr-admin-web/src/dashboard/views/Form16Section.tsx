// Payroll › Payroll Runs › Form 16: who has a Form 16 for a FY, and the way to
// add them. Sowaka does not generate Form 16: HR downloads Part A from TRACES
// and Part B from their tax tool, then uploads the PDFs here, one per row or a
// batch whose file names carry the PAN or the employee ID ("ABCDE1234F.pdf",
// "CS379_PartA.pdf"). Employees download them in the app under Payroll ›
// Downloads › Form 16.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../store';
import { ApiError } from '../../services/http';
import { FORM16_BATCH, bulkUploadForm16, deleteForm16, form16FileUrl, listForm16, uploadForm16 } from '../../services/form16';
import type { Form16BulkDTO, Form16DocumentDTO, Form16EmployeeDTO, Form16Part } from '../../services/form16';
import { useLoad } from '../useLoad';
import { Card, EmptyRow, ListPending, Pill, SearchInput, SelectBox, StatusTabs, Th } from '../ui';
import { STAT } from '../theme';
import { btn, btnClass, cellName, cellSub, hint, TH, toolbar, TR } from '../ds';
import { IconFile, IconX } from '../icons';
import * as L from './look';

const COLS = '1.6fr 0.8fr 2.2fr 0.9fr';
type Filter = 'all' | 'missing' | 'uploaded';

/** "2026-27" for a day in April 2026 to March 2027. */
function fyOf(d: Date): string {
  const y = d.getFullYear();
  const start = d.getMonth() >= 3 ? y : y - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
}
function previousFy(fy: string): string {
  const start = Number(fy.slice(0, 4)) - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
}
const dateLabel = (iso: string) => new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
const sizeLabel = (bytes: number) => (bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);
const PART_LABEL: Record<Form16Part, string> = { A: 'Part A', B: 'Part B', combined: 'Part A + B' };

/** The part a file name says ("…_PartA.pdf", "Part-B"), as the server reads a batch; otherwise both. */
function partInName(name: string): Form16Part {
  const upper = name.toUpperCase();
  const a = /PART[\s_-]*A(?![A-Z])/.test(upper);
  const b = /PART[\s_-]*B(?![A-Z])/.test(upper);
  return a && !b ? 'A' : b && !a ? 'B' : 'combined';
}

export function Form16Section() {
  const { flash } = useStore();
  // Form 16 is issued after a year ends: the last three that have.
  const lastFy = previousFy(fyOf(new Date()));
  const fyOptions = [lastFy, previousFy(lastFy), previousFy(previousFy(lastFy))];
  const [fy, setFy] = useState(lastFy);
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [batch, setBatch] = useState<{ done: number; total: number } | null>(null);
  const [result, setResult] = useState<Form16BulkDTO | null>(null);
  const bulkInput = useRef<HTMLInputElement>(null);
  const rowInput = useRef<HTMLInputElement>(null);
  const rowFor = useRef<string | null>(null);

  const list = useLoad(() => listForm16(fy), [fy]);
  const employees = useMemo(() => list.data?.employees ?? [], [list.data]);
  useEffect(() => {
    if (list.state === 'error') flash(list.error instanceof ApiError ? list.error.message : 'Could not load Form 16', 'error');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list.state]);
  useEffect(() => setResult(null), [fy]);

  const counts = useMemo(() => {
    const uploaded = employees.filter((e) => e.documents.length > 0).length;
    return { all: employees.length, uploaded, missing: employees.length - uploaded };
  }, [employees]);
  const q = search.trim().toLowerCase();
  const rows = employees.filter((e) =>
    (filter === 'all' || (filter === 'uploaded') === e.documents.length > 0)
    && (!q || e.name.toLowerCase().includes(q) || (e.employeeId ?? '').toLowerCase().includes(q)));

  const replaceRow = (userId: string, update: (e: Form16EmployeeDTO) => Form16EmployeeDTO) =>
    list.setData((d) => (d ? { ...d, employees: d.employees.map((e) => (e.userId === userId ? update(e) : e)) } : d!));
  const refresh = async () => {
    try {
      await list.reload();
    } catch {
      // the list on screen stays; the next load says what is wrong
    }
  };

  const uploadOne = async (userId: string, file: File) => {
    setBusy(userId);
    try {
      const doc = await uploadForm16(userId, fy, file, partInName(file.name));
      await refresh();
      const who = employees.find((e) => e.userId === userId)?.name ?? 'the employee';
      flash(`${PART_LABEL[doc.part]} uploaded for ${who}`);
    } catch (e) {
      flash(e instanceof ApiError ? e.message : 'Could not upload the Form 16', 'error');
    } finally {
      setBusy(null);
    }
  };

  const uploadMany = async (files: File[]) => {
    const pdfs = files.filter((f) => /\.pdf$/i.test(f.name));
    if (pdfs.length === 0) {
      flash('Choose PDF files', 'error');
      return;
    }
    setResult(null);
    setBatch({ done: 0, total: pdfs.length });
    const out: Form16BulkDTO = { fy, uploaded: [], unmatched: files.filter((f) => !/\.pdf$/i.test(f.name)).map((f) => ({ fileName: f.name, reason: 'Not a PDF' })) };
    // A big batch goes up in several requests: at most FORM16_BATCH files and 40 MB each, under
    // the server's 50 MB request limit; a request that fails lists its files and the rest carry on.
    const groups: File[][] = [];
    for (const f of pdfs) {
      const last = groups[groups.length - 1];
      const size = last ? last.reduce((t, x) => t + x.size, 0) : 0;
      if (!last || last.length >= FORM16_BATCH || size + f.size > 40 * 1024 * 1024) groups.push([f]);
      else last.push(f);
    }
    try {
      let done = 0;
      for (const group of groups) {
        try {
          const part = await bulkUploadForm16(fy, group);
          out.uploaded.push(...part.uploaded);
          out.unmatched.push(...part.unmatched);
        } catch (e) {
          const reason = e instanceof ApiError ? e.message : 'Could not upload';
          out.unmatched.push(...group.map((f) => ({ fileName: f.name, reason })));
        }
        done += group.length;
        setBatch({ done, total: pdfs.length });
      }
      flash(`${out.uploaded.length} Form 16 ${out.uploaded.length === 1 ? 'file' : 'files'} uploaded${out.unmatched.length ? `, ${out.unmatched.length} not matched` : ''}`, out.unmatched.length && !out.uploaded.length ? 'error' : undefined);
    } catch (e) {
      flash(e instanceof ApiError ? e.message : 'Could not upload the files', 'error');
    } finally {
      setResult(out);
      setBatch(null);
      await refresh();
    }
  };

  const open = async (doc: Form16DocumentDTO) => {
    // Opened first, so the browser treats it as the click's own window and does not block it.
    const tab = window.open('', '_blank');
    setBusy(doc.id);
    try {
      const url = await form16FileUrl(doc.id);
      if (tab) tab.location.href = url;
      else window.open(url, '_blank', 'noopener');
    } catch (e) {
      tab?.close();
      flash(e instanceof ApiError ? e.message : 'Could not open the file', 'error');
    } finally {
      setBusy(null);
    }
  };

  const remove = async (person: Form16EmployeeDTO, doc: Form16DocumentDTO) => {
    if (!window.confirm(`Remove ${person.name}'s ${PART_LABEL[doc.part]} for FY ${doc.fy}? They will no longer see it in the app.`)) return;
    setBusy(doc.id);
    try {
      await deleteForm16(doc.id);
      replaceRow(person.userId, (e) => ({ ...e, documents: e.documents.filter((d) => d.id !== doc.id) }));
      flash('Form 16 removed');
    } catch (e) {
      flash(e instanceof ApiError ? e.message : 'Could not remove the file', 'error');
    } finally {
      setBusy(null);
    }
  };

  const ready = list.state === 'ready';
  return (
    <Card style={{ ...L.cardPad, marginTop: 20 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 260 }}>
          <div style={L.cardTitle}>Form 16</div>
          <div style={L.cardNote}>
            {ready && list.data
              ? `${counts.uploaded} of ${counts.all} employees have a Form 16 for FY ${fy} · due by ${dateLabel(list.data.readyBy)}`
              : `Each employee's Form 16 for FY ${fy}, downloaded in the app under Payroll › Downloads`}
          </div>
        </div>
        <SelectBox value={fy} onChange={setFy}>
          {fyOptions.map((f) => <option key={f} value={f}>FY {f}</option>)}
        </SelectBox>
        <button onClick={() => bulkInput.current?.click()} disabled={batch !== null} className={btnClass('primary')} style={btn('primary')}>
          {batch ? `Uploading ${batch.done} / ${batch.total}…` : 'Upload PDFs'}
        </button>
        <input
          ref={bulkInput}
          type="file"
          accept="application/pdf,.pdf"
          multiple
          hidden
          onChange={(e) => {
            const files = [...(e.target.files ?? [])];
            e.target.value = '';
            if (files.length) void uploadMany(files);
          }}
        />
        <input
          ref={rowInput}
          type="file"
          accept="application/pdf,.pdf"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (file && rowFor.current) void uploadOne(rowFor.current, file);
          }}
        />
      </div>

      <div style={{ ...hint, marginBottom: 14 }}>
        Upload several PDFs at once by naming each with the employee&apos;s PAN or employee ID, e.g. <code>ABCDE1234F.pdf</code> or <code>CS379_PartA.pdf</code>.
        A name with &quot;Part A&quot; or &quot;Part B&quot; files that part; otherwise it is taken as both parts in one PDF and replaces any separate parts. PDF only, up to 3 MB each.
      </div>

      {result && (result.uploaded.length > 0 || result.unmatched.length > 0) && (
        <div style={{ background: 'var(--surface-2)', border: '1px solid var(--line)', borderRadius: 12, padding: '12px 14px', marginBottom: 16, fontSize: 13 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <strong style={{ fontWeight: 600 }}>{result.uploaded.length} uploaded</strong>
            {result.unmatched.length > 0 && <Pill label={`${result.unmatched.length} not matched`} tone={STAT.Declined} />}
            <span style={{ flex: 1 }} />
            <button onClick={() => setResult(null)} title="Dismiss" className={btnClass('ghost')} style={btn('ghost', 'sm')}><IconX /></button>
          </div>
          {result.unmatched.length > 0 && (
            <ul style={{ margin: '8px 0 0', paddingLeft: 18, color: 'var(--ink-2)', lineHeight: 1.6 }}>
              {result.unmatched.map((u) => <li key={u.fileName}><strong style={{ fontWeight: 500 }}>{u.fileName}</strong> — {u.reason}</li>)}
            </ul>
          )}
        </div>
      )}

      <div style={toolbar}>
        <StatusTabs<Filter>
          options={['all', 'missing', 'uploaded']}
          active={filter}
          onSelect={setFilter}
          labels={{ all: 'All', missing: 'Not uploaded', uploaded: 'Uploaded' }}
          counts={ready ? counts : undefined}
        />
        <div style={{ flex: 1, minWidth: 240, display: 'flex' }}>
          <SearchInput value={search} onChange={setSearch} placeholder="Search by employee name or ID…" width="100%" />
        </div>
      </div>

      <div style={TH(COLS)}>
        <Th>EMPLOYEE</Th>
        <Th>PAN</Th>
        <Th>FORM 16</Th>
        <Th align="right">ACTION</Th>
      </div>
      {ready && rows.map((e, i) => (
        <div key={e.userId} className="dc-row" style={TR(COLS, i === rows.length - 1)}>
          <div style={{ minWidth: 0 }}>
            <div style={{ ...cellName, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{e.name}</div>
            <div style={cellSub}>{e.employeeId || '—'}</div>
          </div>
          <div style={{ fontVariantNumeric: 'tabular-nums', color: e.panLast4 ? 'var(--ink-2)' : 'var(--ink-3)' }}>{e.panLast4 ? `•••• ${e.panLast4}` : 'Not set'}</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', minWidth: 0 }}>
            {e.documents.length === 0 && <span style={{ color: 'var(--ink-3)', fontSize: 13 }}>Not uploaded</span>}
            {e.documents.map((d) => (
              <span key={d.id} style={chip}>
                <button onClick={() => void open(d)} disabled={busy === d.id} title={`Open ${d.fileName}`} style={chipLink}>
                  <IconFile size={14} />
                  <span style={{ whiteSpace: 'nowrap' }}>{PART_LABEL[d.part]}</span>
                  <span style={cellSub}>{sizeLabel(d.size)} · {dateLabel(d.uploadedAt)}</span>
                </button>
                <button onClick={() => void remove(e, d)} disabled={busy === d.id} title="Remove" style={chipX}><IconX size={12} /></button>
              </span>
            ))}
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button
              onClick={() => { rowFor.current = e.userId; rowInput.current?.click(); }}
              disabled={busy === e.userId || batch !== null}
              className={btnClass()}
              style={btn('secondary', 'sm')}
            >
              {busy === e.userId ? 'Uploading…' : e.documents.length ? 'Replace' : 'Upload'}
            </button>
          </div>
        </div>
      ))}
      <ListPending state={list.state} onRetry={list.retry} cols={4} avatar={false} rows={4} />
      {ready && rows.length === 0 && (
        <EmptyRow text={employees.length === 0 ? `No employees to issue a Form 16 to for FY ${fy}.` : 'No employees match your filters.'} />
      )}
    </Card>
  );
}

const chip = {
  display: 'inline-flex', alignItems: 'center', gap: 2, border: '1px solid var(--line-2)', borderRadius: 999, padding: '2px 4px 2px 10px',
  background: 'var(--surface)', maxWidth: '100%',
};
const chipLink = {
  display: 'inline-flex', alignItems: 'center', gap: 6, background: 'none', border: 'none', padding: '2px 0', cursor: 'pointer',
  color: 'var(--accent-ink)', fontSize: 12.5, fontFamily: 'inherit', minWidth: 0,
};
const chipX = {
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 22, height: 22, borderRadius: 999, border: 'none',
  background: 'none', color: 'var(--ink-3)', cursor: 'pointer', padding: 0,
};
