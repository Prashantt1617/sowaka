// The onboarding template editor's words, glyphs and shapes (Setup › Employee lifecycle ›
// Onboarding templates; the Final designs' "2 · Dashboard setup"). No components here, so the
// editor's files keep Fast Refresh; the pieces that draw are in designParts.tsx.
import type { CSSProperties } from 'react';
import type { DesignMedia, DesignStage, MediaBackground, MeetWith, TeamRole, TourLesson } from '../../../services/lifecycle';
import { OWNER_TONE } from './format';

// —— Words ————————————————————————————————————————————————————————————————

export const STAGES: DesignStage[] = ['pre', 'd1', 'w1', 'm1', 'mid', 'fin'];
/** A stage's name; Months 2 to 5 and Month 6 on six months, Month 2 and Month 3 on three. */
export function stageName(s: DesignStage, months: 3 | 6): string {
  const six = months === 6;
  return { pre: 'Pre-boarding', d1: 'Day 1', w1: 'Week 1', m1: 'Month 1', mid: six ? 'Months 2 to 5' : 'Month 2', fin: six ? 'Month 6' : 'Month 3' }[s];
}
/** The same, with "Before joining" for the time before Day 1 (meeting groups, team tasks). */
export const stageOrBefore = (s: DesignStage, months: 3 | 6) => (s === 'pre' ? 'Before joining' : stageName(s, months));
/** When a check-in goes out. */
export const checkinWhen = (s: DesignStage, months: 3 | 6) => (s === 'fin' ? 'After confirmation' : `End of ${stageName(s, months)}`);

export const MEET_LABEL: Record<MeetWith, string> = { hr: 'HR', manager: 'Manager', buddy: 'Buddy', it: 'IT & admin', head_of_department: 'Head of department' };
export const MEET_WITH: MeetWith[] = ['hr', 'manager', 'buddy', 'it', 'head_of_department'];
export const ROLE_LABEL: Record<TeamRole, string> = { manager: 'Manager', buddy: 'Buddy', hr: 'HR', it: 'IT & admin', senior: 'Someone senior', head_of_department: 'Head of department' };
export const MEETS_LABEL: Record<'hr' | 'manager' | 'buddy', string> = { hr: 'HR', manager: 'Manager', buddy: 'Buddy' };

export const TOUR: Array<[TourLesson, string, string]> = [
  ['punch', 'Punch in and out', 'Day 1'], ['missed', 'Fix a missed punch', 'Day 2'], ['leave', 'Leave policy and applying for leave', 'Day 3'],
  ['overtime', 'Applying for overtime', 'Day 4'], ['approveLeave', 'Approving leave', 'Managers only'], ['approveOvertime', 'Approving overtime', 'Managers only'],
];
export const tourName = (l: TourLesson) => TOUR.find((t) => t[0] === l)?.[1] ?? l;

/** 'HH:mm' as "9:30 AM". */
export function clock(hhmm?: string): string {
  if (!hhmm) return '';
  const [h, m] = hhmm.split(':').map(Number);
  if (Number.isNaN(h)) return hhmm;
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m || 0).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
}
// —— Icons (line glyphs, 24 grid) ———————————————————————————————————————————

export const GLYPH = {
  sign: 'M14 3H6v18h12V7zM14 3v4h4M8 17c1.5-2 2.5-2 3 0s1.5 2 3 0',
  meet: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21c0-4 4-6 8-6s8 2 8 6',
  task: 'M9 6h11M9 12h11M9 18h11M4 6l1 1 2-2M4 12l1 1 2-2M4 18l1 1 2-2',
  video: 'M8 5v14l11-7z',
  ack: 'M14 3H6v18h12V7zM14 3v4h4M9 13l2 2 4-4',
  form: 'M14 3H6v18h12V7zM14 3v4h4M9 13h6M9 17h6',
  survey: 'M4 19V9M10 19V5M16 19v-7M22 19H2',
  tour: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM15.5 8.5l-2 5-5 2 2-5z',
  profile: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21c0-4 4-6 8-6s8 2 8 6',
  access: 'M4 5h16v11H4zM2 19h20',
  team: 'M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM17 11a3 3 0 1 0 0-6M3 20c0-3 3-5 6-5s6 2 6 5M15 15c3 0 6 2 6 5',
  help: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6V14M12 17h.01',
  review: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  image: 'M4 5h16v14H4zM4 15l4-4 4 4 3-3 5 5M15 9h.01',
  text: 'M5 6h14M12 6v13',
  doc: 'M14 3H6v18h12V7zM14 3v4h4M9 13h6M9 17h6',
  mail: 'M3 6h18v12H3zM3 7l9 6 9-6',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2',
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
  chevron: 'M9 6l6 6-6 6',
  down: 'M6 9l6 6 6-6',
  upload: 'M12 16V4M7 9l5-5 5 5M4 20h16',
  target: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10zM12 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2z',
} as const;
// —— Shapes ———————————————————————————————————————————————————————————————

