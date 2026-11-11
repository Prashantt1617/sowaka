// Pieces shared by the App usage tabs: the ratio row that opens a list of
// people, the list itself, the column chart and the small formatters.
import { useState } from 'react';
import type { ReactNode } from 'react';
import type { UsageGroup, UsagePersonDTO } from '../../../../services/engagement-usage';
import { GROUPS, GROUP_COLOR, GROUP_LONG, daysBetween, pct, plural, sd } from './format';
import { IconBell, IconChevronRight, IconClose } from '../../../icons';
import { PersonAvatar } from '../../../PersonAvatar';
import { SearchInput } from '../../../ui';
import { Td, Th } from '../../lookUi';
import * as L from '../../look';
import '../../look.css';
import './usage.css';

export type Person = UsagePersonDTO;

/** Last opened: the latest day with app activity; else their last sign-in, said as such. */
export function LastOpened({ p, today }: { p: Person; today: string }) {
  if (p.lastOpen) {
    const ago = daysBetween(p.lastOpen, today);
    return ago === 0 ? 'Today' : ago === 1 ? 'Yesterday' : sd(p.lastOpen);
  }
  if (p.lastLoginAt) {
    const d = new Date(new Date(p.lastLoginAt).getTime() + 330 * 60_000).toISOString().slice(0, 10);
    return <span className="ua-muted">Last sign-in {sd(d)}</span>;
  }
  return <span className="ua-muted">Never</span>;
}

export type Col = [string, (p: Person) => ReactNode];

