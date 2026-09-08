// SVG icons from the design handoff, as React components.
import type { CSSProperties, ReactElement } from 'react';
import type { View } from './theme';

type IconProps = { size?: number; stroke?: string; style?: CSSProperties };

const base = (size: number, stroke: string, style?: CSSProperties) => ({
  width: size,
  height: size,
  viewBox: '0 0 24 24',
  fill: 'none' as const,
  stroke,
  strokeWidth: 1.7,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  style,
});

export const Logo = () => (
  <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round">
    <path d="M5 16c2.5-1 4-3 4-6" />
    <path d="M19 8c-2.5 1-4 3-4 6" />
    <path d="M5 16c3 1.6 11 1.6 14-8" />
  </svg>
);

// ---- Nav / section icons (18px, currentColor) ----
export const navIcon: Record<View, ReactElement> = {
  organisation: (
    <svg {...base(18, 'currentColor')}>
      <path d="M3 21h18M5 21V7l7-4 7 4v14" />
      <path d="M9 9h.01M12 9h.01M15 9h.01M9 13h.01M12 13h.01M15 13h.01M10 21v-4h4v4" />
    </svg>
  ),
  games: (
    <svg {...base(18, 'currentColor')}>
      <path d="M7 8h10a4 4 0 0 1 3.7 5.5l-1.2 3a2 2 0 0 1-3.2.8L14.8 16H9.2l-1.5 1.3a2 2 0 0 1-3.2-.8l-1.2-3A4 4 0 0 1 7 8z" />
      <path d="M8 11v4M6 13h4M16 12h.01M18 14h.01" />
    </svg>
  ),
  departments: (
    <svg {...base(18, 'currentColor')}>
      <rect x="4" y="13" width="6" height="8" rx="1" />
      <rect x="14" y="13" width="6" height="8" rx="1" />
      <path d="M9 13V9a3 3 0 0 1 3-3 3 3 0 0 1 3 3v4M12 6V3" />
    </svg>
  ),
  designations: (
    <svg {...base(18, 'currentColor')}>
      <path d="M12 3l2.3 4.7 5.2.8-3.7 3.6.9 5.1L12 15l-4.6 2.4.9-5.1L4.5 8.5l5.2-.8L12 3z" />
    </svg>
  ),
  usersroles: (
    <svg {...base(18, 'currentColor')}>
      <path d="M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z" />
      <path d="M2.5 20a6.5 6.5 0 0 1 13 0" />
      <path d="M18 8.5l1.4 1.4L22 7.3" />
    </svg>
  ),
  overview: (
    <svg {...base(18, 'currentColor')}>
      <rect x="3" y="3" width="7" height="9" rx="1.5" />
      <rect x="14" y="3" width="7" height="5" rx="1.5" />
      <rect x="14" y="12" width="7" height="9" rx="1.5" />
      <rect x="3" y="16" width="7" height="5" rx="1.5" />
    </svg>
  ),
  leave: (
    <svg {...base(18, 'currentColor')}>
      <rect x="3" y="4.5" width="18" height="16.5" rx="2.5" />
      <path d="M3 9h18M8 2.5v4M16 2.5v4" />
    </svg>
  ),
  overtime: (
    <svg {...base(18, 'currentColor')}>
      <circle cx="12" cy="13" r="8" />
      <path d="M12 9.5V13l2.5 2M9 2.5h6M12 2.5v3" />
    </svg>
  ),
  attendance: (
    <svg {...base(18, 'currentColor')}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7.5V12l3 2" />
    </svg>
  ),
  feedback: (
    <svg {...base(18, 'currentColor')}>
      <path d="M21 11.5a8.38 8.38 0 0 1-9 8.3 8.5 8.5 0 0 1-3.8-.9L3 20.5l1.6-4.2A8.4 8.4 0 0 1 12 3.2a8.38 8.38 0 0 1 9 8.3z" />
    </svg>
  ),
  kpi: (
    <svg {...base(18, 'currentColor')}>
      <path d="M3 3v18h18" />
      <path d="M7 15l3.5-4 3 2.5L20 7" />
      <path d="M20 11V7h-4" />
    </svg>
  ),
  kpibulk: (
    <svg {...base(18, 'currentColor')}>
      <path d="M4 6h10M4 12h10M4 18h6" />
      <path d="M17 15l2.5 2.5L23 13" />
    </svg>
  ),
  kpitemplates: (
    <svg {...base(18, 'currentColor')}>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M3 9h18M9 9v11" />
    </svg>
  ),
  shifttypes: (
    <svg {...base(18, 'currentColor')}>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 8v4l2.5 1.5" />
    </svg>
  ),
  roster: (
    <svg {...base(18, 'currentColor')}>
      <rect x="3" y="4.5" width="18" height="16" rx="2.5" />
      <path d="M3 9h18M8 3v3M16 3v3M7.5 13h2M11 13h2M14.5 13h2M7.5 16.5h2M11 16.5h2" />
    </svg>
  ),
  shiftswaps: (
    <svg {...base(18, 'currentColor')}>
      <path d="M16 3l4 4-4 4" />
      <path d="M20 7H4" />
      <path d="M8 21l-4-4 4-4" />
      <path d="M4 17h16" />
    </svg>
  ),
  holidaybank: (
    <svg {...base(18, 'currentColor')}>
      <rect x="3" y="4.5" width="18" height="16" rx="2.5" />
      <path d="M3 9h18M8 3v3M16 3v3" />
      <path d="M12 11.5l.9 1.8 2 .3-1.45 1.4.35 2-1.8-.95-1.8.95.35-2L9.1 13.6l2-.3z" />
    </svg>
  ),
  policies: (
    <svg {...base(18, 'currentColor')}>
      <path d="M6 3h8l4 4v14a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" />
      <path d="M14 3v4h4" />
      <path d="M8.5 12h7M8.5 15.5h7M8.5 8.5h3" />
    </svg>
  ),
  reimbursements: (
    <svg {...base(18, 'currentColor')}>
      <path d="M5 3h14v18l-2.5-1.5L14 21l-2-1.5L10 21l-2.5-1.5L5 21z" />
      <path d="M9 8h6M9 12h6" />
    </svg>
  ),
  onboarding: (
    <svg {...base(18, 'currentColor')}>
      <path d="M16 19v-1.5A3.5 3.5 0 0 0 12.5 14h-5A3.5 3.5 0 0 0 4 17.5V19" />
      <circle cx="10" cy="7.5" r="3.5" />
      <path d="M19 8v6M22 11h-6" />
    </svg>
  ),
  exit: (
    <svg {...base(18, 'currentColor')}>
      <path d="M14 21H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h8" />
      <path d="M17 16l4-4-4-4M21 12H9" />
    </svg>
  ),
  payroll: (
    <svg {...base(18, 'currentColor')}>
      <rect x="2.5" y="6" width="19" height="13" rx="2.5" />
      <path d="M2.5 10.5h19" />
      <circle cx="17.5" cy="14.5" r="1.3" />
    </svg>
  ),
  payschedule: (
    <svg {...base(18, 'currentColor')}>
      <rect x="3" y="4.5" width="18" height="16" rx="2.5" />
      <path d="M3 9h18M8 3v3M16 3v3M8 13h3M8 16.5h6" />
    </svg>
  ),
  taxdetails: (
    <svg {...base(18, 'currentColor')}>
      <path d="M6 3h8l4 4v14a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" />
      <path d="M14 3v4h4M9 13.5l2 2 4-4.5" />
    </svg>
  ),
  payheads: (
    <svg {...base(18, 'currentColor')}>
      <rect x="3" y="3.5" width="18" height="17" rx="2.5" />
      <path d="M7.5 8h9M7.5 12h9M7.5 16h5" />
    </svg>
  ),
  templates: (
    <svg {...base(18, 'currentColor')}>
      <rect x="3" y="3.5" width="8" height="8" rx="1.5" />
      <rect x="13" y="3.5" width="8" height="5" rx="1.5" />
      <rect x="13" y="11" width="8" height="9.5" rx="1.5" />
      <rect x="3" y="14" width="8" height="6.5" rx="1.5" />
    </svg>
  ),
  statutorycomponents: (
    <svg {...base(18, 'currentColor')}>
      <path d="M12 3l7 3v5c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6l7-3z" />
      <path d="M9 11.5l2 2 4-4" />
    </svg>
  ),
  payruns: (
    <svg {...base(18, 'currentColor')}>
      <path d="M5 3h9l5 5v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" />
      <path d="M14 3v5h5M8 13l2.5 2.5L16 10" />
    </svg>
  ),
  employees: (
    <svg {...base(18, 'currentColor')}>
      <circle cx="9" cy="8" r="3.2" />
      <path d="M3.5 19v-1A3.5 3.5 0 0 1 7 14.5h4A3.5 3.5 0 0 1 14.5 18v1" />
      <path d="M16.5 5.2a3.2 3.2 0 0 1 0 6M18.5 14.7a3.5 3.5 0 0 1 2 3.1V19" />
    </svg>
  ),
  orgchart: (
    <svg {...base(18, 'currentColor')}>
      <rect x="9" y="3" width="6" height="5" rx="1.3" />
      <rect x="2.5" y="16" width="6" height="5" rx="1.3" />
      <rect x="15.5" y="16" width="6" height="5" rx="1.3" />
      <path d="M12 8v4M5.5 16v-2.5h13V16" />
    </svg>
  ),
  settings: (
    <svg {...base(18, 'currentColor')}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  ),
};

