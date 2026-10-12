import type { AppPage } from '../models/app-page.model';

/**
 * The rules of the app's server-held pages, pure so they can be checked
 * without a database (`src/scripts/app-pages-check.ts`).
 */

/** The pages the app knows how to show. Anything else is never served. */
export const APP_PAGE_KEYS = ['games-home'] as const;
export type AppPageKey = (typeof APP_PAGE_KEYS)[number];

export function isAppPageKey(key: unknown): key is AppPageKey {
  return typeof key === 'string' && (APP_PAGE_KEYS as readonly string[]).includes(key);
}

/** The version an upload gets: above both the current and the kept one, so a
 *  version number is never reused, even after a rollback. */
export function nextVersion(page: Pick<AppPage, 'version' | 'previous'> | null): number {
  if (!page) return 1;
  return Math.max(page.version || 0, page.previous?.version || 0) + 1;
}

/** The document after uploading [html]: the new version on top, the one it
 *  replaces kept as the previous. Which companies have it does not change. */
export function withUpload(
  page: AppPage | null,
  key: AppPageKey,
  html: string,
  now: Date,
  by: string,
): AppPage {
  return {
    key,
    html,
    version: nextVersion(page),
    previous: page ? { html: page.html, version: page.version } : null,
    enabledOrgs: page?.enabledOrgs ?? [],
    updatedAt: now,
    updatedBy: by,
  };
}

/** The document after a rollback: the previous version back on top, and the
 *  one it replaces kept as the previous, so a second rollback undoes the
 *  first. Null when there is nothing to go back to. */
export function rolledBack(page: AppPage, now: Date, by: string): AppPage | null {
  if (!page.previous) return null;
  return {
    ...page,
    html: page.previous.html,
    version: page.previous.version,
    previous: { html: page.html, version: page.version },
    updatedAt: now,
    updatedBy: by,
  };
}

/** Whether [org] gets the page. */
export function pageIsOnFor(page: Pick<AppPage, 'enabledOrgs' | 'html'> | null, org: string | undefined): boolean {
  if (!page || !org || typeof page.html !== 'string' || page.html.length === 0) return false;
  return Array.isArray(page.enabledOrgs) && page.enabledOrgs.includes(org);
}

/** The companies after switching the page on or off for [org]. */
export function enabledOrgsAfter(orgs: string[] | undefined, org: string, on: boolean): string[] {
  const rest = (orgs ?? []).filter((o) => o !== org);
  return on ? [...rest, org] : rest;
}
