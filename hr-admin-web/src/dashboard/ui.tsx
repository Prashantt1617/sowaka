// Small reusable presentational pieces used across views, drawn to the
// Sowaka HR Admin prototype: pill controls, white cards with a soft shadow,
// grey table-header strips, solid status pills and one blue primary action.
// The matching style objects (btn, iconBtn, TH, TR, inp…) are in ds.ts.
import type { CSSProperties, ReactNode } from 'react';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Pill as PillT } from './theme';
import { avColor, initials } from './theme';
import { IconChevronDown, IconSearch } from './icons';
import { CARD, CARD_PAD, PAGE_ACTIONS_ID, SEG, TAG, TILE, segBtn, sentence } from './ds';

export function Avatar({
  name,
  size = 34,
  font = 14,
  src,
}: {
  name: string;
  size?: number;
  font?: number;
  /** Their photo; the initials stand in when it is missing or fails to load. */
  src?: string;
}) {
  const [broken, setBroken] = useState(false);
  if (src && !broken) {
    return (
      <img
        src={src}
        alt=""
        onError={() => setBroken(true)}
        style={{ width: size, height: size, borderRadius: '50%', objectFit: 'cover', flexShrink: 0, display: 'block', background: 'var(--surface-2)' }}
      />
    );
  }
  // A soft tint of the person's colour with their initials in the full colour.
  const c = avColor(name);
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        // Lifted toward the ink in dark mode so the initials stay readable.
        color: `color-mix(in srgb, ${c} var(--av-fg), var(--ink))`,
        fontWeight: 600,
        fontSize: Math.round(font * 0.9 * 2) / 2,
        lineHeight: 1,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
        background: `color-mix(in srgb, ${c} var(--av-bg), var(--surface))`,
      }}
    >
      {initials(name)}
    </div>
  );
}

/** Solid status pill: 11.5px medium, a 6px dot, fully rounded. */
export function Pill({
  label,
  tone,
  fontSize = 11.5,
  padding = '3px 10px',
  fontWeight = 500,
}: {
  label: ReactNode;
  tone: PillT;
  fontSize?: number;
  padding?: string;
  fontWeight?: number;
}) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        fontSize,
        fontWeight,
        padding,
        borderRadius: 99,
        background: tone.bg,
        color: tone.fg,
        whiteSpace: 'nowrap',
        lineHeight: 1.5,
        letterSpacing: '-.005em',
      }}
    >
      <span aria-hidden style={{ width: 6, height: 6, borderRadius: '50%', background: 'currentColor', opacity: 0.85, flexShrink: 0 }} />
      {label}
    </span>
  );
}

/** Neutral outline tag (departments, designations, codes). */
export function Tag({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return <span style={{ ...TAG, ...style }}>{children}</span>;
}

/** KPI tile: label first, then a light 24px number in ink.
 *  `color` is accepted for older call sites; the prototype keeps every number in ink. */
export function SummaryCard({
  label,
  value,
  sub,
  onClick,
  active,
}: {
  label: ReactNode;
  value: ReactNode;
  color?: string;
  /** Small grey line under the number. */
  sub?: ReactNode;
  onClick?: () => void;
  active?: boolean;
}) {
  const style: CSSProperties = {
    ...TILE,
    ...(active ? { border: '1px solid var(--sel)', boxShadow: '0 0 0 1px var(--sel), var(--shadow)' } : null),
  };
  const body = (
    <>
      <div style={{ fontSize: 12.5, lineHeight: '18.75px', color: 'var(--ink-2)', fontWeight: 400 }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 400, letterSpacing: '-.02em', lineHeight: 1.05, marginTop: 6, color: 'var(--ink)', fontVariantNumeric: 'tabular-nums' }}>{value}</div>
      {sub != null && <div style={{ fontSize: 12.5, color: 'var(--ink-3)', lineHeight: 1.5 }}>{sub}</div>}
    </>
  );
  if (onClick) {
    return (
      <button type="button" onClick={onClick} aria-pressed={active} className="ds-tile" style={{ ...style, textAlign: 'left', cursor: 'pointer', font: 'inherit', color: 'inherit', width: '100%' }}>
        {body}
      </button>
    );
  }
  return <div style={style}>{body}</div>;
}

export function SearchInput({
  value,
  onChange,
  placeholder,
  width = 262,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  width?: number | string;
}) {
  return (
    <div className="ds-field" style={{ display: 'flex', alignItems: 'center', background: 'var(--surface)', border: '1px solid var(--line-2)', borderRadius: 999, height: 40, padding: '0 12px', gap: 6, width, flexShrink: 0 }}>
      <IconSearch size={15} stroke="var(--ink-3)" />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="ds-inp-bare"
        style={{ border: 'none', outline: 'none', background: 'none', fontSize: 13.5, width: '100%', height: '100%', color: 'var(--ink)', minWidth: 0, padding: '1px 2px' }}
      />
    </div>
  );
}

