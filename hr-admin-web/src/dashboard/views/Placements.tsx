// Placements — for a company that is a placement agency: its placements, its
// clients (the companies hiring) and its candidates (`customers` in the API and
// the code; the app and this page call them candidates). Recruiters
// add them from the app's Actions tab; HR reads, edits, deletes and exports
// them here. Only a company with features.placements sees the section, and
// the server refuses everyone else.
//
// Each tab is laid out as Claims › Reimbursement requests: summary cards, the
// status tabs, a filter row, a table of rows that open a drawer. The forms are
// the side sheet Reimbursement Types opens, and Export Excel is the Employees
// list's.
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import type { CSSProperties, ReactNode } from 'react';
import { useStore } from '../store';
import { FSTAT, STAT } from '../theme';
import type { Pill as PillTone } from '../theme';
import { Avatar, Card, CountLine, DateRange, EmptyRow, ListPending, LoadingFigure, PageActions, Pill, SearchInput, SelectBox, StatusTabs, SummaryCard, Tag, Th } from '../ui';
import type { LoadState } from '../ui';
import { btn, btnClass, cellName, cellSub, eyebrow, fieldLabel, hint, iconBtn, inp, textareaStyle, TH, toolbar, TR } from '../ds';
import { IconDownload, IconPlus } from '../icons';
import { IconEdit, IconTrash } from './peopleTable';
import { CloseButton, DrawerShell, InfoGrid, RemarkBlock } from '../drawers/shell';
import {
  PLACEMENT_STATUSES,
  createPlacement, createPlacementClient, createPlacementCustomer,
  deletePlacement, deletePlacementClient, deletePlacementCustomer,
  getPlacementsSummary, listPlacementClients, listPlacementCustomers, listPlacements, restorePlacementCustomer,
  updatePlacement, updatePlacementClient, updatePlacementCustomer,
  type CandidateStage, type ClientInput, type CustomerInput, type Placement, type PlacementClient, type PlacementCustomer,
  type PlacementDesignation, type PlacementFilters, type PlacementInput, type PlacementStatus, type PlacementsSummary,
} from '../../services/placements';

// ── shared ────────────────────────────────────────────────────────────────

// The app's words for each status; the API keeps its own values.
const STATUS_LABEL: Record<PlacementStatus, string> = {
  shortlisted: 'Profile shared',
  interviewing: 'Interview scheduled',
  offered: 'Selected',
  joined: 'Joined',
  dropped: 'Rejected / dropped',
};
// The dashboard's solid pills: grey not started, yellow in progress, blue offered, green joined, red dropped.
const STATUS_TONE: Record<PlacementStatus, PillTone> = {
  shortlisted: FSTAT.Draft,
  interviewing: STAT.Pending,
  offered: STAT.Paid,
  joined: STAT.Approved,
  dropped: STAT.Declined,
};

/** Where a candidate stands across their placements, as the app says it. */
const STAGE_LABEL: Record<CandidateStage, string> = { not_placed: 'Not placed', in_process: 'In process', joined: 'Joined' };
const STAGE_TONE: Record<CandidateStage, PillTone> = { not_placed: FSTAT.Draft, in_process: STAT.Pending, joined: STAT.Approved };
const REMOVED_TONE = STAT.Declined;
/** A client's onboarding fee: green once received, yellow until then. */
const feePill = (c: PlacementClient) => <Pill label={c.feePaid ? 'Fee paid' : 'Fee pending'} tone={c.feePaid ? STAT.Approved : STAT.Pending} />;

const rupees = (n: number | null) => (n === null ? '—' : `₹${n.toLocaleString('en-IN')}`);
/** 29 Oct 2026, from a YYYY-MM-DD day or an ISO time. */
const fmtDay = (value: string | null | undefined) => {
  if (!value) return '—';
  const date = value.length === 10 ? new Date(`${value}T00:00:00`) : new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  // The year only when it is not this one, as the request lists date things.
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', ...(sameYear ? {} : { year: 'numeric' }) });
};
const message = (e: unknown) => (e instanceof Error ? e.message : 'Something went wrong. Try again.');

/** Search and the shared filters, the search sent a moment after typing stops. */
function useFilters<T extends Record<string, string>>(initial: T) {
  const [filters, setFilters] = useState(initial);
  const [q, setQ] = useState('');
  const [sentQ, setSentQ] = useState('');
  useEffect(() => {
    const t = window.setTimeout(() => setSentQ(q.trim()), 250);
    return () => window.clearTimeout(t);
  }, [q]);
  const set = (key: keyof T) => (value: string) => setFilters((f) => ({ ...f, [key]: value }));
  return { filters, set, q, setQ, query: { ...filters, q: sentQ } as PlacementFilters };
}

/** A list from the server for these filters: loading, error with Retry, then the rows. */
function useList<T>(load: (filters: PlacementFilters) => Promise<T[]>, query: PlacementFilters, enabled = true) {
  const [rows, setRows] = useState<T[]>([]);
  const [state, setState] = useState<LoadState>('loading');
  const [attempt, setAttempt] = useState(0);
  const key = JSON.stringify(query);
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    setState((s) => (s === 'ready' ? s : 'loading'));
    load(JSON.parse(key) as PlacementFilters)
      .then((r) => { if (live) { setRows(r); setState('ready'); } })
      .catch(() => { if (live) setState('error'); });
    return () => { live = false; };
  }, [key, attempt, load, enabled]);
  return { rows, state, reload: () => setAttempt((n) => n + 1) };
}

/** Everyone who added something on the rows seen so far, for the Added by filter. */
function useCreators(rows: { createdByUserId: string; createdByName: string }[]) {
  const [seen, setSeen] = useState<Record<string, string>>({});
  useEffect(() => {
    const fresh = rows.filter((r) => r.createdByUserId && !(r.createdByUserId in seen));
    if (fresh.length) setSeen((s) => ({ ...s, ...Object.fromEntries(fresh.map((r) => [r.createdByUserId, r.createdByName || 'Former employee'])) }));
  }, [rows, seen]);
  return Object.entries(seen).sort((a, b) => a[1].localeCompare(b[1]));
}

