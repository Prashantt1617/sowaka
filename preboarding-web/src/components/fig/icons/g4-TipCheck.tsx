import { FigSvg, type FigIconProps } from './svg';

/** Tick, 14 px in a 24 px canvas circle (photo tips; green). From the Figma frame's SVG export. */
export function G4TipCheck(p: FigIconProps) {
  return <FigSvg box={14} base={1.51667} {...p}><path transform="translate(2.158 3.325)" d="M0.758333 3.675L3.675 6.59167L9.50833 0.758333" /></FigSvg>;
}
