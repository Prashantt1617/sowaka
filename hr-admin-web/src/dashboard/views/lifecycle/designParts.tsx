// The onboarding template editor's small pieces (Setup › Employee lifecycle › Onboarding templates,
// the Final designs' "2 · Dashboard setup"): labels, row and group shapes, the radio pills, the
// side panel, the (i) notes and the watch-list tiles. Drawn with the dashboard's tokens (ds.ts).
import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { DrawerShell } from '../../drawers/shell';
import { SEG, iconBtn, segBtn } from '../../ds';
import { IconClose, IconInfo } from '../../icons';
import type { DesignMedia, DesignStage } from '../../../services/lifecycle';
import { GLYPH, rowLine, tileLook } from './designWords';



export function Glyph({ d, size = 15, color = 'currentColor', width = 2, style }: { d: string; size?: number; color?: string; width?: number; style?: CSSProperties }) {
  return (
    <svg aria-hidden width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={width} strokeLinecap="round" strokeLinejoin="round" style={{ flex: 'none', ...style }}>
      <path d={d} />
    </svg>
  );
}

const removeBtn: CSSProperties = { position: 'relative', zIndex: 2, width: 32, height: 32, border: 0, borderRadius: 9, background: 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flex: 'none', color: 'var(--ink-3)' };

