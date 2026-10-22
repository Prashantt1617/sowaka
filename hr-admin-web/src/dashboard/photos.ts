// Whose face is this? Resolves a person's profile photo from the employee
// directory the dashboard has already loaded (store `emps`), so lists that
// only carry a name or a userId can show the photo without another request.
import { useStore } from './store';
import type { Emp } from './seed';

type PhotoIndex = { known: Set<string>; byId: Map<string, string>; byName: Map<string, string> };

// One index per loaded directory; rebuilt only when the store replaces `emps`.
const indexes = new WeakMap<Emp[], PhotoIndex>();

const nameKey = (name: string) => name.trim().replace(/\s+/g, ' ').toLowerCase();

function indexOf(emps: Emp[]): PhotoIndex {
  let idx = indexes.get(emps);
  if (idx) return idx;
  const known = new Set<string>();
  const byId = new Map<string, string>();
  const byName = new Map<string, string>();
  const seen = new Set<string>();
  for (const e of emps) {
    known.add(e.id);
    if (e.photoUrl) byId.set(e.id, e.photoUrl);
    const key = nameKey(e.name);
    if (!key) continue;
    // Two people with the same name: a name alone cannot say whose photo it is.
    if (seen.has(key)) byName.delete(key);
    else if (e.photoUrl) byName.set(key, e.photoUrl);
    seen.add(key);
  }
  idx = { known, byId, byName };
  indexes.set(emps, idx);
  return idx;
}

/** The photo URL for a person, by userId first and then by name; '' when none. */
export function usePhotoFor(userId?: string | null, name?: string | null): string {
  const { emps } = useStore();
  const idx = indexOf(emps);
  if (userId) {
    const byId = idx.byId.get(userId);
    if (byId) return byId;
    // A known userId without a photo: their name must not borrow someone else's.
    if (idx.known.has(userId)) return '';
  }
  return name ? (idx.byName.get(nameKey(name)) ?? '') : '';
}
