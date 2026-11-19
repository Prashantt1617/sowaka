// The design's own icons (Figma file iR1u5kUixarUHeVIU6jiHn, page "Pre-boarding Portal"), copied path for
// path from the frames' SVG exports. Each icon keeps its native grid (`box`) and draws at `size`;
// `stroke` is the stroke width in px at that size (default: the frame's, scaled with the icon).
import type { ReactNode } from 'react';

export type FigIconProps = { size?: number; stroke?: number; className?: string; title?: string };

export function FigSvg({ box, base, size, stroke, className, title, fill, children }: FigIconProps & { box: number; base: number; fill?: boolean; children: ReactNode }) {
  const s = size ?? box;
  const sw = stroke !== undefined ? (stroke * box) / s : base;
  return (
    <svg width={s} height={s} viewBox={`0 0 ${box} ${box}`} className={className} aria-hidden={title ? undefined : true} role={title ? 'img' : undefined}
      fill={fill ? 'currentColor' : 'none'} stroke={fill ? 'none' : 'currentColor'} strokeWidth={fill ? undefined : sw} strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block', flex: 'none' }}>
      {title && <title>{title}</title>}
      {children}
    </svg>
  );
}