/** The rows on screen as an Excel sheet, as Employees exports. */
async function exportSheet(name: string, rows: Record<string, string | number>[], widths: number[]) {
  // The spreadsheet library is large; it is fetched the first time someone exports.
  const XLSX = await import('xlsx');
  const ws = XLSX.utils.json_to_sheet(rows);
  ws['!cols'] = widths.map((wch) => ({ wch }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, name);
  XLSX.writeFile(wb, `${name.toLowerCase()}-${new Date().toISOString().slice(0, 10)}.xlsx`);
}

function Filters({ q, onQ, placeholder, creators, createdBy, onCreatedBy, from, to, onFrom, onTo, children, trailing }: {
  q: string; onQ: (v: string) => void; placeholder: string;
  creators: [string, string][]; createdBy: string; onCreatedBy: (v: string) => void;
  from: string; to: string; onFrom: (v: string) => void; onTo: (v: string) => void;
  /** Filters of the page's own, before the shared ones. */
  children?: ReactNode;
  /** At the row's end: the count. */
  trailing?: ReactNode;
}) {
  return (
    <div style={toolbar}>
      <div style={{ flex: 1, minWidth: 262, display: 'flex' }}>
        <SearchInput value={q} onChange={onQ} placeholder={placeholder} width="100%" />
      </div>
      {children}
      <SelectBox value={createdBy} onChange={onCreatedBy}>
        <option value="all">Added by anyone</option>
        {creators.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
      </SelectBox>
      <DateRange from={from} to={to} onFrom={onFrom} onTo={onTo} />
      {trailing}
    </div>
  );
}

function RowActions({ onEdit, onDelete }: { onEdit: () => void; onDelete: () => void }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 7 }} onClick={(e) => e.stopPropagation()}>
      <button className="ds-icon-btn" style={iconBtn(34)} title="Edit" onClick={onEdit}><IconEdit /></button>
      <button className="ds-icon-btn" style={{ ...iconBtn(34), color: 'var(--bad)' }} title="Delete" onClick={onDelete}><IconTrash /></button>
    </div>
  );
}

/**
 * A drawer over the whole page. On the page itself the view fades in with a
 * transform, which would trap a fixed layer inside it (as Reports › Attendance
 * found), so it goes to the body.
 */
function Sheet({ width, onClose, children }: { width?: number; onClose: () => void; children: ReactNode }) {
  return createPortal(<DrawerShell width={width} onClose={onClose}>{children}</DrawerShell>, document.body);
}

/** The drawer's head: who or what it is, as the request drawers draw a person. */
function SheetHead({ title, subtitle, onClose, avatar = true }: { title: string; subtitle?: ReactNode; onClose: () => void; avatar?: boolean }) {
  return (
    <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
      {avatar && <Avatar name={title} size={42} font={15} />}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 16, fontWeight: 600, lineHeight: 1.5, color: 'var(--ink)' }}>{title}</div>
        {subtitle && <div style={{ fontSize: 11.5, color: 'var(--ink-3)', fontWeight: 400, lineHeight: 1.5 }}>{subtitle}</div>}
      </div>
      <CloseButton onClose={onClose} />
    </div>
  );
}

function SheetFoot({ children }: { children: ReactNode }) {
  return (
    <div style={{ position: 'sticky', bottom: 0, marginTop: 'auto', background: 'var(--surface)', borderTop: '1px solid var(--line)', padding: '16px 20px', display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
      {children}
    </div>
  );
}

/** Add or Edit, in the side sheet the dashboard opens its forms in. */
function FormSheet({ title, error, saving, onClose, onSave, children }: {
  title: string; error: string; saving: boolean; onClose: () => void; onSave: () => void; children: ReactNode;
}) {
  return (
    <Sheet onClose={onClose}>
      <SheetHead title={title} onClose={onClose} avatar={false} />
      <div style={{ padding: 20, flex: 1 }}>
        {children}
        {error && <div style={errorTag}>{error}</div>}
      </div>
      <SheetFoot>
        <button onClick={onClose} className={btnClass()} style={btn()}>Cancel</button>
        <button onClick={onSave} disabled={saving} className={btnClass('primary')} style={btn('primary')}>{saving ? 'Saving…' : 'Save'}</button>
      </SheetFoot>
    </Sheet>
  );
}

function Field({ label, required, children, note }: { label: string; required?: boolean; children: ReactNode; note?: string }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <label style={{ ...fieldLabel, display: 'block', marginBottom: 6 }}>
        {label}{required && <span style={{ color: 'var(--bad)', marginLeft: 2 }}>*</span>}
      </label>
      {children}
      {note && <div style={{ ...hint, marginTop: 6 }}>{note}</div>}
    </div>
  );
}

function TextInput({ value, onChange, placeholder, type = 'text', autoFocus }: { value: string; onChange: (v: string) => void; placeholder?: string; type?: string; autoFocus?: boolean }) {
  return <input type={type} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="ds-inp" style={inp} autoFocus={autoFocus} />;
}

function RupeeInput({ value, onChange, placeholder, step = '1000' }: { value: string; onChange: (v: string) => void; placeholder?: string; step?: string }) {
  return (
    <div className="ds-inp" style={unitBox}>
      <span style={{ padding: '0 12px', color: 'var(--ink-3)', borderRight: '1px solid var(--line)', fontSize: 13, alignSelf: 'stretch', display: 'flex', alignItems: 'center' }}>₹</span>
      <input type="number" min="0" step={step} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} style={unitInput} />
    </div>
  );
}

const numberOrNull = (v: string) => (v.trim() === '' ? null : Number(v));

// ── Placements ────────────────────────────────────────────────────────────

const P_COLS = '1.6fr 1.2fr 1.25fr 0.75fr 0.75fr 0.9fr 1fr 1.4fr 0.8fr';

