import { FigSvg, type FigIconProps } from './svg';

/** Calendar, 22 px (Leave and holidays). */
export function FigCalendar(p: FigIconProps) {
  return <FigSvg box={22} base={1.65} {...p}><path transform="translate(1.925 3.7583)" d="M2.65833 0.825H15.4917C16.5042 0.825 17.325 1.64581 17.325 2.65833V13.6583C17.325 14.6709 16.5042 15.4917 15.4917 15.4917H2.65833C1.64581 15.4917 0.825 14.6709 0.825 13.6583V2.65833C0.825 1.64581 1.64581 0.825 2.65833 0.825Z" /><path transform="translate(1.925 1.925)" d="M0.825 7.24167H17.325M5.40833 0.825V4.49167M12.7417 0.825V4.49167" /></FigSvg>;
}
