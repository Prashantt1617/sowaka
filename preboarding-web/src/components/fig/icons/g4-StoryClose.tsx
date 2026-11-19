import { FigSvg, type FigIconProps } from './svg';

/** Close, 24 px (stories; brand on light pages, white on Culture). From the Figma frame's SVG export. */
export function G4StoryClose(p: FigIconProps) {
  return <FigSvg box={24} base={2} {...p}><path d="M6 6L18 18M18 6L6 18" /></FigSvg>;
}
