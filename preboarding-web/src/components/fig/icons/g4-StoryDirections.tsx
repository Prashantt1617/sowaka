import { FigSvg, type FigIconProps } from './svg';

/** Navigation arrow, 20 px (Get directions, Day 1 story). From the Figma frame's SVG export. */
export function G4StoryDirections(p: FigIconProps) {
  return <FigSvg box={20} base={1.66667} {...p}><path d="M2.5 9.16667L17.5 2.5L10.8333 17.5L9.16667 10.8333L2.5 9.16667Z" /></FigSvg>;
}
