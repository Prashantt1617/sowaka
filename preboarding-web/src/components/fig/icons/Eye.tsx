import { FigSvg, type FigIconProps } from './svg';

/** Eye, 18 px (View letter). */
export function FigEye(p: FigIconProps) {
  return <FigSvg box={18} base={1.35} {...p}><path d="M1.5 9C1.5 9 4.125 3.75 9 3.75C13.875 3.75 16.5 9 16.5 9C16.5 9 13.875 14.25 9 14.25C4.125 14.25 1.5 9 1.5 9Z" /><path d="M11.25 9C11.25 10.2426 10.2426 11.25 9 11.25C7.75736 11.25 6.75 10.2426 6.75 9C6.75 7.75736 7.75736 6.75 9 6.75C10.2426 6.75 11.25 7.75736 11.25 9Z" /></FigSvg>;
}
