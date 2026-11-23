// Small hooks the lifecycle pages share.
import { useCallback, useEffect, useState } from 'react';
import { useStore } from '../../store';
import { useBrand } from '../../brand';
import { getCompanySettings, getOffices } from '../../../services/hrms';
import { getTemplateJourneys } from '../../../services/lifecycle';
import type { TemplateJourney } from '../../../services/lifecycle';
import { errText } from './format';

/** An onboarding template's tabs: the template, the joiners on it, moving joiners onto it. */
export type JoinersTab = 'template' | 'joiners' | 'edit';
export const JOINERS_TAB_LABELS: Record<JoinersTab, string> = { template: 'Template', joiners: 'Joiners', edit: 'Edit joiners' };

/** Every open onboarding journey of the company, each naming its template; this template's are its joiners. */
export function useTemplateJoiners(id: string) {
  const [rows, setRows] = useState<TemplateJourney[] | null>(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let live = true;
    setError('');
    getTemplateJourneys(id, 'all')
      .then((r) => { if (live) setRows(r); })
      .catch((e) => { if (live) setError(errText(e, 'Could not load the joiners')); });
    return () => { live = false; };
  }, [id, attempt]);
  const reload = useCallback(() => setAttempt((n) => n + 1), []);
  const count = rows ? rows.filter((r) => r.templateId === id).length : undefined;
  return { rows, error, reload, count };
}
export type TemplateJoinersData = ReturnType<typeof useTemplateJoiners>;

/** The company's name as letters and emails carry it. */
export function useCompanyName(): string {
  const brand = useBrand();
  const { user } = useStore();
  return brand.name ?? user?.company ?? 'the company';
}

/** Department, designation and location choices for the offer form. */
export function useOfferChoices() {
  const [designations, setDesignations] = useState<string[]>([]);
  const [departments, setDepartments] = useState<string[]>([]);
  const [locations, setLocations] = useState<string[]>([]);
  useEffect(() => {
    getCompanySettings().then((s) => { setDesignations(s.designations ?? []); setDepartments(s.departments ?? []); }).catch(() => undefined);
    getOffices().then((o) => setLocations(o.map((x) => x.name))).catch(() => undefined);
  }, []);
  return { designations, departments, locations };
}


/**
 * What HR typed into a document, kept in this tab's session under `key` until it is saved, generated
 * or sent: leaving the page (or reloading) and coming back brings the fields back. `ready` once the
 * page's own data has loaded, so the kept copy goes on top of it; the returned function forgets it.
 */
export function useFormStash<T>(key: string, ready: boolean, snapshot: T, restore: (kept: T) => void): () => void {
  const [restored, setRestored] = useState('');
  useEffect(() => {
    if (!ready || restored === key) return;
    setRestored(key);
    try { const raw = sessionStorage.getItem(key); if (raw) restore(JSON.parse(raw) as T); } catch { /* nothing kept */ }
    // restore is the caller's setter bundle, read once per key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, key, restored]);
  const json = JSON.stringify(snapshot);
  useEffect(() => {
    if (restored !== key) return;
    try { sessionStorage.setItem(key, json); } catch { /* not kept */ }
  }, [restored, key, json]);
  return useCallback(() => { try { sessionStorage.removeItem(key); } catch { /* nothing to forget */ } }, [key]);
}

/** A browser history step for the page's own state: Back and Forward walk through it instead of leaving. */
export function pushDocState(docs: Record<string, unknown>) {
  try { window.history.pushState({ ...(window.history.state ?? {}), docs }, ''); } catch { /* history not available */ }
}
export function replaceDocState(docs: Record<string, unknown>) {
  try { window.history.replaceState({ ...(window.history.state ?? {}), docs }, ''); } catch { /* history not available */ }
}

/** The email panel as a history step: Back closes it, Forward opens it again. */
export function useMailStep(): [boolean, () => void, () => void] {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const onPop = (e: PopStateEvent) => setOpen(Boolean((e.state as { docs?: { mail?: boolean } } | null)?.docs?.mail));
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  const show = useCallback(() => {
    const docs = ((window.history.state as { docs?: Record<string, unknown> } | null)?.docs) ?? {};
    if (!docs.mail) pushDocState({ ...docs, mail: true });
    setOpen(true);
  }, []);
  const close = useCallback(() => {
    if ((window.history.state as { docs?: { mail?: boolean } } | null)?.docs?.mail) window.history.back();
    else setOpen(false);
  }, []);
  return [open, show, close];
}
