// People › Org chart — the company as a tree that reads left to right, on a
// canvas you can zoom and drag.
//
// The head of the company sits on the left. Their reports stack in a column
// beside them, each joined to the head by its own curve, and each report's
// team is the next column along. Siblings stack, so the card above someone is
// never their manager — the curve says who is — and a big team makes the chart
// taller rather than wider, which is the way a screen scrolls.
//
// The tree is whoever reports to whom: anyone without a manager on the roster
// is a root, and everyone else hangs off theirs. A cycle in the data (A reports
// to B reports to A) would otherwise recurse forever, so nodes are only ever
// visited once and anyone left over is shown as their own root rather than
// silently dropped.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, MouseEvent as ReactMouseEvent } from 'react';
import { useStore } from '../store';
import { Avatar } from '../ui';
import type { Emp } from '../seed';

type OrgNode = {
  id: string;
  name: string;
  title: string;
  team: string;
  photoUrl: string;
  children: OrgNode[];
};

// ── geometry ─────────────────────────────────────────────────────────────
const ROOT_W = 344;
const ROOT_H = 80;
const LEAD_W = 332;
const LEAD_H = 78;
const MEMBER_W = 284;
const MEMBER_H = 60;
/** Room between one level and the next, where the curves run. */
const LINK_W = 84;
/** Between siblings, and a little more between one team and the next. */
const GAP = 12;
const TEAM_GAP = 22;
const ROOT_GAP = 96;
const PAD = 72;
/** More reports than this and the root's fan out on both sides of them. */
const SPLIT_AT = 8;

const sizeAt = (depth: number): [number, number] =>
  depth === 0 ? [ROOT_W, ROOT_H] : depth === 1 ? [LEAD_W, LEAD_H] : [MEMBER_W, MEMBER_H];
const kindAt = (depth: number): Box['kind'] => (depth === 0 ? 'root' : depth === 1 ? 'lead' : 'row');

/** Where a person's card ended up on the canvas. */
type Box = { node: OrgNode; x: number; y: number; w: number; h: number; kind: 'root' | 'lead' | 'row' };
type Line = { d: string; strong?: boolean };
type Link = { x1: number; y1: number; x2: number; y2: number; strong: boolean };
type Layout = { boxes: Box[]; lines: Line[]; width: number; height: number };

/**
 * The roster as a tree. Roots are people with no manager on the roster — the
 * head of the company in practice, but anyone whose manager has left counts
 * too, which is better than hiding them.
 */
function buildTree(emps: Emp[]): OrgNode[] {
  const byId = new Map(emps.map((e) => [e.id, e]));
  const childrenOf = new Map<string, Emp[]>();
  const roots: Emp[] = [];
  for (const person of emps) {
    const managerId = person.managerId && byId.has(person.managerId) ? person.managerId : '';
    if (!managerId || managerId === person.id) roots.push(person);
    else childrenOf.set(managerId, [...(childrenOf.get(managerId) ?? []), person]);
  }
  const seen = new Set<string>();
  const toNode = (person: Emp): OrgNode => {
    seen.add(person.id);
    const reports = (childrenOf.get(person.id) ?? [])
      .filter((child) => !seen.has(child.id))
      // Managers first, so the people who head sub-teams sit at the top of a
      // column, then everyone else by name.
      .sort((a, b) => {
        const aHas = (childrenOf.get(a.id) ?? []).length > 0 ? 0 : 1;
        const bHas = (childrenOf.get(b.id) ?? []).length > 0 ? 0 : 1;
        return aHas - bHas || a.name.localeCompare(b.name);
      });
    return {
      id: person.id,
      name: person.name,
      title: person.role || 'Team member',
      team: person.team === '—' ? '' : person.team,
      photoUrl: person.photoUrl,
      children: reports.map(toNode),
    };
  };
  const tree = roots.sort((a, b) => a.name.localeCompare(b.name)).map(toNode);
  const orphans = emps.filter((e) => !seen.has(e.id)).map(toNode);
  return [...tree, ...orphans];
}

/** Everyone under a node, however deep. */
const headcount = (n: OrgNode): number => n.children.reduce((sum, k) => sum + 1 + headcount(k), 0);

