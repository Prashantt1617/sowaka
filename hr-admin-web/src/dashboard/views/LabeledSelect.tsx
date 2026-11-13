// A pill-shaped filter with its label inside ("Department  All departments ⌄"),
// laid out in a row with `.ar-filters`. Shared by the Attendance report and the
// Time office pages.
import type { ReactNode } from 'react';
import { btn, btnClass } from '../ds';
import './labeled-select.css';

export function LabeledSelect({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: [string, string][] }) {
  return (
    <label className="ar-sel">
      <span>{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </label>
  );
}

/** "Filters · 2 ⌄": opens the page's filters, tinted while any is set (as on Company calendar). */
export function FiltersButton({ open, active, onClick }: { open: boolean; active: number; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} aria-expanded={open} className={btnClass()}
      style={{ ...btn(), gap: 8, background: active ? 'var(--accent-soft)' : undefined, color: active ? 'var(--accent-ink)' : undefined }}>
      Filters{active ? ` · ${active}` : ''}
      <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden style={{ transform: open ? 'rotate(180deg)' : undefined, transition: 'transform .15s' }}><path d="M2.5 4.5 6 8l3.5-3.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
    </button>
  );
}

/** The open filters: the page's dropdowns, then Apply and Clear. */
export function FiltersPanel({ active, dirty, onApply, onClear, children }: { active: number; dirty: boolean; onApply: () => void; onClear: () => void; children: ReactNode }) {
  return (
    <div className="ar-filters compact" style={{ marginBottom: 12 }}>
      {children}
      <button type="button" onClick={onApply} className="pd-btn primary">Apply</button>
      {(active > 0 || dirty) && <button type="button" onClick={onClear} className="pd-btn ghost">Clear</button>}
    </div>
  );
}
