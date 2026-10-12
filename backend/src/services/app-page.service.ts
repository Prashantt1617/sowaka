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
  const page = await appPages().findOne(
    { key, enabledOrgs: org },
    { projection: { _id: 0, html: 1, version: 1, enabledOrgs: 1 } },
  );
  if (!page || !pageIsOnFor(page, org)) return null;
  return { version: String(page.version), html: page.html };
}
