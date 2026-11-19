// G3's web-only icons (the "Web · …" frames 4967:93936 … 4967:94851), paths copied from the frames'
// SVG exports and drawn with G1's FigSvg (native grid `box`, stroke scales with size, currentColor).
import { FigSvg, type FigIconProps } from './svg';

/** Breadcrumb "‹ All sections" back, 18 px (Web · 5–8, node 4967:94193). */
export function G3BackSmall(p: FigIconProps) {
  return <FigSvg box={18} base={1.5} {...p}><path d="M11.25 4.5L6.75 9L11.25 13.5" /></FigSvg>;
}

/** Copy work email, 20 px (Web · 4, node 4967:94100). */
export function G3Copy(p: FigIconProps) {
  return (
    <FigSvg box={20} base={1.33333} {...p}>
      <path transform="translate(6 6)" d="M2.33333 0.666667H9C9.92047 0.666667 10.6667 1.41286 10.6667 2.33333V9C10.6667 9.92047 9.92047 10.6667 9 10.6667H2.33333C1.41286 10.6667 0.666667 9.92047 0.666667 9V2.33333C0.666667 1.41286 1.41286 0.666667 2.33333 0.666667Z" />
      <path transform="translate(2.6667 2.6667)" d="M10.6667 4V1.5C10.6667 1.27899 10.5789 1.06702 10.4226 0.910745C10.2663 0.754464 10.0543 0.666667 9.83333 0.666667H1.5C1.27899 0.666667 1.06702 0.754464 0.910745 0.910745C0.754464 1.06702 0.666667 1.27899 0.666667 1.5V9.83333C0.666667 10.0543 0.754464 10.2663 0.910745 10.4226C1.06702 10.5789 1.27899 10.6667 1.5 10.6667H4" />
    </FigSvg>
  );
}

/** Icon/Line/download, 20 px (Install the app, Web · 4, node I4999:88;4913:57227). */
export function G3Download20(p: FigIconProps) {
  return <FigSvg box={20} base={1.5} {...p}><path d="M10 3.33333V12.5M5.83333 8.33333L10 12.5L14.1667 8.33333M4.16667 16.6667H15.8333" /></FigSvg>;
}
