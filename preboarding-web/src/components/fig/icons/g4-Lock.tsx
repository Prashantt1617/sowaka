import { FigSvg, type FigIconProps } from './svg';

/** Lock, 16 px (ID documents note). From the Figma frame's SVG export. */
export function G4Lock(p: FigIconProps) {
  return <FigSvg box={16} base={1.2} {...p}><path d="M4.66667 7.33333V5.33333C4.66667 4.44928 5.01786 3.60143 5.64298 2.97631C6.2681 2.35119 7.11595 2 8 2C8.88406 2 9.7319 2.35119 10.357 2.97631C10.9821 3.60143 11.3333 4.44928 11.3333 5.33333V7.33333M3.33333 7.33333H12.6667V14H3.33333V7.33333Z" /></FigSvg>;
}
