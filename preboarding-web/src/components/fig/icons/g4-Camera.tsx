import { FigSvg, type FigIconProps } from './svg';

/** Camera, 20 px (Take a photo). From the Figma frame's SVG export. */
export function G4Camera(p: FigIconProps) {
  return <FigSvg box={20} base={1.5} {...p}><path d="M3.33333 6.66667H5.83333L7.5 4.16667H12.5L14.1667 6.66667H16.6667V16.6667H3.33333V6.66667Z" /><path d="M12.9167 10.8333C12.9167 12.4442 11.6108 13.75 10 13.75C8.38917 13.75 7.08333 12.4442 7.08333 10.8333C7.08333 9.2225 8.38917 7.91667 10 7.91667C11.6108 7.91667 12.9167 9.2225 12.9167 10.8333Z" /></FigSvg>;
}
