import { FigSvg, type FigIconProps } from './svg';

/** Chevron down, 18 px (selects). */
export function FigChevronDown(p: FigIconProps) {
  return <FigSvg box={18} base={1.35} {...p}><path d="M4.5 6.75L9 11.25L13.5 6.75" /></FigSvg>;
}
