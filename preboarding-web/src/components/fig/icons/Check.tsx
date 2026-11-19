import { FigSvg, type FigIconProps } from './svg';

/** Check, 18 px (the Accepted chip on home). */
export function FigCheck(p: FigIconProps) {
  return <FigSvg box={18} base={1.8} {...p}><path d="M3.75 9L7.5 12.75L15 5.25" /></FigSvg>;
}
