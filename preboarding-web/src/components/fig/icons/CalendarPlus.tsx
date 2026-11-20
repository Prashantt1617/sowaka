import { FigSvg, type FigIconProps } from './svg';

/** Calendar with plus, 18 px (Add to calendar). */
export function FigCalendarPlus(p: FigIconProps) {
  return <FigSvg box={18} base={1.35} {...p}><path d="M3.75 3.75H14.25C15.0784 3.75 15.75 4.42157 15.75 5.25V14.25C15.75 15.0784 15.0784 15.75 14.25 15.75H3.75C2.92157 15.75 2.25 15.0784 2.25 14.25V5.25C2.25 4.42157 2.92157 3.75 3.75 3.75Z" /><path d="M2.25 7.5H15.75M6 2.25V5.25M12 2.25V5.25M9 9.75V13.5M7.125 11.625H10.875" /></FigSvg>;
}
