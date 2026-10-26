import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { appPages } from '../config/db';
import { env } from '../config/env';
import { isAppPageKey, pageIsOnFor } from './app-page-rules';

/** What the app is given: the page and the version it is, to keep a copy by. */
export interface ServedAppPage {
  version: string;
  html: string;
}

/**
 * The page [key] for someone at [org], or null when they do not get it (the
 * app then shows its own native screen). With `APP_PAGE_DIR` on a developer's
 * machine, the file `<dir>/<key>.html` for everyone, as version "dev".
 */
export async function appPageFor(org: string | undefined, key: string): Promise<ServedAppPage | null> {
  if (!isAppPageKey(key)) return null;
  if (env.appPageDir) {
    try {
      const html = await readFile(join(resolve(env.appPageDir), `${key}.html`), 'utf8');
      return html.length ? { version: 'dev', html } : null;
    } catch {
      return null;
    }
  }
  if (!org) return null;
  const cacheKey = `${key}|${org}`;
  const kept = served.get(cacheKey);
  if (kept && Date.now() - kept.at < APP_PAGE_MS) return kept.page;
  const read = readPage(org, key);
  served.set(cacheKey, { at: Date.now(), page: read });
  // A failed read is not kept: the next request asks again.
  read.catch(() => {
    if (served.get(cacheKey)?.page === read) served.delete(cacheKey);
  });
  return read;
}

/**
 * How long a page is kept per company. The Games home page is a whole HTML
 * document (~140 KB) read on every open of the tab, and on a link where every
 * read of it took seconds that was the tab's wait. Sowaka uploads a new
 * version from a script, a few times a week; it reaches the app within this.
 */
export const APP_PAGE_MS = 60_000;
const served = new Map<string, { at: number; page: Promise<ServedAppPage | null> }>();

/** For the checks: forget every kept page. */
export function forgetAppPages(): void {
  served.clear();
}

async function readPage(org: string, key: string): Promise<ServedAppPage | null> {
  const page = await appPages().findOne(
    { key, enabledOrgs: org },
    { projection: { _id: 0, html: 1, version: 1, enabledOrgs: 1 } },
  );
  if (!page || !pageIsOnFor(page, org)) return null;
  return { version: String(page.version), html: page.html };
}
