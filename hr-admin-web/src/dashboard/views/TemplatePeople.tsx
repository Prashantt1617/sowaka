// The people side of a template (Shifts, Performance and Onboarding templates): who
// is on it, and adding or removing them. One search box for both, in plain words:
// "3D team under Ravi", "interns in Gurgaon", "joined after March 2026", "not on
// this template". What the words can't place is read by Suwi; what was
// understood shows as chips that can be taken off one by one.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useStore } from '../store';
import type { Emp } from '../seed';
import { Avatar, SearchInput, StatusTabs, Th } from '../ui';
import { TH, TR, cellName, cellSub, note as noteBox } from '../ds';
import { smartPeopleSearch } from '../../services/hrms';
import { applyPeopleFilter, chipsOf, EMPTY_FILTER, isEmptyFilter, mergeFilters, parsePeopleQuery } from '../peopleQuery';
import type { FilterChip, PeopleFilter } from '../peopleQuery';

const PAGE = 50;

/** Where someone is now, for the Edit employees list. */
export type Placement = { on: boolean; elsewhere?: string };

/** A column after the name, for a template whose people are not the usual employees (joiners: stage, joining date). */
export type PeopleColumn = { head: string; cell: (e: Emp) => ReactNode; width?: string };
/** What the people are called: ['person', 'people'] by default, ['joiner', 'joiners'] on an onboarding template. */
export type PeopleNoun = [one: string, many: string];
const PEOPLE: PeopleNoun = ['person', 'people'];
const count = (n: number, [one, many]: PeopleNoun) => `${n} ${n === 1 ? one : many}`;
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** The usual columns: team, designation, manager (and the location, or a note, on the members' list). */
const BASE_COLUMNS: PeopleColumn[] = [
  { head: 'TEAM', cell: (e) => e.team || '—', width: '0.8fr' },
  { head: 'DESIGNATION', cell: (e) => e.role || '—', width: '1fr' },
  { head: 'REPORTS TO', cell: (e) => e.manager || '—', width: '0.9fr' },
];

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
export function TemplateMembers({ members, note, emptyText, extra, title = 'Employees on this template', noun = PEOPLE, columns, onOpen, placeholder }: {
  members: Emp[]; note?: ReactNode; emptyText: string; extra?: (e: Emp) => ReactNode;
  title?: string; noun?: PeopleNoun;
  /** In place of team, designation, manager and location. */
  columns?: PeopleColumn[];
  /** What a name opens (the profile by default). */
  onOpen?: (e: Emp) => void;
  placeholder?: string;
}) {
  const [shown, setShown] = useState<Emp[]>(members);
  const [filtering, setFiltering] = useState(false);
  const isOn = useMemo(() => () => true, []);
  const list = filtering ? shown : members;
  const cols = columns ?? [...BASE_COLUMNS.map((c) => ({ ...c, width: '1fr' })), { head: extra ? 'NOTE' : 'LOCATION', cell: (e: Emp) => (extra ? extra(e) : e.location || '—'), width: '1.2fr' }];
  return (
    <section className="pd-card" style={{ display: 'grid', gap: 14 }}>
      <div className="pd-card-h" style={{ marginBottom: 0 }}>
        <h3>{title}</h3>
        <small>{filtering ? `${list.length} of ${members.length}` : count(members.length, noun)}</small>
      </div>
      {note && <div style={{ ...noteBox, display: 'block' }}>{note}</div>}
      <PeopleSearch emps={members} onTemplate={isOn} onChange={(s, f) => { setShown(s); setFiltering(f); }} placeholder={placeholder ?? 'Search: 3D team, under Ravi, interns in Gurgaon, joined this year…'} />
      <PeopleTable rows={list} emptyText={filtering ? 'Nobody on this template matches.' : emptyText} columns={cols} onOpen={onOpen} noun={noun} />
    </section>
  );
}

/** Edit employees: everyone, searchable, ticked to add or take off. */
export function TemplateEditPeople({
  emps, placement, onAdd, onRemove, note, removeBlocked, addWord = 'Add', noun = PEOPLE, columns, onOpen, placeholders,
}: {
  emps: Emp[];
  placement: (e: Emp) => Placement;
  onAdd: (ids: string[]) => Promise<void>;
  /** Absent: people can't be taken off here (the default shift); `removeBlocked` says why. */
  onRemove?: (ids: string[]) => Promise<void>;
  note?: ReactNode;
  removeBlocked?: string;
  addWord?: string;
  noun?: PeopleNoun;
  /** In place of team, designation and manager (the last column, where they are now, stays). */
  columns?: PeopleColumn[];
  onOpen?: (e: Emp) => void;
  placeholders?: { add: string; remove: string };
}) {
  const cols = columns ?? BASE_COLUMNS;
  const editCols = `20px 1.5fr ${cols.map((c) => c.width ?? '1fr').join(' ')} 0.9fr`;
  const many = noun[1];
  // Adding and removing are separate lists: who is not on it yet, and who is.
  const [mode, setMode] = useState<'add' | 'remove'>('add');
  const pool = useMemo(() => emps.filter((e) => (mode === 'add' ? !placement(e).on : placement(e).on)), [emps, placement, mode]);
  const [shown, setShown] = useState<Emp[]>(pool);
  const [filtering, setFiltering] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState('');
  const [limit, setLimit] = useState(PAGE);
  const onTemplate = useMemo(() => (e: Emp) => placement(e).on, [placement]);
  const list = filtering ? shown : pool;
  useEffect(() => { setLimit(PAGE); }, [list]);
  const switchTo = (m: 'add' | 'remove') => { setMode(m); setPicked(new Set()); setFiltering(false); };

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
        <h3>{mode === 'add' ? `Add ${many} to this template` : `Remove ${many} from this template`}</h3>
        <small>{filtering ? `${list.length} of ${pool.length}` : count(pool.length, noun)}</small>
      </div>
      <div style={{ justifySelf: 'start' }}>
        <StatusTabs<'add' | 'remove'> options={['add', 'remove']} active={mode} onSelect={switchTo} labels={{ add: `Add ${many}`, remove: `Remove ${many}` }} />
      </div>
      {note && <div style={{ ...noteBox, display: 'block' }}>{note}</div>}
      {mode === 'remove' && !onRemove ? (
        <div style={{ ...noteBox, display: 'block' }}>{removeBlocked ?? `${cap(many)} can’t be taken off this template here.`}</div>
      ) : (<>
      <PeopleSearch key={mode} emps={pool} onTemplate={onTemplate} onChange={(s, f) => { setShown(s); setFiltering(f); }}
        placeholder={placeholders ? placeholders[mode] : mode === 'add' ? 'Who to add? e.g. people on the 3D team under Ravi, interns in Gurgaon' : 'Who to remove? e.g. Sales team, joined before 2025'} />

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--ink-2)', cursor: 'pointer' }}>
          <input type="checkbox" id="pick-all" checked={allShown} onChange={() => setPicked((p) => { const n = new Set(p); for (const e of list) { if (allShown) n.delete(e.id); else n.add(e.id); } return n; })} style={tick} />
          {allShown ? 'Untick all shown' : `Tick all ${list.length} shown`}
        </label>
        <span style={{ flex: 1 }} />
        {picked.size > 0 && <span style={{ fontSize: 12.5, color: 'var(--ink-3)' }}>{picked.size} ticked</span>}
        {mode === 'add'
          ? <button type="button" id="people-add" disabled={!!busy || toAdd.length === 0} onClick={() => void run('add')} className="pd-btn primary">
              {busy === 'add' ? 'Saving…' : `${addWord} ${toAdd.length ? count(toAdd.length, noun) : ''}`.trim()}
            </button>
          : <button type="button" id="people-remove" disabled={!!busy || toRemove.length === 0} onClick={() => void run('remove')} className="pd-btn danger">
              {busy === 'remove' ? 'Saving…' : `Remove ${toRemove.length ? count(toRemove.length, noun) : ''}`.trim()}
            </button>}
      </div>
      {mode === 'add' && moving > 0 && <div style={{ fontSize: 12.5, color: 'var(--warn)' }}>{moving} of them {moving === 1 ? 'is' : 'are'} on another template now and will move to this one.</div>}

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 220px', gap: 16, alignItems: 'start' }}>
        <div style={{ minWidth: 0 }}>
          <div style={TH(editCols)}><span /><Th>{nameHead(noun)}</Th>{cols.map((c) => <Th key={c.head}>{c.head}</Th>)}<Th>NOW</Th></div>
          {list.length === 0 && <div style={{ ...TR(editCols), color: 'var(--ink-3)', display: 'block' }}>{pool.length === 0 ? (mode === 'remove' ? 'Nobody is on this template yet.' : 'Everyone is already on this template.') : 'Nobody matches.'}</div>}
          {list.slice(0, limit).map((e, i) => {
            const p = placement(e);
            return (
              <label key={e.id} className="dc-row" style={{ ...TR(editCols, i === Math.min(limit, list.length) - 1), alignItems: 'start', cursor: 'pointer' }}>
                <input type="checkbox" checked={picked.has(e.id)} onChange={() => toggle(e.id)} style={{ ...tick, marginTop: 7 }} aria-label={`Tick ${e.name}`} />
                <Person e={e} onOpen={onOpen} />
                {cols.map((c) => <span key={c.head} style={wrapText}>{c.cell(e)}</span>)}
                <span style={{ ...wrapText, fontSize: 12.5, color: p.on ? 'var(--ok)' : 'var(--ink-3)', fontWeight: p.on ? 500 : 400 }}>{p.on ? 'On this template' : p.elsewhere ?? 'None'}</span>
              </label>
            );
          })}
          {list.length > limit && <div style={{ padding: '12px 0' }}><button type="button" onClick={() => setLimit((n) => n + PAGE)} className="pd-btn sm">Show {Math.min(PAGE, list.length - limit)} more</button></div>}
        </div>

        {/* Everyone ticked, wherever the search has moved since: the cart. */}
        <aside id="people-cart" style={{ position: 'sticky', top: 12, border: '1px solid var(--line)', borderRadius: 14, background: 'var(--surface-2)', padding: '12px 12px 8px', display: 'grid', gap: 6 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--ink)' }}>{mode === 'add' ? 'To add' : 'To remove'}</span>
            <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>{picked.size}</span>
            <span style={{ flex: 1 }} />
            {picked.size > 0 && <button type="button" onClick={() => setPicked(new Set())} className="pd-btn ghost sm" style={{ height: 24, padding: '0 6px', fontSize: 12 }}>Clear</button>}
          </div>
          {picked.size === 0 && <div style={{ fontSize: 12.5, color: 'var(--ink-3)', lineHeight: 1.45, paddingBottom: 6 }}>Tick {many} in the list; they collect here.</div>}
          <div style={{ display: 'grid', gap: 2, maxHeight: 420, overflowY: 'auto' }}>
            {ids.map((id) => {
              const e = emps.find((x) => x.id === id);
              if (!e) return null;
              return (
                <div key={id} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 2px', fontSize: 13, color: 'var(--ink)' }}>
                  <span style={{ flex: 1, minWidth: 0, lineHeight: 1.35 }}>{e.name}</span>
                  <button type="button" aria-label={`Untick ${e.name}`} onClick={() => toggle(id)} style={{ ...chipX, color: 'var(--ink-3)' }}>×</button>
                </div>
              );
            })}
          </div>
        </aside>
      </div>
      </>)}
    </section>
  );
}