/**
 * Tidy tree, rotated: depth runs outward from the root, siblings stack top to
 * bottom. A node's span is the taller of its own card and its children's
 * spans laid end to end; children are stacked inside that span and the parent
 * centred on them. Each link is a cubic curve leaving the parent's edge and
 * arriving at the child's, so a team fans out from one point and there is no
 * doubt whose team it is.
 *
 * A manager with many reports would make one very tall column, so past
 * SPLIT_AT their reports are dealt onto both sides — the chart grows outward
 * instead of downward, and the space either side of the root gets used.
 */
function layout(roots: OrgNode[], collapsed: Set<string>): Layout {
  const boxes: Box[] = [];
  const links: Link[] = [];
  const kids = (n: OrgNode) => (collapsed.has(n.id) ? [] : n.children);

  const spans = new Map<string, number>();
  const span = (n: OrgNode, depth: number): number => {
    const own = sizeAt(depth)[1] + GAP;
    const children = kids(n).reduce((sum, k) => sum + span(k, depth + 1), 0);
    const total = Math.max(own, children + (children ? TEAM_GAP : 0));
    spans.set(n.id, total);
    return total;
  };

  /** Stacks a run of children beside a parent, on one side, and links them. */
  const stack = (parent: Box, list: OrgNode[], depth: number, top: number, dir: 1 | -1) => {
    let cy = top;
    for (const k of list) {
      const [cw] = sizeAt(depth);
      const cx = dir > 0 ? parent.x + parent.w + LINK_W : parent.x - LINK_W - cw;
      const child = place(k, depth, cx, cy, dir);
      links.push({
        x1: dir > 0 ? parent.x + parent.w : parent.x, y1: parent.y + parent.h / 2,
        x2: dir > 0 ? child.x : child.x + child.w, y2: child.y + child.h / 2,
        strong: depth === 1,
      });
      cy += spans.get(k.id) ?? 0;
    }
  };

  const place = (n: OrgNode, depth: number, x: number, top: number, dir: 1 | -1): Box => {
    const [w, h] = sizeAt(depth);
    const ks = kids(n);
    let total = spans.get(n.id) ?? h + GAP;

    // Past the split, deal reports onto both sides, each side taking the next
    // report while it is the shorter — so the two columns end up level. Only
    // the root has both sides free: anyone deeper already has their own
    // manager on one side, and dealing half a team that way lands it on top
    // of the neighbouring columns.
    if (depth === 0 && ks.length > SPLIT_AT) {
      const right: OrgNode[] = [], left: OrgNode[] = [];
      let rs = 0, ls = 0;
      for (const k of ks) {
        const sp = spans.get(k.id) ?? 0;
        if (rs <= ls) { right.push(k); rs += sp; } else { left.push(k); ls += sp; }
      }
      total = Math.max(h + GAP, Math.max(rs, ls) + TEAM_GAP);
      spans.set(n.id, total);
      const self: Box = { node: n, x, y: top + (total - h) / 2, w, h, kind: kindAt(depth) };
      boxes.push(self);
      stack(self, right, depth + 1, top + (total - rs) / 2, 1);
      stack(self, left, depth + 1, top + (total - ls) / 2, -1);
      return self;
    }

    const childrenSpan = ks.reduce((sum, k) => sum + (spans.get(k.id) ?? 0), 0);
    const self: Box = { node: n, x, y: top + (total - h) / 2, w, h, kind: kindAt(depth) };
    boxes.push(self);
    stack(self, ks, depth + 1, top + (total - childrenSpan) / 2, dir);
    return self;
  };

  let top = PAD;
  for (const root of roots) {
    const total = span(root, 0);
    // The root's own span has to allow for a split before anything is placed.
    place(root, 0, 0, top, 1);
    top += (spans.get(root.id) ?? total) + ROOT_GAP;
  }

  // Everything was placed with the root at x = 0; shift it into the canvas.
  const minX = Math.min(...boxes.map((b) => b.x));
  const maxX = Math.max(...boxes.map((b) => b.x + b.w));
  const dx = PAD - minX;
  for (const b of boxes) b.x += dx;
  const c = LINK_W / 2;
  const lines: Line[] = links.map((l) => {
    const x1 = l.x1 + dx, x2 = l.x2 + dx;
    const bend = x2 >= x1 ? c : -c;
    return { d: `M ${x1} ${l.y1} C ${x1 + bend} ${l.y1}, ${x2 - bend} ${l.y2}, ${x2} ${l.y2}`, strong: l.strong };
  });
  return { boxes, lines, width: maxX - minX + PAD * 2, height: top - ROOT_GAP + PAD };
}

