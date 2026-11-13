// The Time office pages' Filters panel, as on Company calendar: pick in the panel,
// then Apply (or Clear). The list only changes on Apply.
import { useState } from 'react';

export function useFilterDraft<T extends Record<string, string>>(current: T, apply: (v: T) => void, blank: T) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<T>(current);
  const keys = Object.keys(blank) as (keyof T)[];
  return {
    open,
    draft,
    /** How many filters are set, for "Filters · 2". */
    active: keys.filter((k) => current[k] !== blank[k]).length,
    dirty: keys.some((k) => draft[k] !== blank[k]),
    toggle: () => { setDraft(current); setOpen((o) => !o); },
    set: (k: keyof T, v: string) => setDraft((d) => ({ ...d, [k]: v })),
    apply: () => { apply(draft); setOpen(false); },
    clear: () => { setDraft(blank); apply(blank); setOpen(false); },
  };
}
export type FilterDraft = ReturnType<typeof useFilterDraft<Record<string, string>>>;
