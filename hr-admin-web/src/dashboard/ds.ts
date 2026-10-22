// The Sowaka HR Admin prototype's shapes as style objects, so every view
// draws the same buttons, tables, fields and cards. The components that use
// them live in ui.tsx; the hover and focus states are classes in styles.css.
//   btn('primary' | 'secondary' | …, 'sm'?) + className={btnClass(kind)}
//   iconBtn(size?)              round icon button (className "ds-icon-btn")
//   TH(cols) / TR(cols)         grid table header strip and body row, inside <Card padded>
//   inp / textareaStyle / fieldLabel / hint / eyebrow / note / toolbar
//   sentence('EMPLOYEE NAME')  'Employee name' (headers in sentence case)
import type { CSSProperties } from 'react';

export const TAG: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  fontSize: 11.5,
  fontWeight: 400,
  lineHeight: 1.5,
  padding: '3px 9px',
  borderRadius: 999,
  background: 'var(--surface)',
  border: '1px solid var(--line-2)',
  color: 'var(--ink-2)',
  whiteSpace: 'nowrap',
};

/** The KPI tile box on its own, for tiles a view lays out itself. */
export const TILE: CSSProperties = {
  background: 'var(--surface)',
  border: '1px solid transparent',
  borderRadius: 'var(--r-lg)',
  boxShadow: 'var(--shadow)',
  padding: '14px 16px',
  minHeight: 96,
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  position: 'relative',
};

/** Row of KPI tiles: 16px apart. */
export const TILES: CSSProperties = { display: 'grid', gap: 16 };

/** The segmented control track and its buttons, for views that build their own. */
export const SEG: CSSProperties = {
  display: 'inline-flex',
  flexWrap: 'wrap',
  background: 'var(--surface-2)',
  border: '1px solid var(--line)',
  borderRadius: 999,
  padding: 4,
  gap: 2,
};
export function segBtn(on: boolean): CSSProperties {
  return {
    border: 'none',
    cursor: 'pointer',
    fontSize: 13,
    fontWeight: on ? 500 : 400,
    lineHeight: 1.5,
    height: 32,
    padding: '0 12px',
    borderRadius: 999,
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    whiteSpace: 'nowrap',
    background: on ? 'var(--sel)' : 'transparent',
    color: on ? 'var(--on-sel)' : 'var(--ink-2)',
  };
}

export const CARD_PAD = 20;
export const CARD: CSSProperties = {
  background: 'var(--surface)',
  border: '1px solid transparent',
  borderRadius: 'var(--r-lg)',
  boxShadow: 'var(--shadow)',
  overflow: 'hidden',
  minWidth: 0,
};

/** Card heading row: a 16px semibold title with a small grey note. */
export const cardTitle: CSSProperties = { fontSize: 16, fontWeight: 600, letterSpacing: '-.01em', lineHeight: 1.5, color: 'var(--ink)', margin: 0 };
export const cardNote: CSSProperties = { fontSize: 12, fontWeight: 400, color: 'var(--ink-3)', lineHeight: 1.5 };

// ---------------------------------------------------------------------------
// Tables. The prototype draws a grey header strip with rounded ends inside a
// card padded 20px, sentence-case 12px grey labels, and 13.5px rows divided
// by a hairline. Our tables are CSS grids, so these give the row boxes:
//   <Card padded> <div style={TH(COLS)}>…</div> {rows.map(r => <div className="dc-row" style={TR(COLS)}>…)} </Card>

/** Space between grid columns: the 12px cell padding on either side. */
export const COL_GAP = 24;

export function TH(cols: string): CSSProperties {
  return {
    display: 'grid',
    gridTemplateColumns: cols,
    columnGap: COL_GAP,
    alignItems: 'center',
    background: 'var(--surface-2)',
    borderRadius: 12,
    padding: '10px 12px',
    fontSize: 12,
    fontWeight: 400,
    lineHeight: '18px',
    letterSpacing: 0,
    color: 'var(--ink-3)',
    whiteSpace: 'nowrap',
  };
}

export function TR(cols: string, last = false): CSSProperties {
  return {
    display: 'grid',
    gridTemplateColumns: cols,
    columnGap: COL_GAP,
    alignItems: 'center',
    padding: '10px 12px',
    borderBottom: last ? 'none' : '1px solid var(--line)',
    fontSize: 13.5,
    lineHeight: 1.5,
    color: 'var(--ink)',
  };
}

/** Table cell text: data in ink at 13.5, a person's name at 14 medium, notes 11.5 grey. */
export const cellText: CSSProperties = { fontSize: 13.5, fontWeight: 400, color: 'var(--ink)' };
export const cellName: CSSProperties = { fontSize: 14, fontWeight: 500, lineHeight: 1.25, color: 'var(--ink)' };
export const cellSub: CSSProperties = { fontSize: 11.5, fontWeight: 400, lineHeight: 1.3, color: 'var(--ink-3)' };
export const cellMuted: CSSProperties = { fontSize: 13.5, fontWeight: 400, color: 'var(--ink-3)' };

