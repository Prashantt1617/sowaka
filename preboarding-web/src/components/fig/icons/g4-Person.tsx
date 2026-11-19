import { FigSvg, type FigIconProps } from './svg';

/** Person, 64 px (No photo yet). From the Figma frame's SVG export. */
export function G4Person(p: FigIconProps) {
  return <FigSvg box={64} base={3.73333} {...p}><path transform="translate(19.467 8.8)" d="M23.2 12.5333C23.2 18.4244 18.4244 23.2 12.5333 23.2C6.6423 23.2 1.86667 18.4244 1.86667 12.5333C1.86667 6.6423 6.6423 1.86667 12.5333 1.86667C18.4244 1.86667 23.2 6.6423 23.2 12.5333Z" /><path transform="translate(8.8 38.133)" d="M1.86667 17.8667C1.86667 7.2 12.5333 1.86667 23.2 1.86667C33.8667 1.86667 44.5333 7.2 44.5333 17.8667" /></FigSvg>;
}
