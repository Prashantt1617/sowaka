// Names, colours and date formatting shared by the App usage tabs.
import type { UsageGroup } from '../../../../services/engagement-usage';

export const GROUPS: UsageGroup[] = ['app', 'bio', 'present'];
/** Long names (column heads, legends) and short ones (a cell). */
export const GROUP_LONG: Record<UsageGroup, string> = { app: 'Punch on the app', bio: 'Biometric', present: 'Always present' };
export const GROUP_SHORT: Record<UsageGroup, string> = { app: 'App punch', bio: 'Biometric', present: 'Always present' };
export const GROUP_COLOR: Record<UsageGroup, string> = { app: 'var(--ua-app)', bio: 'var(--ua-bio)', present: 'var(--ua-present)' };

export const pct = (n: number, d: number) => (d ? `${Math.round((n / d) * 100)}%` : '—');
export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
/** 2026-11-03 → "3 Nov". */
export const sd = (iso: string) => `${Number(iso.slice(8, 10))} ${MON[Number(iso.slice(5, 7)) - 1]}`;
/** "Tue 3 Nov". */
export const sdw = (iso: string) => `${DOW[new Date(`${iso}T00:00:00Z`).getUTCDay()]} ${sd(iso)}`;
/** A range in words: "3 – 9 Nov", or one day. */
export const rangeLabel = (a: string, b: string) => (a === b ? sd(a) : `${sd(a)} – ${sd(b)}`);
export const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
export const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
/** Today in IST, the day the server keys app activity by. */
export const istToday = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);