export function IconCircle({ d }: { d: string }) {
  return <span style={{ width: 32, height: 32, borderRadius: '50%', background: 'var(--surface-2)', color: 'var(--ink-2)', display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}><Glyph d={d} /></span>;
}

/** A row's bin; an agenda point's or question's cross ([cross]), as the canvas draws them. */
export function RemoveButton({ label, onClick, cross }: { label: string; onClick: () => void; cross?: boolean }) {
  return (
    <button type="button" className="pd-row-hover" aria-label={`Remove ${label}`} title="Remove" onClick={onClick} style={removeBtn}>
      {cross ? <IconClose size={15} stroke="currentColor" /> : (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 7h14M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" /></svg>
      )}
    </button>
  );
}

/** One row of a list: its icon, its title, what sits on the right; `onOpen` makes the whole row open it. */
export function ItemRow({ icon, title, titleNode, onOpen, openLabel, children, onRemove, indent, last, chevron }: {
  icon: string; title: string; titleNode?: ReactNode; onOpen?: () => void; openLabel?: string; children?: ReactNode; onRemove?: () => void; indent?: boolean; last?: boolean; chevron?: boolean;
}) {
  return (
    <div style={{ minHeight: 60, padding: `10px 0 10px ${indent ? 16 : 0}px`, borderBottom: last ? 0 : rowLine, display: 'flex', alignItems: 'center', gap: 12, position: 'relative' }}>
      <IconCircle d={icon} />
      {titleNode ?? <span style={{ flex: 1, minWidth: 0, fontSize: 13.5, fontWeight: 500, color: 'var(--ink)', overflowWrap: 'anywhere' }}>{title}</span>}
      {onOpen && <button type="button" onClick={onOpen} aria-label={openLabel ?? `Open ${title}`} style={{ position: 'absolute', inset: 0, zIndex: 1, border: 0, background: 'transparent', padding: 0, cursor: 'pointer' }} />}
      {children}
      {onRemove && <RemoveButton label={title} onClick={onRemove} />}
      {chevron && <Glyph d={GLYPH.chevron} size={16} color="var(--ink-3)" />}
    </div>
  );
}

/** A group's head (Do in Sowaka, Week 1…): its name, how many, and + / − to open or close it. */
export function GroupHead({ title, count, open, onToggle, last }: { title: string; count: number; open: boolean; onToggle: () => void; last?: boolean }) {
  return (
    <button type="button" onClick={onToggle} aria-expanded={open}
      style={{ width: '100%', minHeight: 56, border: 0, borderBottom: last ? 0 : rowLine, background: 'transparent', padding: 0, display: 'flex', alignItems: 'center', gap: 10, fontFamily: 'inherit', textAlign: 'left', cursor: 'pointer', color: 'var(--ink)' }}>
      <span style={{ flex: 1, fontSize: 14, fontWeight: 600 }}>{title}</span>
      <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--ink-3)' }}>{count}</span>
      <span style={{ width: 26, height: 26, borderRadius: '50%', background: 'var(--surface-2)', display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}><Glyph d={open ? GLYPH.minus : GLYPH.plus} size={14} width={2.4} /></span>
    </button>
  );
}

/** A row of pills that pick one value (role="radio"). */
/**
 * The canvas's three pickers: `seg` the grey track (Probation length), `who` separate pills with the
 * picked one outlined in blue (who meets them, who sets it up), `when` separate pills with the picked one black.
 */
export function RadioPills<T extends string>({ label, options, value, onPick, look = 'when' }: { label: string; options: Array<[T, string]>; value: T | undefined; onPick: (v: T) => void; look?: 'seg' | 'who' | 'when' }) {
  if (look === 'seg') {
    return (
      <div role="radiogroup" aria-label={label} style={{ ...SOFT_SEG, display: 'inline-flex' }}>
        {options.map(([v, t]) => (
          <button key={v} type="button" role="radio" aria-checked={value === v} onClick={() => onPick(v)} style={{ ...softSegBtn(value === v), flex: 'none' }}>{t}</button>
        ))}
      </div>
    );
  }
  return (
    <div role="radiogroup" aria-label={label} style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
      {options.map(([v, t]) => {
        const on = value === v;
        const tone = look === 'who'
          ? { background: on ? 'var(--accent-soft)' : 'var(--surface)', color: on ? 'var(--accent)' : 'var(--ink)', border: on ? '1.5px solid var(--accent)' : '1px solid var(--line-strong, var(--line))' }
          : { background: on ? 'var(--ink)' : 'var(--surface)', color: on ? 'var(--surface)' : 'var(--ink)', border: on ? '1px solid var(--ink)' : '1px solid var(--line)' };
        return (
          <button key={v} type="button" role="radio" aria-checked={on} onClick={() => onPick(v)}
            style={{ height: 36, padding: '0 12px', borderRadius: 999, fontFamily: 'inherit', fontSize: 12, fontWeight: 600, cursor: 'pointer', ...tone }}>{t}</button>
        );
      })}
    </div>
  );
}

/** A form block's label over its control. */
export function Block({ label, aside, children }: { label: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5, color: 'var(--ink-2)' }}><span>{label}</span>{aside}</div>
      {children}
    </div>
  );
}

/** The (i) button and the dark note it opens. */
export function InfoToggle({ label, open, onToggle }: { label: string; open: boolean; onToggle: () => void }) {
  return (
    <button type="button" onClick={onToggle} aria-expanded={open} aria-label={label}
      style={{ width: 22, height: 22, border: 0, background: 'transparent', padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flex: 'none' }}>
      <IconInfo size={17} stroke={open ? 'var(--ink)' : 'var(--ink-3)'} />
    </button>
  );
}
export function InfoNote({ children, floating }: { children: ReactNode; floating?: boolean }) {
  return (
    <div role="note" style={{ ...(floating ? { position: 'absolute', left: 0, top: 30, zIndex: 4, width: 300 } : {}), background: 'var(--sel)', color: 'var(--on-sel)', borderRadius: 12, padding: '12px 14px', fontSize: 12, fontWeight: 500, lineHeight: 1.5, boxShadow: 'var(--shadow)' }}>
      {children}
    </div>
  );
}

// —— Side panel and dialogs ——————————————————————————————————————————————————

