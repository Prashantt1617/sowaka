import { FigSvg, type FigIconProps } from './svg';

/** Cross, 14 px in a 24 px canvas circle (photo tips; amber). From the Figma frame's SVG export. */
export function G4TipCross(p: FigIconProps) {
  return <FigSvg box={14} base={1.51667} {...p}><path transform="translate(2.742 2.742)" d="M0.758333 0.758333L7.75833 7.75833M7.75833 0.758333L0.758333 7.75833" /></FigSvg>;
}
