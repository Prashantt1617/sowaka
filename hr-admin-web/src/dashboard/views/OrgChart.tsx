// People › Org chart — a full-bleed, scrollable flow chart of the company,
// built from the reporting lines on the roster.
//
// The tree is whoever reports to whom: anyone without a manager is a root, and
// everyone else hangs off theirs. A cycle in the data (A reports to B reports to
// A) would otherwise recurse forever, so nodes are only ever visited once and
// anyone left over is shown as their own root rather than silently dropped.
// The connector lines come from the .oc-tree CSS block in styles.css.
import { useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import { useStore } from '../store';
import { Avatar } from '../ui';
import type { Emp } from '../seed';

type Kind = 'company' | 'founder' | 'normal';
type OrgNode = { id: string; name: string; title: string; kind?: Kind; children?: OrgNode[] };

/**
 * One person placed on the canvas, with the parent they hang off.
 */
type Placed = { node: OrgNode; x: number; y: number; depth: number; parent?: Placed };

/**
 * Two cards overlap only when they are within a card's width horizontally AND
 * its height vertically, so any pair further apart than the card's diagonal is
 * safe at every angle. Every distance below is measured against that, which is
 * what stops a ring collapsing onto itself at an awkward angle.
 */
const SAFE_APART = Math.hypot(190, 132);
const GAP_ALONG_RING = 26;
const GAP_BETWEEN_RINGS = 40;

/**
 * Lays the tree out as clusters rather than rows: the root sits in the middle,
 * its reports ring it, and each of those becomes the centre of its own ring.
 *
 * Every node claims an angular slice sized by how many leaves sit under it, so
 * a manager with eight reports gets eight times the arc of one with a single
 * report. Children are spread inside their parent's slice, centred on the
 * direction pointing away from the parent, which is what makes each manager
 * read as the middle of their own group.
 *
 * The ring radius is derived, not fixed: a card needs a chord of at least its
 * own width, and the chord across an angle is 2·r·sin(θ/2), so the radius is
 * whatever makes the *narrowest* slice wide enough to hold one. A fixed radius
 * is what made five reports in a narrow cone sit on top of each other.
 */
function layout(root: OrgNode, open: Set<string>): Placed[] {
  // A closed manager contributes nothing below them, so the ring they sit on
  // is sized for what is actually drawn rather than for a hidden subtree.
  const shown = (n: OrgNode): OrgNode[] => (open.has(n.id) ? n.children ?? [] : []);
  const leaves = (n: OrgNode): number => {
    const kids = shown(n);
    return kids.length === 0 ? 1 : kids.reduce((total, child) => total + leaves(child), 0);
  };

  const out: Placed[] = [];
  const place = (
    node: OrgNode, x: number, y: number, depth: number,
    from: number, to: number, parent?: Placed,
  ) => {
    const self: Placed = { node, x, y, depth, parent };
    out.push(self);
    const children = shown(node);
    if (children.length === 0) return;

    const total = children.reduce((sum, child) => sum + leaves(child), 0);
    // Below the root, children stay in a cone facing outward so a cluster never
    // wraps back over the manager it belongs to.
    const span = depth === 0 ? Math.PI * 2 : Math.min(to - from, Math.PI * 0.9);
    const slices = children.map((child) => (leaves(child) / total) * span);

    // Wide enough for the tightest slice to hold a card, and far enough out to
    // clear the parent's own card at any angle.
    const need = SAFE_APART + GAP_ALONG_RING;
    const narrowest = Math.min(...slices);
    const byChord = need / (2 * Math.sin(Math.min(narrowest, Math.PI) / 2));
    const minimum = SAFE_APART + GAP_BETWEEN_RINGS;
    // A single child has no one to collide with, so it sits at the minimum.
    const radius = children.length === 1 ? minimum : Math.max(minimum, byChord);

    let cursor = depth === 0 ? -Math.PI / 2 : (from + to) / 2 - span / 2;
    children.forEach((child, i) => {
      const slice = slices[i];
      const angle = cursor + slice / 2;
      place(
        child,
        x + Math.cos(angle) * radius,
        y + Math.sin(angle) * radius,
        depth + 1,
        angle - slice / 2, angle + slice / 2,
        self,
      );
      cursor += slice;
    });
  };
  place(root, 0, 0, 0, 0, Math.PI * 2);
  return out;
}

/**
 * The roster as a tree. Roots are people with no manager on the roster — the
 * founders in practice, but anyone whose manager has left counts too, which is
 * better than hiding them.
 */
function buildTree(emps: Emp[]): { roots: OrgNode[]; total: number } {
  const byId = new Map(emps.map((e) => [e.id, e]));
  const childrenOf = new Map<string, Emp[]>();
  const roots: Emp[] = [];
  for (const person of emps) {
    const managerId = person.managerId && byId.has(person.managerId) ? person.managerId : '';
    if (!managerId || managerId === person.id) roots.push(person);
    else childrenOf.set(managerId, [...(childrenOf.get(managerId) ?? []), person]);
  }

  const seen = new Set<string>();
  const toNode = (person: Emp, depth: number): OrgNode => {
    seen.add(person.id);
    const reports = (childrenOf.get(person.id) ?? [])
      .filter((child) => !seen.has(child.id))
      .sort((a, b) => a.name.localeCompare(b.name));
    return {
      id: person.id,
      name: person.name,
      title: person.role || person.team || 'Team member',
      // The top of the tree reads as leadership; everyone below is a member.
      kind: depth === 0 ? 'founder' : 'normal',
      children: reports.map((child) => toNode(child, depth + 1)),
    };
  };

  const tree = roots
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((person) => toNode(person, 0));
  // Anyone unreachable from a root — a reporting cycle — still gets shown.
  const orphans = emps.filter((e) => !seen.has(e.id)).map((person) => toNode(person, 0));
  return { roots: [...tree, ...orphans], total: emps.length };
}


export function OrgChart() {
  const { emps, loaded, user } = useStore();
  const { roots, total } = useMemo(() => buildTree(emps), [emps]);

  return (
    <div style={fullBleed}>
      {/* Header bar */}
      <div style={headerBar}>
        <div>
          <div style={{ fontSize: 20, fontWeight: 800, color: '#222222' }}>
            {user?.company ?? 'Organisation'} chart
          </div>
          <div style={{ fontSize: 14, color: '#717171', marginTop: 2 }}>
            {loaded
              ? `${total} people · ${roots.length} at the top — click a card to open or close their team`
              : 'Loading the roster…'}
          </div>
        </div>
        <div style={legend}>
          <LegendDot color="#0571A6" label="No manager" />
          <LegendDot color="#9197A2" label="Team member" />
        </div>
      </div>

      {/* Scroll canvas */}
      <div style={canvas} className="scry">
        {loaded && roots.length === 0 ? (
          <div style={{ padding: '60px 24px', textAlign: 'center', color: '#9197A2', fontSize: 15 }}>
            Nobody on the roster yet.
          </div>
        ) : (
          <div style={{ display: 'flex', gap: 60, padding: '40px 60px 80px', alignItems: 'flex-start' }}>
            {roots.map((root) => <Cluster key={root.name} root={root} />)}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * One root and whoever is currently expanded beneath them.
 *
 * Everything is not drawn at once on purpose: 218 people in concentric rings
 * needs a canvas tens of thousands of pixels wide, because the outermost ring
 * has to seat every leaf at a card's width apart. Opening a manager shows their
 * ring; closing it puts the space back.
 */
function Cluster({ root }: { root: OrgNode }) {
  const [open, setOpen] = useState<Set<string>>(() => new Set([root.id]));
  const placed = useMemo(() => layout(root, open), [root, open]);
  const toggle = (id: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });

  // The canvas is sized to what was actually laid out, with room for the cards
  // themselves, so nothing is clipped at the edges.
  const half = { x: CARD_W / 2 + 30, y: CARD_H / 2 + 30 };
  const minX = Math.min(...placed.map((p) => p.x)) - half.x;
  const maxX = Math.max(...placed.map((p) => p.x)) + half.x;
  const minY = Math.min(...placed.map((p) => p.y)) - half.y;
  const maxY = Math.max(...placed.map((p) => p.y)) + half.y;
  const width = maxX - minX;
  const height = maxY - minY;
  const at = (p: Placed) => ({ left: p.x - minX, top: p.y - minY });

  return (
    <div style={{ position: 'relative', width, height, flexShrink: 0 }}>
      {/* Connectors sit under the cards so a line never crosses a name. */}
      <svg width={width} height={height} style={{ position: 'absolute', inset: 0 }} aria-hidden>
        {placed.filter((p) => p.parent).map((p) => {
          const from = at(p.parent!);
          const to = at(p);
          return (
            <line
              key={`${p.parent!.node.name}-${p.node.name}`}
              x1={from.left} y1={from.top} x2={to.left} y2={to.top}
              stroke="#DCE0E6" strokeWidth={p.depth === 1 ? 2 : 1.4}
            />
          );
        })}
      </svg>
      {placed.map((p) => (
        <div
          key={p.node.name}
          style={{
            position: 'absolute',
            left: at(p).left, top: at(p).top,
            transform: 'translate(-50%, -50%)',
          }}
        >
          <NodeCard
            n={p.node}
            depth={p.depth}
            reports={(p.node.children ?? []).length}
            open={open.has(p.node.id)}
            onToggle={() => toggle(p.node.id)}
          />
        </div>
      ))}
    </div>
  );
}

const CARD_W = 190;
const CARD_H = 132;

function NodeCard({ n, depth, reports, open, onToggle }: {
  n: OrgNode; depth: number; reports: number; open: boolean; onToggle: () => void;
}) {
  const founder = depth === 0;
  return (
    <div
      onClick={reports > 0 ? onToggle : undefined}
      title={reports > 0 ? (open ? 'Hide this team' : 'Show this team') : undefined}
      style={{
        ...cardBase, ...(founder ? founderCard : normalCard), whiteSpace: 'normal',
        cursor: reports > 0 ? 'pointer' : 'default',
      }}
    >
      <div style={{ position: 'relative', marginBottom: 8 }}>
        <Avatar name={n.name} size={founder ? 52 : 44} font={founder ? 16 : 14} />
        {founder && <span style={founderBadge}>★</span>}
      </div>
      <div style={{ fontSize: founder ? 16 : 14, fontWeight: 700, color: '#222222' }}>{n.name}</div>
      <div style={{ fontSize: 12, color: '#717171', marginTop: 2, lineHeight: 1.35 }}>{n.title}</div>
      {reports > 0 && (
        <div style={open ? reportsTagOpen : reportsTag}>
          {open ? '−' : '+'} {reports} {reports === 1 ? 'report' : 'reports'}
        </div>
      )}
    </div>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 14, color: '#717171', fontWeight: 600 }}>
      <span style={{ width: 11, height: 11, borderRadius: '50%', background: color }} />
      {label}
    </span>
  );
}

// —— styles ————————————————————————————————————————————————————————————
// Break out of the padded content area to fill the viewport, with an internal
// scroll region (page padding is 28px top / 34px sides / 60px bottom).
const fullBleed: CSSProperties = {
  margin: '-28px -34px -60px',
  height: 'calc(100% + 88px)',
  display: 'flex',
  flexDirection: 'column',
  background: '#F7F7F9',
};
const headerBar: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 16,
  padding: '16px 34px',
  borderBottom: '1px solid #EBEBEB',
  background: '#F7F7F9',
  flexShrink: 0,
};
const legend: CSSProperties = { marginLeft: 'auto', display: 'flex', gap: 18, alignItems: 'center' };
const canvas: CSSProperties = { flex: 1, overflow: 'auto' };

const reportsTagOpen: CSSProperties = {
  marginTop: 7, fontSize: 11.5, fontWeight: 800, letterSpacing: '.02em',
  color: '#717171', background: '#F0F0F2', border: '1px solid #E4E4E8',
  borderRadius: 20, padding: '2px 9px',
};
const reportsTag: CSSProperties = {
  marginTop: 7, fontSize: 11.5, fontWeight: 800, letterSpacing: '.02em',
  color: '#4A6FA5', background: '#EEF3FA', border: '1px solid #DEE8F4',
  borderRadius: 20, padding: '2px 9px',
};
const cardBase: CSSProperties = {
  display: 'inline-flex',
  flexDirection: 'column',
  alignItems: 'center',
  width: CARD_W - 14,
  padding: '14px 14px 12px',
  borderRadius: 14,
  background: '#fff',
  boxShadow: '0 3px 10px rgba(34,34,34,.07)',
  textAlign: 'center',
};
const normalCard: CSSProperties = { border: '1px solid #EBEBEB' };
const founderCard: CSSProperties = { border: '2px solid #0571A6', boxShadow: '0 6px 18px rgba(5,113,166,.16)', width: CARD_W };
const founderBadge: CSSProperties = {
  position: 'absolute',
  right: -4,
  bottom: -2,
  width: 20,
  height: 20,
  borderRadius: '50%',
  background: '#0571A6',
  color: '#fff',
  border: '2px solid #fff',
  fontSize: 12,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
};