/** A panel from the right: a title (and a line under it), the scrolling body, the buttons at the bottom. */
export function SidePanel({ title, sub, width, onClose, footer, children }: { title: string; sub?: string; width: number; onClose: () => void; footer?: ReactNode; children: ReactNode }) {
  return (
    <DrawerShell width={width} onClose={onClose} label={title} onEscape={onClose}>
      <div style={{ padding: '18px 22px', borderBottom: rowLine, display: 'flex', alignItems: 'flex-start', gap: 12, flex: 'none' }}>
        <span style={{ flex: 1, minWidth: 0, display: 'grid', gap: 4 }}>
          <span style={{ fontSize: 16, fontWeight: 600, color: 'var(--ink)' }}>{title}</span>
          {sub && <span style={{ fontSize: 12.5, color: 'var(--ink-3)', lineHeight: 1.5 }}>{sub}</span>}
        </span>
        <button type="button" onClick={onClose} aria-label="Close" className="ds-icon-btn" style={iconBtn(36)}><IconClose size={16} stroke="currentColor" /></button>
      </div>
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '18px 22px', display: 'grid', alignContent: 'start', gap: 18 }}>{children}</div>
      {footer && <div style={{ padding: '14px 22px', borderTop: rowLine, display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8, flex: 'none' }}>{footer}</div>}
    </DrawerShell>
  );
}

