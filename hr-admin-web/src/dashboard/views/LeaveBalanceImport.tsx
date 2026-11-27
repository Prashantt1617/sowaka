// Time office › Leave balances › Import from Excel. HR uploads a sheet of each
// person's latest AVAILABLE days per leave type (any layout: the sheet and the
// header row are found, columns matched by name, every match can be changed).
// Before anything is saved the preview compares Sowaka with the file, person
// by person and type by type: available now, the file's figure, the difference
// (or "Same"); who the file names that isn't here; cells that can't be used;
// and who is here but not in the file. Only the differences are applied, once
// HR has said they checked them. Taken days never change: the total becomes
// the file's available + what is taken.
import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { WorkBook } from 'xlsx';
import { useStore } from '../store';
import { ApiError } from '../../services/http';
import { applyLeaveImport, cancelLeaveImport, previewLeaveImport } from '../../services/hrms';
import type { LeaveBalancesDTO, LeaveImportLine, LeaveImportPreview, LeaveImportResult } from '../../services/hrms';
import { Card, EmptyRow, Pill, SearchInput, Th } from '../ui';
import { btn, btnClass, cellName, cellSub, TH, toolbar, TR } from '../ds';
import { IconDownload } from '../icons';
import { LabeledSelect } from './LabeledSelect';
import { StatTile } from './leaveParts';
import { Pager, usePaged } from './Pager';
import { keyOf, readWorkbook } from './sheetRead';

const days = (n: number) => String(Math.round(n * 100) / 100);
const signed = (n: number) => (n > 0 ? `+${days(n)}` : n < 0 ? `−${days(-n)}` : '0');
/** The headers that say who a row is, as the server reads them. */
const WHO = ['employee id', 'emp id', 'emp code', 'employee code', 'employee no', 'employee number', 'emp no', 'staff id', 'work email', 'email', 'email id', 'official email', 'official email id', 'office email', 'company email', 'mail id'];

type Show = 'diff' | 'all' | 'same' | 'unmatched' | 'errors' | 'missing';
type Line = LeaveImportLine & { same: boolean };

function Difference({ n }: { n: number }) {
  if (n === 0) return <Pill label="Same" tone={{ bg: 'var(--mute-bg)', fg: 'var(--ink-2)' }} />;
  return <Pill label={signed(n)} tone={n > 0 ? { bg: 'var(--ok-bg)', fg: 'var(--ok)' } : { bg: 'var(--bad-bg)', fg: 'var(--bad)' }} />;
}

