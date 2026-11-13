// Requests › Attendance: corrections employees raised against a day, and
// out-of-location punches waiting on a manager.
//
// The same queue a manager sees in the app, but org-wide: HR is asking what is
// outstanding anywhere, not what is waiting on them, so every row names the
// manager it actually belongs to. Needs action puts what is pending first,
// what costs pay ahead of the rest.
// Deciding from here is an override, so it goes through a confirm with a note.
import { useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import { useStore } from '../store';
import { TO_STAT } from '../theme';
import type { ReqStatus } from '../theme';
import type { Correction, CorrectionKind } from '../seed';
import { inDateRange } from '../adapters';
import { downloadCsv } from '../export';
import { Card, EmptyRow, ListPending, Pill, SearchInput, StatusTabs, Th } from '../ui';
import type { LoadState } from '../ui';
import { PersonAvatar } from '../PersonAvatar';
import { btn, btnClass, cellName, cellSub, textareaStyle, TH, toolbar, TR } from '../ds';
import { IconDownload } from '../icons';
import { SuwiInsight } from '../suwi/SuwiInsight';
import { DrawerHeader, DrawerShell, InfoGrid, RemarkBlock } from '../drawers/shell';
import { daysSince, PENDING_ROW, plural, SLOW_DAYS, stepRange } from './leaveDays';
import { NeedsActionShell, PendingChip, PeriodStepper, StatTile, Waiting } from './leaveParts';
import { Pager, usePaged } from './Pager';

const COLS = '32px 1.5fr .95fr 1.15fr 1.3fr .9fr 1.2fr 1fr 1.1fr';
type Kind = CorrectionKind;
/**
 * What each request is, from the request itself (adapters' correctionKindOf):
 * a correction by the day type it asks for, an older one's punch times, an
 * out-of-location punch, or a punch the face check refused.
 */
const KIND: Record<Kind, { label: string; color: string; bg: string; fg: string }> = {
  full: { label: 'Full day asked', color: 'var(--accent)', bg: 'var(--accent-soft)', fg: 'var(--accent-ink)' },
  half: { label: 'Half day asked', color: 'var(--t-peach-i)', bg: 'var(--t-peach)', fg: 'var(--t-peach-i)' },
  wfh: { label: 'Work from home', color: 'var(--t-lilac-i)', bg: 'var(--t-lilac)', fg: 'var(--t-lilac-i)' },
  visit: { label: 'Client visit', color: 'var(--t-plum-i)', bg: 'var(--t-plum)', fg: 'var(--t-plum-i)' },
  leave: { label: 'Leave asked', color: 'color-mix(in srgb, var(--accent) 40%, var(--surface))', bg: 'var(--accent-soft)', fg: 'var(--accent-ink)' },
  times: { label: 'Punch times', color: 'var(--ink-3)', bg: 'var(--mute-bg)', fg: 'var(--ink-2)' },
  other: { label: 'Correction', color: 'var(--ink-4)', bg: 'var(--mute-bg)', fg: 'var(--ink-2)' },
  ool: { label: 'Out of location', color: 'var(--t-sky-i)', bg: 'var(--t-sky)', fg: 'var(--t-sky-i)' },
  face: { label: 'Face check', color: 'var(--ok)', bg: 'var(--ok-bg)', fg: 'var(--ok)' },
};
const kindOf = (r: Correction): Kind => r.kind ?? 'other';
/**
 * Until it is decided the day counts as recorded (absent, a half day, a missed
 * punch) while the request asks for it to count otherwise, so it can change
 * pay: every pending correction and out-of-location request, a disputed half
 * day included. A face check request only holds a punch for a decision and is
 * not counted here.
 */
const affectsPay = (r: Correction) => r.status === 'Pending' && kindOf(r) !== 'face';
const workDay = (r: Correction) => (r.refISO || '').slice(0, 10);
const clock = (iso?: string) => (iso ? new Date(iso).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true }) : '—');

