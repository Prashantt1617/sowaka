import { FigSvg, type FigIconProps } from './svg';

/** Clock, 20 px (Reporting time; 22 px on Working hours). */
export function FigClock(p: FigIconProps) {
  return <FigSvg box={20} base={1.5} {...p}><path d="M10 17.5C14.1421 17.5 17.5 14.1421 17.5 10C17.5 5.85786 14.1421 2.5 10 2.5C5.85786 2.5 2.5 5.85786 2.5 10C2.5 14.1421 5.85786 17.5 10 17.5Z" /><path d="M10 5.83331V9.99998L12.5 11.6666" /></FigSvg>;
}