// Large placeholder icons (34px, currentColor)
export const phIcon: Partial<Record<View, ReactElement>> = {
  attendance: (
    <svg {...base(34, 'currentColor')} strokeWidth={1.6}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7.5V12l3 2" />
    </svg>
  ),
  onboarding: (
    <svg {...base(34, 'currentColor')} strokeWidth={1.6}>
      <path d="M16 19v-1.5A3.5 3.5 0 0 0 12.5 14h-5A3.5 3.5 0 0 0 4 17.5V19" />
      <circle cx="10" cy="7.5" r="3.5" />
      <path d="M19 8v6M22 11h-6" />
    </svg>
  ),
  exit: (
    <svg {...base(34, 'currentColor')} strokeWidth={1.6}>
      <path d="M14 21H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h8" />
      <path d="M17 16l4-4-4-4M21 12H9" />
    </svg>
  ),
  payroll: (
    <svg {...base(34, 'currentColor')} strokeWidth={1.6}>
      <rect x="2.5" y="6" width="19" height="13" rx="2.5" />
      <path d="M2.5 10.5h19" />
      <circle cx="17.5" cy="14.5" r="1.3" />
    </svg>
  ),
  orgchart: (
    <svg {...base(34, 'currentColor')} strokeWidth={1.6}>
      <rect x="9" y="3" width="6" height="5" rx="1.3" />
      <rect x="2.5" y="16" width="6" height="5" rx="1.3" />
      <rect x="15.5" y="16" width="6" height="5" rx="1.3" />
      <path d="M12 8v4M5.5 16v-2.5h13V16" />
    </svg>
  ),
};