export function Placements() {
  const { flash } = useStore();
  const f = useFilters({ status: 'all', clientId: 'all', createdBy: 'all', from: '', to: '' });
  const list = useList(listPlacements, f.query);
  const creators = useCreators(list.rows);
  const [summary, setSummary] = useState<PlacementsSummary | null>(null);
  const [summaryState, setSummaryState] = useState<LoadState>('loading');
  const [clients, setClients] = useState<PlacementClient[]>([]);
  const [customers, setCustomers] = useState<PlacementCustomer[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [editing, setEditing] = useState<Placement | 'new' | null>(null);

  const loadSide = () => {
    getPlacementsSummary().then((s) => { setSummary(s); setSummaryState('ready'); }).catch(() => setSummaryState('error'));
    listPlacementClients().then(setClients).catch(() => undefined);
    listPlacementCustomers().then(setCustomers).catch(() => undefined);
  };
  useEffect(loadSide, []);
  const refresh = () => { list.reload(); loadSide(); };

  const open = openId ? list.rows.find((p) => p.id === openId) ?? null : null;
  const by = summary?.placements.byStatus;

  const remove = async (p: Placement) => {
    if (!window.confirm(`Delete the placement of ${p.customerName} at ${p.clientName}?`)) return;
    try {
      await deletePlacement(p.id);
      setOpenId(null);
      refresh();
      flash('Placement deleted');
    } catch (e) { flash(message(e), 'error'); }
  };

  const exportRows = () => exportSheet('Placements', list.rows.map((p) => ({
    Candidate: p.customerName,
    Client: p.clientName,
    Position: p.position,
    Status: STATUS_LABEL[p.status],
    'Interview date': p.interviewDate ?? '',
    'Joining date': p.joiningDate ?? '',
    'CTC (₹)': p.ctcRupees ?? '',
    'Fee (₹)': p.feeRupees ?? '',
    'Added by': p.createdByName,
    'Added on': p.createdAt.slice(0, 10),
    Notes: p.notes,
  })), [24, 24, 22, 13, 14, 14, 12, 12, 20, 12, 40]);

  return (
    <div style={{ animation: 'fade .3s ease both' }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5,1fr)', gap: 16, marginBottom: 20 }}>
        {PLACEMENT_STATUSES.map((s) => (
          <SummaryCard
            key={s}
            label={STATUS_LABEL[s]}
            value={<LoadingFigure state={summaryState}>{by?.[s] ?? 0}</LoadingFigure>}
            onClick={() => f.set('status')(f.filters.status === s ? 'all' : s)}
            active={f.filters.status === s}
          />
        ))}
      </div>

      <PageActions>
        <button onClick={() => void exportRows()} disabled={list.rows.length === 0} className={btnClass()} style={btn()}>
          <IconDownload stroke="currentColor" /> Export Excel
        </button>
        <button onClick={() => setEditing('new')} className={btnClass('primary')} style={btn('primary')}>
          <IconPlus size={15} stroke="currentColor" /> Add placement
        </button>
      </PageActions>

      <Card padded>
        <div style={{ ...toolbar, justifyContent: 'space-between' }}>
          <StatusTabs<PlacementStatus | 'all'>
            options={['all', ...PLACEMENT_STATUSES]}
            active={f.filters.status as PlacementStatus | 'all'}
            onSelect={f.set('status')}
            labels={STATUS_LABEL}
            counts={by ? { all: summary?.placements.total, ...by } : undefined}
          />
          {list.state === 'ready' && <CountLine shown={list.rows.length} noun={list.rows.length === 1 ? 'placement' : 'placements'} />}
        </div>
        <Filters
          q={f.q} onQ={f.setQ} placeholder="Search position, client or candidate…"
          creators={creators} createdBy={f.filters.createdBy} onCreatedBy={f.set('createdBy')}
          from={f.filters.from} to={f.filters.to} onFrom={f.set('from')} onTo={f.set('to')}
        >
          <SelectBox value={f.filters.clientId} onChange={f.set('clientId')}>
            <option value="all">All clients</option>
            {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </SelectBox>
        </Filters>

        <div style={TH(P_COLS)}>
          <Th>CANDIDATE</Th>
          <Th>CLIENT</Th>
          <Th>POSITION</Th>
          <Th>INTERVIEW</Th>
          <Th>JOINING</Th>
          <Th align="right">CTC</Th>
          <Th>ADDED BY</Th>
          <Th>STATUS</Th>
          <Th align="right">ACTION</Th>
        </div>
        {list.state === 'ready' && list.rows.map((p, i) => (
          <div key={p.id} className="dc-row" onClick={() => setOpenId(p.id)} style={{ ...TR(P_COLS, i === list.rows.length - 1), position: 'relative', cursor: 'pointer' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
              <Avatar name={p.customerName || '?'} />
              <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
                <div style={{ ...cellName, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.customerName || 'Deleted candidate'}</div>
                <div style={cellSub}>Added {fmtDay(p.createdAt)}</div>
              </div>
            </div>
            <div style={ellipsis}>{p.clientName || 'Deleted client'}</div>
            <div style={ellipsis}>{p.position}</div>
            <div style={ellipsis}>{fmtDay(p.interviewDate)}</div>
            <div style={ellipsis}>{fmtDay(p.joiningDate)}</div>
            <div style={{ textAlign: 'right', fontWeight: 500, fontVariantNumeric: 'tabular-nums' }}>{rupees(p.ctcRupees)}</div>
            <div style={ellipsis}>{p.createdByName || '—'}</div>
            <div><Pill label={STATUS_LABEL[p.status]} tone={STATUS_TONE[p.status]} /></div>
            <RowActions onEdit={() => setEditing(p)} onDelete={() => void remove(p)} />
          </div>
        ))}
        <ListPending state={list.state} onRetry={list.reload} cols={7} />
        {list.state === 'ready' && list.rows.length === 0 && (
          <EmptyRow text={summary?.placements.total === 0 ? 'No placements yet. Add one here, or from the app’s Actions tab.' : 'No placements match your filters.'} />
        )}
      </Card>

      {open && (
        <PlacementDrawer
          p={open}
          onClose={() => setOpenId(null)}
          onEdit={() => setEditing(open)}
          onDelete={() => void remove(open)}
          onStatus={async (status) => {
            try {
              await updatePlacement(open.id, { status });
              refresh();
              flash(`Moved to ${STATUS_LABEL[status]}`);
            } catch (e) { flash(message(e), 'error'); }
          }}
        />
      )}
      {editing && (
        <PlacementForm
          initial={editing === 'new' ? null : editing}
          clients={clients}
          customers={customers}
          onClose={() => setEditing(null)}
          onSaved={(text) => { setEditing(null); refresh(); flash(text); }}
        />
      )}
    </div>
  );
}

function PlacementDrawer({ p, onClose, onEdit, onDelete, onStatus }: {
  p: Placement; onClose: () => void; onEdit: () => void; onDelete: () => void; onStatus: (s: PlacementStatus) => void;
}) {
  const { emps } = useStore();
  const nameOf = (userId: string) => emps.find((e) => e.id === userId)?.name ?? (userId === p.createdByUserId ? p.createdByName : 'Former employee');
  return (
    <Sheet width={620} onClose={onClose}>
      <SheetHead title={p.customerName || 'Deleted candidate'} subtitle={`${p.position} · ${p.clientName || 'Deleted client'}`} onClose={onClose} />
      <div style={{ padding: 20 }}>
        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: 18 }}>
          <div>
            <div style={{ fontSize: 11.5, color: 'var(--ink-3)', fontWeight: 400, marginBottom: 3 }}>Annual CTC offered</div>
            <div style={{ fontSize: 30, fontWeight: 400, letterSpacing: '-.03em', lineHeight: 1.15 }}>{rupees(p.ctcRupees)}</div>
          </div>
          <Pill label={STATUS_LABEL[p.status]} tone={STATUS_TONE[p.status]} />
        </div>
        <div style={{ marginBottom: 18 }}>
          <div style={{ ...eyebrow, marginBottom: 8 }}>MOVE TO</div>
          <StatusTabs<PlacementStatus> options={[...PLACEMENT_STATUSES]} active={p.status} onSelect={(s) => { if (s !== p.status) onStatus(s); }} labels={STATUS_LABEL} />
        </div>
        <InfoGrid
          cells={[
            { label: 'CLIENT', value: p.clientName || '—' },
            { label: 'POSITION', value: p.position },
            { label: 'INTERVIEW DATE', value: fmtDay(p.interviewDate) },
            { label: 'JOINING DATE', value: fmtDay(p.joiningDate) },
            { label: 'OUR FEE', value: rupees(p.feeRupees) },
            { label: 'ADDED BY', value: `${p.createdByName || '—'} · ${fmtDay(p.createdAt)}` },
          ]}
        />
        <RemarkBlock label="NOTES" text={p.notes || 'No notes.'} filled={!!p.notes} marginBottom={18} />
        <div style={{ ...eyebrow, marginBottom: 8 }}>STATUS HISTORY</div>
        <div style={{ border: '1px solid var(--line)', borderRadius: 16, overflow: 'hidden' }}>
          {[...p.history].reverse().map((h, i) => (
            <div key={`${h.at}-${i}`} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', borderTop: i ? '1px solid var(--line)' : undefined }}>
              <Pill label={STATUS_LABEL[h.status]} tone={STATUS_TONE[h.status]} />
              <span style={{ flex: 1, fontSize: 13, color: 'var(--ink-2)' }}>{nameOf(h.byUserId)}</span>
              <span style={{ fontSize: 12.5, color: 'var(--ink-3)', fontVariantNumeric: 'tabular-nums' }}>{new Date(h.at).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}</span>
            </div>
          ))}
        </div>
      </div>
      <SheetFoot>
        <button onClick={onDelete} className={btnClass('no')} style={btn('no')}>Delete</button>
        <button onClick={onEdit} className={btnClass('primary')} style={btn('primary')}><IconEdit /> Edit</button>
      </SheetFoot>
    </Sheet>
  );
}

function PlacementForm({ initial, clients, customers, onClose, onSaved }: {
  initial: Placement | null; clients: PlacementClient[]; customers: PlacementCustomer[]; onClose: () => void; onSaved: (text: string) => void;
}) {
  const [customerId, setCustomerId] = useState(initial?.customerId ?? '');
  const [clientId, setClientId] = useState(initial?.clientId ?? '');
  const [position, setPosition] = useState(initial?.position ?? '');
  const [status, setStatus] = useState<PlacementStatus>(initial?.status ?? 'shortlisted');
  const [interviewDate, setInterviewDate] = useState(initial?.interviewDate ?? '');
  const [joiningDate, setJoiningDate] = useState(initial?.joiningDate ?? '');
  const [ctc, setCtc] = useState(initial?.ctcRupees != null ? String(initial.ctcRupees) : '');
  const [fee, setFee] = useState(initial?.feeRupees != null ? String(initial.feeRupees) : '');
  const [notes, setNotes] = useState(initial?.notes ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // A candidate removed from the app can't be put forward; one already on this placement stays pickable.
  const pickable = customers.filter((c) => !c.removedAt || c.id === initial?.customerId);

  const save = async () => {
    if (!customerId) { setError('Pick the candidate being placed'); return; }
    if (!clientId) { setError('Pick the client'); return; }
    if (!position.trim()) { setError('Give the position'); return; }
    setSaving(true); setError('');
    const input: PlacementInput = {
      customerId, clientId, position: position.trim(), status,
      interviewDate: interviewDate || null, joiningDate: joiningDate || null,
      ctcRupees: numberOrNull(ctc), feeRupees: numberOrNull(fee), notes: notes.trim(),
    };
    try {
      if (initial) {
        // The candidate and client only when they change: the server checks them again then, and refuses a removed candidate.
        const { customerId: cu, clientId: cl, ...rest } = input;
        await updatePlacement(initial.id, {
          ...rest,
          ...(cu !== initial.customerId ? { customerId: cu } : {}),
          ...(cl !== initial.clientId ? { clientId: cl } : {}),
        });
      } else await createPlacement(input);
      onSaved(initial ? 'Placement saved' : 'Placement added');
    } catch (e) { setError(message(e)); } finally { setSaving(false); }
  };

  return (
    <FormSheet title={initial ? 'Edit placement' : 'New placement'} error={error} saving={saving} onClose={onClose} onSave={() => void save()}>
      <Field label="Candidate" required note={pickable.length ? undefined : 'Add the candidate under Candidates first.'}>
        <select value={customerId} onChange={(e) => setCustomerId(e.target.value)} className="ds-inp" style={inp}>
          <option value="">Pick a candidate</option>
          {pickable.map((c) => <option key={c.id} value={c.id}>{c.name} · {c.phone}{c.removedAt ? ' (removed)' : ''}</option>)}
        </select>
      </Field>
      <Field label="Client" required note={clients.length ? undefined : 'Add the company under Clients first.'}>
        <select value={clientId} onChange={(e) => setClientId(e.target.value)} className="ds-inp" style={inp}>
          <option value="">Pick a client</option>
          {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </Field>
      <Field label="Position" required><TextInput value={position} onChange={setPosition} placeholder="e.g. Warehouse supervisor" /></Field>
      <Field label="Status">
        <select value={status} onChange={(e) => setStatus(e.target.value as PlacementStatus)} className="ds-inp" style={inp}>
          {PLACEMENT_STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
        </select>
      </Field>
      <div style={grid2}>
        <Field label="Interview date"><TextInput type="date" value={interviewDate} onChange={setInterviewDate} /></Field>
        <Field label="Joining date"><TextInput type="date" value={joiningDate} onChange={setJoiningDate} /></Field>
      </div>
      <div style={grid2}>
        <Field label="Annual CTC"><RupeeInput value={ctc} onChange={setCtc} /></Field>
        <Field label="Our fee"><RupeeInput value={fee} onChange={setFee} /></Field>
      </div>
      <Field label="Notes">
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} className="ds-inp" style={textareaStyle} placeholder="Rounds, feedback, anything to follow up" />
      </Field>
    </FormSheet>
  );
}

// ── Clients ───────────────────────────────────────────────────────────────

const C_COLS = '1.6fr 1.3fr 1.3fr 1fr 0.8fr 0.9fr 1fr 0.8fr';

const budgetText = (d: PlacementDesignation) => (d.budgetRupees === null ? 'Budget not given' : `${rupees(d.budgetRupees)} a ${d.budgetPeriod}`);
const feePaidOn = (c: PlacementClient) => (c.feePaid ? (c.feePaidAt ? fmtDay(c.feePaidAt) : 'Received') : 'Not yet');

export function PlacementClients() {
  const { flash } = useStore();
  const f = useFilters({ createdBy: 'all', from: '', to: '' });
  const list = useList(listPlacementClients, f.query);
  const creators = useCreators(list.rows);
  const [openId, setOpenId] = useState<string | null>(null);
  const [editing, setEditing] = useState<PlacementClient | 'new' | null>(null);
  const open = openId ? list.rows.find((c) => c.id === openId) ?? null : null;

  const remove = async (c: PlacementClient) => {
    if (!window.confirm(`Delete ${c.name}?`)) return;
    try {
      await deletePlacementClient(c.id);
      setOpenId(null);
      list.reload();
      flash(`${c.name} deleted`);
    } catch (e) { flash(message(e), 'error'); }
  };

  const exportRows = () => exportSheet('Clients', list.rows.map((c) => ({
    Client: c.name, 'Contact person': c.contactName, Phone: c.phone, Email: c.email, Industry: c.industry, Location: c.city,
    Roles: c.designations.map((d) => (d.budgetRupees === null ? d.title : `${d.title} (₹${d.budgetRupees.toLocaleString('en-IN')} a ${d.budgetPeriod})`)).join('; '),
    'Onboarding fee (₹)': c.feeRupees ?? '', 'Fee status': c.feePaid ? 'Paid' : 'Pending', 'Fee received on': c.feePaid && c.feePaidAt ? c.feePaidAt.slice(0, 10) : '',
    'UPI / transaction reference': c.feeReference,
    Placements: c.placements, 'Added by': c.createdByName, 'Added on': c.createdAt.slice(0, 10), Notes: c.notes,
  })), [26, 22, 16, 28, 18, 24, 40, 14, 11, 14, 24, 11, 20, 12, 40]);

  return (
    <div style={{ animation: 'fade .3s ease both' }}>
      <PageActions>
        <button onClick={() => void exportRows()} disabled={list.rows.length === 0} className={btnClass()} style={btn()}>
          <IconDownload stroke="currentColor" /> Export Excel
        </button>
        <button onClick={() => setEditing('new')} className={btnClass('primary')} style={btn('primary')}>
          <IconPlus size={15} stroke="currentColor" /> Add client
        </button>
      </PageActions>

      <Card padded>
        <Filters
          q={f.q} onQ={f.setQ} placeholder="Search client, contact or location…"
          creators={creators} createdBy={f.filters.createdBy} onCreatedBy={f.set('createdBy')}
          from={f.filters.from} to={f.filters.to} onFrom={f.set('from')} onTo={f.set('to')}
          trailing={list.state === 'ready' && <span style={{ marginLeft: 'auto' }}><CountLine shown={list.rows.length} noun={list.rows.length === 1 ? 'client' : 'clients'} /></span>}
        />
        <div style={TH(C_COLS)}>
          <Th>CLIENT</Th>
          <Th>CONTACT</Th>
          <Th>EMAIL</Th>
          <Th>LOCATION</Th>
          <Th align="right">PLACEMENTS</Th>
          <Th>FEE</Th>
          <Th>ADDED BY</Th>
          <Th align="right">ACTION</Th>
        </div>
        {list.state === 'ready' && list.rows.map((c, i) => (
          <div key={c.id} className="dc-row" onClick={() => setOpenId(c.id)} style={{ ...TR(C_COLS, i === list.rows.length - 1), position: 'relative', cursor: 'pointer' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
              <Avatar name={c.name} />
              <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
                <div style={{ ...cellName, ...ellipsis }}>{c.name}</div>
                <div style={{ ...cellSub, ...ellipsis }}>{c.industry || 'Industry not given'}</div>
              </div>
            </div>
            <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
              <div style={ellipsis}>{c.contactName || '—'}</div>
              {c.phone && <div style={cellSub}>{c.phone}</div>}
            </div>
            <div style={ellipsis}>{c.email || '—'}</div>
            <div style={ellipsis} title={c.city || undefined}>{c.city || '—'}</div>
            <div style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{c.placements}</div>
            <div>{feePill(c)}</div>
            <div style={ellipsis}>{c.createdByName || '—'}</div>
            <RowActions onEdit={() => setEditing(c)} onDelete={() => void remove(c)} />
          </div>
        ))}
        <ListPending state={list.state} onRetry={list.reload} cols={7} />
        {list.state === 'ready' && list.rows.length === 0 && <EmptyRow text={f.query.q || f.filters.createdBy !== 'all' || f.filters.from || f.filters.to ? 'No clients match your filters.' : 'No clients yet. Add the companies you hire for.'} />}
      </Card>

      {open && (
        <Sheet onClose={() => setOpenId(null)}>
          <SheetHead title={open.name} subtitle={[open.industry, open.city].filter(Boolean).join(' · ') || 'Client'} onClose={() => setOpenId(null)} />
          <div style={{ padding: 20 }}>
            <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: 18 }}>
              <div>
                <div style={{ fontSize: 11.5, color: 'var(--ink-3)', fontWeight: 400, marginBottom: 3 }}>Onboarding fee</div>
                <div style={{ fontSize: 30, fontWeight: 400, letterSpacing: '-.03em', lineHeight: 1.15 }}>{rupees(open.feeRupees)}</div>
              </div>
              {feePill(open)}
            </div>
            <InfoGrid
              cells={[
                { label: 'CONTACT PERSON', value: open.contactName || '—' },
                { label: 'PHONE', value: open.phone || '—' },
                { label: 'EMAIL', value: open.email || '—', wide: true },
                { label: 'INDUSTRY', value: open.industry || '—' },
                { label: 'LOCATION', value: open.city || '—' },
                { label: 'Fee received on', value: feePaidOn(open) },
                { label: 'UPI / transaction reference', value: open.feeReference || '—' },
                { label: 'ADDED BY', value: `${open.createdByName || '—'} · ${fmtDay(open.createdAt)}`, wide: true },
              ]}
            />
            {open.designations.length === 0 ? (
              <RemarkBlock label="ROLES" text="No roles added yet." filled={false} marginBottom={18} />
            ) : (
              <div style={{ marginBottom: 18 }}>
                <div style={{ ...eyebrow, marginBottom: 8 }}>ROLES · {open.designations.length}</div>
                <div style={{ border: '1px solid var(--line)', borderRadius: 16, overflow: 'hidden' }}>
                  {open.designations.map((d, i) => (
                    <div key={d.id} style={{ padding: '10px 14px', borderTop: i ? '1px solid var(--line)' : undefined }}>
                      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
                        <div style={{ flex: 1, minWidth: 0, fontSize: 13.5, fontWeight: 500, ...ellipsis }}>{d.title}</div>
                        <div style={{ fontSize: 12.5, color: d.budgetRupees === null ? 'var(--ink-3)' : 'var(--ink-2)', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{budgetText(d)}</div>
                      </div>
                      {d.description && <div style={{ ...cellSub, marginTop: 2, whiteSpace: 'pre-wrap' }}>{d.description}</div>}
                    </div>
                  ))}
                </div>
              </div>
            )}
            <RemarkBlock label="NOTES" text={open.notes || 'No notes.'} filled={!!open.notes} marginBottom={18} />
            <LinkedPlacements filter={{ clientId: open.id }} count={open.placements} show="customer" />
          </div>
          <SheetFoot>
            <button onClick={() => void remove(open)} className={btnClass('no')} style={btn('no')} disabled={open.placements > 0} title={open.placements > 0 ? 'On a placement: delete or move those first' : undefined}>Delete</button>
            <button onClick={() => setEditing(open)} className={btnClass('primary')} style={btn('primary')}><IconEdit /> Edit</button>
          </SheetFoot>
        </Sheet>
      )}
      {editing && <ClientForm initial={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={(text) => { setEditing(null); list.reload(); flash(text); }} />}
    </div>
  );
}

/** A role row as the form holds it, the budget as typed. A new row's id is the form's own; the server gives it a real one. */
type RoleDraft = { id: string; title: string; budget: string; budgetPeriod: 'month' | 'year'; description: string; isNew: boolean };
let draftSeq = 0;
const newRole = (): RoleDraft => ({ id: `new-${++draftSeq}`, title: '', budget: '', budgetPeriod: 'month', description: '', isNew: true });

function ClientForm({ initial, onClose, onSaved }: { initial: PlacementClient | null; onClose: () => void; onSaved: (text: string) => void }) {
  const [form, setForm] = useState({
    name: initial?.name ?? '', contactName: initial?.contactName ?? '', phone: initial?.phone ?? '', email: initial?.email ?? '',
    industry: initial?.industry ?? '', city: initial?.city ?? '', notes: initial?.notes ?? '',
    // The server charges 2,500 unless told otherwise; a new client shows it.
    fee: initial ? (initial.feeRupees != null ? String(initial.feeRupees) : '') : '2500',
    feeReference: initial?.feeReference ?? '',
  });
  const [feePaid, setFeePaid] = useState(initial?.feePaid ?? false);
  const [roles, setRoles] = useState<RoleDraft[]>(() => (initial?.designations ?? []).map((d) => ({
    id: d.id, title: d.title, budget: d.budgetRupees != null ? String(d.budgetRupees) : '', budgetPeriod: d.budgetPeriod, description: d.description, isNew: false,
  })));
  const set = (key: keyof typeof form) => (value: string) => setForm((f) => ({ ...f, [key]: value }));
  const setRole = (id: string, patch: Partial<RoleDraft>) => setRoles((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const save = async () => {
    if (!form.name.trim()) { setError('Give the client a name'); return; }
    // A row left blank is dropped; one with a budget or description needs its title.
    const kept = roles.filter((r) => r.title.trim() || r.budget.trim() || r.description.trim());
    if (kept.some((r) => !r.title.trim())) { setError('Give each role a title, or remove it'); return; }
    setSaving(true); setError('');
    const { fee, ...rest } = form;
    const input: ClientInput = {
      ...rest,
      feeRupees: numberOrNull(fee),
      feePaid,
      designations: kept.map((r) => ({
        // A new row goes without an id, so the server makes one; an existing row keeps its own.
        id: r.isNew ? '' : r.id,
        title: r.title.trim(), budgetRupees: numberOrNull(r.budget), budgetPeriod: r.budgetPeriod, description: r.description.trim(),
      })),
    };
    try {
      if (initial) await updatePlacementClient(initial.id, input);
      else await createPlacementClient(input);
      onSaved(`${form.name.trim()} saved`);
    } catch (e) { setError(message(e)); } finally { setSaving(false); }
  };
  return (
    <FormSheet title={initial ? 'Edit client' : 'New client'} error={error} saving={saving} onClose={onClose} onSave={() => void save()}>
      <Field label="Company name" required><TextInput value={form.name} onChange={set('name')} placeholder="e.g. Northwind Logistics" autoFocus /></Field>
      <Field label="Contact person"><TextInput value={form.contactName} onChange={set('contactName')} placeholder="Who you deal with there" /></Field>
      <div style={grid2}>
        <Field label="Phone"><TextInput type="tel" value={form.phone} onChange={set('phone')} placeholder="+91 98450 12345" /></Field>
        <Field label="Email"><TextInput type="email" value={form.email} onChange={set('email')} placeholder="name@company.com" /></Field>
      </div>
      <Field label="Industry"><TextInput value={form.industry} onChange={set('industry')} placeholder="e.g. Logistics" /></Field>
      <Field label="Location"><TextInput value={form.city} onChange={set('city')} placeholder="City or full address" /></Field>

      <div style={{ marginBottom: 16 }}>
        <label style={{ ...fieldLabel, display: 'block', marginBottom: 6 }}>Roles</label>
        {roles.map((r) => (
          <div key={r.id} style={roleBox}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10 }}>
              <div style={{ flex: 1, minWidth: 0 }}><TextInput value={r.title} onChange={(v) => setRole(r.id, { title: v })} placeholder="Designation, e.g. Warehouse supervisor" /></div>
              <button type="button" className="ds-icon-btn" style={{ ...iconBtn(34), color: 'var(--bad)', flexShrink: 0 }} title="Remove role" onClick={() => setRoles((rs) => rs.filter((x) => x.id !== r.id))}><IconTrash /></button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 120px', gap: 8, marginBottom: 10 }}>
              <RupeeInput value={r.budget} onChange={(v) => setRole(r.id, { budget: v })} placeholder="Budget" />
              <select value={r.budgetPeriod} onChange={(e) => setRole(r.id, { budgetPeriod: e.target.value as 'month' | 'year' })} className="ds-inp" style={inp} aria-label="Budget per">
                <option value="month">a month</option>
                <option value="year">a year</option>
              </select>
            </div>
            <textarea value={r.description} onChange={(e) => setRole(r.id, { description: e.target.value })} rows={2} className="ds-inp" style={textareaStyle} placeholder="What the role involves, who they want" />
          </div>
        ))}
        <button type="button" onClick={() => setRoles((rs) => [...rs, newRole()])} className={btnClass()} style={btn()}>
          <IconPlus size={15} stroke="currentColor" /> Add role
        </button>
      </div>

      <Field label="Onboarding fee" note="Charged once, when you take the client on."><RupeeInput value={form.fee} onChange={set('fee')} step="500" /></Field>
      <label style={checkRow}>
        <input type="checkbox" checked={feePaid} onChange={(e) => setFeePaid(e.target.checked)} />
        Payment received
      </label>
      <Field label="UPI / transaction reference"><TextInput value={form.feeReference} onChange={set('feeReference')} placeholder="e.g. 4321 0987 6543" /></Field>
      <Field label="Notes">
        <textarea value={form.notes} onChange={(e) => set('notes')(e.target.value)} rows={3} className="ds-inp" style={textareaStyle} placeholder="Openings, terms, anything to remember" />
      </Field>
    </FormSheet>
  );
}

// ── Candidates (customers in the API) ─────────────────────────────────────

const U_COLS = '1.6fr 1.2fr 0.8fr 1.4fr 0.9fr 0.9fr 0.8fr 1fr 0.8fr';

type RemovedView = 'active' | 'removed' | 'all';
const REMOVED_VIEWS: RemovedView[] = ['all', 'active', 'removed'];
const REMOVED_LABEL: Record<RemovedView, string> = { all: 'All', active: 'Active', removed: 'Removed' };
/** The list's `removed` param for each view; `all` is left off, so everyone comes back. */
const REMOVED_PARAM: Record<RemovedView, string> = { active: 'exclude', removed: 'only', all: 'all' };

const candidatePill = (c: PlacementCustomer) => (c.removedAt ? <Pill label="Removed" tone={REMOVED_TONE} /> : <Pill label={STAGE_LABEL[c.stage]} tone={STAGE_TONE[c.stage]} />);

export function PlacementCustomers() {
  const { flash, emps } = useStore();
  const [view, setView] = useState<RemovedView>('active');
  const f = useFilters({ createdBy: 'all', from: '', to: '' });
  const list = useList(listPlacementCustomers, { ...f.query, removed: REMOVED_PARAM[view] });
  const creators = useCreators(list.rows);
  const [openId, setOpenId] = useState<string | null>(null);
  const [editing, setEditing] = useState<PlacementCustomer | 'new' | null>(null);
  const open = openId ? list.rows.find((c) => c.id === openId) ?? null : null;
  const nameOf = (userId: string, row: PlacementCustomer) =>
    emps.find((e) => e.id === userId)?.name ?? (userId && userId === row.createdByUserId ? row.createdByName : 'Former employee');

  const remove = async (c: PlacementCustomer) => {
    if (!window.confirm(`Delete ${c.name}?`)) return;
    try {
      await deletePlacementCustomer(c.id);
      setOpenId(null);
      list.reload();
      flash(`${c.name} deleted`);
    } catch (e) { flash(message(e), 'error'); }
  };

  const restore = async (c: PlacementCustomer) => {
    try {
      await restorePlacementCustomer(c.id);
      // Off the Removed list once restored, so the drawer closes there.
      if (view === 'removed') setOpenId(null);
      list.reload();
      flash(`${c.name} restored`);
    } catch (e) { flash(message(e), 'error'); }
  };

  const exportRows = () => exportSheet('Candidates', list.rows.map((c) => ({
    Candidate: c.name, Phone: c.phone, Email: c.email, 'Current role': c.currentRole, 'Experience (years)': c.experienceYears ?? '',
    Skills: c.skills.join(', '), City: c.city, Address: c.address, Stage: STAGE_LABEL[c.stage], Placements: c.placements,
    Removed: c.removedAt ? 'Yes' : 'No', 'Removed on': c.removedAt ? c.removedAt.slice(0, 10) : '', 'Removed because': c.removedReason,
    'Added by': c.createdByName, 'Added on': c.createdAt.slice(0, 10), Introduction: c.notes,
  })), [24, 16, 28, 22, 10, 30, 14, 36, 12, 11, 9, 12, 30, 20, 12, 40]);

  const filtered = !!(f.query.q || f.filters.createdBy !== 'all' || f.filters.from || f.filters.to);
  const emptyText = filtered
    ? 'No candidates match your filters.'
    : view === 'removed' ? 'No removed candidates.' : 'No candidates yet. Add the candidates you place.';

  return (
    <div style={{ animation: 'fade .3s ease both' }}>
      <PageActions>
        <button onClick={() => void exportRows()} disabled={list.rows.length === 0} className={btnClass()} style={btn()}>
          <IconDownload stroke="currentColor" /> Export Excel
        </button>
        <button onClick={() => setEditing('new')} className={btnClass('primary')} style={btn('primary')}>
          <IconPlus size={15} stroke="currentColor" /> Add candidate
        </button>
      </PageActions>

      <Card padded>
        <div style={{ ...toolbar, justifyContent: 'space-between' }}>
          <StatusTabs<RemovedView> options={REMOVED_VIEWS} active={view} onSelect={setView} labels={REMOVED_LABEL} />
          {list.state === 'ready' && <CountLine shown={list.rows.length} noun={list.rows.length === 1 ? 'candidate' : 'candidates'} />}
        </div>
        <Filters
          q={f.q} onQ={f.setQ} placeholder="Search name, phone, role or skill…"
          creators={creators} createdBy={f.filters.createdBy} onCreatedBy={f.set('createdBy')}
          from={f.filters.from} to={f.filters.to} onFrom={f.set('from')} onTo={f.set('to')}
        />
        <div style={TH(U_COLS)}>
          <Th>CANDIDATE</Th>
          <Th>PHONE</Th>
          <Th align="right">EXPERIENCE</Th>
          <Th>SKILLS</Th>
          <Th>CITY</Th>
          <Th>STAGE</Th>
          <Th align="right">PLACEMENTS</Th>
          <Th>ADDED BY</Th>
          <Th align="right">ACTION</Th>
        </div>
        {list.state === 'ready' && list.rows.map((c, i) => (
          <div key={c.id} className="dc-row" onClick={() => setOpenId(c.id)} style={{ ...TR(U_COLS, i === list.rows.length - 1), position: 'relative', cursor: 'pointer' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
              <Avatar name={c.name} />
              <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
                <div style={{ ...cellName, ...ellipsis }}>{c.name}</div>
                {c.removedAt
                  ? <div style={{ ...cellSub, ...ellipsis }} title={c.removedReason || undefined}>Removed {fmtDay(c.removedAt)}{c.removedReason ? ` · ${c.removedReason}` : ''}</div>
                  : <div style={{ ...cellSub, ...ellipsis }}>{c.currentRole || 'Role not given'}</div>}
              </div>
            </div>
            <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
              <div style={{ fontVariantNumeric: 'tabular-nums' }}>{c.phone}</div>
              {c.email && <div style={{ ...cellSub, ...ellipsis }}>{c.email}</div>}
            </div>
            <div style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{c.experienceYears === null ? '—' : `${c.experienceYears} yrs`}</div>
            <div style={{ display: 'flex', gap: 6, overflow: 'hidden' }}>{c.skills.length ? c.skills.slice(0, 2).map((s) => <Tag key={s}>{s}</Tag>) : '—'}{c.skills.length > 2 && <span style={{ ...cellSub, alignSelf: 'center' }}>+{c.skills.length - 2}</span>}</div>
            <div style={ellipsis}>{c.city || '—'}</div>
            <div style={{ minWidth: 0 }}>{candidatePill(c)}</div>
            <div style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{c.placements}</div>
            <div style={ellipsis}>{c.createdByName || '—'}</div>
            <RowActions onEdit={() => setEditing(c)} onDelete={() => void remove(c)} />
          </div>
        ))}
        <ListPending state={list.state} onRetry={list.reload} cols={8} />
        {list.state === 'ready' && list.rows.length === 0 && <EmptyRow text={emptyText} />}
      </Card>

      {open && (
        <Sheet onClose={() => setOpenId(null)}>
          <SheetHead title={open.name} subtitle={[open.currentRole, open.city].filter(Boolean).join(' · ') || 'Candidate'} onClose={() => setOpenId(null)} />
          <div style={{ padding: 20 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 18 }}>
              <Pill label={STAGE_LABEL[open.stage]} tone={STAGE_TONE[open.stage]} />
              {open.removedAt && <Pill label="Removed" tone={REMOVED_TONE} />}
            </div>
            {open.removedAt && (
              <RemarkBlock
                label={`REMOVED · ${fmtDay(open.removedAt)} · BY ${nameOf(open.removedByUserId, open)}`}
                text={open.removedReason || 'No reason given.'}
                filled={!!open.removedReason}
                marginBottom={18}
              />
            )}
            <InfoGrid
              cells={[
                { label: 'PHONE', value: open.phone },
                { label: 'EXPERIENCE', value: open.experienceYears === null ? '—' : `${open.experienceYears} years` },
                { label: 'EMAIL', value: open.email || '—', wide: true },
                { label: 'CURRENT ROLE', value: open.currentRole || '—' },
                { label: 'CITY', value: open.city || '—' },
                { label: 'ADDRESS', value: open.address ? <span style={{ whiteSpace: 'pre-wrap' }}>{open.address}</span> : '—', wide: true },
                { label: 'SKILLS', value: open.skills.length ? <span style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 2 }}>{open.skills.map((s) => <Tag key={s}>{s}</Tag>)}</span> : '—', wide: true },
                { label: 'ADDED BY', value: `${open.createdByName || '—'} · ${fmtDay(open.createdAt)}`, wide: true },
              ]}
            />
            <RemarkBlock label="INTRODUCTION" text={open.notes || 'No introduction.'} filled={!!open.notes} marginBottom={18} />
            <LinkedPlacements filter={{ customerId: open.id }} count={open.placements} show="client" />
          </div>
          <SheetFoot>
            <button onClick={() => void remove(open)} className={btnClass('no')} style={btn('no')} disabled={open.placements > 0} title={open.placements > 0 ? 'On a placement: delete or move those first' : undefined}>Delete</button>
            {open.removedAt ? (
              <>
                <button onClick={() => setEditing(open)} className={btnClass()} style={btn()}><IconEdit /> Edit</button>
                <button onClick={() => void restore(open)} className={btnClass('primary')} style={btn('primary')}>Restore</button>
              </>
            ) : (
              <button onClick={() => setEditing(open)} className={btnClass('primary')} style={btn('primary')}><IconEdit /> Edit</button>
            )}
          </SheetFoot>
        </Sheet>
      )}
      {editing && <CustomerForm initial={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={(text) => { setEditing(null); list.reload(); flash(text); }} />}
    </div>
  );
}

function CustomerForm({ initial, onClose, onSaved }: { initial: PlacementCustomer | null; onClose: () => void; onSaved: (text: string) => void }) {
  const [form, setForm] = useState({
    name: initial?.name ?? '', phone: initial?.phone ?? '', email: initial?.email ?? '', currentRole: initial?.currentRole ?? '',
    experienceYears: initial?.experienceYears != null ? String(initial.experienceYears) : '', skills: initial?.skills.join(', ') ?? '',
    city: initial?.city ?? '', address: initial?.address ?? '', notes: initial?.notes ?? '',
  });
  const set = (key: keyof typeof form) => (value: string) => setForm((f) => ({ ...f, [key]: value }));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const save = async () => {
    if (!form.name.trim()) { setError('Give the candidate’s name'); return; }
    if (!form.phone.trim()) { setError('Give a phone number'); return; }
    setSaving(true); setError('');
    const input: CustomerInput = {
      ...form,
      experienceYears: numberOrNull(form.experienceYears),
      skills: form.skills.split(',').map((s) => s.trim()).filter(Boolean),
    };
    try {
      if (initial) await updatePlacementCustomer(initial.id, input);
      else await createPlacementCustomer(input);
      onSaved(`${form.name.trim()} saved`);
    } catch (e) { setError(message(e)); } finally { setSaving(false); }
  };
  return (
    <FormSheet title={initial ? 'Edit candidate' : 'New candidate'} error={error} saving={saving} onClose={onClose} onSave={() => void save()}>
      <Field label="Full name" required><TextInput value={form.name} onChange={set('name')} placeholder="e.g. Arjun Mehta" autoFocus /></Field>
      <div style={grid2}>
        <Field label="Phone" required><TextInput type="tel" value={form.phone} onChange={set('phone')} placeholder="98765 43210" /></Field>
        <Field label="Email"><TextInput type="email" value={form.email} onChange={set('email')} placeholder="name@email.com" /></Field>
      </div>
      <div style={grid2}>
        <Field label="Current role"><TextInput value={form.currentRole} onChange={set('currentRole')} placeholder="e.g. Shift supervisor" /></Field>
        <Field label="Experience (years)"><TextInput type="number" value={form.experienceYears} onChange={set('experienceYears')} placeholder="e.g. 4.5" /></Field>
      </div>
      <Field label="Skills" note="Separate skills with commas."><TextInput value={form.skills} onChange={set('skills')} placeholder="Inventory, SAP, Team handling" /></Field>
      <Field label="City"><TextInput value={form.city} onChange={set('city')} placeholder="e.g. Mysuru" /></Field>
      <Field label="Address">
        <textarea value={form.address} onChange={(e) => set('address')(e.target.value)} rows={2} className="ds-inp" style={textareaStyle} placeholder="House, street, area, PIN" />
      </Field>
      <Field label="Introduction">
        <textarea value={form.notes} onChange={(e) => set('notes')(e.target.value)} rows={3} className="ds-inp" style={textareaStyle} placeholder="Skills, strengths and what they are looking for" />
      </Field>
    </FormSheet>
  );
}

/** The placements a client or candidate is on, in their drawer. */
function LinkedPlacements({ filter, count, show }: { filter: PlacementFilters; count: number; show: 'client' | 'customer' }) {
  const list = useList(listPlacements, filter, count > 0);
  if (count === 0) return <RemarkBlock label="PLACEMENTS" text="Not on any placement yet." filled={false} />;
  return (
    <div>
      <div style={{ ...eyebrow, marginBottom: 8 }}>PLACEMENTS · {count}</div>
      {list.state !== 'ready' ? (
        <ListPending state={list.state} onRetry={list.reload} rows={Math.min(count, 3)} cols={2} avatar={false} rowHeight={44} />
      ) : (
        <div style={{ border: '1px solid var(--line)', borderRadius: 16, overflow: 'hidden' }}>
          {list.rows.map((p, i) => (
            <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', borderTop: i ? '1px solid var(--line)' : undefined }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13.5, fontWeight: 500, ...ellipsis }}>{show === 'client' ? p.clientName : p.customerName}</div>
                <div style={cellSub}>{p.position}</div>
              </div>
              <Pill label={STATUS_LABEL[p.status]} tone={STATUS_TONE[p.status]} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const ellipsis: CSSProperties = { minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' };
const grid2: CSSProperties = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 };
// As Reimbursement Types draws its form.
const unitBox: CSSProperties = { ...inp, display: 'flex', alignItems: 'center', padding: 0, overflow: 'hidden' };
const unitInput: CSSProperties = { border: 'none', outline: 'none', padding: '0 12px', height: '100%', fontSize: 13, width: '100%', color: 'var(--ink)', background: 'transparent' };
// As Reimbursement Types draws its "Available in the app" box.
const checkRow: CSSProperties = { display: 'flex', alignItems: 'center', gap: 10, fontSize: 13.5, fontWeight: 500, color: 'var(--ink)', cursor: 'pointer', marginBottom: 16, accentColor: 'var(--accent)' };
// One role in the client form, boxed as the drawers box their lists.
const roleBox: CSSProperties = { border: '1px solid var(--line)', borderRadius: 16, padding: 12, marginBottom: 10 };
const errorTag: CSSProperties = { fontSize: 13, fontWeight: 600, color: 'var(--bad)', background: 'var(--bad-bg)', borderRadius: 14, padding: '10px 14px', marginBottom: 6 };
