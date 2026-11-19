import { FigSvg, type FigIconProps } from './svg';

/** Shield, 22 px (Code of conduct). */
export function FigShield(p: FigIconProps) {
  return <FigSvg box={22} base={1.65} {...p}><path transform="translate(2.8417 1.925)" d="M8.15833 0.825L15.4917 3.575V9.075C15.4917 13.6583 12.2833 16.4083 8.15833 17.325C4.03333 16.4083 0.825 13.6583 0.825 9.075V3.575L8.15833 0.825Z" /></FigSvg>;
}
