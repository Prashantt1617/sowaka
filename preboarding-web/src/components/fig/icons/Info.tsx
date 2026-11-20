import { FigSvg, type FigIconProps } from './svg';

/** Info, 16 px (notes). */
export function FigInfo(p: FigIconProps) {
  return <FigSvg box={16} base={1.2} {...p}><path d="M14 8C14 11.3137 11.3137 14 8 14C4.68629 14 2 11.3137 2 8C2 4.68629 4.68629 2 8 2C11.3137 2 14 4.68629 14 8Z" /><path d="M8 7.33333V10.6667M8 5.33333H8.00667" /></FigSvg>;
}