type Filter = 'all' | 'pay' | 'in' | 'out' | 'both' | 'ool';
/** The design's filters: what the day is missing, by what was punched, or out of location. */
const FILTERS: [Filter, string][] = [['all', 'All'], ['pay', 'Affects pay'], ['in', 'Punch-in missed'], ['out', 'Punch-out missed'], ['both', 'Both missed'], ['ool', 'Out of location']];
const fitsFilter = (r: Correction, f: Filter): boolean => {
  if (f === 'all') return true;
  if (f === 'pay') return affectsPay(r);
  if (f === 'ool') return kindOf(r) === 'ool';
  if (kindOf(r) === 'ool' || kindOf(r) === 'face') return false;
  const inAt = Boolean(r.punchInISO), outAt = Boolean(r.punchOutISO);
  return f === 'in' ? !inAt && outAt : f === 'out' ? inAt && !outAt : !inAt && !outAt;
};
const NEEDS_ACTION_SHOWN = 3;
type CorrPick = 'pay' | 'slow' | 'all';

/** Needs action, as on Leave requests: the most urgent few; its tags filter this table only. */
function CorrNeedsAction({ state, onOpen }: { state: LoadState; onOpen: (id: string) => void }) {
  const s = useStore();
  // What costs pay first, then the longest wait.
  const everything = s.corrs.filter((r) => r.status === 'Pending')
    .sort((a, b) => Number(affectsPay(b)) - Number(affectsPay(a)) || a.ord - b.ord);
  const [pick, setPick] = useState<CorrPick | null>(null);
  const isSlow = (r: Correction) => daysSince(r.ord) > SLOW_DAYS;
  const fits = (r: Correction, k: CorrPick) => (k === 'all' ? true : k === 'pay' ? affectsPay(r) : isSlow(r));
  const matching = everything.filter((r) => fits(r, pick ?? 'all'));
  const paged = usePaged(matching, pick);
  if (state === 'ready' && everything.length === 0) return null;
  const list = pick ? paged.rows : matching.slice(0, NEEDS_ACTION_SHOWN);
  const slow = everything.filter(isSlow).length;
  const tag = (k: CorrPick, text: string, count: number) => ({ tone: 'mute' as const, text, count, picked: pick === k, onPick: () => setPick(pick === k ? null : k) });
  return (
    <NeedsActionShell
      id="corr-needs-action"
      state={state}
      summary={`${plural(everything.length, 'request')} waiting for approval · all dates`}
      chips={[...(slow ? [tag('slow', `Waiting over ${SLOW_DAYS} days`, slow)] : []), tag('all', 'All', everything.length)]}
    >
      {list.map((r) => {
        const k = KIND[kindOf(r)];
        return (
          <div key={r.id} style={{ display: 'grid', gridTemplateColumns: 'minmax(220px,1.5fr) minmax(170px,1.2fr) minmax(150px,1.1fr) minmax(100px,.7fr) minmax(120px,auto)', alignItems: 'center', gap: 16, padding: '12px 22px', borderTop: '1px solid var(--line)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
              <PersonAvatar name={r.name} userId={r.submitterId} />
              <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
                <span style={{ ...cellName, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.name}</span>
                <span style={{ ...cellSub, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.employeeCode} · {r.team}</span>
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={{ fontSize: 13.5 }}>{r.day} {r.workDate}</span>
              <span style={{ alignSelf: 'flex-start', fontSize: 11.5, fontWeight: 600, padding: '2px 8px', borderRadius: 6, background: k.bg, color: k.fg, whiteSpace: 'nowrap' }}>{k.label}</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
              <span style={cellSub}>Manager</span>
              <span style={{ fontSize: 13.5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.manager || '—'}</span>
            </div>
            <Waiting days={daysSince(r.ord)} slow={SLOW_DAYS} />
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
              <PendingChip onClick={() => onOpen(r.id)} label={`Review ${r.name}'s correction`} />
            </div>
          </div>
        );
      })}
      <ListPending state={state} onRetry={() => void s.reload()} rows={3} cols={4} />
      {pick && <div style={{ padding: '0 18px 12px' }}><Pager p={paged} /></div>}
    </NeedsActionShell>
  );
}

export function AttendanceCorrections() {
  const s = useStore();
  const st = s.listState('corrections');
  // A week or a month, stepped back and forward with the arrows by the title.
  const [unit, setUnit] = useState<'week' | 'month'>('month');
  const [offset, setOffset] = useState(0);
  const [filter, setFilter] = useState<Filter>('all');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulk, setBulk] = useState<'approve' | 'decline' | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  const range = stepRange(unit, offset);
  const inPeriod = useMemo(() => s.corrs.filter((r) => inDateRange(r.refISO, range.from, range.to)), [s.corrs, range.from, range.to]);

  const stats = useMemo(() => ({
    total: inPeriod.length,
    pending: inPeriod.filter((r) => r.status === 'Pending').length,
    approved: inPeriod.filter((r) => r.status === 'Approved').length,
    declined: inPeriod.filter((r) => r.status === 'Declined').length,
  }), [inPeriod]);

  const rows = useMemo(() => {
    let out = inPeriod.slice();
    const q = s.corrSearch.trim().toLowerCase();
    if (q) out = out.filter((r) => r.name.toLowerCase().includes(q) || r.employeeCode.toLowerCase().includes(q) || r.manager.toLowerCase().includes(q));
    if (s.corrStatus !== 'all') out = out.filter((r) => r.status === s.corrStatus);
    out = out.filter((r) => fitsFilter(r, filter));
    // Pending that costs pay first, then other pending, then the decided; newest raised within each.
    const rank = (r: Correction) => (r.status === 'Pending' ? (affectsPay(r) ? 0 : 1) : 2);
    return out.sort((a, b) => rank(a) - rank(b) || b.ord - a.ord);
  }, [inPeriod, s.corrSearch, s.corrStatus, filter]);
  const paged = usePaged(rows, `${rows.length}|${rows[0]?.id ?? ''}`);
  const pendingRows = rows.filter((r) => r.status === 'Pending');
  const picked = pendingRows.filter((r) => selected.has(r.id));
  const allPicked = pendingRows.length > 0 && picked.length === pendingRows.length;
  const toggle = (id: string) => setSelected((cur) => { const n = new Set(cur); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  const statusCounts = useMemo(() => {
    const c: Partial<Record<ReqStatus | 'all', number>> = { all: inPeriod.length };
    for (const r of inPeriod) c[r.status] = (c[r.status] ?? 0) + 1;
    return c;
  }, [inPeriod]);

  const exportRows = () =>
    downloadCsv<Correction>(
      'attendance-corrections',
      [
        { header: 'Employee', value: (r) => r.name },
        { header: 'Employee ID', value: (r) => r.employeeCode },
        { header: 'Team', value: (r) => r.team },
        { header: 'Raised on', value: (r) => r.appliedOn },
        { header: 'Work date', value: (r) => r.workDate },
        { header: 'Day', value: (r) => r.day },
        { header: 'Type', value: (r) => KIND[kindOf(r)].label },
        { header: 'Asked for', value: (r) => r.askedFor ?? r.dayType },
        { header: 'Recorded punches', value: (r) => r.recorded },
        { header: 'Reason', value: (r) => r.eRemark },
        { header: 'Manager', value: (r) => r.manager },
        { header: 'Status', value: (r) => r.status },
        { header: 'Affects pay', value: (r) => (affectsPay(r) ? 'yes' : '') },
        { header: 'Decision note', value: (r) => r.mRemark },
        { header: 'Decided by', value: (r) => (r.status === 'Pending' ? '' : r.byAdmin ? 'admin' : 'manager') },
      ],
      rows,
    );

  /** Brings the list to the top of the screen, once it is there. */
  const toList = () => {
    let tries = 0;
    const go = () => {
      const el = document.getElementById('corr-list');
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      else if (tries++ < 20) setTimeout(go, 50);
    };
    setTimeout(go, 50);
  };
  const pickStatus = (v: ReqStatus | 'all') => { s.setCorrStatus(v); setSelected(new Set()); toList(); };

  const open = openId ? s.corrs.find((r) => r.id === openId) ?? null : null;
  const chip = (on: boolean): CSSProperties => ({ height: 32, padding: '0 12px', borderRadius: 999, fontSize: 12.5, fontWeight: 500, cursor: 'pointer', font: 'inherit', border: `1px solid ${on ? 'var(--sel)' : 'var(--line-2)'}`, background: on ? 'var(--sel)' : 'var(--surface)', color: on ? 'var(--on-sel)' : 'var(--ink)' });

  return (
    <div style={{ animation: 'fade .3s ease both' }}>
      <CorrNeedsAction state={st} onOpen={setOpenId} />

      <Card padded>
        <section aria-labelledby="corr-period" style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          <PeriodStepper id="corr-period" title={range.title} unit={unit} onUnit={(u) => { setUnit(u); setOffset(0); setSelected(new Set()); }} onStep={(by) => { setOffset((o) => o + by); setSelected(new Set()); }}
            hasPrev={s.corrs.some((r) => workDay(r) && workDay(r) < range.from)} hasNext={s.corrs.some((r) => workDay(r) > range.to)} />

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 12 }}>
            {/* Each tile filters the list below to what it counts, and brings the list into view. */}
            <StatTile state={st} label="Corrections" value={stats.total} onPick={() => pickStatus('all')} picked={s.corrStatus === 'all'} />
            <StatTile state={st} label="Pending" value={stats.pending} onPick={() => pickStatus('Pending')} picked={s.corrStatus === 'Pending'} color="var(--p-yellow)"
              action={stats.pending > 0 && s.corrStatus !== 'Pending' ? <Pill label="Needs action" tone={TO_STAT.Pending} fontSize={11} padding="2px 8px" /> : undefined} />
            <StatTile state={st} label="Approved" value={stats.approved} onPick={() => pickStatus('Approved')} picked={s.corrStatus === 'Approved'} color="var(--p-green)" />
            <StatTile state={st} label="Declined" value={stats.declined} onPick={() => pickStatus('Declined')} picked={s.corrStatus === 'Declined'} color="var(--p-red)" />
          </div>

          <div id="corr-list" style={{ scrollMarginTop: 96 }}>
              <div style={{ ...toolbar, flexWrap: 'wrap', alignItems: 'center' }}>
                <StatusTabs<ReqStatus | 'all'>
                  options={['all', 'Pending', 'Approved', 'Declined']}
                  active={s.corrStatus}
                  onSelect={(v) => { s.setCorrStatus(v); setSelected(new Set()); }}
                  counts={st === 'ready' ? statusCounts : undefined}
                />
                <div role="group" aria-label="Filter" style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {FILTERS.map(([f, label]) => (
                    <button key={f} type="button" aria-pressed={filter === f} onClick={() => { setFilter(f); setSelected(new Set()); }} style={chip(filter === f)}>{label}</button>
                  ))}
                </div>
                <div style={{ flex: '1 1 220px', maxWidth: 320, display: 'flex', marginLeft: 'auto' }}>
                  <SearchInput value={s.corrSearch} onChange={s.setCorrSearch} placeholder="Search employee or manager" width="100%" />
                </div>
                <button onClick={exportRows} disabled={rows.length === 0} className={btnClass()} style={btn()}>
                  <IconDownload stroke="currentColor" /> Export
                </button>
              </div>

              {picked.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '10px 14px', borderRadius: 14, background: 'var(--accent-soft)', border: '1px solid var(--accent-line)', marginBottom: 12 }}>
                  <span style={{ fontSize: 13.5, fontWeight: 500, color: 'var(--accent-ink)' }}>{plural(picked.length, 'correction')} selected{picked.some(affectsPay) ? ` · ${picked.filter(affectsPay).length} affect pay` : ''}</span>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button type="button" onClick={() => setSelected(new Set())} className={btnClass('ghost')} style={btn('ghost', 'sm')}>Clear</button>
                    <button type="button" onClick={() => setBulk('decline')} className={btnClass('no')} style={btn('no', 'sm')}>Decline</button>
                    <button type="button" onClick={() => setBulk('approve')} className={btnClass('primary')} style={btn('primary', 'sm')}>Approve selected</button>
                  </div>
                </div>
              )}

              <div style={{ overflowX: 'auto' }}>
                <div style={{ minWidth: 1040 }}>
                  <div style={TH(COLS)}>
                    <div><input type="checkbox" aria-label="Select all pending rows" checked={allPicked} disabled={pendingRows.length === 0} onChange={() => setSelected(allPicked ? new Set() : new Set(pendingRows.map((r) => r.id)))} /></div>
                    <Th>EMPLOYEE</Th>
                    <Th>WORK DATE</Th>
                    <Th>TYPE</Th>
                    <Th>PUNCHED</Th>
                    <Th>ASKED FOR</Th>
                    <Th>REASON</Th>
                    <Th>MANAGER</Th>
                    <Th>STATUS</Th>
                  </div>
                  {paged.rows.map((r, i) => {
                    const pend = r.status === 'Pending';
                    const k = KIND[kindOf(r)];
                    return (
                      <div key={r.id} className="dc-row" onClick={() => setOpenId(r.id)} style={{ ...TR(COLS, i === paged.rows.length - 1), cursor: 'pointer', ...(pend ? PENDING_ROW : null), ...(selected.has(r.id) && pend ? { background: 'color-mix(in srgb, var(--accent) 14%, var(--surface))' } : null) }}>
                        <div onClick={(e) => e.stopPropagation()}>
                          {pend && <input type="checkbox" aria-label={`Select ${r.name}, ${r.workDate}`} checked={selected.has(r.id)} onChange={() => toggle(r.id)} />}
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
                          <PersonAvatar name={r.name} userId={r.submitterId} />
                          <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
                            <div style={{ ...cellName, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.name}</div>
                            <div style={{ ...cellSub, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.employeeCode} · {r.team}</div>
                          </div>
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column' }}>
                          <span>{r.day} {r.workDate}</span>
                          <span style={cellSub}>raised {r.appliedOn}</span>
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                          <span style={{ alignSelf: 'flex-start', fontSize: 11.5, fontWeight: 600, padding: '2px 8px', borderRadius: 6, background: k.bg, color: k.fg, whiteSpace: 'nowrap' }}>{k.label}</span>
                          {r.ool && <span style={{ ...cellSub, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.ool.reason}</span>}
                        </div>
                        <div style={{ fontSize: 13, color: r.recorded === 'No punch' ? 'var(--ink-3)' : 'var(--ink-2)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={r.recorded}>{r.recorded === 'No punch' ? '— → —' : r.recorded}</div>
                        <div>{r.askedFor ?? r.dayType}</div>
                        <div style={{ color: r.eRemark ? 'var(--ink)' : 'var(--ink-3)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={r.eRemark || ''}>{r.eRemark || '—'}</div>
                        <div style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={r.manager}>{r.manager || '—'}</div>
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 4 }}>
                          {pend ? <PendingChip onClick={() => setOpenId(r.id)} label={`Review ${r.name}'s correction`} /> : <Pill label={r.status} tone={TO_STAT[r.status]} />}
                          {!pend && r.byAdmin && <span style={{ fontSize: 11.5, color: 'var(--ink-3)' }}>by admin</span>}
                          {affectsPay(r) && <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--bad)' }}>Affects pay</span>}
                        </div>
                      </div>
                    );
                  })}
                  <ListPending state={st} onRetry={() => void s.reload()} cols={8} />
                  {st === 'ready' && rows.length === 0 && <EmptyRow text="No attendance corrections match your filters." />}
                </div>
                <Pager p={paged} />
              </div>
          </div>
        </section>
      </Card>

      {open && <CorrectionDrawer r={open} onClose={() => setOpenId(null)} />}
      {s.corrConfirm && <ConfirmOverride />}
      {bulk && <BulkConfirm action={bulk} rows={picked} onClose={() => setBulk(null)} onDone={() => { setBulk(null); setSelected(new Set()); }} />}
    </div>
  );
}


/** One correction: Suwi's checks, what was punched and asked, where, and the decision. */
function CorrectionDrawer({ r, onClose }: { r: Correction; onClose: () => void }) {
  const s = useStore();
  const k = KIND[kindOf(r)];
  const pend = r.status === 'Pending';
  const map = r.ool ? `https://www.google.com/maps?q=${r.ool.latitude},${r.ool.longitude}` : '';
  return (
    <DrawerShell onClose={onClose}>
      <DrawerHeader name={r.name} userId={r.submitterId} subtitle={`${r.employeeCode} · ${r.team} · Raised ${r.appliedOn}`} onClose={onClose} />
      <div style={{ padding: 20 }}>
        <SuwiInsight kind="correction" id={r.id} pending={pend} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20, flexWrap: 'wrap' }}>
          <Pill label={r.byAdmin ? `${r.status} · by admin` : r.status} tone={TO_STAT[r.status]} />
          <Pill label={k.label} tone={{ bg: k.bg, fg: k.fg }} />
          {affectsPay(r) && <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--bad)' }}>Affects pay until decided</span>}
        </div>
        <InfoGrid
          cells={[
            { label: 'WORK DATE', value: `${r.day} ${r.workDate}` },
            { label: 'TYPE', value: k.label },
            { label: 'PUNCHED', value: r.punchInISO || r.punchOutISO ? `${clock(r.punchInISO)} → ${clock(r.punchOutISO)}` : r.ool ? `Checked ${r.ool.at ? clock(r.ool.at) : ''}` : 'No punch' },
            { label: 'ASKED FOR', value: r.askedFor ?? r.dayType },
            { label: 'MANAGER', value: r.manager || '—', wide: true },
          ]}
        />
        {r.ool && (
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.06em', color: 'var(--ink-3)', marginBottom: 8 }}>LOCATION</div>
            <div style={{ padding: '12px 14px', borderRadius: 12, background: 'var(--surface-2)', display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={{ fontSize: 14, fontWeight: 500 }}>{r.ool.place}</span>
              <a href={map} target="_blank" rel="noopener noreferrer" style={{ fontSize: 13, color: 'var(--accent-ink)' }}>{r.ool.latitude.toFixed(5)}, {r.ool.longitude.toFixed(5)} · Open in map</a>
            </div>
          </div>
        )}
        <RemarkBlock label="EMPLOYEE REASON" text={r.eRemark || 'No reason given.'} filled={!!r.eRemark} marginBottom={16} />
        <RemarkBlock label="MANAGER REMARK" text={r.mRemark || 'No remark yet.'} filled={!!r.mRemark} marginBottom={8} />
      </div>
      {pend && (
        <div style={{ position: 'sticky', bottom: 0, marginTop: 'auto', background: 'var(--surface)', borderTop: '1px solid var(--line)', padding: '16px 20px', display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button onClick={() => { onClose(); s.corrAsk(r.id, 'decline'); }} className={btnClass('no')} style={btn('no')}>Decline</button>
          <button onClick={() => { onClose(); s.corrAsk(r.id, 'approve'); }} className={btnClass('primary')} style={btn('primary')}>Approve correction</button>
        </div>
      )}
    </DrawerShell>
  );
}

/** Approve or decline the selected ones together: one note, each its own override. */
function BulkConfirm({ action, rows, onClose, onDone }: { action: 'approve' | 'decline'; rows: Correction[]; onClose: () => void; onDone: () => void }) {
  const s = useStore();
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const approve = action === 'approve';
  const managers = [...new Set(rows.map((r) => r.manager).filter(Boolean))];
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'var(--scrim)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 60, animation: 'ovl .2s ease both' }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: 'min(520px, calc(100% - 32px))', background: 'var(--surface)', borderRadius: 'var(--r-lg)', padding: 20, boxShadow: 'var(--shadow-drawer)', animation: 'pop .2s ease both' }}>
        <div style={{ fontSize: 16, fontWeight: 600, lineHeight: 1.5, marginBottom: 4 }}>{approve ? 'Approve' : 'Decline'} {plural(rows.length, 'correction')}?</div>
        <div style={{ fontSize: 13.5, color: 'var(--ink-2)', lineHeight: 1.55, marginBottom: 16 }}>
          {approve ? 'Each day will count as asked.' : 'Each day stays as it was recorded.'}
          {managers.length ? ` This overrides ${managers.length <= 2 ? managers.join(' and ') : `${managers.length} managers`}.` : ''}
        </div>
        <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Add a note for the employees (optional)" rows={3} className="ds-inp" style={{ ...textareaStyle, marginBottom: 20 }} />
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button type="button" onClick={onClose} className={btnClass()} style={btn()}>Cancel</button>
          <button type="button" disabled={busy} onClick={async () => { setBusy(true); await s.corrDecideMany(rows.map((r) => r.id), action, note); setBusy(false); onDone(); }} className={btnClass(approve ? 'primary' : 'danger')} style={btn(approve ? 'primary' : 'danger')}>
            {busy ? 'Saving…' : approve ? `Approve ${rows.length}` : `Decline ${rows.length}`}
          </button>
        </div>
      </div>
    </div>
  );
}

/** HR is overriding the reporting manager, so the note is worth capturing. */
function ConfirmOverride() {
  const s = useStore();
  if (!s.corrConfirm) return null;
  const { id, action } = s.corrConfirm;
  const row = s.corrs.find((r) => r.id === id);
  const approve = action === 'approve';
  return (
    <div onClick={s.corrCloseConfirm} style={{ position: 'fixed', inset: 0, background: 'var(--scrim)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 60, animation: 'ovl .2s ease both' }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: 'min(520px, calc(100% - 32px))', background: 'var(--surface)', borderRadius: 'var(--r-lg)', padding: 20, boxShadow: 'var(--shadow-drawer)', animation: 'pop .2s ease both' }}>
        <div style={{ fontSize: 16, fontWeight: 600, lineHeight: 1.5, marginBottom: 4 }}>{approve ? 'Approve' : 'Decline'} this correction?</div>
        <div style={{ fontSize: 13.5, color: 'var(--ink-2)', fontWeight: 400, lineHeight: 1.55, marginBottom: 16 }}>
          {row ? `${row.name}’s ${row.workDate} will be ${approve ? `recorded as ${(row.askedFor ?? row.dayType).toLowerCase()}` : 'left as it is'}. ${row.manager ? `${row.manager} is the approver — this overrides them.` : ''}` : ''}
        </div>
        <textarea value={s.corrNote} onChange={(e) => s.setCorrNote(e.target.value)} placeholder="Add a note for the employee (optional)" rows={3} className="ds-inp" style={{ ...textareaStyle, marginBottom: 20 }} />
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button type="button" onClick={s.corrCloseConfirm} className={btnClass()} style={btn()}>Cancel</button>
          <button type="button" onClick={s.corrDecide} className={btnClass(approve ? 'primary' : 'danger')} style={btn(approve ? 'primary' : 'danger')}>{approve ? 'Approve' : 'Decline'}</button>
        </div>
      </div>
    </div>
  );
}
