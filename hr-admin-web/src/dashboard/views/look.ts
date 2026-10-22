// The HR Admin design's measured values for the Performance, Reports, Payroll
// and Connect screens: cards with 20px padding, tables with a rounded grey
// header strip, pill buttons and fields, outlined tags and solid status pills.
// Plain values only (no components), so Fast Refresh keeps working.
//
// Pair with look.css for what inline styles can't express (header-strip
// corners, row hover, the last row's rule, focus rings).
import type { CSSProperties } from 'react';

/** Padding for a <Card> that holds a table or a form. */
export const cardPad: CSSProperties = { padding: 20 };

/** <table className="lk-t">: separate borders so the header strip can round. */
export const table: CSSProperties = { width: '100%', borderCollapse: 'separate', borderSpacing: 0, fontSize: 13.5 };

export const th: CSSProperties = {
  textAlign: 'left', fontSize: 12, fontWeight: 400, color: 'var(--ink-3)', background: 'var(--surface-2)',
  padding: '10px 12px', whiteSpace: 'nowrap', textTransform: 'none', letterSpacing: 0, border: 'none',
};
export const td: CSSProperties = {
  padding: '10px 12px', borderBottom: '1px solid var(--line)', fontSize: 13.5, fontWeight: 400,
  color: 'var(--ink)', verticalAlign: 'middle',
};
/** The bold first line of a cell (a name or a period). */
export const cellName: CSSProperties = { fontSize: 14, fontWeight: 500, color: 'var(--ink)' };
/** The grey second line under it. */
export const cellSub: CSSProperties = { fontSize: 11.5, fontWeight: 400, color: 'var(--ink-3)', marginTop: 1 };

/** Card head: title 16/600, note 12 grey. */
export const cardTitle: CSSProperties = { fontSize: 16, fontWeight: 600, letterSpacing: '-.01em', color: 'var(--ink)', lineHeight: 1.5 };
export const cardNote: CSSProperties = { fontSize: 12, fontWeight: 400, color: 'var(--ink-3)' };
/** Small brand-coloured group label. */
export const eyebrow: CSSProperties = { fontSize: 10.5, fontWeight: 600, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--hi)' };
/** "6 parameters" style count at the top of a list. */
export const countLine: CSSProperties = { fontSize: 16, fontWeight: 400, letterSpacing: '-.02em', color: 'var(--ink-3)' };

const btnBase: CSSProperties = {
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8, height: 40, padding: '0 16px',
  borderRadius: 999, fontSize: 13, fontWeight: 500, whiteSpace: 'nowrap', cursor: 'pointer', fontFamily: 'inherit', lineHeight: 1.5,
};
export const btnPrimary: CSSProperties = {
  ...btnBase, background: 'var(--accent-grad)', color: '#fff', border: '1px solid transparent',
  boxShadow: '0 8px 18px -10px var(--accent)',
};
export const btn: CSSProperties = { ...btnBase, background: 'var(--surface)', color: 'var(--ink)', border: '1px solid var(--line-2)' };
export const btnSm: CSSProperties = { ...btn, height: 32, padding: '0 12px', fontSize: 12, gap: 6 };
export const btnSmPrimary: CSSProperties = { ...btnPrimary, height: 32, padding: '0 12px', fontSize: 12, gap: 6 };
export const btnGhost: CSSProperties = { ...btnSm, background: 'none', border: '1px solid transparent', color: 'var(--accent-ink)' };
export const btnDanger: CSSProperties = { ...btnSm, background: 'var(--bad-bg)', border: '1px solid transparent', color: 'var(--bad)' };

/** Pill search/filter field (icon + input inside). */
export const field: CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 6, height: 40, padding: '0 12px', borderRadius: 999,
  border: '1px solid var(--line-2)', background: 'var(--surface)', color: 'var(--ink-3)', fontSize: 13,
};
/** A form input (.inp): 42 tall, 12 radius. */
export const input: CSSProperties = {
  minHeight: 42, padding: '10px 12px', lineHeight: '20px', borderRadius: 12, border: '1px solid var(--line-2)', background: 'var(--surface)',
  color: 'var(--ink)', fontSize: 13, fontFamily: 'inherit', outline: 'none', width: '100%',
};
export const textarea: CSSProperties = { ...input, minHeight: 84, lineHeight: 1.5 };
/** Label above a form field. */
export const label: CSSProperties = { display: 'block', fontSize: 11.5, fontWeight: 400, color: 'var(--ink-2)', marginBottom: 6 };