function PeopleTable({ rows, emptyText, columns, onOpen, noun = PEOPLE }: { rows: Emp[]; emptyText: string; columns: PeopleColumn[]; onOpen?: (e: Emp) => void; noun?: PeopleNoun }) {
  const [limit, setLimit] = useState(PAGE);
  const cols = `1.6fr ${columns.map((c) => c.width ?? '1fr').join(' ')}`;
  return (
    <div style={{ overflowX: 'auto' }}>
      <div style={{ minWidth: 720 }}>
        <div style={TH(cols)}><Th>{nameHead(noun)}</Th>{columns.map((c) => <Th key={c.head}>{c.head}</Th>)}</div>
        {rows.length === 0 && <div style={{ ...TR(cols), color: 'var(--ink-3)', display: 'block' }}>{emptyText}</div>}
        {rows.slice(0, limit).map((e, i) => (
          <div key={e.id} style={TR(cols, i === Math.min(limit, rows.length) - 1)}>
            <Person e={e} onOpen={onOpen} />
            {columns.map((c) => <span key={c.head} style={cellText}>{c.cell(e)}</span>)}
          </div>
        ))}
        {rows.length > limit && <div style={{ padding: '12px 0' }}><button type="button" onClick={() => setLimit((n) => n + PAGE)} className="pd-btn sm">Show {Math.min(PAGE, rows.length - limit)} more</button></div>}
      </div>
    </div>
  );
}

