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

// ---- Loading, error and empty states ------------------------------------
// A page shows these until its own data has arrived: a skeleton shaped like
// the content (hidden for the first 130 ms so fast loads don't flicker, still
// under reduced motion), a short error with Retry, and only then the real
// empty state. The shimmer and the delay live in styles.css (.sk, .sk-delay).

export type LoadState = 'loading' | 'error' | 'ready';

/** One shimmering placeholder bar. */
export function Skeleton({ w = '100%', h = 12, r = 6, style }: { w?: number | string; h?: number; r?: number | string; style?: CSSProperties }) {
  return <span aria-hidden className="sk" style={{ width: w, height: h, borderRadius: r, flexShrink: 0, ...style }} />;
}

/** Holds skeleton pieces: announced as busy, invisible for the first 130 ms. */
export function SkeletonFrame({ children, style, label = 'Loading' }: { children: ReactNode; style?: CSSProperties; label?: string }) {
  return (
    <div className="sk-delay" role="status" aria-busy="true" aria-label={label} style={style}>
      {children}
    </div>
  );
}

// Varied, repeatable widths so rows read like text rather than stripes.
const SK_W = ['72%', '48%', '60%', '38%', '66%', '54%', '44%'];

/** Table or list rows: an avatar and a name, then a bar per further column. */
export function SkeletonRows({ rows = 6, cols = 4, avatar = true, rowHeight = 64, pad = 18 }: { rows?: number; cols?: number; avatar?: boolean; rowHeight?: number; pad?: number }) {
  return (
    <SkeletonFrame>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 18, minHeight: rowHeight, padding: `0 ${pad}px`, borderTop: i ? '1px solid var(--line)' : 'none' }}>
          <div style={{ flex: 1.6, display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
            {avatar && <Skeleton w={32} h={32} r="50%" />}
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 7, minWidth: 0 }}>
              <Skeleton w={SK_W[i % SK_W.length]} h={11} />
              <Skeleton w={SK_W[(i + 3) % SK_W.length]} h={9} style={{ opacity: 0.7 }} />
            </div>
          </div>
          {Array.from({ length: Math.max(0, cols - 1) }, (_, c) => (
            <div key={c} style={{ flex: 1, minWidth: 0 }}>
              <Skeleton w={SK_W[(i + c + 1) % SK_W.length]} h={11} />
            </div>
          ))}
        </div>
      ))}
    </SkeletonFrame>
  );
}

/** A table body's worth of skeleton rows, for a view that keeps its header. */
export function SkeletonTableRows({ colSpan, rows = 6, cols = 4, avatar = true }: { colSpan: number; rows?: number; cols?: number; avatar?: boolean }) {
  return (
    <tr>
      <td colSpan={colSpan} style={{ padding: 0 }}>
        <SkeletonRows rows={rows} cols={cols} avatar={avatar} />
      </td>
    </tr>
  );
}

/**
 * The body of a list whose header stays put: skeleton rows while it loads, the
 * error with Retry if it failed, nothing once it is ready (the rows take over).
 */
export function ListPending({ state, onRetry, errorText, rows = 6, cols = 4, avatar = true, rowHeight }: { state: LoadState; onRetry?: () => void; errorText?: string; rows?: number; cols?: number; avatar?: boolean; rowHeight?: number }) {
  if (state === 'ready') return null;
  if (state === 'error') return <LoadError text={errorText} onRetry={onRetry} />;
  return <SkeletonRows rows={rows} cols={cols} avatar={avatar} rowHeight={rowHeight} />;
}

/** A row of summary-card placeholders, like a row of SummaryCard. */
export function SkeletonCards({ count = 4, minWidth = 160, style }: { count?: number; minWidth?: number; style?: CSSProperties }) {
  return (
    <SkeletonFrame style={{ display: 'grid', gridTemplateColumns: `repeat(auto-fit, minmax(${minWidth}px, 1fr))`, gap: 14, ...style }}>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} style={{ background: 'var(--surface)', borderRadius: 'var(--r-lg)', boxShadow: 'var(--shadow)', padding: 16, minHeight: 96, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <Skeleton w={SK_W[i % SK_W.length]} h={10} />
          <Skeleton w={56} h={22} />
        </div>
      ))}
    </SkeletonFrame>
  );
}

