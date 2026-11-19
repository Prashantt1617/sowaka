import { FigSvg, type FigIconProps } from './svg';

/** Mail, 32 px (the code screen mark). */
export function FigMail(p: FigIconProps) {
  return <FigSvg box={32} base={2.1333} {...p}><path transform="translate(2.9333 5.6)" d="M3.73333 1.06667H22.4C23.8728 1.06667 25.0667 2.26057 25.0667 3.73333V17.0667C25.0667 18.5394 23.8728 19.7333 22.4 19.7333H3.73333C2.26057 19.7333 1.06667 18.5394 1.06667 17.0667V3.73333C1.06667 2.26057 2.26057 1.06667 3.73333 1.06667Z" /><path transform="translate(2.9333 8.2667)" d="M1.06678 1.06678L13.0668 9.06678L25.0668 1.06678" /></FigSvg>;
}