/** The name column's head: EMPLOYEE, or the noun (JOINER). */
const nameHead = (noun: PeopleNoun) => (noun === PEOPLE ? 'EMPLOYEE' : noun[0].toUpperCase());

function Person({ e, onOpen }: { e: Emp; onOpen?: (e: Emp) => void }) {
  const s = useStore();
  return (
    <span style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
      <Avatar name={e.name} size={30} font={12} src={e.photoUrl} />
      <span style={{ minWidth: 0 }}>
        <button type="button" onClick={(ev) => { ev.preventDefault(); if (onOpen) onOpen(e); else s.openProfile(e.id); }} style={{ ...cellName, border: 'none', background: 'none', padding: 0, cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit', display: 'block' }}>{e.name}</button>
        <span style={{ ...cellSub, display: 'block' }}>{[e.employeeId, e.location].filter((x) => x && x !== '—').join(' · ')}</span>
      </span>
    </span>
  );
}

const cellText = { fontSize: 13.5, color: 'var(--ink)', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } as const;
/** Long values wrap onto a second line instead of being cut off. */
const wrapText = { fontSize: 13, lineHeight: 1.4, color: 'var(--ink)', minWidth: 0, whiteSpace: 'normal', overflowWrap: 'anywhere' } as const;
const tick = { width: 16, height: 16, accentColor: 'var(--accent)', cursor: 'pointer', flexShrink: 0 } as const;
const chip = { display: 'inline-flex', alignItems: 'center', gap: 4, height: 26, padding: '0 4px 0 10px', borderRadius: 999, fontSize: 12.5, fontWeight: 500, background: 'var(--accent-soft)', color: 'var(--accent-ink)' } as const;
const chipX = { width: 20, height: 20, border: 'none', background: 'none', color: 'inherit', cursor: 'pointer', fontSize: 15, lineHeight: 1, borderRadius: 999, padding: 0 } as const;
