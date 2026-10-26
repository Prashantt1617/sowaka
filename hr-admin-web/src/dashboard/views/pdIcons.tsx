// Line icons for the People and Shifts views, drawn like the prototype's
// (24px grid, 1.8 stroke, round caps). Size comes from the surrounding CSS.
import type { ReactNode } from 'react';

function Svg({ children, size }: { children: ReactNode; size?: number }) {
  return (
    <svg width={size ?? 16} height={size ?? 16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {children}
    </svg>
  );
}

export const PdUser = ({ size }: { size?: number }) => <Svg size={size}><circle cx="12" cy="8" r="4" /><path d="M4 21c1-4 4.5-6 8-6s7 2 8 6" /></Svg>;
export const PdClock = ({ size }: { size?: number }) => <Svg size={size}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></Svg>;
export const PdFile = ({ size }: { size?: number }) => <Svg size={size}><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5M9 13h6M9 17h4" /></Svg>;
export const PdWallet = ({ size }: { size?: number }) => <Svg size={size}><rect x="3" y="6" width="18" height="14" rx="3" /><path d="M3 10h18M16 15h2" /><path d="M7 6V5a2 2 0 0 1 2-2h8" /></Svg>;
export const PdStar = ({ size }: { size?: number }) => <Svg size={size}><path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z" /></Svg>;
export const PdChart = ({ size }: { size?: number }) => <Svg size={size}><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" /></Svg>;
export const PdTarget = ({ size }: { size?: number }) => <Svg size={size}><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="5" /><circle cx="12" cy="12" r="1" /></Svg>;
export const PdCalendar = ({ size }: { size?: number }) => <Svg size={size}><rect x="3" y="5" width="18" height="16" rx="3" /><path d="M3 10h18M8 3v4M16 3v4" /></Svg>;
export const PdEdit = ({ size }: { size?: number }) => <Svg size={size}><path d="M4 20h4L19 9l-4-4L4 16z" /><path d="m13.5 6.5 4 4" /></Svg>;
export const PdLock = ({ size }: { size?: number }) => <Svg size={size}><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></Svg>;
export const PdArrowRight = ({ size }: { size?: number }) => <Svg size={size}><path d="M5 12h14M13 6l6 6-6 6" /></Svg>;
export const PdBank = ({ size }: { size?: number }) => <Svg size={size}><path d="M3 10 12 4l9 6M5 10v8M9 10v8M15 10v8M19 10v8M3 20h18" /></Svg>;
export const PdPin = ({ size }: { size?: number }) => <Svg size={size}><path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z" /><circle cx="12" cy="9.5" r="2.5" /></Svg>;
export const PdLayers = ({ size }: { size?: number }) => <Svg size={size}><path d="m12 3 9 5-9 5-9-5z" /><path d="m3 13 9 5 9-5" /></Svg>;
export const PdTrash = ({ size }: { size?: number }) => <Svg size={size}><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6" /></Svg>;
export const PdSun = ({ size }: { size?: number }) => <Svg size={size}><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></Svg>;
export const PdUpload = ({ size }: { size?: number }) => <Svg size={size}><path d="M12 16V4M7 9l5-5 5 5M5 20h14" /></Svg>;
export const PdClose = ({ size }: { size?: number }) => <Svg size={size}><path d="M6 6l12 12M18 6 6 18" /></Svg>;
export const PdCheck = ({ size }: { size?: number }) => <Svg size={size}><path d="m5 12 5 5 9-10" /></Svg>;
