// How a person's profile words things, shared by the Employee profile and the pre-boarding
// profile (profileParts.tsx holds the components; these stay apart for fast refresh).

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** YYYY-MM-DD as the profile shows dates, e.g. 15 Oct 2026. */
export const showDate = (iso: string) => {
  if (!iso) return '—';
  const [y, m, day] = iso.split('-').map(Number);
  return `${String(day).padStart(2, '0')} ${MONTHS[m - 1]} ${y}`;
};

/** First word, last word, and whatever sits between. */
export function nameParts(name: string) {
  const words = name.trim().split(/\s+/).filter(Boolean);
  return { first: words[0] ?? '', middle: words.slice(1, -1).join(' '), last: words.length > 1 ? words[words.length - 1] : '' };
}

/** Employee type: the words the dashboard shows, and how the employee record keeps each. */
export const EMP_TYPE_VALUE: Record<string, 'full_time' | 'contract' | 'intern'> = { 'Full-time': 'full_time', Contract: 'contract', Intern: 'intern' };
