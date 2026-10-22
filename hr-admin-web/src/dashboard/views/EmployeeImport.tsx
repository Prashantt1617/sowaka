// People › Import — update employee details from a sheet. Upload an Excel or
// CSV file in any layout: the header row and sheet are found, columns are
// matched by name (case, spacing and punctuation don't matter) and HR can
// change any match. Nothing is written until HR has seen the full list of what
// it does (every row of the file, new employees, every changed, added and
// removed value, cells and rows that can't be imported) and approved it.
// Only the columns in the file are touched; a bad cell skips only that cell.
// Dashboard admins only.
import { useEffect, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import * as XLSX from 'xlsx';
import { useStore } from '../store';
import { ApiError } from '../../services/http';
import { Card } from '../ui';
import { applyEmployeeImport, cancelEmployeeImport, getEmployeeImportTemplate, previewEmployeeImport, type EmployeeImportColumn, type EmployeeImportPreview, type EmployeeImportResult } from '../../services/hrms';

/** A cell as text: dates as YYYY-MM-DD (read in the sheet's own day), everything else as written. */
const cellText = (v: unknown): string => {
  if (v instanceof Date && !Number.isNaN(v.valueOf())) return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}`;
  return v === null || v === undefined ? '' : String(v).trim();
};
/** A header as compared: lower case, words only, brackets dropped — as the server compares it. */
const keyOf = (s: unknown) => String(s ?? '').toLowerCase().replace(/\([^)]*\)/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim();

/**
 * Finds the header: of every sheet's first 30 rows, the row naming the most
 * columns Import knows (first sheet wins a tie). The rows under it become
 * objects keyed by its cells, each with its row number in the sheet.
 */
function readWorkbook(wb: XLSX.WorkBook, names: string[]) {
  const known = (c: unknown) => { const k = keyOf(c); return k !== '' && names.some((n) => k === n || k.startsWith(`${n} `)); };
  let best = { score: 0, sheet: wb.SheetNames[0], at: 0, aoa: [] as unknown[][] };
  wb.SheetNames.forEach((n, si) => {
    const aoa = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[n], { header: 1, defval: '', raw: true, blankrows: true });
    if (si === 0 && best.aoa.length === 0) best.aoa = aoa;
    for (let i = 0; i < Math.min(aoa.length, 30); i++) {
      const score = aoa[i].filter(known).length;
      if (score > best.score) best = { score, sheet: n, at: i, aoa };
    }
  });
  const seen = new Map<string, number>();
  const header = (best.aoa[best.at] ?? []).map((c, j) => {
    const h = cellText(c) || `Column ${j + 1}`;
    const n = (seen.get(h) ?? 0) + 1; seen.set(h, n);
    return n > 1 ? `${h} (${n})` : h;
  });
  const rows = best.aoa.slice(best.at + 1)
    .map((r, i) => ({ __row: String(best.at + i + 2), ...Object.fromEntries(header.map((h, j) => [h, cellText(r[j])])) }))
    .filter((r) => Object.entries(r).some(([k, v]) => k !== '__row' && v !== ''));
  return { sheet: best.sheet, sheets: wb.SheetNames.length, headerRow: best.at + 1, rows };
}

export function EmployeeImport() {
  const s = useStore();
  const [fileName, setFileName] = useState('');
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<EmployeeImportPreview | null>(null);
  const [result, setResult] = useState<EmployeeImportResult | null>(null);
  const [rowFilter, setRowFilter] = useState<'all' | EmployeeImportPreview['rows'][number]['status']>('all');
  const [accepted, setAccepted] = useState<EmployeeImportColumn[]>([]);
  const [file, setFile] = useState<{ rows: Record<string, string>[]; sheet: string; sheets: number; headerRow: number } | null>(null);
  const [emptyRemoves, setEmptyRemoves] = useState(false);
  // HR's choices on the preview: single changes declined ("row:field"), and new people not to add.
  const [declined, setDeclined] = useState<Set<string>>(new Set());
  // What each column was first matched to, so ticking it back on restores that; and columns ticked on but not yet given a field.
  const [guess, setGuess] = useState<Record<string, string>>({});
  const [pending, setPending] = useState<Set<string>>(new Set());
  // Fixes typed or picked for skipped cells, by "row|column": written into the sheet's rows, then previewed again.
  const [fixes, setFixes] = useState<Record<string, string>>({});
  const [skipNew, setSkipNew] = useState<Set<number>>(new Set());
  const toggle = <T,>(set: Set<T>, v: T) => { const n = new Set(set); if (n.has(v)) n.delete(v); else n.add(v); return n; };

  useEffect(() => { getEmployeeImportTemplate().then((t) => setAccepted(t.accepted ?? [])).catch(() => undefined); }, []);

  const downloadTemplate = async () => {
    try {
      const t = await getEmployeeImportTemplate();
      const ws = XLSX.utils.aoa_to_sheet([t.headers, ...t.rows]);
      ws['!cols'] = t.headers.map(() => ({ wch: 20 }));
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Employees');
      XLSX.writeFile(wb, 'Employees - import template.xlsx');
    } catch (e) {
      s.flash(e instanceof ApiError ? e.message : 'Could not download the template', 'error');
    }
  };

  /** Asks the server what the file would do, with HR's column matching and empty-cell choice. */
  const runPreview = async (name: string, rows: Record<string, string>[], opts: { emptyRemoves: boolean; mapping?: Record<string, string> }, keepChoices = false) => {
    setBusy(true);
    try {
      if (preview) await cancelEmployeeImport(preview.importId).catch(() => undefined);
      const p = await previewEmployeeImport(name, rows, opts);
      setPreview(p);
      if (!keepChoices) { setDeclined(new Set()); setSkipNew(new Set()); }
      setPending(new Set()); setFixes({});
      if (!opts.mapping) setGuess(Object.fromEntries(p.fileColumns.map((c) => [c.key, c.field])));
    } catch (e) {
      s.flash(e instanceof ApiError ? e.message : `Could not read ${name}`, 'error');
    } finally {
      setBusy(false);
    }
  };

  const upload = async (f: File) => {
    setBusy(true); setPreview(null); setResult(null); setFileName(f.name); setRowFilter('all'); setFile(null);
    try {
      const names = accepted.length ? accepted.flatMap((c) => [keyOf(c.header), ...c.aliases]) : ['employee id', 'emp id', 'name', 'email', 'designation', 'department'];
      const read = readWorkbook(XLSX.read(await f.arrayBuffer(), { cellDates: true }), names);
      if (read.rows.length === 0) { s.flash(`${f.name} has no rows under its header`, 'error'); setBusy(false); return; }
      setFile(read);
      setBusy(false);
      await runPreview(f.name, read.rows, { emptyRemoves });
    } catch (e) {
      s.flash(e instanceof ApiError ? e.message : `Could not read ${f.name}`, 'error');
      setBusy(false);
    }
  };

  /** HR changed what a column is read as: preview again with every column's current match. */
  const rematch = (key: string, field: string) => {
    if (!preview || !file) return;
    setPending((x) => { const n = new Set(x); n.delete(key); return n; });
    const mapping = Object.fromEntries(preview.fileColumns.map((c) => [c.key, c.key === key ? field : c.field]));
    // A field can be read from one column only: the column that had it before lets it go.
    if (field) for (const c of preview.fileColumns) if (c.key !== key && c.field === field) mapping[c.key] = '';
    void runPreview(fileName, file.rows, { emptyRemoves, mapping });
  };
  /** Tick a column on (back to what it was matched to, or pick a field) or off (not used). */
  const toggleColumn = (key: string, on: boolean) => {
    if (!on) { rematch(key, ''); return; }
    if (guess[key]) rematch(key, guess[key]);
    else setPending((x) => new Set(x).add(key));
  };
  const applyFixes = () => {
    if (!preview || !file) return;
    const rows = file.rows.map((r) => {
      const out = { ...r };
      for (const [k, v] of Object.entries(fixes)) { const [row, column] = [k.slice(0, k.indexOf('|')), k.slice(k.indexOf('|') + 1)]; if (r.__row === row && v !== '') out[column] = v; }
      return out;
    });
    setFile({ ...file, rows });
    void runPreview(fileName, rows, { emptyRemoves, mapping: Object.fromEntries(preview.fileColumns.map((c) => [c.key, c.field])) }, true);
  };
  const toggleEmpty = (on: boolean) => {
    setEmptyRemoves(on);
    if (preview && file) void runPreview(fileName, file.rows, { emptyRemoves: on, mapping: Object.fromEntries(preview.fileColumns.map((c) => [c.key, c.field])) });
  };

  const approve = async () => {
    if (!preview) return;
    setBusy(true);
    try {
      const r = await applyEmployeeImport(preview.importId, {
        declined: [...declined].map((k) => { const [row, field] = k.split(':'); return { row: Number(row), field }; }),
        skipRows: [...skipNew],
      });
      setResult(r); setPreview(null); setFile(null);
      s.flash(`Imported: ${r.created} added, ${r.updated} updated`);
      void s.reload();
    } catch (e) {
      s.flash(e instanceof ApiError ? e.message : 'Could not import', 'error');
    } finally {
      setBusy(false);
    }
  };
  const cancel = async () => {
    if (preview) await cancelEmployeeImport(preview.importId).catch(() => undefined);
    setPreview(null); setFileName(''); setFile(null);
  };

  const counts = preview && {
    changed: preview.updates.reduce((t, u) => t + u.changes.filter((c) => c.kind === 'changed').length, 0),
    added: preview.updates.reduce((t, u) => t + u.changes.filter((c) => c.kind === 'added').length, 0),
    removed: preview.updates.reduce((t, u) => t + u.changes.filter((c) => c.kind === 'removed').length, 0),
  };
  const blocked = preview?.errors.some((e) => e.row === 0) ?? false;
  const addCount = preview ? preview.newEmployees.filter((n) => !skipNew.has(n.row)).length : 0;
  const updateCount = preview ? preview.updates.filter((u) => u.changes.some((c) => !declined.has(`${u.row}:${c.field}`))).length : 0;
  const declinedCount = declined.size + skipNew.size;
  const nothing = addCount + updateCount === 0;

  return (
    <div style={{ display: 'grid', gap: 16, maxWidth: 1100 }}>
      <Card style={{ padding: '18px 22px' }}>
        <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 280 }}>
            <div style={{ fontSize: 18, fontWeight: 800 }}>Import employee details</div>
            <div style={{ fontSize: 14, color: '#717171', marginTop: 4, lineHeight: 1.5 }}>
              Upload an Excel or CSV of employees. Nothing is saved until you approve.
            </div>
          </div>
          <button type="button" onClick={() => void downloadTemplate()} style={ghost}>Download current employees</button>
          <label style={{ ...primary, opacity: busy ? 0.6 : 1 }}>
            {busy ? 'Reading…' : 'Upload file'}
            <input type="file" accept=".xlsx,.xls,.csv" disabled={busy} style={{ display: 'none' }} onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void upload(f); }} />
          </label>
        </div>
      </Card>

      {preview && counts && (
        <>
          <Card style={{ padding: '16px 22px' }}>
            <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 10 }}>{fileName}: what this import will do</div>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <Chip tone="good" label="New employees" value={preview.newEmployees.length} />
              <Chip tone="info" label="People updated" value={preview.updates.length} />
              <Chip tone="info" label="Values changed" value={counts.changed} />
              <Chip tone="good" label="Values added" value={counts.added} />
              <Chip tone="bad" label="Values removed" value={counts.removed} />
              <Chip tone="quiet" label="Unchanged" value={preview.unchanged} />
              <Chip tone={preview.skippedCells.length ? 'warn' : 'quiet'} label="Cells skipped" value={preview.skippedCells.length} />
              <Chip tone={preview.errors.length ? 'bad' : 'quiet'} label="Rows not imported" value={preview.errors.length} />
            </div>
            <div style={{ fontSize: 13, color: '#717171', marginTop: 10, lineHeight: 1.5 }}>
              {file && <>Read sheet <strong>{file.sheet.trim()}</strong>{file.sheets > 1 ? ` (of ${file.sheets})` : ''}, header on row {file.headerRow}, {file.rows.length} rows. </>}
              Using {preview.fileColumns.filter((c) => c.field).length} of {preview.fileColumns.length} columns: choose which under Columns from your file. 
              {preview.accountLimit.max !== null && <>Accounts: {preview.accountLimit.used} of {preview.accountLimit.max} used, {preview.accountLimit.afterImport} after this import.</>}
            </div>
            {preview.notes.length > 0 && <div style={{ fontSize: 13, color: '#9A6200', marginTop: 8 }}>{preview.notes.join(' ')}</div>}
            <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13.5, marginTop: 10, color: '#484848' }}>
              <input type="checkbox" checked={emptyRemoves} disabled={busy} onChange={(e) => toggleEmpty(e.target.checked)} />
              Empty cells remove the current value (off: empty cells leave it as it is; templates, salary and bank details are never removed by an import)
            </label>
            <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
              <button type="button" disabled={busy || blocked || nothing} onClick={() => void approve()} style={{ ...primary, opacity: busy || blocked || nothing ? 0.5 : 1 }}>
                {busy ? 'Importing…' : `Approve and import${nothing ? '' : ` (${addCount} new, ${updateCount} updated)`}`}
              </button>
              <button type="button" onClick={() => void cancel()} disabled={busy} style={ghost}>Cancel</button>
              {declinedCount > 0 && <span style={{ alignSelf: 'center', fontSize: 13, fontWeight: 700, color: '#717171' }}>{declinedCount} declined · <button type="button" onClick={() => { setDeclined(new Set()); setSkipNew(new Set()); }} style={{ ...linkBtn }}>undo all</button></span>}
              {(preview.errors.length > 0 || preview.skippedCells.length > 0) && !blocked && <span style={{ alignSelf: 'center', fontSize: 13, color: '#A8475F' }}>Everything that's right is imported; the cells and rows listed below are left as they are. Fix them in the file and upload again to include them.</span>}
            </div>
          </Card>

          <Section title={`Columns from your file: ${preview.fileColumns.filter((c) => c.field).length} used, ${preview.fileColumns.filter((c) => !c.field).length} not used`}>
            <div style={{ padding: '10px 18px 0', fontSize: 13, color: '#717171' }}>Tick the columns to use and pick what each one fills. To use a different column for something, pick it there: the column that had it is switched off. The preview updates as you go.</div>
            <div style={{ overflowX: 'auto' }}>
              <table style={table}><thead><tr><th style={{ ...th, width: 60 }}>Use</th><th style={th}>Column in your file</th><th style={th}>First value</th><th style={th}>Fills</th></tr></thead>
                <tbody>{preview.fileColumns.map((c) => {
                  const on = !!c.field || pending.has(c.key);
                  return (
                    <tr key={c.key} style={{ background: on ? undefined : '#FAFAFB' }}>
                      <td style={td}><input type="checkbox" checked={on} disabled={busy} onChange={(e) => toggleColumn(c.key, e.target.checked)} style={{ width: 17, height: 17, cursor: 'pointer' }} /></td>
                      <td style={{ ...td, fontWeight: 600, color: on ? undefined : '#9197A2' }}>{c.header}</td>
                      <td style={{ ...td, color: '#9197A2', maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.sample || '—'}</td>
                      <td style={td}>
                        {on ? (
                          <select value={c.field} disabled={busy} onChange={(e) => rematch(c.key, e.target.value)} style={{ padding: '6px 8px', borderRadius: 8, border: `1px solid ${c.field ? '#B9D7EE' : '#E8B84A'}`, background: c.field ? '#F3F8FD' : '#FFF8E8', fontFamily: 'inherit', fontSize: 13.5, minWidth: 200 }}>
                            <option value="">{c.field ? 'Not used' : 'Pick what it fills…'}</option>
                            {preview.fieldChoices.map((a) => {
                              const other = preview.fileColumns.find((o) => o.field === a.field && o.key !== c.key);
                              return <option key={a.field} value={a.field}>{a.label}{other ? ` (now from ${other.header})` : ''}</option>;
                            })}
                          </select>
                        ) : <span style={{ fontSize: 13, color: '#9197A2' }}>Not used</span>}
                      </td>
                    </tr>
                  );
                })}</tbody></table>
            </div>
          </Section>

          {preview.errors.length > 0 && (
            <Section title={`Rows not imported (${preview.errors.length})`}>
              <table style={table}><thead><tr><th style={th}>Row</th><th style={th}>Problem</th></tr></thead>
                <tbody>{preview.errors.map((e, i) => <tr key={i}><td style={{ ...td, width: 70 }}>{e.row || '—'}</td><td style={{ ...td, color: '#A8475F' }}>{e.message}</td></tr>)}</tbody></table>
            </Section>
          )}

          {preview.newEmployees.length > 0 && (
            <Section title={`New employees (${preview.newEmployees.length})`}>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ ...table, minWidth: 900 }}><thead><tr><th style={th}></th><th style={th}>Row</th>{preview.columns.map((c) => <th key={c.field} style={th}>{c.label}</th>)}</tr></thead>
                  <tbody>{preview.newEmployees.map((n) => {
                    const off = skipNew.has(n.row);
                    return (
                      <tr key={n.row} style={{ opacity: off ? 0.5 : 1 }}>
                        <td style={td}><button type="button" onClick={() => setSkipNew((x) => toggle(x, n.row))} style={off ? undoBtn : declineBtn}>{off ? 'Add back' : "Don't add"}</button></td>
                        <td style={td}>{n.row}</td>
                        {preview.columns.map((c) => <td key={c.field} style={{ ...td, textDecoration: off ? 'line-through' : undefined }}>{n.values[c.label] || '—'}</td>)}
                      </tr>
                    );
                  })}</tbody></table>
              </div>
            </Section>
          )}

          {preview.updates.length > 0 && (
            <Section title={`Changes to existing employees (${preview.updates.length} people)`}>
              <div style={{ padding: '10px 18px 0', fontSize: 13, color: '#717171' }}>Don't want one of these? Press <strong>Decline</strong> on that line; the rest is still imported.</div>
              <table style={table}><thead><tr><th style={th}>Employee</th><th style={th}>Field</th><th style={th}>Now</th><th style={th}>After import</th><th style={th}></th><th style={th}></th></tr></thead>
                <tbody>{preview.updates.flatMap((u) => {
                  const allOff = u.changes.every((c) => declined.has(`${u.row}:${c.field}`));
                  return u.changes.map((c, i) => {
                    const key = `${u.row}:${c.field}`;
                    const off = declined.has(key);
                    return (
                      <tr key={`${u.userId}-${c.field}`} style={{ background: off ? '#FAFAFB' : undefined }}>
                        <td style={td}>{i === 0 ? <>
                          <strong>{u.name}</strong>{u.employeeId && <span style={{ color: '#717171' }}> · {u.employeeId}</span>}<div style={{ fontSize: 12, color: '#9197A2' }}>row {u.row}</div>
                          {u.changes.length > 1 && <button type="button" onClick={() => setDeclined((x) => { const n = new Set(x); for (const ch of u.changes) { const k2 = `${u.row}:${ch.field}`; if (allOff) n.delete(k2); else n.add(k2); } return n; })} style={{ ...linkBtn, fontSize: 12, marginTop: 4 }}>{allOff ? 'Accept all for this person' : 'Decline all for this person'}</button>}
                        </> : ''}</td>
                        <td style={{ ...td, color: off ? '#9197A2' : undefined }}>{c.label}</td>
                        <td style={{ ...td, color: c.kind === 'removed' ? '#A8475F' : '#717171', textDecoration: c.kind === 'removed' && !off ? 'line-through' : undefined }}>{c.from || '—'}</td>
                        <td style={{ ...td, fontWeight: 600, color: off ? '#9197A2' : undefined, textDecoration: off ? 'line-through' : undefined }}>{c.to || '—'}</td>
                        <td style={td}>{off ? <span style={{ background: '#F4F4F6', color: '#717171', borderRadius: 6, padding: '2px 8px', fontSize: 12, fontWeight: 700 }}>Declined: stays as now</span> : <Tag kind={c.kind} />}</td>
                        <td style={{ ...td, textAlign: 'right' }}><button type="button" onClick={() => setDeclined((x) => toggle(x, key))} style={off ? undoBtn : declineBtn}>{off ? 'Accept' : 'Decline'}</button></td>
                      </tr>
                    );
                  });
                })}</tbody></table>
            </Section>
          )}

          {preview.skippedCells.length > 0 && (
            <Section title={`Cells to fix (${preview.skippedCells.length}): the rest of these rows is still imported`}>
              <div style={{ display: 'flex', gap: 12, alignItems: 'center', padding: '10px 18px', flexWrap: 'wrap', borderBottom: '1px solid #F4F4F6' }}>
                <span style={{ fontSize: 13, color: '#717171', flex: 1, minWidth: 260 }}>Fix a cell here: pick the right person, date or value. Cells you leave alone keep what the employee has now.</span>
                <button type="button" disabled={busy || Object.values(fixes).every((v) => !v)} onClick={applyFixes} style={{ ...primary, padding: '7px 14px', fontSize: 13.5, opacity: busy || Object.values(fixes).every((v) => !v) ? 0.5 : 1 }}>
                  {busy ? 'Updating…' : `Use ${Object.values(fixes).filter(Boolean).length || ''} fix${Object.values(fixes).filter(Boolean).length === 1 ? '' : 'es'} and update the preview`}
                </button>
              </div>
              <div style={{ overflowX: 'auto' }}>
              <table style={table}><thead><tr><th style={th}>Row</th><th style={th}>Employee</th><th style={th}>Column</th><th style={th}>In the file</th><th style={th}>Problem</th><th style={th}>Fix</th></tr></thead>
                <tbody>{preview.skippedCells.map((c, i) => {
                  const key = `${c.row}|${c.column}`;
                  return (
                    <tr key={i} style={{ background: fixes[key] ? '#F3FAF2' : undefined }}>
                      <td style={{ ...td, width: 50 }}>{c.row}</td><td style={td}>{c.name}</td><td style={td}>{c.label}</td>
                      <td style={td}>{c.value || '(empty)'}</td><td style={{ ...td, color: '#9A6200' }}>{c.message}</td>
                      <td style={{ ...td, minWidth: 240 }}>{c.column ? <FixInput cell={c} lists={preview.pickLists} value={fixes[key] ?? ''} onChange={(v) => setFixes((f) => ({ ...f, [key]: v }))} /> : '—'}</td>
                    </tr>
                  );
                })}</tbody></table>
              </div>
            </Section>
          )}

          <Section title={`Every row in the file (${preview.rows.length})`}>
            <div style={{ display: 'flex', gap: 8, padding: '12px 18px 4px', flexWrap: 'wrap' }}>
              {(['all', 'new', 'updated', 'unchanged', 'not imported'] as const).map((f) => {
                const n = f === 'all' ? preview.rows.length : preview.rows.filter((r) => r.status === f).length;
                return <button key={f} type="button" onClick={() => setRowFilter(f)} style={{ ...ghost, padding: '5px 12px', fontSize: 13, background: rowFilter === f ? '#E7F1FB' : '#fff', color: rowFilter === f ? '#0571A6' : '#484848', borderColor: rowFilter === f ? '#B9D7EE' : '#EBEBEB' }}>{f === 'all' ? 'All' : STATUS[f][2]} {n}</button>;
              })}
            </div>
            <table style={table}><thead><tr><th style={th}>Row</th><th style={th}>Employee</th><th style={th}>Employee ID</th><th style={th}>What happens</th><th style={th}>Details</th></tr></thead>
              <tbody>{preview.rows.filter((r) => rowFilter === 'all' || r.status === rowFilter).map((r) => (
                <tr key={r.row}><td style={{ ...td, width: 60 }}>{r.row}</td><td style={td}>{r.name || '—'}</td><td style={td}>{r.employeeId || '—'}</td><td style={td}><Status status={r.status} /></td><td style={{ ...td, color: r.status === 'not imported' ? '#A8475F' : '#717171' }}>{r.detail || '—'}</td></tr>
              ))}</tbody></table>
          </Section>
        </>
      )}

      {result && (
        <Card style={{ padding: '16px 22px' }}>
          <div style={{ fontSize: 15, fontWeight: 700 }}>Import done: {result.created} added, {result.updated} updated</div>
          {result.failed.length > 0 && (
            <table style={{ ...table, marginTop: 10 }}><thead><tr><th style={th}>Row</th><th style={th}>Not saved</th></tr></thead>
              <tbody>{result.failed.map((f, i) => <tr key={i}><td style={td}>{f.row}</td><td style={{ ...td, color: '#A8475F' }}>{f.message}</td></tr>)}</tbody></table>
          )}
        </Card>
      )}
    </div>
  );
}

/** The editor for one skipped cell: a person or template list, a date, a fixed choice, or text. */
function FixInput({ cell, lists, value, onChange }: { cell: EmployeeImportPreview['skippedCells'][number]; lists: EmployeeImportPreview['pickLists']; value: string; onChange: (v: string) => void }) {
  const box: CSSProperties = { padding: '6px 8px', borderRadius: 8, border: `1px solid ${value ? '#9FCB9A' : '#EBEBEB'}`, fontFamily: 'inherit', fontSize: 13.5, width: '100%', maxWidth: 300, background: '#fff' };
  const choices: Record<string, string[]> = {
    employeeType: ['Full-time', 'Contract', 'Intern'], isDirector: ['Yes', 'No'], gender: ['Male', 'Female', 'Other'],
    payMode: ['Bank transfer', 'Cheque', 'Cash'], accountType: ['Savings', 'Current'],
  };
  if (cell.field === 'manager' && lists.manager) {
    const suggested = lists.manager.filter((p) => cell.suggested?.includes(p.value));
    return (
      <select value={value} onChange={(e) => onChange(e.target.value)} style={box}>
        <option value="">Leave as it is</option>
        {suggested.length > 0 && <optgroup label={`Matches for "${cell.value}"`}>{suggested.map((p) => <option key={`s-${p.value}`} value={p.value}>{p.label}</option>)}</optgroup>}
        <optgroup label="Everyone">{lists.manager.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}</optgroup>
      </select>
    );
  }
  const list = lists[cell.field as keyof typeof lists];
  if (list) return <select value={value} onChange={(e) => onChange(e.target.value)} style={box}><option value="">Leave as it is</option>{list.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}</select>;
  if (choices[cell.field]) return <select value={value} onChange={(e) => onChange(e.target.value)} style={box}><option value="">Leave as it is</option>{choices[cell.field].map((t) => <option key={t} value={t}>{t}</option>)}</select>;
  if (cell.field === 'birthday' || cell.field === 'joiningDate') return <input type="date" value={value} onChange={(e) => onChange(e.target.value)} style={box} />;
  return <input value={value} onChange={(e) => onChange(e.target.value)} placeholder="Type the right value" style={box} />;
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card>
      <div style={{ padding: '14px 18px', borderBottom: '1px solid #EBEBEB', fontSize: 15.5, fontWeight: 800 }}>{title}</div>
      {children}
    </Card>
  );
}
function Chip({ label, value, tone }: { label: string; value: number; tone: 'good' | 'bad' | 'info' | 'quiet' | 'warn' }) {
  const c = { good: ['#E5F4E4', '#2F6B33'], bad: ['#FBEBEB', '#A8475F'], info: ['#E7F1FB', '#0571A6'], quiet: ['#F4F4F6', '#717171'], warn: ['#FFF4DE', '#9A6200'] }[tone];
  return <span style={{ background: c[0], color: c[1], borderRadius: 10, padding: '7px 12px', fontSize: 13.5, fontWeight: 700 }}>{label} <span style={{ fontSize: 15 }}>{value}</span></span>;
}
function Tag({ kind }: { kind: 'changed' | 'added' | 'removed' }) {
  const c = { changed: ['#E7F1FB', '#0571A6', 'Changed'], added: ['#E5F4E4', '#2F6B33', 'Added'], removed: ['#FBEBEB', '#A8475F', 'Removed'] }[kind];
  return <span style={{ background: c[0], color: c[1], borderRadius: 6, padding: '2px 8px', fontSize: 12, fontWeight: 700 }}>{c[2]}</span>;
}

const STATUS = { new: ['#E5F4E4', '#2F6B33', 'New'], updated: ['#E7F1FB', '#0571A6', 'Updated'], unchanged: ['#F4F4F6', '#717171', 'No change'], 'not imported': ['#FBEBEB', '#A8475F', 'Not imported'] } as const;
function Status({ status }: { status: keyof typeof STATUS }) {
  const c = STATUS[status];
  return <span style={{ background: c[0], color: c[1], borderRadius: 6, padding: '2px 8px', fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap' }}>{c[2]}</span>;
}

const declineBtn: CSSProperties = { background: '#fff', color: '#A8475F', border: '1px solid #F0C9C4', padding: '4px 10px', borderRadius: 8, fontSize: 12.5, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' };
const undoBtn: CSSProperties = { ...declineBtn, color: '#0571A6', border: '1px solid #B9D7EE' };
const linkBtn: CSSProperties = { background: 'none', border: 'none', padding: 0, color: '#0571A6', fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', fontSize: 13 };

const primary: CSSProperties = { display: 'inline-flex', alignItems: 'center', background: '#0571A6', color: '#fff', border: 'none', padding: '9px 16px', borderRadius: 10, fontSize: 14.5, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' };
const ghost: CSSProperties = { background: '#fff', color: '#484848', border: '1px solid #EBEBEB', padding: '9px 15px', borderRadius: 10, fontSize: 14.5, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' };
const table: CSSProperties = { width: '100%', borderCollapse: 'collapse', fontSize: 14 };
const th: CSSProperties = { textAlign: 'left', fontSize: 12, textTransform: 'uppercase', letterSpacing: '.03em', color: '#717171', fontWeight: 700, padding: '10px 14px', borderBottom: '1px solid #EBEBEB', background: '#FBFBFC', whiteSpace: 'nowrap' };
const td: CSSProperties = { padding: '9px 14px', borderBottom: '1px solid #F4F4F6', verticalAlign: 'top' };
