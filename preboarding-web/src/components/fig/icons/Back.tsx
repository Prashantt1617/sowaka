import { FigSvg, type FigIconProps } from './svg';

/** Back (chevron left), 22 px, in the 40 px back button of every section header. */
export function FigBack(p: FigIconProps) {
  return <FigSvg box={22} base={1.8333} {...p}><path transform="translate(7.3333 4.5833)" d="M6.41667 0.916667L0.916667 6.41667L6.41667 11.9167" /></FigSvg>;
}
