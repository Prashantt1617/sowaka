// Shared Figma pieces (G1): field, intro line, note, list rows, chips, progress, PDF tile, actions bar.
// Styles in styles/fig.css. Screens compose these; screen-only CSS goes in fig-g<N>.css.
import { useId, type InputHTMLAttributes, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { FigChevronRight, FigIcon3D, FigInfo, type Fig3DName } from './icons';

/** Label, input, help (App · 1 "Work email"). Pass `input` props, or `children` for a custom control. */
export function FigField({ label, help, error, children, ...input }: { label: string; help?: ReactNode; error?: string; children?: ReactNode } & InputHTMLAttributes<HTMLInputElement>) {
  const id = useId();
  return (
    <div className="fig-field">
      <label className="fig-field__label" htmlFor={input.id ?? id}>{label}</label>
      {children ?? <input id={id} className="fig-input" aria-invalid={error ? true : undefined} {...input} />}
      {help && <span className="fig-field__help">{help}</span>}
      {error && <span className="fig-field__error" role="alert">{error}</span>}
    </div>
  );
}

/** The line under a section header: 32 px 3D icon + secondary text. */
export function FigIntro({ icon, children }: { icon: Fig3DName; children: ReactNode }) {
  return <p className="fig-intro"><FigIcon3D name={icon} size={32} /><span>{children}</span></p>;
}

/** Canvas-tinted note with the 16 px info icon. */
export function FigNote({ children }: { children: ReactNode }) {
  return <p className="fig-note"><FigInfo /><span>{children}</span></p>;
}

/** White bordered list; children are rows (separated by 1 px lines). */
export function FigList({ children, as: Tag = 'div', label }: { children: ReactNode; as?: 'div' | 'ul' | 'dl'; label?: string }) {
  return <Tag className="fig-list" aria-label={label}>{children}</Tag>;
}

/** Label / value row ("Role · Counsellor"). Use inside <FigList as="dl">. */
export function FigKv({ label, value }: { label: ReactNode; value: ReactNode }) {
  return <div className="fig-kv"><dt>{label}</dt><dd>{value}</dd></div>;
}

/** A link row: lead, title, sub, chevron (Employee profile, Policies). */
export function FigRow({ to, onClick, lead, title, sub, subClass = 'fig-t3', chevClass, className = '', ariaLabel }: {
  to?: string; onClick?: () => void; lead?: ReactNode; title: ReactNode; sub?: ReactNode; subClass?: string; chevClass?: string; className?: string; ariaLabel?: string;
}) {
  const inner = (
    <>
      {lead}
      <span className="fig-row__text">
        <span className="fig-body-strong">{title}</span>
        {sub && <span className={`fig-label ${subClass}`}>{sub}</span>}
      </span>
      <span className={`fig-row__chev ${chevClass ?? ''}`}><FigChevronRight /></span>
    </>
  );
  return to
    ? <Link to={to} className={`fig-row ${className}`} aria-label={ariaLabel}>{inner}</Link>
    : <button type="button" className={`fig-row ${className}`} onClick={onClick} aria-label={ariaLabel}>{inner}</button>;
}

export type FigTone = 'success' | 'info' | 'warning' | 'neutral' | 'brand';
export function FigChip({ tone, children }: { tone: FigTone; children: ReactNode }) {
  return <span className={`fig-chip fig-chip--${tone}`}>{children}</span>;
}

/** 8 px bar; `white` track on tinted tiles. */
export function FigProgress({ value, white, label }: { value: number; white?: boolean; label?: string }) {
  const v = Math.max(0, Math.min(100, Math.round(value)));
  return (
    <span className={`fig-progress${white ? ' fig-progress--white' : ''}`} role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={v}>
      <i style={{ width: `${v}%` }} />
    </span>
  );
}

export function FigPdf() {
  return <span className="fig-pdf" aria-hidden="true">PDF</span>;
}

/** Bottom actions: the primary button and an optional line under it; `bar` = sticky white bar with a top border. */
export function FigActions({ children, note, bar }: { children: ReactNode; note?: ReactNode; bar?: boolean }) {
  return (
    <div className={`fig-actions${bar ? ' fig-actions--bar' : ''}`}>
      {children}
      {note && <p className="fig-actions__note">{note}</p>}
    </div>
  );
}
