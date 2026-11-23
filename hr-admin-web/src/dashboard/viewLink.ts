// A dashboard page's own address: its name in the #fragment, then what it is
// about (`#preboarding/<journeyId>`), so a page about one thing opens directly,
// in a new tab too.
import type { View } from './theme';

/** The #fragment for a page and what it is about. */
export const viewHash = (v: View, param = '') => (param ? `${v}/${encodeURIComponent(param)}` : v);