/** The node with this id, wherever it sits. */
function findNode(roots: OrgNode[], id: string): OrgNode | null {
  for (const r of roots) {
    if (r.id === id) return r;
    const hit = findNode(r.children, id);
    if (hit) return hit;
  }
  return null;
}

/** Every manager above a node, so a search hit can be uncovered. */
function ancestorsOf(roots: OrgNode[], id: string): string[] {
  const path: string[] = [];
  const walk = (n: OrgNode, trail: string[]): boolean => {
    if (n.id === id) { path.push(...trail); return true; }
    return n.children.some((k) => walk(k, [...trail, n.id]));
  };
  roots.some((r) => walk(r, []));
  return path;
}

const ZOOM_MIN = 0.3;
const ZOOM_MAX = 2;
/** Fit-to-screen stops here: smaller than this and names cannot be read. */
const FIT_MIN = 0.6;
/** …and no bigger than this, or a five-person company becomes a poster. */
const FIT_MAX = 1.35;

export function OrgChart() {
  const { emps, loaded, user, setEmpDrawerId, orgChartFocus, setOrgChartFocus } = useStore();
  const fullRoots = useMemo(() => buildTree(emps), [emps]);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [query, setQuery] = useState('');

  // Centring on a manager makes them the root of what is drawn: their team
  // fans out on both sides of them the way the head's does, which no card
  // deeper in the tree can do in place — one of its sides is always facing
  // its own manager. The chain above them stays on screen as a trail.
  const [focusId, setFocusId] = useState<string | null>(orgChartFocus);
  // Consumed on arrival, so the next plain visit opens on the whole org.
  useEffect(() => { if (orgChartFocus) setOrgChartFocus(null); }, [orgChartFocus, setOrgChartFocus]);
  /** Where each centring came from, so the spotlight on the centre card steps back. */
  const focusStack = useRef<(string | null)[]>([]);
  const focused = useMemo(() => (focusId ? findNode(fullRoots, focusId) : null), [fullRoots, focusId]);
  const roots = useMemo(() => (focused ? [focused] : fullRoots), [focused, fullRoots]);
  const trail = useMemo(
    () => (focused ? [...ancestorsOf(fullRoots, focused.id).map((id) => findNode(fullRoots, id)), focused].filter((n): n is OrgNode => !!n) : []),
    [fullRoots, focused],
  );

  const chart = useMemo(() => layout(roots, collapsed), [roots, collapsed]);
  const managers = useMemo(() => emps.filter((e) => emps.some((o) => o.managerId === e.id)).length, [emps]);
  const teams = useMemo(() => new Set(emps.map((e) => e.team).filter((t) => t && t !== '—')).size, [emps]);

  /** Every manager below the roots: what "Collapse teams" folds. */
  const foldable = useMemo(() => {
    const ids = new Set<string>();
    const walk = (n: OrgNode, depth: number) => {
      if (depth > 0 && n.children.length) ids.add(n.id);
      n.children.forEach((k) => walk(k, depth + 1));
    };
    roots.forEach((r) => walk(r, 0));
    return ids;
  }, [roots]);

  // Teams start folded: the first screen is the head and their leads, and a
  // team opens when someone asks for it rather than all thirty at once.
  const seeded = useRef(false);
  useEffect(() => {
    if (seeded.current || roots.length === 0) return;
    seeded.current = true;
    setCollapsed(new Set(foldable));
  }, [roots, foldable]);

  // ── search ────────────────────────────────────────────────────────────
  const needle = query.trim().toLowerCase();
  const matches = useMemo(() => {
    if (!needle) return new Set<string>();
    const hit = (n: OrgNode) =>
      n.name.toLowerCase().includes(needle) || n.title.toLowerCase().includes(needle) || n.team.toLowerCase().includes(needle);
    const ids = new Set<string>();
    const walk = (n: OrgNode) => { if (hit(n)) ids.add(n.id); n.children.forEach(walk); };
    roots.forEach(walk);
    return ids;
  }, [needle, roots]);

  useEffect(() => {
    if (matches.size === 0) return;
    // A match folded away under its manager is no use; open the way to it.
    setCollapsed((prev) => {
      const next = new Set(prev);
      for (const id of matches) ancestorsOf(roots, id).forEach((a) => next.delete(a));
      return next.size === prev.size ? prev : next;
    });
  }, [matches, roots]);

  // ── zoom and pan ──────────────────────────────────────────────────────
  const viewport = useRef<HTMLDivElement>(null);
  const [view, setView] = useState({ scale: 1, x: 0, y: 0 });
  const drag = useRef<{ x: number; y: number; vx: number; vy: number; moved: boolean } | null>(null);

  const fit = () => {
    const box = viewport.current?.getBoundingClientRect();
    if (!box || chart.width === 0 || box.width < 100 || box.height < 100) return;
    // Fill the viewport: a small company scales up to use the room, a large
    // one scales down to fit, within the range where cards still read well.
    const scale = Math.max(FIT_MIN, Math.min(box.width / chart.width, box.height / chart.height, FIT_MAX));
    setView({
      scale,
      x: Math.max(0, (box.width - chart.width * scale) / 2),
      y: Math.max(0, (box.height - chart.height * scale) / 2),
    });
  };
  // Until someone moves the view themselves, it keeps fitting: the page is
  // still settling its height when the chart first appears, and a fit taken
  // against a half-sized viewport leaves the chart hugging the top.
  const interacted = useRef(false);
  const fitRef = useRef(fit);
  fitRef.current = fit;
  useLayoutEffect(() => {
    if (chart.boxes.length === 0 || !seeded.current || interacted.current) return;
    fitRef.current();
  }, [chart]);
  useEffect(() => {
    const el = viewport.current;
    if (!el) return;
    const ro = new ResizeObserver(() => { if (!interacted.current) fitRef.current(); });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  /** Scales about a point in viewport coordinates, so what is under the cursor stays put. */
  const zoomAt = (factor: number, cx?: number, cy?: number) => {
    interacted.current = true;
    setView((v) => {
      const scale = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, v.scale * factor));
      const box = viewport.current?.getBoundingClientRect();
      const px = cx ?? (box?.width ?? 0) / 2;
      const py = cy ?? (box?.height ?? 0) / 2;
      const k = scale / v.scale;
      return { scale, x: px - (px - v.x) * k, y: py - (py - v.y) * k };
    });
  };

  useEffect(() => {
    const el = viewport.current;
    if (!el) return;
    // React registers wheel listeners as passive, and a passive listener cannot
    // stop the page from scrolling — so this one is attached by hand.
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const box = el.getBoundingClientRect();
      if (e.ctrlKey || e.metaKey) {
        zoomAt(Math.exp(-e.deltaY * 0.01), e.clientX - box.left, e.clientY - box.top);
      } else {
        interacted.current = true;
        setView((v) => ({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY }));
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  const onMouseDown = (e: ReactMouseEvent) => {
    if (e.button !== 0) return;
    drag.current = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y, moved: false };
    const move = (ev: MouseEvent) => {
      const d = drag.current;
      if (!d) return;
      const dx = ev.clientX - d.x;
      const dy = ev.clientY - d.y;
      if (Math.hypot(dx, dy) > 4) { d.moved = true; interacted.current = true; }
      if (d.moved) setView((v) => ({ ...v, x: d.vx + dx, y: d.vy + dy }));
    };
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      // Cleared on the next tick so a card's click handler can still tell a
      // drag from a click.
      setTimeout(() => { drag.current = null; }, 0);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };

  const goTo = (b: Box) => {
    const box = viewport.current?.getBoundingClientRect();
    if (!box) return;
    setView((v) => ({
      ...v,
      x: box.width / 2 - (b.x + b.w / 2) * v.scale,
      y: box.height / 2 - (b.y + b.h / 2) * v.scale,
    }));
  };
  useEffect(() => {
    if (matches.size === 0) return;
    const first = chart.boxes.find((b) => matches.has(b.node.id));
    if (first) goTo(first);
  }, [matches, chart]);

  // Folding a column shifts the columns beside it; the card that was clicked
  // is kept where it was on screen so the cursor is still over it.
  const anchor = useRef<{ id: string; x: number; y: number; opening: boolean } | null>(null);
  const toggle = (id: string) => {
    interacted.current = true;
    const b = chart.boxes.find((q) => q.node.id === id);
    if (b) anchor.current = { id, x: b.x, y: b.y, opening: collapsed.has(id) };
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  useLayoutEffect(() => {
    const a = anchor.current;
    if (!a) return;
    anchor.current = null;
    const b = chart.boxes.find((q) => q.node.id === a.id);
    const box = viewport.current?.getBoundingClientRect();
    if (!b || !box) return;
    if (!a.opening) {
      // Folded: keep the card under the cursor while its neighbours reflow.
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      if (dx || dy) setView((v) => ({ ...v, x: v.x - dx * v.scale, y: v.y - dy * v.scale }));
      return;
    }
    // Opened: the team is what they asked to see, so make sure it is on screen
    // — the card and its reports together, zoomed out only if they need it.
    const ids = new Set(b.node.children.map((k) => k.id));
    const group = chart.boxes.filter((q) => q.node.id === b.node.id || ids.has(q.node.id));
    const gx1 = Math.min(...group.map((q) => q.x)) - 24, gy1 = Math.min(...group.map((q) => q.y)) - 24;
    const gx2 = Math.max(...group.map((q) => q.x + q.w)) + 24, gy2 = Math.max(...group.map((q) => q.y + q.h)) + 24;
    setView((v) => {
      const scale = Math.max(ZOOM_MIN, Math.min(v.scale, box.width / (gx2 - gx1), box.height / (gy2 - gy1)));
      // Pan only as far as needed: if the group already fits on screen, leave it.
      let x = v.x, y = v.y;
      if (scale !== v.scale) {
        x = box.width / 2 - ((gx1 + gx2) / 2) * scale;
        y = box.height / 2 - ((gy1 + gy2) / 2) * scale;
      } else {
        if (gx2 * scale + x > box.width) x = box.width - gx2 * scale;
        if (gx1 * scale + x < 0) x = -gx1 * scale;
        if (gy2 * scale + y > box.height) y = box.height - gy2 * scale;
        if (gy1 * scale + y < 0) y = -gy1 * scale;
      }
      return { scale, x, y };
    });
  }, [chart]);

  const openPerson = (id: string) => {
    if (drag.current?.moved) return;
    setEmpDrawerId(id);
  };

  /** Re-roots the chart on a person: their reports showing, sub-teams folded, view refitted. */
  const focusOn = (id: string | null, remember = true) => {
    const node = id ? findNode(fullRoots, id) : null;
    if (remember) focusStack.current.push(focusId);
    setFocusId(node ? node.id : null);
    const ids = new Set<string>();
    const walk = (n: OrgNode, depth: number) => {
      if (depth > 0 && n.children.length) ids.add(n.id);
      n.children.forEach((k) => walk(k, depth + 1));
    };
    (node ? [node] : fullRoots).forEach((r) => walk(r, 0));
    setCollapsed(ids);
    setQuery('');
    anchor.current = null;
    interacted.current = false;
  };
  /** The spotlight on the centre card: back to wherever the chart was before. */
  const focusBack = () => {
    const prev = focusStack.current.pop();
    focusOn(prev === undefined ? null : prev, false);
  };

  return (
    <div style={fullBleed}>
      <div style={headerBar}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 20, fontWeight: 800, color: '#222222' }}>
            {user?.company ?? 'Organisation'} chart
          </div>
          <div style={{ fontSize: 14, color: '#717171', marginTop: 2 }}>
            {loaded
              ? `${emps.length} people · ${managers} managers · ${teams} departments`
              : 'Loading the roster…'}
          </div>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={searchWrap}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#9197A2" strokeWidth="2.2" strokeLinecap="round" aria-hidden>
              <circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" />
            </svg>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Find a person, role or team"
              style={searchInput}
            />
            {matches.size > 0 && <span style={matchCount}>{matches.size}</span>}
          </div>
          <button type="button" style={ghostBtn} onClick={() => setCollapsed(new Set())}>Expand all</button>
          <button type="button" style={ghostBtn} onClick={() => setCollapsed(new Set(foldable))}>Collapse teams</button>
        </div>
      </div>

      <div ref={viewport} onMouseDown={onMouseDown} style={canvas}>
        {loaded && roots.length === 0 ? (
          <div style={{ padding: '60px 24px', textAlign: 'center', color: '#9197A2', fontSize: 15 }}>
            Nobody on the roster yet.
          </div>
        ) : (
          <div
            style={{
              position: 'absolute', left: 0, top: 0,
              width: chart.width, height: chart.height,
              transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`,
              transformOrigin: '0 0', willChange: 'transform',
            }}
          >
            <svg width={chart.width} height={chart.height} style={{ position: 'absolute', inset: 0, overflow: 'visible' }} aria-hidden>
              {chart.lines.map((l, i) => (
                <path key={i} d={l.d} fill="none" stroke={l.strong ? '#BFC8D4' : '#D3D9E2'} strokeWidth={l.strong ? 2 : 1.6} strokeLinecap="round" />
              ))}
            </svg>
            {chart.boxes.map((b) => {
              const shared = {
                node: b.node,
                open: !collapsed.has(b.node.id),
                dimmed: needle.length > 0 && !matches.has(b.node.id),
                highlighted: matches.has(b.node.id),
                onOpen: () => openPerson(b.node.id),
                onToggle: () => toggle(b.node.id),
                // The head of the full chart is already the centre; anyone
                // else with a team can become it.
                onFocus: b.kind === 'root' && !focused && fullRoots.length === 1 ? undefined : b.node.id === focusId ? focusBack : () => focusOn(b.node.id),
                focusActive: b.node.id === focusId,
              };
              return (
                <div key={b.node.id} style={{ position: 'absolute', left: b.x, top: b.y, width: b.w, height: b.h }}>
                  {b.kind === 'row' ? <Row {...shared} /> : <HeadCard {...shared} root={b.kind === 'root'} />}
                </div>
              );
            })}
          </div>
        )}

        {focused && (
          <div style={trailBar} onMouseDown={(e) => e.stopPropagation()}>
            <button type="button" style={trailBtn} onClick={() => focusOn(null)}>
              {user?.company ?? 'Everyone'}
            </button>
            {trail.map((n, i) => (
              <span key={n.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <span style={{ color: '#B5BAC4' }}>›</span>
                {i === trail.length - 1
                  ? <span style={{ ...trailBtn, color: '#222222', cursor: 'default' }}>{n.name}</span>
                  : <button type="button" style={trailBtn} onClick={() => focusOn(n.id)}>{n.name}</button>}
              </span>
            ))}
          </div>
        )}
        <div style={zoomBar} onMouseDown={(e) => e.stopPropagation()}>
          <button type="button" style={zoomBtn} onClick={() => zoomAt(1 / 1.25)} title="Zoom out">−</button>
          <button type="button" style={zoomLabel} onClick={() => { interacted.current = false; fit(); }} title="Fit to screen">{Math.round(view.scale * 100)}%</button>
          <button type="button" style={zoomBtn} onClick={() => zoomAt(1.25)} title="Zoom in">+</button>
        </div>
        <div style={hint}>Drag to move · ⌘ + scroll to zoom · click a person for their profile</div>
      </div>
    </div>
  );
}

// ── cards ────────────────────────────────────────────────────────────────

type CardProps = {
  node: OrgNode; open: boolean; dimmed: boolean; highlighted: boolean;
  onOpen: () => void; onToggle: () => void;
  /** Absent on the head of the full chart, which is the centre already. */
  onFocus?: () => void;
  /** This card is the centre: its spotlight is lit, and pressing it steps back. */
  focusActive?: boolean;
};

/**
 * The spotlight: makes this person the centre of what is drawn. Lit on the
 * card that is the centre, where pressing it steps back to the view before.
 */
function FocusButton({ onFocus, active }: { onFocus: () => void; active?: boolean }) {
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onFocus(); }}
      title={active ? 'Back to the previous view' : 'Spotlight their team'}
      aria-label={active ? 'Back to the previous view' : 'Spotlight their team'}
      style={{ ...focusBtn, ...(active ? focusBtnActive : {}) }}
    >
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <circle cx="12" cy="12" r="3.5" /><path d="M12 2v4M12 18v4M2 12h4M18 12h4" />
      </svg>
    </button>
  );
}

/** The fold toggle, showing how many people sit under this person. */
function CountToggle({ under, open, onToggle }: { under: number; open: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onToggle(); }}
      title={open ? 'Fold this team' : 'Show this team'}
      style={{ ...countBtn, ...(open ? {} : countBtnClosed) }}
    >
      {under}
      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"
        style={{ marginLeft: 4, transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .15s' }} aria-hidden>
        <path d="m6 9 6 6 6-6" />
      </svg>
    </button>
  );
}

/** The avatar with an "open profile" badge that shows when the card is hovered. */
function AvatarWithOpen({ node, size, font, onOpen }: { node: OrgNode; size: number; font: number; onOpen: () => void }) {
  return (
    <div style={{ position: 'relative', flexShrink: 0 }}>
      <Avatar name={node.name} size={size} font={font} src={node.photoUrl} />
      <button
        type="button"
        className="oc-open"
        onClick={(e) => { e.stopPropagation(); onOpen(); }}
        title="Open profile"
        aria-label="Open profile"
      >
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M7 17 17 7M9 7h8v8" />
        </svg>
      </button>
    </div>
  );
}

/** The head of the company, and each lead at the top of a column. */
function HeadCard({ node, root, open, dimmed, highlighted, onOpen, onToggle, onFocus, focusActive }: CardProps & { root: boolean }) {
  const under = headcount(node);
  return (
    <div
      className="oc-card"
      onClick={onOpen}
      style={{
        ...headCard, ...(root ? rootCard : {}), ...(highlighted ? highlightCard : {}),
        opacity: dimmed ? 0.35 : 1, height: '100%',
      }}
    >
      <AvatarWithOpen node={node} size={root ? 52 : 44} font={root ? 18 : 15} onOpen={onOpen} />
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ ...nameStyle, fontSize: root ? 18 : 16.5 }}>{node.name}</div>
        <div style={{ ...titleStyle, whiteSpace: 'normal', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>{node.title}</div>
      </div>
      {under > 0 && onFocus && <FocusButton onFocus={onFocus} active={focusActive} />}
      {under > 0 && <CountToggle under={under} open={open} onToggle={onToggle} />}
    </div>
  );
}

/** One person in a team list. Managers within the list get a fold toggle. */
function Row({ node, open, dimmed, highlighted, onOpen, onToggle, onFocus, focusActive }: CardProps) {
  const under = headcount(node);
  return (
    <div
      className="oc-card"
      onClick={onOpen}
      style={{ ...rowCard, ...(highlighted ? highlightCard : {}), opacity: dimmed ? 0.35 : 1, height: '100%' }}
    >
      <AvatarWithOpen node={node} size={36} font={13} onOpen={onOpen} />
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={nameStyle}>{node.name}</div>
        <div style={titleStyle}>{node.title}</div>
      </div>
      {under > 0 && onFocus && <FocusButton onFocus={onFocus} active={focusActive} />}
      {under > 0 && <CountToggle under={under} open={open} onToggle={onToggle} />}
    </div>
  );
}

// ── styles ───────────────────────────────────────────────────────────────
// Break out of the padded content area to fill the viewport (page padding is
// 28px top / 34px sides / 60px bottom).
const fullBleed: CSSProperties = {
  margin: '-28px -34px -60px',
  height: 'calc(100% + 88px)',
  display: 'flex',
  flexDirection: 'column',
};
const headerBar: CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 16, padding: '16px 34px',
  borderBottom: '1px solid #EBEBEB', flexShrink: 0,
  // Solid: this bar carries text, and a company backdrop can be dark.
  background: '#F7F7F9',
};
const canvas: CSSProperties = {
  flex: 1, position: 'relative', overflow: 'hidden', userSelect: 'none', cursor: 'grab',
};
const searchWrap: CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 8, background: '#fff',
  border: '1px solid #E4E4E8', borderRadius: 10, padding: '0 10px', height: 36, width: 260,
};
const searchInput: CSSProperties = {
  flex: 1, minWidth: 0, border: 0, outline: 0, background: 'transparent',
  fontSize: 13.5, color: '#222222', fontFamily: 'inherit',
};
const matchCount: CSSProperties = {
  fontSize: 11.5, fontWeight: 800, color: '#0571A6', background: '#E7F2F7', borderRadius: 20, padding: '1px 7px',
};
const ghostBtn: CSSProperties = {
  height: 36, padding: '0 12px', borderRadius: 10, border: '1px solid #E4E4E8', background: '#fff',
  color: '#4B5563', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
};
const zoomBar: CSSProperties = {
  position: 'absolute', right: 20, bottom: 20, display: 'flex', alignItems: 'center', background: '#fff',
  border: '1px solid #E4E4E8', borderRadius: 12, boxShadow: '0 4px 14px rgba(34,34,34,.08)', overflow: 'hidden',
};
const zoomBtn: CSSProperties = {
  width: 38, height: 36, border: 0, background: 'transparent', cursor: 'pointer', fontSize: 18, color: '#222222', fontFamily: 'inherit',
};
const zoomLabel: CSSProperties = {
  height: 36, minWidth: 56, border: 0, borderLeft: '1px solid #EEEEF1', borderRight: '1px solid #EEEEF1',
  background: 'transparent', cursor: 'pointer', fontSize: 12.5, fontWeight: 700, color: '#4B5563', fontFamily: 'inherit',
};
const hint: CSSProperties = {
  position: 'absolute', left: 20, bottom: 20, fontSize: 12, color: '#717171', fontWeight: 600, pointerEvents: 'none',
  background: '#fff', border: '1px solid #E4E4E8', borderRadius: 10, padding: '6px 10px',
};

const headCard: CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 12, boxSizing: 'border-box', padding: '12px 14px',
  borderRadius: 14, background: '#fff', border: '1px solid #E6E8EC',
  boxShadow: '0 3px 10px rgba(34,34,34,.06)', cursor: 'pointer', transition: 'opacity .15s, box-shadow .15s',
};
const rootCard: CSSProperties = {
  border: '2px solid #0571A6', boxShadow: '0 8px 22px rgba(5,113,166,.16)', padding: '14px 16px',
};
const rowCard: CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 10, boxSizing: 'border-box', padding: '10px 12px',
  borderRadius: 12, background: '#fff', border: '1px solid #E9EBEF', cursor: 'pointer',
  transition: 'opacity .15s, box-shadow .15s',
};
const highlightCard: CSSProperties = { boxShadow: '0 0 0 3px #0571A6, 0 8px 22px rgba(5,113,166,.2)' };
const nameStyle: CSSProperties = {
  fontSize: 15.5, fontWeight: 700, color: '#222222', lineHeight: 1.25,
  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
};
const titleStyle: CSSProperties = {
  fontSize: 13, color: '#717171', marginTop: 3, lineHeight: 1.3,
  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
};
const countBtn: CSSProperties = {
  flexShrink: 0, display: 'inline-flex', alignItems: 'center', fontSize: 12, fontWeight: 800,
  fontFamily: 'inherit', color: '#717171', background: '#F0F0F2', border: '1px solid #E4E4E8',
  borderRadius: 20, padding: '3px 9px', cursor: 'pointer',
};
const countBtnClosed: CSSProperties = { color: '#0571A6', background: '#E7F2F7', border: '1px solid #CFE3EE' };
const focusBtn: CSSProperties = {
  flexShrink: 0, width: 34, height: 34, borderRadius: 10, display: 'inline-flex', alignItems: 'center',
  justifyContent: 'center', color: '#4B5563', background: '#F0F0F2', border: '1px solid #E4E4E8', cursor: 'pointer',
  marginRight: 6,
};
const focusBtnActive: CSSProperties = {
  color: '#fff', background: '#0571A6', border: '1px solid #0571A6', boxShadow: '0 0 0 4px rgba(5,113,166,.18)',
};
const trailBar: CSSProperties = {
  position: 'absolute', left: 20, top: 16, display: 'flex', alignItems: 'center', gap: 6,
  background: '#fff', border: '1px solid #E4E4E8', borderRadius: 12, padding: '6px 10px',
  boxShadow: '0 4px 14px rgba(34,34,34,.08)', fontSize: 13, fontWeight: 600,
};
const trailBtn: CSSProperties = {
  border: 0, background: 'transparent', color: '#0571A6', fontSize: 13, fontWeight: 700,
  cursor: 'pointer', fontFamily: 'inherit', padding: '2px 4px',
};
