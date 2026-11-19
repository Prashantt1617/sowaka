import { FigSvg, type FigIconProps } from './svg';

/** Select chevron, 18 px ("Highest qualification: not chosen"; Figma export, stroke 1.35). */
export function G2SelectChevron(p: FigIconProps) {
  return <FigSvg box={18} base={1.35} {...p}><path d="M4.5 6.75L9 11.25L13.5 6.75" /></FigSvg>;
}