export const rowLine = '1px solid var(--line)';
export const chip: CSSProperties = { display: 'inline-flex', alignItems: 'center', height: 24, padding: '0 9px', borderRadius: 8, fontSize: 11.5, fontWeight: 500, whiteSpace: 'nowrap', background: 'var(--accent-soft)', color: 'var(--accent-ink)' };
export const pillChip = (bg: string, fg: string): CSSProperties => ({ ...chip, borderRadius: 999, background: bg, color: fg });
export const addBtn: CSSProperties = { height: 40, padding: '0 18px', borderRadius: 12, border: '1.5px dashed var(--line-2)', background: 'var(--surface-2)', color: 'var(--accent-ink)', fontFamily: 'inherit', fontSize: 13, fontWeight: 500, cursor: 'pointer' };
export const smallBtn: CSSProperties = { position: 'relative', zIndex: 2 };

/** Who-chip colours by role (the dashboard's owner tones). */
export function whoChip(role: TeamRole | MeetWith | 'senior'): CSSProperties {
  const tone = OWNER_TONE[role === 'senior' ? 'head_of_department' : role];
  return pillChip(tone.bg, tone.fg);
}
export const BACKGROUNDS: Array<[MediaBackground, string, string]> = [
  ['rust', 'Rust', 'linear-gradient(160deg, #D2541B 0%, #B23500 55%, #8A2900 100%)'], ['blue', 'Blue', '#0571A6'], ['ink', 'Ink', '#16181D'],
  ['green', 'Green', '#15803D'], ['purple', 'Purple', '#5B3FAF'], ['sand', 'Sand', '#9A4A06'],
];
export const bgOf = (bg?: MediaBackground) => (BACKGROUNDS.find((b) => b[0] === bg) ?? BACKGROUNDS[0])[2];
const MEDIA_GLYPH: Record<DesignMedia['type'], string> = { video: GLYPH.video, image: GLYPH.image, text: GLYPH.text, pdf: GLYPH.doc };

/** What a tile looks like: a text card on its colour, an empty dashed one to upload, or the file's kind. */
export function tileLook(media: DesignMedia): { bg: string; border: string; bar: string; text: boolean; icon: string; iconColor: string; empty: boolean } {
  if (media.type === 'text') return { bg: bgOf(media.bg), border: '0', bar: 'rgba(255,255,255,0.6)', text: true, icon: GLYPH.text, iconColor: '#FFFFFF', empty: false };
  if (!media.fileId) return { bg: 'var(--surface)', border: '1.5px dashed var(--line-2)', bar: 'var(--line)', text: false, icon: MEDIA_GLYPH[media.type], iconColor: 'var(--ink-3)', empty: true };
  if (media.type === 'pdf') return { bg: 'var(--surface)', border: rowLine, bar: 'var(--line)', text: false, icon: GLYPH.doc, iconColor: 'var(--accent-ink)', empty: false };
  return { bg: media.type === 'image' ? 'linear-gradient(160deg, #F6D7C6 0%, #E9A27F 100%)' : '#16181D', border: '0', bar: 'rgba(255,255,255,0.6)', text: false, icon: MEDIA_GLYPH[media.type], iconColor: '#FFFFFF', empty: false };
}
/** A file picker without a visible input; resolves with the chosen file. */
export function pickFile(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.onchange = () => resolve(input.files?.[0] ?? null);
    input.click();
  });
}