/** Segmented control (tabs within a page). */
export const seg: CSSProperties = {
  display: 'inline-flex', flexWrap: 'wrap', gap: 2, padding: 4, borderRadius: 999, background: 'var(--surface-2)', border: '1px solid var(--line)',
};
export const segBtn = (on: boolean): CSSProperties => ({
  display: 'inline-flex', alignItems: 'center', gap: 6, height: 32, padding: '0 12px', borderRadius: 999, border: 'none',
  cursor: 'pointer', fontSize: 13, fontWeight: on ? 500 : 400, fontFamily: 'inherit',
  background: on ? 'var(--sel)' : 'transparent', color: on ? 'var(--on-sel)' : 'var(--ink-2)',
});
/** Count inside a segment button. */
export const segCount: CSSProperties = { fontSize: 11, opacity: 0.8 };

/** Toggle chip (36 tall). */
export const chip = (on: boolean): CSSProperties => ({
  display: 'inline-flex', alignItems: 'center', gap: 6, height: 36, padding: '0 14px', borderRadius: 99,
  fontSize: 12.5, fontWeight: 400, cursor: 'pointer', fontFamily: 'inherit',
  border: `1px solid ${on ? 'var(--sel)' : 'var(--line)'}`, background: on ? 'var(--sel)' : 'var(--surface)', color: on ? 'var(--on-sel)' : 'var(--ink-2)',
});

/** Neutral outlined tag (departments, templates, codes). */
export const tag: CSSProperties = {
  display: 'inline-flex', alignItems: 'center', fontSize: 11.5, fontWeight: 400, padding: '3px 9px', borderRadius: 999,
  background: 'var(--surface)', border: '1px solid var(--line-2)', color: 'var(--ink-2)', whiteSpace: 'nowrap', lineHeight: 1.5,
};

export type Tone = 'ok' | 'warn' | 'info' | 'bad' | 'mute';
/** Solid status pills. */
export const TONES: Record<Tone, { bg: string; fg: string }> = {
  ok: { bg: 'var(--p-green)', fg: '#fff' },
  warn: { bg: 'var(--p-yellow)', fg: 'var(--p-yellow-ink)' },
  info: { bg: 'var(--p-blue)', fg: '#fff' },
  bad: { bg: 'var(--p-red)', fg: '#fff' },
  mute: { bg: 'var(--mute-bg)', fg: 'var(--ink-2)' },
};
export const pill = (tone: Tone): CSSProperties => ({
  display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11.5, fontWeight: 500, padding: '3px 10px', borderRadius: 99,
  background: TONES[tone].bg, color: TONES[tone].fg, whiteSpace: 'nowrap', lineHeight: 1.5,
});
/** The dot at the start of a status pill. */
export const pillDot: CSSProperties = { width: 6, height: 6, borderRadius: '50%', background: 'currentColor', opacity: 0.85, flexShrink: 0 };

/** Dashed-free info note (.note). */
export const note: CSSProperties = {
  display: 'flex', gap: 12, alignItems: 'flex-start', background: 'var(--surface-2)', border: '1px solid var(--line)',
  borderRadius: 14, padding: '12px 14px', color: 'var(--ink-2)', fontSize: 13, lineHeight: 1.5,
};

/** Key–value rows (.kv). */
export const kvDt: CSSProperties = { fontSize: 11.5, fontWeight: 400, color: 'var(--ink-3)' };
export const kvDd: CSSProperties = { fontSize: 14, fontWeight: 500, color: 'var(--ink)' };

/** Modal: white sheet, 22 radius, 16/20 head and foot. */
export const modalSheet: CSSProperties = {
  position: 'relative', width: '100%', maxHeight: '92vh', background: 'var(--surface)', borderRadius: 'var(--r-lg)',
  boxShadow: 'var(--shadow-lg)', animation: 'pop .2s ease both', display: 'flex', flexDirection: 'column', overflow: 'hidden',
};
export const modalHeadBar: CSSProperties = {
  padding: '16px 20px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0,
};
export const modalTitle: CSSProperties = { fontSize: 16, fontWeight: 600, letterSpacing: '-.01em' };
export const modalBody: CSSProperties = { padding: 20 };
export const modalFootBar: CSSProperties = {
  padding: '16px 20px', borderTop: '1px solid var(--line)', display: 'flex', alignItems: 'center', gap: 8, background: 'var(--surface)', flexShrink: 0,
};

/** Bars (.bar): 10 tall, rounded, blue fill. */
export const barTrack: CSSProperties = { height: 10, borderRadius: 99, background: 'var(--surface-2)', overflow: 'hidden' };