// ---- Standalone icons ----
export const IconSearch = ({ size = 16, stroke = '#9197A2' }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth="1.9" strokeLinecap="round">
    <circle cx="11" cy="11" r="7" />
    <path d="M21 21l-4-4" />
  </svg>
);

export const IconChevronRight = ({ size = 17, stroke = '#9197A2' }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M9 6l6 6-6 6" />
  </svg>
);

export const IconChevronDown = ({ size = 14, stroke = '#9197A2', style }: IconProps) => (
  <svg style={style} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M6 9l6 6 6-6" />
  </svg>
);

export const IconSort = ({ size = 16, stroke = '#9197A2' }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth="1.8" strokeLinecap="round">
    <path d="M8 9l4-4 4 4M8 15l4 4 4-4" />
  </svg>
);

export const IconDownload = ({ size = 15, stroke = '#fff' }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 3v12M7 10l5 5 5-5M5 21h14" />
  </svg>
);

export const IconClose = ({ size = 16, stroke = '#484848' }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth="2" strokeLinecap="round">
    <path d="M6 6l12 12M18 6L6 18" />
  </svg>
);

export const IconEye = ({ size = 16, stroke = '#717171' }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="3" />
    <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" />
  </svg>
);

export const IconCheck = ({ size = 15, stroke = '#4F7A52' }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
    <path d="M5 12.5l4.5 4.5L19 6.5" />
  </svg>
);

export const IconX = ({ size = 15, stroke = '#A8475F' }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth="2.2" strokeLinecap="round">
    <path d="M6 6l12 12M18 6L6 18" />
  </svg>
);

export const IconBell = ({ size = 18, stroke = '#484848' }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
    <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
    <path d="M13.7 21a2 2 0 0 1-3.4 0" />
  </svg>
);

export const IconPlus = ({ size = 16, stroke = '#fff' }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 5v14M5 12h14" />
  </svg>
);

export const IconStar = ({ size = 15 }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="#0571A6" stroke="none">
    <path d="M12 2.5l2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 18.4 6.1 21l1.2-6.5L2.5 9.9 9.1 9z" />
  </svg>
);

export const IconFile = ({ size = 18, stroke = '#0571A6' }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <path d="M14 2v6h6" />
  </svg>
);

export const IconExternal = ({ size = 17, stroke = '#9197A2' }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M7 17L17 7M17 7H8M17 7v9" />
  </svg>
);

export const IconInfo = ({ size = 16, stroke = '#9197A2' }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="9" />
    <path d="M12 11v5M12 7.5v.5" />
  </svg>
);

export const IconOverride = ({ size = 17, stroke = '#0571A6' }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 2.5a9.5 9.5 0 1 0 9.5 9.5" />
    <path d="M21.5 4.5l-9 9-3-3" />
  </svg>
);

export const IconChevronUpDown = ({ size = 16, stroke = '#9197A2' }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth="1.8" strokeLinecap="round">
    <path d="M8 9l4-4 4 4M8 15l4 4 4-4" />
  </svg>
);

export const IconLogout = ({ size = 16, stroke = '#9197A2' }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M14 21H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h8" />
    <path d="M17 16l4-4-4-4M21 12H9" />
  </svg>
);
