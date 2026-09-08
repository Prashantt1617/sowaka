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
  width: '100%', padding: '9px 11px', border: '1px solid #EBEBEB', borderRadius: 10,
  fontSize: 16, fontFamily: 'inherit', background: '#fff', color: '#222222',
};
export const primaryBtn: CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 6, background: '#0571A6', color: '#fff',
  border: 'none', padding: '9px 15px', borderRadius: 11, fontSize: 16, fontWeight: 700, cursor: 'pointer',
};
export const ghostBtn: CSSProperties = {
  background: '#fff', color: '#484848', border: '1px solid #EBEBEB', padding: '11px 20px',
  borderRadius: 11, fontSize: 16, fontWeight: 700, cursor: 'pointer',
};
export const smallBtn: CSSProperties = {
  background: '#fff', color: '#484848', border: '1px solid #EBEBEB', padding: '6px 12px',
  borderRadius: 9, fontSize: 14, fontWeight: 700, cursor: 'pointer',
};
export const noteTag: CSSProperties = {
  background: '#EAF2FB', color: '#3C6E9E', fontSize: 13.5, borderRadius: 10,
  padding: '11px 13px', lineHeight: 1.5,
};
export const warnTag: CSSProperties = {
  background: '#F6E9D5', border: '1px solid #ECD9B4', borderRadius: 10, padding: '12px 14px',
  fontSize: 14, color: '#8A6A20', lineHeight: 1.5,
};
export const panelCard: CSSProperties = {
  background: '#fff', border: '1px solid #EBEBEB', borderRadius: 14, padding: '18px 20px',
};
export const panelTitle: CSSProperties = { fontSize: 16, fontWeight: 800, marginBottom: 14 };

export const modalCard: CSSProperties = {
  position: 'relative', width: '100%', maxHeight: '92vh', background: '#F7F7F9', borderRadius: 20,
  boxShadow: '0 30px 70px rgba(60,40,24,.3)', animation: 'pop .2s ease both',
  display: 'flex', flexDirection: 'column',
};
export const modalHead: CSSProperties = {
  padding: '20px 26px', borderBottom: '1px solid #EBEBEB', display: 'flex',
  alignItems: 'center', justifyContent: 'space-between', flexShrink: 0,
};
export const modalFoot: CSSProperties = {
  padding: '14px 26px', borderTop: '1px solid #EBEBEB', display: 'flex', alignItems: 'center',
  gap: 11, background: '#fff', borderBottomLeftRadius: 20, borderBottomRightRadius: 20, flexShrink: 0,
};
