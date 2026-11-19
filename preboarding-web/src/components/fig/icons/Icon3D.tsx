// The design's 3D icons (Icon/3D/*): PNGs from the Figma file (192 px), drawn at 20, 24, 32, 48 or 64 px.
import bank from '../../../assets/fig3d/bank.png';
import calendar from '../../../assets/fig3d/calendar.png';
import documentApproved from '../../../assets/fig3d/document-approved.png';
import idCard from '../../../assets/fig3d/id-card.png';
import phone from '../../../assets/fig3d/phone.png';
import team from '../../../assets/fig3d/team.png';
import user from '../../../assets/fig3d/user.png';
import write from '../../../assets/fig3d/write.png';

const SRC = { bank, calendar, 'document-approved': documentApproved, 'id-card': idCard, phone, team, user, write } as const;
export type Fig3DName = keyof typeof SRC;

export function FigIcon3D({ name, size = 32 }: { name: Fig3DName; size?: number }) {
  return <img src={SRC[name]} alt="" aria-hidden="true" width={size} height={size} style={{ display: 'block', flex: 'none', objectFit: 'contain', width: size, height: size }} />;
}