export function LeaveBalanceImport({ balances, onApplied }: { balances: LeaveBalancesDTO; onApplied: () => void }) {
  const s = useStore();
  const [busy, setBusy] = useState(false);
  const [fileName, setFileName] = useState('');
  const [book, setBook] = useState<WorkBook | null>(null);
  const [file, setFile] = useState<{ rows: Record<string, string>[]; sheet: string; sheetNames: string[]; headerRow: number } | null>(null);
  // The file's figures are always each person's current balance (available now); never totals for the year.
  const mode = 'available' as 'available' | 'total';
  const [preview, setPreview] = useState<LeaveImportPreview | null>(null);
  const [result, setResult] = useState<LeaveImportResult | null>(null);
  const [declined, setDeclined] = useState<Set<string>>(new Set());
  const [checked, setChecked] = useState(false);
  const [show, setShow] = useState<Show>('diff');
  const [search, setSearch] = useState('');

  // The spreadsheet library is large and only the import pages read files with it: fetch it while HR picks one.
  useEffect(() => { import('xlsx').catch(() => undefined); }, []);
  const names = useMemo(() => [...WHO, ...balances.types.flatMap((t) => [keyOf(t.name), keyOf(t.key.replace(/_/g, ' '))])], [balances.types]);

  /** Today's balances in the import's own columns: edit the figures and upload it back. */
  const downloadCurrent = async () => {
    try {
      const XLSX = await import('xlsx');
      const types = balances.types.filter((t) => t.editable);
      const headers = ['Employee ID', 'Name', 'Work Email', 'Department', ...types.map((t) => t.name)];
      const rows = balances.people
        .slice().sort((a, b) => (a.employeeId || '~').localeCompare(b.employeeId || '~', undefined, { numeric: true }))
        .map((p) => [p.employeeId, p.name, p.email, p.department, ...types.map((t) => { const c = p.types.find((x) => x.key === t.key); return c?.editable ? c.remaining : ''; })]);
      const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
      ws['!cols'] = headers.map((h, i) => ({ wch: i === 1 || i === 2 ? 28 : Math.max(14, h.length + 2) }));
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, `Available ${balances.year}`);
      XLSX.writeFile(wb, `Leave balances ${balances.year} - available now.xlsx`);
    } catch {
      s.flash('Could not make the sheet', 'error');
    }
  };

  /** Asks the server what the file would do, with HR's column matching and what the figures are. */
  const runPreview = async (name: string, rows: Record<string, string>[], opts: { mapping?: Record<string, string>; mode: 'available' | 'total' }) => {
    setBusy(true);
    try {
      if (preview) await cancelLeaveImport(preview.importId).catch(() => undefined);
      const p = await previewLeaveImport(name, rows, opts);
      setPreview(p);
      setDeclined(new Set());
      setChecked(false);
      setShow(p.changes.length ? 'diff' : 'all');
    } catch (e) {
      s.flash(e instanceof ApiError ? e.message : `Could not read ${name}`, 'error');
    } finally {
      setBusy(false);
    }
  };

  const read = async (wb: WorkBook, name: string, sheet?: string) => {
    const XLSX = await import('xlsx');
    const got = readWorkbook(XLSX, wb, names, sheet);
    if (got.rows.length === 0) { s.flash(`${sheet ?? name} has no rows under its header`, 'error'); return; }
    setFile({ rows: got.rows, sheet: got.sheet, sheetNames: wb.SheetNames, headerRow: got.headerRow });
    await runPreview(name, got.rows, { mode });
  };

  const upload = async (f: File) => {
    setBusy(true); setPreview(null); setResult(null); setFileName(f.name); setFile(null); setBook(null);
    try {
      const XLSX = await import('xlsx');
      const wb = XLSX.read(await f.arrayBuffer(), { cellDates: true });
      setBook(wb);
      setBusy(false);
      await read(wb, f.name);
    } catch (e) {
      s.flash(e instanceof ApiError ? e.message : `Could not read ${f.name}`, 'error');
      setBusy(false);
    }
  };

  const mappingNow = () => (preview ? Object.fromEntries(preview.fileColumns.map((c) => [c.key, c.field])) : undefined);
  /** HR changed what a column is read as: preview again with every column's current match. */
  const rematch = (key: string, field: string) => {
    if (!preview || !file) return;
    const mapping = mappingNow()!;
    mapping[key] = field;
    // A field is read from one column only: the column that had it lets it go.
    if (field) for (const c of preview.fileColumns) if (c.key !== key && c.field === field) mapping[c.key] = '';
    void runPreview(fileName, file.rows, { mapping, mode });
  };

  const lines = useMemo<Line[]>(() => preview ? [...preview.changes.map((l) => ({ ...l, same: false })), ...preview.same.map((l) => ({ ...l, same: true }))].sort((a, b) => a.row - b.row || a.typeName.localeCompare(b.typeName)) : [], [preview]);
  const q = search.trim().toLowerCase();
  const fits = (name: string, code: string) => !q || name.toLowerCase().includes(q) || code.toLowerCase().includes(q);
  const shownLines = lines.filter((l) => (show === 'diff' ? !l.same : show === 'same' ? l.same : true) && fits(l.name, l.employeeId));
  const cellErrors = (preview?.errors ?? []).filter((e) => e.row > 0 && fits(e.name, e.employeeId));
  const fileErrors = (preview?.errors ?? []).filter((e) => e.row === 0);
  const unmatched = (preview?.unmatched ?? []).filter((u) => fits('', u.value));
  const missing = (preview?.notInFile ?? []).filter((p) => fits(p.name, p.employeeId));
  const pagedLines = usePaged(shownLines, `${preview?.importId}|${show}|${q}`);
  const pagedMissing = usePaged(missing, `${preview?.importId}|${q}`);
  const toApply = preview ? preview.changes.filter((c) => !declined.has(`${c.row}:${c.type}`)) : [];
  const peopleChanging = new Set(preview?.changes.map((c) => c.userId)).size;
  const blocked = fileErrors.length > 0;

  /** The preview as a workbook, to look through offline: the comparison, then what was left out. */
  const downloadPreview = async () => {
    if (!preview) return;
    try {
      const XLSX = await import('xlsx');
      const wb = XLSX.utils.book_new();
      const cmp = [['Row', 'Employee', 'Employee ID', 'Department', 'Leave type', 'Taken', 'Sowaka available now', 'File available', 'Difference', 'Total now', 'Total after', 'Result', 'Note'],
        ...lines.map((l) => [l.row, l.name, l.employeeId, l.department, l.typeName, l.taken, l.availableNow, l.availableNew, l.same ? 'Same' : signed(l.difference), l.totalNow, l.totalNew,
          l.same ? 'Same: no change' : declined.has(`${l.row}:${l.type}`) ? 'Declined: stays as now' : 'Will change', l.note ?? ''])];
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(cmp), 'Sowaka vs file');
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Row', 'In the file', 'Why'], ...preview.unmatched.map((u) => [u.row, u.value, u.message])]), 'Not matched');
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Row', 'Employee', 'Employee ID', 'Column', 'In the file', 'Problem'], ...preview.errors.map((e) => [e.row || '', e.name, e.employeeId, e.column, e.value, e.message])]), 'Not imported');
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Employee', 'Employee ID', 'Department'], ...preview.notInFile.map((p) => [p.name, p.employeeId, p.department])]), 'Not in the file');
      XLSX.writeFile(wb, `Leave import preview - ${fileName.replace(/\.[^.]+$/, '')}.xlsx`);
    } catch {
      s.flash('Could not make the sheet', 'error');
    }
  };

  const approve = async () => {
    if (!preview) return;
    setBusy(true);
    try {
      const r = await applyLeaveImport(preview.importId, [...declined].map((k) => { const i = k.indexOf(':'); return { row: Number(k.slice(0, i)), type: k.slice(i + 1) }; }));
      setResult(r); setPreview(null); setFile(null); setBook(null);
      s.flash(`Leave balances updated: ${r.values} ${r.values === 1 ? 'figure' : 'figures'} for ${r.people} ${r.people === 1 ? 'person' : 'people'}`);
      onApplied();
    } catch (e) {
      s.flash(e instanceof ApiError ? e.message : 'Could not apply the import', 'error');
    } finally {
      setBusy(false);
    }
  };
  const cancel = async () => {
    if (preview) await cancelLeaveImport(preview.importId).catch(() => undefined);
    setPreview(null); setFile(null); setBook(null); setFileName('');
  };
  const toggle = (k: string) => setDeclined((x) => { const n = new Set(x); if (n.has(k)) n.delete(k); else n.add(k); return n; });

  const LINE_COLS = 'minmax(200px,1.5fr) minmax(120px,1fr) .6fr .9fr .9fr .8fr 110px';
  const MAP_COLS = '56px minmax(180px,1.4fr) minmax(120px,1fr) minmax(200px,1.2fr)';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <Card padded>
        <section style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 14 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1, minWidth: 260 }}>
              <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>Import leave balances · {balances.year}</h2>
              <span style={{ fontSize: 12.5, color: 'var(--ink-3)', lineHeight: 1.5 }}>
                Upload an Excel or CSV with each person’s latest available days per leave type. Rows match by Employee ID, else work email; columns by their header.
                You see every difference from Sowaka before anything is saved, and taken days never change.
              </span>
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button type="button" onClick={() => void downloadCurrent()} className={btnClass()} style={btn()}><IconDownload stroke="currentColor" /> Download current balances</button>
              <label className={btnClass('primary')} style={{ ...btn('primary'), opacity: busy ? 0.6 : 1, cursor: busy ? 'default' : 'pointer' }}>
                {busy ? 'Reading…' : 'Upload file'}
                <input type="file" accept=".xlsx,.xls,.csv" disabled={busy} style={{ display: 'none' }} onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void upload(f); }} />
              </label>
            </div>
          </div>
          {file && (
            <div className="ar-filters compact" style={{ alignItems: 'center' }}>
              {file.sheetNames.length > 1 && book && (
                <LabeledSelect label="Sheet" value={file.sheet} onChange={(v) => void read(book, fileName, v)} options={file.sheetNames.map((n): [string, string] => [n, n.trim()])} />
              )}
              <span style={{ fontSize: 12.5, color: 'var(--ink-2)' }}>The file's figures are each person's <b>current balance</b> (days available now).</span>
              <span style={{ fontSize: 12.5, color: 'var(--ink-3)' }}>{fileName} · header on row {file.headerRow} · {file.rows.length} rows</span>
            </div>
          )}
        </section>
      </Card>

      {preview && (
        <Card padded>
          <section aria-labelledby="lb-compare" style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <h2 id="lb-compare" style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>Sowaka and {fileName}: the differences</h2>
              <span style={{ fontSize: 12.5, color: 'var(--ink-3)' }}>
                {mode === 'available' ? 'Available days in Sowaka now against the file’s; ' : 'Totals in Sowaka now against the file’s; '}
                only the lines that differ are applied. Nothing has been saved yet.
              </span>
            </div>

            {fileErrors.map((e, i) => <div key={i} role="alert" style={{ padding: '10px 14px', borderRadius: 12, background: 'var(--bad-bg)', color: 'var(--bad)', fontSize: 13.5 }}>{e.message}</div>)}

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 12 }}>
              <StatTile state="ready" label="Differences" value={preview.changes.length} sub={`${peopleChanging} ${peopleChanging === 1 ? 'person' : 'people'}`} onPick={() => setShow('diff')} picked={show === 'diff'} color="var(--p-blue)" />
              <StatTile state="ready" label="Same" value={preview.same.length} sub="Already what Sowaka has" onPick={() => setShow('same')} picked={show === 'same'} color="var(--p-green)" />
              <StatTile state="ready" label="Not matched" value={preview.unmatched.length} sub="Rows that are nobody here" onPick={() => setShow('unmatched')} picked={show === 'unmatched'} color="var(--p-yellow)" attn={preview.unmatched.length > 0 && show !== 'unmatched'} />
              <StatTile state="ready" label="Errors" value={preview.errors.filter((e) => e.row > 0).length} sub="Cells and rows not used" onPick={() => setShow('errors')} picked={show === 'errors'} color="var(--p-red)" />
              <StatTile state="ready" label="Not in the file" value={preview.notInFile.length} sub="In Sowaka, stay as they are" onPick={() => setShow('missing')} picked={show === 'missing'} />
            </div>

            <div style={{ ...toolbar, marginBottom: 0 }}>
              <div style={{ flex: 1, minWidth: 240, display: 'flex' }}>
                <SearchInput value={search} onChange={setSearch} placeholder="Search employee or ID…" width="100%" />
              </div>
              {(show === 'diff' || show === 'all' || show === 'same') && (
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 13.5, color: 'var(--ink-2)', cursor: 'pointer' }}>
                  <input type="checkbox" checked={show === 'diff'} onChange={(e) => setShow(e.target.checked ? 'diff' : 'all')} style={{ width: 16, height: 16 }} />
                  Only differences
                </label>
              )}
              <button type="button" onClick={() => void downloadPreview()} className={btnClass()} style={btn()}><IconDownload stroke="currentColor" /> Download this preview</button>
            </div>

            {(show === 'diff' || show === 'all' || show === 'same') && (
              <div style={{ overflowX: 'auto' }}>
                <div style={{ minWidth: 900 }}>
                  <div style={TH(LINE_COLS)}>
                    <Th>EMPLOYEE</Th><Th>LEAVE TYPE</Th><Th>TAKEN</Th><Th>{mode === 'available' ? 'SOWAKA AVAILABLE' : 'SOWAKA TOTAL'}</Th><Th>{mode === 'available' ? 'FILE AVAILABLE' : 'FILE TOTAL'}</Th><Th>DIFFERENCE</Th><Th align="right"> </Th>
                  </div>
                  {pagedLines.rows.map((l, i) => {
                    const k = `${l.row}:${l.type}`;
                    const off = declined.has(k);
                    return (
                      <div key={k} className="dc-row" style={{ ...TR(LINE_COLS, i === pagedLines.rows.length - 1), opacity: off ? 0.55 : 1 }}>
                        <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
                          <span style={{ ...cellName, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{l.name}</span>
                          <span style={{ ...cellSub, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{[l.employeeId, `row ${l.row}`].filter(Boolean).join(' · ')}</span>
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                          <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{l.typeName}</span>
                          {l.note && <span style={{ ...cellSub, color: 'var(--warn)' }}>{l.note}</span>}
                        </div>
                        <div style={{ fontVariantNumeric: 'tabular-nums', color: 'var(--ink-2)' }}>{days(l.taken)}</div>
                        <div style={{ fontVariantNumeric: 'tabular-nums' }}>{days(mode === 'available' ? l.availableNow : l.totalNow)}<span style={{ ...cellSub, display: 'block' }}>{mode === 'available' ? `of ${days(l.totalNow)}` : `${days(l.availableNow)} available`}</span></div>
                        <div style={{ fontVariantNumeric: 'tabular-nums', fontWeight: l.same ? 400 : 600, textDecoration: off ? 'line-through' : undefined }}>{days(mode === 'available' ? l.availableNew : l.totalNew)}<span style={{ ...cellSub, display: 'block', fontWeight: 400 }}>{mode === 'available' ? `of ${days(l.totalNew)}` : `${days(l.availableNew)} available`}</span></div>
                        <div>{off ? <Pill label="Declined" tone={{ bg: 'var(--mute-bg)', fg: 'var(--ink-3)' }} /> : <Difference n={l.same ? 0 : l.difference} />}</div>
                        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                          {!l.same && <button type="button" onClick={() => toggle(k)} className={btnClass()} style={{ ...btn(), height: 30, padding: '0 12px', fontSize: 12.5, color: off ? 'var(--accent-ink)' : 'var(--bad)' }}>{off ? 'Accept' : 'Decline'}</button>}
                        </div>
                      </div>
                    );
                  })}
                  {shownLines.length === 0 && <EmptyRow text={show === 'diff' ? (lines.length ? 'No differences: the file says what Sowaka already has.' : 'No leave figures read from this file.') : 'Nothing to show.'} />}
                </div>
                <Pager p={pagedLines} />
              </div>
            )}

            {show === 'unmatched' && (
              <SimpleTable cols="80px minmax(140px,1fr) minmax(240px,2fr)" head={['ROW', 'IN THE FILE', 'WHY']} empty="Every row matched someone."
                rows={unmatched.map((u) => [String(u.row), u.value || '—', <span key="m" style={{ color: 'var(--warn)' }}>{u.message}</span>])} />
            )}
            {show === 'errors' && (
              <SimpleTable cols="70px minmax(180px,1.3fr) minmax(120px,.9fr) minmax(90px,.6fr) minmax(220px,1.8fr)" head={['ROW', 'EMPLOYEE', 'COLUMN', 'IN THE FILE', 'PROBLEM']} empty="Every figure could be used."
                rows={cellErrors.map((e) => [String(e.row), <span key="n" style={cellName}>{e.name || '—'}{e.employeeId && <span style={{ ...cellSub, display: 'block' }}>{e.employeeId}</span>}</span>, e.column || 'Whole row', e.value || '—', <span key="m" style={{ color: 'var(--bad)' }}>{e.message}</span>])} />
            )}
            {show === 'missing' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <span style={{ fontSize: 12.5, color: 'var(--ink-3)' }}>Active employees the file doesn’t mention. Their balances stay as they are.</span>
                <SimpleTable cols="minmax(200px,1.5fr) minmax(120px,1fr) minmax(140px,1fr)" head={['EMPLOYEE', 'EMPLOYEE ID', 'DEPARTMENT']} empty="The file names everyone."
                  rows={pagedMissing.rows.map((p) => [<span key="n" style={cellName}>{p.name}</span>, p.employeeId || '—', p.department || '—'])} />
                <Pager p={pagedMissing} />
              </div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, paddingTop: 4, borderTop: '1px solid var(--line)' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13.5, color: 'var(--ink)', paddingTop: 14, cursor: toApply.length ? 'pointer' : 'default' }}>
                <input type="checkbox" checked={checked} disabled={busy || blocked || toApply.length === 0} onChange={(e) => setChecked(e.target.checked)} style={{ width: 17, height: 17 }} />
                I have checked the differences above{declined.size ? ` (${declined.size} declined)` : ''}
              </label>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                <button type="button" disabled={busy || blocked || !checked || toApply.length === 0} onClick={() => void approve()} className={btnClass('primary')} style={btn('primary')}>
                  {busy ? 'Applying…' : toApply.length ? `Apply ${toApply.length} ${toApply.length === 1 ? 'difference' : 'differences'}` : 'Nothing to apply'}
                </button>
                <button type="button" onClick={() => void cancel()} disabled={busy} className={btnClass()} style={btn()}>Cancel</button>
                {declined.size > 0 && <button type="button" onClick={() => setDeclined(new Set())} className={btnClass('ghost')} style={btn('ghost')}>Undo declines</button>}
                <span style={{ fontSize: 12.5, color: 'var(--ink-3)' }}>Lines marked Same, rows not matched and errors are left as they are.</span>
              </div>
            </div>
          </section>
        </Card>
      )}

      {preview && (
        <Card padded>
          <section style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <h3 style={{ margin: 0, fontSize: 14.5, fontWeight: 600 }}>Columns from your file: {preview.fileColumns.filter((c) => c.field).length} used, {preview.fileColumns.filter((c) => !c.field).length} not used</h3>
            <span style={{ fontSize: 12.5, color: 'var(--ink-3)' }}>Pick what each column is read as. A leave type or the Employee ID is read from one column only: picking it elsewhere switches the other off. The comparison updates as you go.</span>
            <div style={{ overflowX: 'auto' }}>
              <div style={{ minWidth: 640 }}>
                <div style={TH(MAP_COLS)}><Th>USE</Th><Th>COLUMN IN YOUR FILE</Th><Th>FIRST VALUE</Th><Th>READ AS</Th></div>
                {preview.fileColumns.map((c, i) => (
                  <div key={c.key} style={{ ...TR(MAP_COLS, i === preview.fileColumns.length - 1), background: c.field ? undefined : 'var(--surface-2)' }}>
                    <div><input type="checkbox" checked={!!c.field} disabled={busy || !c.field} onChange={() => rematch(c.key, '')} aria-label={`Stop using ${c.header}`} style={{ width: 16, height: 16 }} /></div>
                    <div style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: c.field ? 'var(--ink)' : 'var(--ink-3)' }}>{c.header}</div>
                    <div style={{ ...cellSub, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.sample || '—'}</div>
                    <div>
                      <select value={c.field} disabled={busy} onChange={(e) => rematch(c.key, e.target.value)}
                        style={{ height: 34, padding: '0 10px', borderRadius: 999, border: '1px solid var(--line-2)', background: 'var(--surface)', color: 'var(--ink)', fontFamily: 'inherit', fontSize: 12.5, minWidth: 200 }}>
                        <option value="">Not used</option>
                        {preview.fieldChoices.map((a) => {
                          const other = preview.fileColumns.find((o) => o.field === a.field && o.key !== c.key);
                          return <option key={a.field} value={a.field}>{a.label}{other ? ` (now from ${other.header})` : ''}</option>;
                        })}
                      </select>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </section>
        </Card>
      )}

      {result && (
        <Card padded>
          <section style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>Done: {result.values} {result.values === 1 ? 'figure' : 'figures'} changed for {result.people} {result.people === 1 ? 'person' : 'people'}</h2>
            <span style={{ fontSize: 12.5, color: 'var(--ink-3)' }}>Each change is on the person’s Activity, made by import. Their app shows the new balance now.{result.unchanged ? ` ${result.unchanged} already matched by the time it was applied.` : ''}</span>
            {result.failed.length > 0 && (
              <SimpleTable cols="70px minmax(180px,1fr) minmax(260px,2fr)" head={['ROW', 'EMPLOYEE', 'NOT SAVED']} empty=""
                rows={result.failed.map((f) => [String(f.row), f.name || '—', <span key="m" style={{ color: 'var(--bad)' }}>{f.message}</span>])} />
            )}
          </section>
        </Card>
      )}
    </div>
  );
}

/** A plain list in the Time office table look. */
function SimpleTable({ cols, head, rows, empty }: { cols: string; head: string[]; rows: ReactNode[][]; empty: string }) {
  return (
    <div style={{ overflowX: 'auto' }}>
      <div style={{ minWidth: 600 }}>
        <div style={TH(cols)}>{head.map((h) => <Th key={h}>{h}</Th>)}</div>
        {rows.map((r, i) => <div key={i} style={TR(cols, i === rows.length - 1)}>{r.map((c, j) => <div key={j} style={{ minWidth: 0 }}>{c}</div>)}</div>)}
        {rows.length === 0 && empty && <EmptyRow text={empty} />}
      </div>
    </div>
  );
}