/** Lines of text, for a card or a form. */
export function SkeletonLines({ lines = 3, gap = 12, style }: { lines?: number; gap?: number; style?: CSSProperties }) {
  return (
    <SkeletonFrame style={{ display: 'flex', flexDirection: 'column', gap, ...style }}>
      {Array.from({ length: lines }, (_, i) => <Skeleton key={i} w={SK_W[i % SK_W.length]} h={11} />)}
    </SkeletonFrame>
  );
}

/** A form's worth of label-and-field pairs, two to a row. */
export function SkeletonForm({ fields = 6 }: { fields?: number }) {
  return (
    <SkeletonFrame style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '22px 26px' }}>
      {Array.from({ length: fields }, (_, i) => (
        <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
          <Skeleton w={110} h={10} style={{ opacity: 0.7 }} />
          <Skeleton w="80%" h={34} r={10} />
        </div>
      ))}
    </SkeletonFrame>
  );
}

/** A page's worth: optional summary cards over a card of rows. */
export function SkeletonPage({ cards = 0, rows = 6, cols = 4, avatar = true }: { cards?: number; rows?: number; cols?: number; avatar?: boolean }) {
  return (
    <div>
      {cards > 0 && <SkeletonCards count={cards} style={{ marginBottom: 18 }} />}
      <Card><SkeletonRows rows={rows} cols={cols} avatar={avatar} /></Card>
    </div>
  );
}

/** A count or figure: a bar its size while loading, a dash if it failed. */
export function LoadingFigure({ state, children, w = 44, h = 20 }: { state: LoadState; children: ReactNode; w?: number | string; h?: number }) {
  if (state === 'ready') return <>{children}</>;
  if (state === 'error') return <span title="Could not load">—</span>;
  return (
    <span className="sk-delay" role="status" aria-label="Loading" style={{ display: 'inline-flex', verticalAlign: 'middle' }}>
      <Skeleton w={w} h={h} />
    </span>
  );
}

/** A compact inline spinner, for a small section or a figure in a sentence. */
export function Spinner({ size = 13, label }: { size?: number; label?: string }) {
  return (
    <span className="sk-delay" role="status" aria-label={label ?? 'Loading'} style={{ display: 'inline-flex', alignItems: 'center', gap: 8, color: 'var(--ink-3)', fontSize: 12.5, verticalAlign: 'middle' }}>
      <span aria-hidden className="sk-spin" style={{ width: size, height: size, border: '2px solid var(--line-2)', borderTopColor: 'var(--accent)', borderRadius: '50%', display: 'inline-block', flexShrink: 0 }} />
      {label}
    </span>
  );
}

/** A request that failed: a short line and Retry, never a spinner forever. */
export function LoadError({ text = 'This could not be loaded.', onRetry, compact }: { text?: string; onRetry?: () => void; compact?: boolean }) {
  return (
    <div role="alert" style={{ display: 'flex', flexDirection: compact ? 'row' : 'column', alignItems: 'center', justifyContent: 'center', gap: compact ? 12 : 14, padding: compact ? '8px 0' : 44, textAlign: 'center', color: 'var(--ink-2)', fontSize: 13 }}>
      <span>{text}</span>
      {onRetry && (
        <button
          onClick={onRetry}
          style={{ height: 34, padding: '0 16px', borderRadius: 999, border: '1px solid var(--line-2)', background: 'var(--surface)', color: 'var(--ink)', fontSize: 12.5, fontWeight: 500, cursor: 'pointer' }}
        >
          Retry
        </button>
      )}
    </div>
  );
}

/**
 * The page body once `state` is ready; the skeleton while it loads; the error
 * with Retry if it failed. Pass a function as children when the content reads
 * data that is not there yet.
 */
export function Loadable({
  state,
  onRetry,
  errorText,
  skeleton,
  children,
}: {
  state: LoadState;
  onRetry?: () => void;
  errorText?: string;
  skeleton: ReactNode;
  children: ReactNode | (() => ReactNode);
}) {
  if (state === 'error') return <Card><LoadError text={errorText} onRetry={onRetry} /></Card>;
  if (state === 'loading') return <>{skeleton}</>;
  return <>{typeof children === 'function' ? (children as () => ReactNode)() : children}</>;
}
