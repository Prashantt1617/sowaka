import { FigSvg, type FigIconProps } from './svg';

/** Chevron right, 22 px in a 40 px tinted circle (policy reads; the Back vector mirrored). From the Figma frame's SVG export. */
export function G4StoryChevron(p: FigIconProps) {
  return <FigSvg box={22} base={1.83333} {...p}><path transform="translate(7.333 4.583)" d="M0.916667 0.916667L6.41667 6.41667L0.916667 11.9167" /></FigSvg>;
}
