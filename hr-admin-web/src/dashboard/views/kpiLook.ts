// The KPI screens' style constants in the HR Admin design (values in look.ts).
// Same names as kpiStyles.ts, which People and Shifts still use as they are.
import type { CSSProperties } from 'react';
import * as L from './look';

export { MAX_PER_SET } from './kpiStyles';

export const inputStyle: CSSProperties = { ...L.input };
export const primaryBtn: CSSProperties = { ...L.btnPrimary };
export const ghostBtn: CSSProperties = { ...L.btn };
export const smallBtn: CSSProperties = { ...L.btnSm };
export const noteTag: CSSProperties = { ...L.note, display: 'block' };
export const warnTag: CSSProperties = {
  background: 'var(--warn-bg)', border: '1px solid var(--warn-line)', borderRadius: 14, padding: '12px 14px',
  fontSize: 13, color: 'var(--warn)', lineHeight: 1.5,
};
export const panelCard: CSSProperties = {
  background: 'var(--surface)', border: '1px solid transparent', borderRadius: 'var(--r-lg)', padding: 20, boxShadow: 'var(--shadow)',
};
export const panelTitle: CSSProperties = { ...L.cardTitle, marginBottom: 16 };

export const modalCard: CSSProperties = { ...L.modalSheet };
export const modalHead: CSSProperties = { ...L.modalHeadBar };
export const modalFoot: CSSProperties = { ...L.modalFootBar };
