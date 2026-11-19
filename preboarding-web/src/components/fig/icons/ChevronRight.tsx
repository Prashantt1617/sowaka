import { FigSvg, type FigIconProps } from './svg';

/** Chevron right: 20 px in list rows; 18 px on tile chips (pass stroke={1.5}). */
export function FigChevronRight(p: FigIconProps) {
  return <FigSvg box={20} base={1.5} {...p}><path d="M7.5 5L12.5 10L7.5 15" /></FigSvg>;
}
