import { FigSvg, type FigIconProps } from './svg';

/** Plus, 18 px (Add another contact). */
export function FigPlus(p: FigIconProps) {
  return <FigSvg box={18} base={1.5} {...p}><path d="M9 3.75V14.25M3.75 9H14.25" /></FigSvg>;
}
