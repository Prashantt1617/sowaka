import { FigSvg, type FigIconProps } from './svg';

/** Play (filled), 24 px in the Culture story ring; 20 px on the culture cards. */
export function FigPlay(p: FigIconProps) {
  return <FigSvg box={24} base={0} fill {...p}><path transform="translate(8 5)" d="M0 0V14L11 7L0 0Z" /></FigSvg>;
}
