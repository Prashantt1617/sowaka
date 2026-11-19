import { FigSvg, type FigIconProps } from './svg';

/** Check in a circle, 18 px (the "You’ve finished this section" banner). */
export function FigCheckCircle(p: FigIconProps) {
  return <FigSvg box={18} base={1.65} {...p}><path d="M15.75 9C15.75 12.7279 12.7279 15.75 9 15.75C5.27208 15.75 2.25 12.7279 2.25 9C2.25 5.27208 5.27208 2.25 9 2.25C12.7279 2.25 15.75 5.27208 15.75 9Z" /><path d="M6 9L8.25 11.25L12 6.75" /></FigSvg>;
}
