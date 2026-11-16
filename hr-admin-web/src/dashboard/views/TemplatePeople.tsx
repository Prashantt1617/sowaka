// The people side of a template (Shifts and Performance templates): who is on
// it, and adding or removing them. One search box for both, in plain words:
// "3D team under Ravi", "interns in Gurgaon", "joined after March 2026", "not on
// this template". What the words can't place is read by Suwi; what was
// understood shows as chips that can be taken off one by one.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useStore } from '../store';
import type { Emp } from '../seed';
import { Avatar, Pill, SearchInput, Th } from '../ui';
import { TH, TR, cellName, cellSub, note as noteBox } from '../ds';
import { smartPeopleSearch } from '../../services/hrms';
import { applyPeopleFilter, chipsOf, EMPTY_FILTER, isEmptyFilter, mergeFilters, parsePeopleQuery } from '../peopleQuery';
import type { FilterChip, PeopleFilter } from '../peopleQuery';

const COLS = '36px 1.6fr 1fr 1fr 1fr 1.2fr';
const PAGE = 50;

/** Where someone is now, for the Edit employees list. */
export type Placement = { on: boolean; elsewhere?: string };

export function PeopleSearch({ emps, onTemplate, onChange, placeholder }: { emps: Emp[]; onTemplate: (e: Emp) => boolean; onChange: (shown: Emp[], filtering: boolean) => void; placeholder: string }) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<PeopleFilter>(EMPTY_FILTER);
  const [chips, setChips] = useState<FilterChip[]>([]);
  const [asking, setAsking] = useState(false);
  const [byAi, setByAi] = useState(false);
  const [unplaced, setUnplaced] = useState('');
  const asked = useRef('');

  // The words, read here at once; what is left over goes to Suwi after a pause.
  useEffect(() => {
    const read = parsePeopleQuery(query, emps);
    setFilter(read.filter); setChips(read.chips); setByAi(false); setUnplaced(read.leftover);
    if (!read.leftover) return;
    const q = query.trim();
    const t = setTimeout(() => {
      asked.current = q;
      setAsking(true);
      smartPeopleSearch(q).then((f) => {
        if (asked.current !== q) return;
        // Suwi read the whole sentence, so its reading replaces the word matching (keeping only "on this template", which Suwi may leave out).
        const merged = { ...mergeFilters(EMPTY_FILTER, f), on: f.on ?? read.filter.on, text: '' };
        const found = !isEmptyFilter({ ...EMPTY_FILTER, ...f, text: '' });
        if (found) { setFilter(merged); setChips(chipsOf(merged, emps)); setByAi(true); setUnplaced(''); }
      }).catch(() => undefined).finally(() => { if (asked.current === q) setAsking(false); });
    }, 700);
    return () => clearTimeout(t);
  }, [query, emps]);

  const shown = useMemo(() => applyPeopleFilter(filter, emps, onTemplate), [filter, emps, onTemplate]);
  const filtering = !isEmptyFilter(filter) || !!unplaced;
  useEffect(() => { onChange(unplaced && !byAi && isEmptyFilter(filter) ? [] : shown, filtering); }, [shown, filtering, unplaced, byAi, filter]); // eslint-disable-line react-hooks/exhaustive-deps

  const drop = (c: FilterChip) => {
    const next = c.without(filter);
    setFilter(next); setChips(chips.filter((x) => x.key !== c.key));
  };
  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <SearchInput value={query} onChange={setQuery} placeholder={placeholder} width="100%" />
      {(chips.length > 0 || asking || unplaced) && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', minHeight: 26 }}>
          {chips.map((c) => (
            <span key={c.key} style={chip}>
              {c.label}
              <button type="button" aria-label={`Remove ${c.label}`} onClick={() => drop(c)} style={chipX}>×</button>
            </span>
          ))}
          {asking && <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>Suwi is reading “{unplaced}”…</span>}
          {!asking && byAi && <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>Read by Suwi</span>}
          {!asking && !byAi && unplaced && <span style={{ fontSize: 12, color: 'var(--warn)' }}>Couldn’t place “{unplaced}”</span>}
        </div>
      )}
    </div>
  );
}

