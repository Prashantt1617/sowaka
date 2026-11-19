import { FigSvg, type FigIconProps } from './svg';

/** Check, 14 px, white in the 24 px green done circle. */
export function FigCheckSmall(p: FigIconProps) {
  return <FigSvg box={14} base={1.75} {...p}><path transform="translate(2.0417 3.2083)" d="M0.875 3.79167L3.79167 6.70833L9.625 0.875" /></FigSvg>;
}
