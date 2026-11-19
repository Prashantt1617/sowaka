import { FigSvg, type FigIconProps } from './svg';

/** Download, 18 px. */
export function FigDownload(p: FigIconProps) {
  return <FigSvg box={18} base={1.35} {...p}><path d="M9 3V12M4.5 8.25L9 12.75L13.5 8.25M3.75 15H14.25" /></FigSvg>;
}
