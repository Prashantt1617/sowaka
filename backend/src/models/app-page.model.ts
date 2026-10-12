/**
 * A page the app shows inside one of its own tabs, kept in the database so it
 * changes without an app release: today only the Games tab's home
 * ('games-home'). The app fetches it with the person's session
 * (`GET /app-pages/:key`) and falls back to its own native screen whenever
 * the page is not on for their company.
 *
 * Written by Sowaka with `src/scripts/app-pages.ts`, never from a dashboard.
 * One document per key in `app_pages`.
 */
export interface AppPage {
  /** Which page: one of APP_PAGE_KEYS in `services/app-page-rules.ts`. */
  key: string;
  /** The whole page, one self-contained HTML file. */
  html: string;
  /** Goes up by one with every upload; the app replaces its copy when it changes. */
  version: number;
  /** The version before this one, kept for a one-step rollback. */
  previous: { html: string; version: number } | null;
  /** The companies (org ids) that get the page; everyone else keeps the native screen. */
  enabledOrgs: string[];
  updatedAt: Date;
  /** Who wrote this version: the operator's name, for the record. */
  updatedBy: string;
}
