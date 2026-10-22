// Style constants for the KPI screens, matching Payroll › Salary Components.
//
// Separate from kpiUi.tsx because a module exporting both components and plain
// values breaks React Fast Refresh — editing a KPI screen would leave the page
// stale until a full reload.
import type { CSSProperties } from 'react';

/** Ceiling on a template and on one person's assigned set — mirrors the
 *  backend's MAX_PARAMETERS_PER_SET, which rejects anything larger. */
export const MAX_PER_SET = 10;

export const inputStyle: CSSProperties = {
  width: '100%', padding: '9px 11px', border: '1px solid var(--line)', borderRadius: 10,
  fontSize: 14, fontFamily: 'inherit', background: 'var(--surface)', color: 'var(--ink)',
};
export const primaryBtn: CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 6, background: 'var(--accent-grad)', color: '#fff',
  border: 'none', padding: '9px 15px', borderRadius: 999, fontSize: 14, fontWeight: 500, cursor: 'pointer',
};
export const ghostBtn: CSSProperties = {
  background: 'var(--surface)', color: 'var(--ink-2)', border: '1px solid var(--line)', padding: '11px 20px',
  borderRadius: 999, fontSize: 14, fontWeight: 500, cursor: 'pointer',
};
export const smallBtn: CSSProperties = {
  background: 'var(--surface)', color: 'var(--ink-2)', border: '1px solid var(--line)', padding: '6px 12px',
  borderRadius: 999, fontSize: 13, fontWeight: 500, cursor: 'pointer',
};
export const noteTag: CSSProperties = {
  background: 'var(--accent-soft)', color: 'var(--t-sky-i)', fontSize: 12.5, borderRadius: 10,
  padding: '11px 13px', lineHeight: 1.5,
};
export const warnTag: CSSProperties = {
  background: 'var(--warn-bg)', border: '1px solid var(--warn-line)', borderRadius: 10, padding: '12px 14px',
  fontSize: 13, color: 'var(--warn)', lineHeight: 1.5,
};
export const panelCard: CSSProperties = {
  background: 'var(--surface)', border: '1px solid transparent', borderRadius: 16, padding: '18px 20px', boxShadow: 'var(--shadow)',
};
export const panelTitle: CSSProperties = { fontSize: 14, fontWeight: 600, marginBottom: 14 };

export const modalCard: CSSProperties = {
  position: 'relative', width: '100%', maxHeight: '92vh', background: 'var(--surface-2)', borderRadius: 'var(--r-lg)',
  boxShadow: 'var(--shadow-lg)', animation: 'pop .2s ease both',
  display: 'flex', flexDirection: 'column',
};
export const modalHead: CSSProperties = {
  padding: '20px 26px', borderBottom: '1px solid var(--line)', display: 'flex',
  alignItems: 'center', justifyContent: 'space-between', flexShrink: 0,
};
export const modalFoot: CSSProperties = {
  padding: '14px 26px', borderTop: '1px solid var(--line)', display: 'flex', alignItems: 'center',
  gap: 11, background: 'var(--surface)', borderBottomLeftRadius: 20, borderBottomRightRadius: 20, flexShrink: 0,
};
