import { FigSvg, type FigIconProps } from './svg';

/** Upload, 20 px (the upload tile's brand arrow; Figma export, stroke 1.5). */
export function G2Upload(p: FigIconProps) {
  return <FigSvg box={20} base={1.5} {...p}><path transform="translate(3.4167 2.5833)" d="M6.58333 10.75V0.75M11.5833 4.91667L6.58333 0.75L1.58333 4.91667M0.75 14.0833H12.4167" /></FigSvg>;
}