/** Segmented status filter: a grey pill track with the selected option in black. */
export function StatusTabs<T extends string>({
  options,
  active,
  onSelect,
  labels,
  counts,
}: {
  options: T[];
  active: T;
  onSelect: (v: T) => void;
  labels?: Partial<Record<T, string>>;
  /** Small count after each label, as the prototype shows. */
  counts?: Partial<Record<T, number>>;
}) {
  return (
    <div style={SEG}>
      {options.map((opt) => {
        const on = active === opt;
        const n = counts?.[opt];
        return (
          <button key={opt} type="button" onClick={() => onSelect(opt)} style={segBtn(on)}>
            {labels?.[opt] ?? (opt === ('all' as T) ? 'All' : opt)}
            {n != null && <span style={{ fontSize: 11, fontWeight: 700, color: on ? 'inherit' : 'var(--ink-3)', opacity: on ? 0.8 : 1 }}>{n}</span>}
          </button>
        );
      })}
    </div>
  );
}

export function SelectBox({
  value,
  onChange,
  children,
}: {
  value: string;
  onChange: (v: string) => void;
  children: ReactNode;
}) {
  return (
    <div className="ds-field" style={{ position: 'relative', display: 'flex', alignItems: 'center', borderRadius: 999 }}>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{
          appearance: 'none',
          WebkitAppearance: 'none',
          background: 'var(--surface)',
          border: '1px solid var(--line-2)',
          borderRadius: 999,
          height: 40,
          padding: '0 34px 0 14px',
          fontSize: 13,
          fontWeight: 500,
          color: 'var(--ink)',
          cursor: 'pointer',
          outline: 'none',
        }}
      >
        {children}
      </select>
      <IconChevronDown size={14} stroke="var(--ink)" style={{ position: 'absolute', right: 13, pointerEvents: 'none' }} />
    </div>
  );
}

export function DateRange({
  from,
  to,
  onFrom,
  onTo,
}: {
  from: string;
  to: string;
  onFrom: (v: string) => void;
  onTo: (v: string) => void;
}) {
  const box: CSSProperties = {
    border: 'none',
    outline: 'none',
    background: 'none',
    fontSize: 13,
    fontWeight: 500,
    color: 'var(--ink)',
    cursor: 'pointer',
  };
  return (
    <div className="ds-field" style={{ display: 'flex', alignItems: 'center', background: 'var(--surface)', border: '1px solid var(--line-2)', borderRadius: 999, height: 40, padding: '0 12px', gap: 6 }}>
      <span style={{ fontSize: 12, fontWeight: 400, color: 'var(--ink-3)' }}>From</span>
      <input type="date" value={from} max={to || undefined} onChange={(e) => onFrom(e.target.value)} style={box} />
      <span style={{ fontSize: 12, fontWeight: 400, color: 'var(--ink-3)' }}>to</span>
      <input type="date" value={to} min={from || undefined} onChange={(e) => onTo(e.target.value)} style={box} />
      {(from || to) && (
        <button
          onClick={() => {
            onFrom('');
            onTo('');
          }}
          title="Clear dates"
          style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--ink-3)', fontSize: 18, fontWeight: 500, lineHeight: 1, padding: '0 2px' }}
        >
          ×
        </button>
      )}
    </div>
  );
}

/** White card, 22px corners, soft shadow. Pass `padded` for the prototype's 20px inset. */
export function Card({ children, style, padded }: { children: ReactNode; style?: CSSProperties; padded?: boolean }) {
  return <div style={{ ...CARD, ...(padded ? { padding: CARD_PAD } : null), ...style }}>{children}</div>;
}

export function EmptyRow({ text }: { text: string }) {
  return (
    <div style={{ padding: 40, textAlign: 'center', color: 'var(--ink-3)', fontSize: 13.5, fontWeight: 400 }}>
      {text}
    </div>
  );
}

/** A header label, shown in sentence case ("EMPLOYEE" reads "Employee"). */
export function Th({ children, align }: { children: string; align?: 'right' | 'center' }) {
  return <div style={{ textAlign: align, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>{sentence(children)}</div>;
}

/** "15 of 15": the count at the right of a toolbar. */
export function CountLine({ shown, total, noun }: { shown: ReactNode; total?: ReactNode; noun?: string }) {
  return (
    <span style={{ fontSize: 16, fontWeight: 400, letterSpacing: '-.02em', lineHeight: 1.5, color: 'var(--ink-3)', whiteSpace: 'nowrap' }}>
      <b style={{ fontWeight: 500, color: 'var(--ink)' }}>{shown}</b>
      {total != null && <> of {total}</>}
      {noun && <> {noun}</>}
    </span>
  );
}

export function PageActions({ children }: { children: ReactNode }) {
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  useEffect(() => {
    setSlot(document.getElementById(PAGE_ACTIONS_ID));
  }, []);
  return slot ? createPortal(children, slot) : null;
}
