// Small reusable presentational pieces used across views.
import type { CSSProperties, ReactNode } from 'react';
import { useState } from 'react';
import type { Pill as PillT } from './theme';
import { avColor, initials } from './theme';
import { IconChevronDown, IconSearch } from './icons';

// Photo URLs that have already failed once. An expired presigned link or a
// missing file fails the same way every time, so any later avatar given that
// URL goes straight to the initials instead of asking for it again.
const brokenPhotos = new Set<string>();

export function Avatar({
  name,
  size = 36,
  font = 14,
  src,
  tone,
}: {
  name: string;
  size?: number;
  font?: number;
  /** Their photo; the initials stand in when it is missing or fails to load. */
  src?: string;
  /** Colours for the initials circle, when it should not take the person's own. */
  tone?: { bg: string; fg: string };
}) {
  const [failed, setFailed] = useState<string | null>(null);
  if (src && src !== failed && !brokenPhotos.has(src)) {
    return (
      <img
        src={src}
        alt={name}
        loading="lazy"
        decoding="async"
        width={size}
        height={size}
        onError={() => {
          brokenPhotos.add(src);
          setFailed(src);
        }}
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
        color: tone ? tone.fg : `color-mix(in srgb, ${c} var(--av-fg), var(--ink))`,
        fontWeight: 600,
        fontSize: Math.round(font * 0.9 * 2) / 2,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
        background: tone ? tone.bg : `color-mix(in srgb, ${c} var(--av-bg), var(--surface))`,
      }}
    >
      {initials(name.trim() || '?')}
    </div>
  );
}

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
        borderRadius: 999,
        background: tone.bg,
        color: tone.fg,
        whiteSpace: 'nowrap',
        lineHeight: 1.45,
      }}
    >
      <span aria-hidden style={{ width: 6, height: 6, borderRadius: '50%', background: 'currentColor', opacity: 0.85, flexShrink: 0 }} />
      {label}
    </span>
  );
}

export function SummaryCard({
  label,
  value,
  color = 'var(--ink)',
}: {
  label: string;
  value: ReactNode;
  color?: string;
}) {
  return (
    <div style={{ background: 'var(--surface)', border: '1px solid transparent', borderRadius: 'var(--r-lg)', boxShadow: 'var(--shadow)', padding: '14px 16px', minHeight: 96 }}>
      <div style={{ fontSize: 12.5, color: 'var(--ink-2)', fontWeight: 400 }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 400, letterSpacing: '-.02em', marginTop: 6, color }}>{value}</div>
    </div>
  );
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
  width?: number;
}) {
  return (
    <div className="ds-field" style={{ display: 'flex', alignItems: 'center', background: 'var(--surface)', border: '1px solid var(--line-2)', borderRadius: 999, height: 40, padding: '0 14px', gap: 8, width }}>
      <IconSearch />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        style={{ border: 'none', outline: 'none', background: 'none', fontSize: 13, width: '100%', color: 'var(--ink)' }}
      />
    </div>
  );
}

export function StatusTabs<T extends string>({
  options,
  active,
  onSelect,
  labels,
}: {
  options: T[];
  active: T;
  onSelect: (v: T) => void;
  labels?: Partial<Record<T, string>>;
}) {
  return (
    <div style={{ display: 'inline-flex', flexWrap: 'wrap', background: 'var(--surface-2)', border: '1px solid var(--line)', borderRadius: 999, padding: 4, gap: 2 }}>
      {options.map((opt) => {
        const on = active === opt;
        return (
          <button
            key={opt}
            onClick={() => onSelect(opt)}
            style={{
              border: 'none',
              cursor: 'pointer',
              fontSize: 13,
              fontWeight: on ? 500 : 400,
              height: 32,
              padding: '0 13px',
              borderRadius: 999,
              background: on ? 'var(--sel)' : 'transparent',
              color: on ? 'var(--on-sel)' : 'var(--ink-2)',
            }}
          >
            {labels?.[opt] ?? (opt === ('all' as T) ? 'All' : opt)}
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
    <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
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
        }}
      >
        {children}
      </select>
      <IconChevronDown style={{ position: 'absolute', right: 11, pointerEvents: 'none' }} />
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
    <div style={{ display: 'flex', alignItems: 'center', background: 'var(--surface)', border: '1px solid var(--line-2)', borderRadius: 999, height: 40, padding: '0 14px', gap: 7 }}>
      <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--ink-3)' }}>From</span>
      <input type="date" value={from} max={to || undefined} onChange={(e) => onFrom(e.target.value)} style={box} />
      <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--ink-3)' }}>to</span>
      <input type="date" value={to} min={from || undefined} onChange={(e) => onTo(e.target.value)} style={box} />
      {(from || to) && (
        <button
          onClick={() => {
            onFrom('');
            onTo('');
          }}
          title="Clear dates"
          style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--ink-4)', fontSize: 18, fontWeight: 500, lineHeight: 1, padding: '0 2px' }}
        >
          ×
        </button>
      )}
    </div>
  );
}

export function Card({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return (
    <div style={{ background: 'var(--surface)', border: '1px solid transparent', borderRadius: 'var(--r-lg)', boxShadow: 'var(--shadow)', overflow: 'hidden', ...style }}>
      {children}
    </div>
  );
}

export function EmptyRow({ text }: { text: string }) {
  return (
    <div style={{ padding: 48, textAlign: 'center', color: 'var(--ink-3)', fontSize: 13, fontWeight: 400 }}>
      {text}
    </div>
  );
}