/** A dark overlay with something in the middle (the Employee preview); Escape closes it. */
export function Overlay({ onClose, label, children }: { onClose: () => void; label: string; children: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return createPortal(
    <div style={{ position: 'fixed', inset: 0, zIndex: 75, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div onClick={onClose} style={{ position: 'absolute', inset: 0, background: 'var(--scrim)' }} />
      <div role="dialog" aria-modal="true" aria-label={label} style={{ position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14, maxHeight: '100%' }}>{children}</div>
    </div>,
    document.body,
  );
}

/** A dropdown of names (Who does the HR tasks…). */
export function NameDropdown({ label, value, options, onPick, placeholder = '' }: { label: string; value: string; options: ReadonlyArray<{ id: string; name: string }>; onPick: (id: string) => void; placeholder?: string }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return undefined;
    const close = (e: globalThis.MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', onKey); };
  }, [open]);
  const shown = options.find((o) => o.id === value)?.name ?? placeholder;
  return (
    <span ref={box} style={{ position: 'relative', flex: 'none' }}>
      <button type="button" onClick={() => setOpen(!open)} aria-haspopup="listbox" aria-expanded={open} aria-label={`${label}: ${shown}`}
        style={{ height: 36, minWidth: 190, padding: '0 10px 0 12px', borderRadius: 10, border: '1px solid var(--line-2)', background: 'var(--surface)', color: 'var(--ink)', fontFamily: 'inherit', fontSize: 13, fontWeight: 500, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{shown}</span><Glyph d={GLYPH.down} size={14} color="var(--ink-3)" />
      </button>
      {open && (
        <div role="listbox" aria-label={label} style={{ position: 'absolute', right: 0, top: 42, zIndex: 6, minWidth: 240, maxHeight: 300, overflowY: 'auto', background: 'var(--surface)', border: rowLine, borderRadius: 14, boxShadow: 'var(--shadow-drawer)', padding: 6, display: 'flex', flexDirection: 'column', gap: 2 }}>
          {options.map((o) => (
            <button key={o.id || 'none'} type="button" role="option" aria-selected={o.id === value} onClick={() => { onPick(o.id); setOpen(false); }}
              style={{ minHeight: 40, border: 0, borderRadius: 9, background: o.id === value ? 'var(--surface-2)' : 'transparent', padding: '0 10px', display: 'flex', alignItems: 'center', fontFamily: 'inherit', cursor: 'pointer', color: 'var(--ink)', fontSize: 13, fontWeight: 500, textAlign: 'left' }}>{o.name}</button>
          ))}
        </div>
      )}
    </span>
  );
}

// —— Watch-list tiles ———————————————————————————————————————————————————————


/** The face of a tile (also the story dialog's preview, bigger). */
export function TileFace({ media, w, h, emptyText, textShown, preview }: { media: DesignMedia; w: number; h: number; emptyText: string; textShown?: string; preview?: boolean }) {
  const look = tileLook(media);
  return (
    <span style={{ width: w, height: h, borderRadius: 14, background: look.bg, border: look.border, boxSizing: 'border-box', position: 'relative', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '12px 10px', flex: 'none' }}>
      <span style={{ position: 'absolute', left: 8, right: 8, top: 6, height: 2, borderRadius: 2, background: look.bar }} />
      {look.text
        ? <span style={{ color: '#FFFFFF', fontSize: w > 120 ? 14 : 11, fontWeight: 600, lineHeight: 1.35, textAlign: 'center', overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 6, WebkitBoxOrient: 'vertical', overflowWrap: 'anywhere' }}>{textShown ?? media.text ?? ''}</span>
        : <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: preview ? 8 : 6 }}><Glyph d={look.icon} size={preview ? 34 : 22} color={look.iconColor} />{look.empty && <span style={preview ? { fontSize: 12, color: 'var(--ink-3)', textAlign: 'center' } : { fontSize: 11, fontWeight: 600, color: 'var(--accent-ink)', textAlign: 'center' }}>{emptyText}</span>}</span>}
    </span>
  );
}

/** The strip of tiles: + Add first, then each item with its title (and when it shows). */
export function TileStrip({ items, onAdd, addLabel, onOpen, whenOf }: {
  /** `index`: the item's place in its list, when the strip shows them in another order. */
  items: Array<{ id?: string; title: string; media: DesignMedia; stage: DesignStage; index?: number }>; onAdd: () => void; addLabel: string; onOpen: (index: number) => void; whenOf?: (s: DesignStage) => string;
}) {
  return (
    <div style={{ display: 'flex', gap: 12, overflowX: 'auto', padding: '14px 0 12px' }}>
      <button type="button" onClick={onAdd} aria-label={addLabel} style={{ width: 96, flex: 'none', border: 0, background: 'transparent', padding: 0, fontFamily: 'inherit', textAlign: 'left', cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 6 }}>
        <span style={{ width: 96, height: 160, borderRadius: 14, border: '1.5px dashed var(--line-2)', background: 'var(--surface-2)', boxSizing: 'border-box', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Glyph d={GLYPH.plus} size={22} color="var(--accent-ink)" width={2.2} /></span>
        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--accent-ink)' }}>Add</span>
      </button>
      {items.map((it, i) => (
        <button key={it.id ?? i} type="button" onClick={() => onOpen(it.index ?? i)} aria-label={`Edit ${it.title}`} style={{ width: 96, flex: 'none', border: 0, background: 'transparent', padding: 0, fontFamily: 'inherit', textAlign: 'left', cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 6, color: 'var(--ink)' }}>
          <TileFace media={it.media} w={96} h={160} emptyText="Upload" />
          <span style={{ fontSize: 12, fontWeight: 500, lineHeight: 1.3, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>{it.title}</span>
          {whenOf && <span style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: -3 }}>{whenOf(it.stage)}</span>}
        </button>
      ))}
    </div>
  );
}


/** The canvas's white-on-grey toggle (Probation length, a watch item's type): the picked one white, raised. */
export const SOFT_SEG: CSSProperties = { display: 'flex', gap: 4, padding: 4, background: 'var(--surface-2)', borderRadius: 12 };
export const softSegBtn = (on: boolean): CSSProperties => ({
  flex: 1, height: 36, borderRadius: 9, border: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '0 14px',
  background: on ? 'var(--surface)' : 'transparent', color: 'var(--ink)', fontFamily: 'inherit', fontSize: 13, fontWeight: on ? 700 : 500,
  cursor: 'pointer', boxShadow: on ? '0 1px 3px rgba(0,0,0,.12)' : 'none',
});