/** Employees: who is on it, searchable. */
export function TemplateMembers({ members, note, emptyText, extra }: { members: Emp[]; note?: ReactNode; emptyText: string; extra?: (e: Emp) => ReactNode }) {
  const [shown, setShown] = useState<Emp[]>(members);
  const [filtering, setFiltering] = useState(false);
  const isOn = useMemo(() => () => true, []);
  const list = filtering ? shown : members;
  return (
    <section className="pd-card" style={{ display: 'grid', gap: 14 }}>
      <div className="pd-card-h" style={{ marginBottom: 0 }}>
        <h3>Employees on this template</h3>
        <small>{filtering ? `${list.length} of ${members.length}` : `${members.length} ${members.length === 1 ? 'person' : 'people'}`}</small>
      </div>
      {note && <div style={{ ...noteBox, display: 'block' }}>{note}</div>}
      <PeopleSearch emps={members} onTemplate={isOn} onChange={(s, f) => { setShown(s); setFiltering(f); }} placeholder="Search: 3D team, under Ravi, interns in Gurgaon, joined this year…" />
      <PeopleTable rows={list} emptyText={filtering ? 'Nobody on this template matches.' : emptyText} extra={extra} />
    </section>
  );
}

/** Edit employees: everyone, searchable, ticked to add or take off. */
export function TemplateEditPeople({
  emps, placement, onAdd, onRemove, note, removeBlocked, addWord = 'Add',
}: {
  emps: Emp[];
  placement: (e: Emp) => Placement;
  onAdd: (ids: string[]) => Promise<void>;
  /** Absent: people can't be taken off here (the default shift); `removeBlocked` says why. */
  onRemove?: (ids: string[]) => Promise<void>;
  note?: ReactNode;
  removeBlocked?: string;
  addWord?: string;
}) {
  const [shown, setShown] = useState<Emp[]>(emps);
  const [filtering, setFiltering] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState('');
  const [limit, setLimit] = useState(PAGE);
  const onTemplate = useMemo(() => (e: Emp) => placement(e).on, [placement]);
  const list = filtering ? shown : emps;
  useEffect(() => { setLimit(PAGE); }, [list]);

  const ids = [...picked];
  const toAdd = ids.filter((id) => { const e = emps.find((x) => x.id === id); return e && !placement(e).on; });
  const toRemove = ids.filter((id) => { const e = emps.find((x) => x.id === id); return e && placement(e).on; });
  const moving = toAdd.filter((id) => { const e = emps.find((x) => x.id === id); return e && placement(e).elsewhere; }).length;
  const allShown = list.length > 0 && list.every((e) => picked.has(e.id));
  const toggle = (id: string) => setPicked((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const run = async (what: 'add' | 'remove') => {
    setBusy(what);
    try {
      if (what === 'add') await onAdd(toAdd); else await onRemove?.(toRemove);
      setPicked(new Set());
    } finally { setBusy(''); }
  };

  return (
    <section className="pd-card" style={{ display: 'grid', gap: 14 }}>
      <div className="pd-card-h" style={{ marginBottom: 0 }}>
        <h3>Add or remove employees</h3>
        <small>{filtering ? `${list.length} match` : `${emps.length} people`}</small>
      </div>
      {note && <div style={{ ...noteBox, display: 'block' }}>{note}</div>}
      <PeopleSearch emps={emps} onTemplate={onTemplate} onChange={(s, f) => { setShown(s); setFiltering(f); }} placeholder="Who? e.g. people on the 3D team under Ravi, not on this template" />

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--ink-2)', cursor: 'pointer' }}>
          <input type="checkbox" id="pick-all" checked={allShown} onChange={() => setPicked((p) => { const n = new Set(p); for (const e of list) { if (allShown) n.delete(e.id); else n.add(e.id); } return n; })} style={tick} />
          {allShown ? 'Untick all shown' : `Tick all ${list.length} shown`}
        </label>
        <span style={{ flex: 1 }} />
        {picked.size > 0 && <span style={{ fontSize: 12.5, color: 'var(--ink-3)' }}>{picked.size} ticked</span>}
        <button type="button" id="people-add" disabled={!!busy || toAdd.length === 0} onClick={() => void run('add')} className="pd-btn primary">
          {busy === 'add' ? 'Saving…' : `${addWord} ${toAdd.length || ''}${toAdd.length ? ` ${toAdd.length === 1 ? 'person' : 'people'}` : ''}`.trim()}
        </button>
        {onRemove
          ? <button type="button" id="people-remove" disabled={!!busy || toRemove.length === 0} onClick={() => void run('remove')} className="pd-btn" style={{ color: toRemove.length ? 'var(--bad)' : undefined }}>
              {busy === 'remove' ? 'Saving…' : `Remove ${toRemove.length || ''}${toRemove.length ? ` ${toRemove.length === 1 ? 'person' : 'people'}` : ''}`.trim()}
            </button>
          : removeBlocked && <span style={{ fontSize: 12.5, color: 'var(--ink-3)', maxWidth: 360 }}>{removeBlocked}</span>}
      </div>
      {moving > 0 && <div style={{ fontSize: 12.5, color: 'var(--warn)' }}>{moving} of them {moving === 1 ? 'is' : 'are'} on another template now and will move to this one.</div>}

      <div style={{ overflowX: 'auto' }}>
        <div style={{ minWidth: 760 }}>
          <div style={TH(COLS)}><span /><Th>EMPLOYEE</Th><Th>TEAM</Th><Th>DESIGNATION</Th><Th>REPORTS TO</Th><Th>NOW</Th></div>
          {list.length === 0 && <div style={{ ...TR(COLS), color: 'var(--ink-3)', display: 'block' }}>Nobody matches.</div>}
          {list.slice(0, limit).map((e, i) => {
            const p = placement(e);
            return (
              <label key={e.id} className="dc-row" style={{ ...TR(COLS, i === Math.min(limit, list.length) - 1), cursor: 'pointer' }}>
                <input type="checkbox" checked={picked.has(e.id)} onChange={() => toggle(e.id)} style={tick} aria-label={`Tick ${e.name}`} />
                <Person e={e} />
                <span style={cellText}>{e.team || '—'}</span>
                <span style={cellText}>{e.role || '—'}</span>
                <span style={cellText}>{e.manager || '—'}</span>
                <span>{p.on ? <Pill label="On this template" tone={{ bg: 'var(--ok-bg)', fg: 'var(--ok)' }} /> : p.elsewhere ? <span style={{ ...cellSub, fontSize: 12.5 }}>{p.elsewhere}</span> : <span style={{ ...cellSub, fontSize: 12.5 }}>None</span>}</span>
              </label>
            );
          })}
          {list.length > limit && <div style={{ padding: '12px 0' }}><button type="button" onClick={() => setLimit((n) => n + PAGE)} className="pd-btn sm">Show {Math.min(PAGE, list.length - limit)} more</button></div>}
        </div>
      </div>
    </section>
  );
}

function PeopleTable({ rows, emptyText, extra }: { rows: Emp[]; emptyText: string; extra?: (e: Emp) => ReactNode }) {
  const [limit, setLimit] = useState(PAGE);
  const cols = '1.6fr 1fr 1fr 1fr 1.2fr';
  return (
    <div style={{ overflowX: 'auto' }}>
      <div style={{ minWidth: 720 }}>
        <div style={TH(cols)}><Th>EMPLOYEE</Th><Th>TEAM</Th><Th>DESIGNATION</Th><Th>REPORTS TO</Th><Th>{extra ? 'NOTE' : 'LOCATION'}</Th></div>
        {rows.length === 0 && <div style={{ ...TR(cols), color: 'var(--ink-3)', display: 'block' }}>{emptyText}</div>}
        {rows.slice(0, limit).map((e, i) => (
          <div key={e.id} style={TR(cols, i === Math.min(limit, rows.length) - 1)}>
            <Person e={e} />
            <span style={cellText}>{e.team || '—'}</span>
            <span style={cellText}>{e.role || '—'}</span>
            <span style={cellText}>{e.manager || '—'}</span>
            <span style={cellText}>{extra ? extra(e) : e.location || '—'}</span>
          </div>
        ))}
        {rows.length > limit && <div style={{ padding: '12px 0' }}><button type="button" onClick={() => setLimit((n) => n + PAGE)} className="pd-btn sm">Show {Math.min(PAGE, rows.length - limit)} more</button></div>}
      </div>
    </div>
  );
}

function Person({ e }: { e: Emp }) {
  const s = useStore();
  return (
    <span style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
      <Avatar name={e.name} size={30} font={12} src={e.photoUrl} />
      <span style={{ minWidth: 0 }}>
        <button type="button" onClick={(ev) => { ev.preventDefault(); s.openProfile(e.id); }} style={{ ...cellName, border: 'none', background: 'none', padding: 0, cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit', display: 'block' }}>{e.name}</button>
        <span style={{ ...cellSub, display: 'block' }}>{[e.employeeId, e.location].filter((x) => x && x !== '—').join(' · ')}</span>
      </span>
    </span>
  );
}

const cellText = { fontSize: 13.5, color: 'var(--ink)', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } as const;
const tick = { width: 16, height: 16, accentColor: 'var(--accent)', cursor: 'pointer', flexShrink: 0 } as const;
const chip = { display: 'inline-flex', alignItems: 'center', gap: 4, height: 26, padding: '0 4px 0 10px', borderRadius: 999, fontSize: 12.5, fontWeight: 500, background: 'var(--accent-soft)', color: 'var(--accent-ink)' } as const;
const chipX = { width: 20, height: 20, border: 'none', background: 'none', color: 'inherit', cursor: 'pointer', fontSize: 15, lineHeight: 1, borderRadius: 999, padding: 0 } as const;