/** "Employee" from "EMPLOYEE": headers and labels in sentence case, short acronyms kept. */
const KEEP = new Set(['ID', 'HR', 'OOL', 'KPI', 'PF', 'ESI', 'PAN', 'UAN', 'IFSC', 'TDS', 'LOP', 'OT', 'CTC', 'GPS', 'PT', 'LWF', 'TAN', 'GST', 'GSTIN', 'CIN', 'URL', 'SLA', 'FY', 'IP', 'UPI', 'CSV', 'PDF', 'Q1', 'Q2', 'Q3', 'Q4']);
export function sentence(s: string): string {
  if (!s || s !== s.toUpperCase()) return s;
  let first = true;
  return s.replace(/[A-Z0-9][A-Z0-9'’.]*/g, (w) => {
    const out = KEEP.has(w) ? w : first ? w[0] + w.slice(1).toLowerCase() : w.toLowerCase();
    first = false;
    return out;
  });
}

// ---------------------------------------------------------------------------
// Buttons: 40px pills (32px small), 13px medium. One blue gradient primary.

export type BtnKind = 'primary' | 'secondary' | 'ghost' | 'ok' | 'no' | 'danger' | 'dark';

export function btn(kind: BtnKind = 'secondary', size: 'md' | 'sm' = 'md'): CSSProperties {
  const sm = size === 'sm';
  const base: CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    height: sm ? 32 : 40,
    padding: sm ? '0 12px' : '0 16px',
    borderRadius: 999,
    border: '1px solid var(--line-2)',
    background: 'var(--surface)',
    color: 'var(--ink)',
    fontSize: sm ? 12 : 13,
    fontWeight: 500,
    lineHeight: 1.5,
    whiteSpace: 'nowrap',
    cursor: 'pointer',
    flexShrink: 0,
  };
  switch (kind) {
    case 'primary':
      return { ...base, background: 'var(--accent-grad)', border: '1px solid transparent', color: '#fff', boxShadow: '0 8px 18px -10px var(--accent)' };
    case 'ghost':
      return { ...base, background: 'none', border: '1px solid transparent', color: 'var(--accent-ink)' };
    case 'ok':
      return { ...base, background: 'var(--ok-bg)', border: '1px solid transparent', color: 'var(--ok)' };
    case 'no':
      return { ...base, background: 'var(--bad-bg)', border: '1px solid transparent', color: 'var(--bad)' };
    case 'danger':
      return { ...base, background: 'var(--bad-solid)', border: '1px solid var(--bad-solid)', color: '#fff' };
    case 'dark':
      return { ...base, background: 'var(--sel)', border: '1px solid var(--sel)', color: 'var(--on-sel)' };
    default:
      return base;
  }
}

/** The class that gives each button kind its hover. */
export function btnClass(kind: BtnKind = 'secondary'): string {
  switch (kind) {
    case 'primary':
      return 'ds-btn-primary';
    case 'ghost':
      return 'ds-btn-ghost';
    case 'ok':
      return 'ds-btn-ok';
    case 'no':
      return 'ds-btn-no';
    case 'danger':
    case 'dark':
      return 'ds-btn-solid';
    default:
      return 'ds-btn';
  }
}

/** Round icon button (42px in the top bar and drawers, 34 in table rows, 32 small). Use className "ds-icon-btn". */
export function iconBtn(size = 42): CSSProperties {
  return {
    position: 'relative',
    width: size,
    height: size,
    borderRadius: 999,
    border: '1px solid var(--line)',
    background: 'var(--surface)',
    color: 'var(--ink-2)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    flexShrink: 0,
    padding: 0,
  };
}

// ---------------------------------------------------------------------------
// Forms: 42px inputs with 12px corners, 11.5px labels 6px above, grey hints.
// Give inputs className "ds-inp" for the blue focus ring.

export const inp: CSSProperties = {
  height: 42,
  width: '100%',
  border: '1px solid var(--line-2)',
  borderRadius: 12,
  background: 'var(--surface)',
  padding: '0 12px',
  fontSize: 13,
  lineHeight: 1.5,
  color: 'var(--ink)',
  outline: 'none',
};
export const textareaStyle: CSSProperties = { ...inp, height: 'auto', minHeight: 84, padding: '10px 12px', resize: 'vertical' };
export const fieldLabel: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 6, fontSize: 11.5, fontWeight: 400, lineHeight: 1.5, color: 'var(--ink-2)' };
export const hint: CSSProperties = { fontSize: 11.5, fontWeight: 400, lineHeight: 1.5, color: 'var(--ink-3)' };

/** Small brand-blue group label: 10.5px semibold capitals. */
export const eyebrow: CSSProperties = { fontSize: 10.5, fontWeight: 600, letterSpacing: '.08em', textTransform: 'uppercase', lineHeight: 1.5, color: 'var(--hi)' };

/** A grey info note: surface-2 box, 14px corners. */
export const note: CSSProperties = {
  display: 'flex',
  gap: 12,
  alignItems: 'flex-start',
  background: 'var(--surface-2)',
  border: '1px solid var(--line)',
  borderRadius: 14,
  padding: '12px 14px',
  color: 'var(--ink-2)',
  fontSize: 13,
  lineHeight: 1.5,
};

/** Toolbar row above a table, inside its card. */
export const toolbar: CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 16 };

// ---------------------------------------------------------------------------
// The page's own buttons go at the right of the page head, level with the
// title, as in the prototype. The shell renders the slot; a view portals in.

export const PAGE_ACTIONS_ID = 'ds-page-actions';