/** People under a row: search, the first ten, Show all. */
export function PeopleList({
  people,
  cols,
  nameOf,
  onClose,
  action,
}: {
  people: Person[];
  cols: Col[];
  nameOf: (id: string) => string;
  onClose?: () => void;
  /** Something to do with the people shown, e.g. a reminder; given the filtered list. */
  action?: (shown: Person[]) => ReactNode;
}) {
  const [q, setQ] = useState('');
  const [all, setAll] = useState(false);
  const needle = q.trim().toLowerCase();
  const list = needle ? people.filter((p) => p.name.toLowerCase().includes(needle)) : people;
  const shown = all ? list : list.slice(0, 10);
  return (
    <div className="ua-list">
      <div className="ua-ptb">
        <SearchInput value={q} onChange={setQ} placeholder="Search a name" width={240} />
        <span className="sp" />
        {list.length > 0 && action?.(list)}
        {onClose && (
          <button type="button" className="lk-ghost" style={L.btnGhost} onClick={onClose}>
            <IconClose size={13} /> Close
          </button>
        )}
      </div>
      {list.length ? (
        <>
          <div className="ua-scroll">
            <table className="lk-t" style={L.table}>
              <thead>
                <tr>
                  <Th>Person</Th>
                  <Th>Manager</Th>
                  {cols.map(([label]) => <Th key={label}>{label}</Th>)}
                </tr>
              </thead>
              <tbody>
                {shown.map((p) => (
                  <tr key={p.id}>
                    <Td><Who p={p} /></Td>
                    <Td muted>{p.mgr ? nameOf(p.mgr) : '—'}</Td>
                    {cols.map(([label, cell]) => <Td key={label}>{cell(p)}</Td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {list.length > 10 && (
            <div style={{ marginTop: 10 }}>
              <button type="button" className="lk-ghost" style={L.btnGhost} onClick={() => setAll((v) => !v)}>
                {all ? 'Show fewer' : `Show all ${list.length}`}
              </button>
            </div>
          )}
        </>
      ) : (
        <p className="ua-muted" style={{ margin: 0, fontSize: 13 }}>{needle ? 'Nobody by that name.' : 'Nobody here.'}</p>
      )}
    </div>
  );
}

export function Who({ p }: { p: Person }) {
  return (
    <span style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
      <PersonAvatar name={p.name} userId={p.id} size={30} font={11} />
      <span style={{ minWidth: 0 }}>
        <span style={{ ...L.cellName, display: 'block' }}>{p.name}</span>
        <span style={{ ...L.cellSub, display: 'block' }}>{p.dept} · {p.loc}</span>
      </span>
    </span>
  );
}

/** A bar with "n of m" and the percentage. */
export function Fraction({ n, d }: { n: number; d: number }) {
  return (
    <div className="ua-fr">
      <div className="ua-track-bar"><i style={{ width: `${d ? (n / d) * 100 : 0}%` }} /></div>
      <span><b>{n}</b> of {d}</span>
      <em>{pct(n, d)}</em>
    </div>
  );
}

/** A row that opens the list of people who have not done it. */
export function RatioRow({
  id, open, onToggle, label, sub, n, d, missing, cols, nameOf, untracked, action,
}: {
  id: string;
  open: string;
  onToggle: (id: string) => void;
  label: string;
  sub?: string;
  n: number;
  d: number;
  missing: Person[];
  cols: Col[];
  nameOf: (id: string) => string;
  /** Built from app activity for a range before tracking began. */
  untracked?: boolean;
  action?: (shown: Person[]) => ReactNode;
}) {
  const on = open === id;
  return (
    <div className={`ua-rr${on ? ' on' : ''}`}>
      <button type="button" className="ua-rh" aria-expanded={on} onClick={() => onToggle(id)} disabled={untracked}>
        <div className="grow">
          <b>{label}</b>
          {sub && <span>{sub}</span>}
        </div>
        {untracked ? <span className="ua-muted" style={{ fontSize: 13 }}>Not tracked for these dates</span> : <Fraction n={n} d={d} />}
        <IconChevronRight size={14} />
      </button>
      {on && !untracked && <PeopleList people={missing} cols={cols} nameOf={nameOf} onClose={() => onToggle(id)} action={action} />}
    </div>
  );
}

export function Card({ title, note, right, children }: { title: string; note?: ReactNode; right?: ReactNode; children: ReactNode }) {
  return (
    <section className="ua-card">
      <div className="ua-card-h">
        <div>
          <h3>{title}</h3>
          {note && <small>{note}</small>}
        </div>
        {right}
      </div>
      {children}
    </section>
  );
}

export function Kpis({ items }: { items: [string, ReactNode, string][] }) {
  return (
    <div className="ua-kpi">
      {items.map(([label, value, sub]) => (
        <div key={label} className="ua-k">
          <span>{label}</span>
          <b>{value}</b>
          <small>{sub}</small>
        </div>
      ))}
    </div>
  );
}

/** A column chart: one column per bucket, stacked when it has several parts. */
export function Columns({
  cols,
  height = 170,
}: {
  cols: { key: string; label: string; parts: { v: number; color: string }[]; tip: string; off?: boolean; part?: boolean }[];
  height?: number;
}) {
  const [hover, setHover] = useState<string | null>(null);
  const max = Math.max(1, ...cols.map((c) => c.parts.reduce((s, p) => s + p.v, 0)));
  const every = cols.length > 18 ? Math.ceil(cols.length / 15) : 1;
  return (
    <div className="ua-cols" style={{ height }} onMouseLeave={() => setHover(null)}>
      {cols.map((c, i) => {
        const total = c.parts.reduce((s, p) => s + p.v, 0);
        return (
          <div key={c.key} className={`ua-col${c.off ? ' off' : ''}${c.part ? ' part' : ''}`} onMouseEnter={() => setHover(c.key)} aria-label={c.tip}>
            {hover === c.key && <span className="ua-tip">{c.tip}</span>}
            <div className="st" style={c.off ? undefined : { height: `${Math.round((total / max) * 100)}%` }}>
              {!c.off && c.parts.map((p, j) => (p.v ? <i key={j} style={{ flex: p.v, background: p.color }} /> : null))}
            </div>
            <span className="lb">{i % every === 0 ? c.label : ''}</span>
          </div>
        );
      })}
    </div>
  );
}

export function GroupLegend({ counts }: { counts?: Record<UsageGroup, number> }) {
  return (
    <div className="ua-legs">
      {GROUPS.map((g) => (
        <span key={g} className="ua-leg">
          <i style={{ background: GROUP_COLOR[g] }} />
          {GROUP_LONG[g]}{counts ? ` · ${plural(counts[g], 'person', 'people')}` : ''}
        </span>
      ))}
    </div>
  );
}

/** The button that sends a push to the people listed, after a confirmation. */
export function RemindButton({ count, onClick }: { count: number; onClick: () => void }) {
  return (
    <button type="button" className="lk-btn" style={L.btnSm} onClick={onClick} disabled={!count}>
      <IconBell size={13} /> Remind them with a push
    </button>
  );
}
