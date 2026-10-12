/**
 * The pages the app shows inside its own tabs, managed from here: no app
 * release, no deploy. Today one page: the Games tab's home ('games-home',
 * from backend/app-pages/games-home.html).
 *
 * A page is one document in `app_pages`: the current version, the one before
 * it (for a one-step rollback) and the companies it is on for. A company not
 * on the list keeps the app's native screen, and so does every company until
 * it is enabled. Uploading here is a production deploy: the database is shared.
 *
 *   # Upload a new version from a file (the current one is kept as the previous):
 *   node --env-file=.env --import tsx src/scripts/app-pages.ts upsert app-pages/games-home.html --key games-home
 *   node --env-file=.env --import tsx src/scripts/app-pages.ts upsert app-pages/games-home.html --key games-home --by "Kritik"
 *
 *   # Which company gets it (the app picks it up the next time the tab is shown):
 *   node --env-file=.env --import tsx src/scripts/app-pages.ts enable sowaka games-home
 *   node --env-file=.env --import tsx src/scripts/app-pages.ts disable sowaka games-home
 *
 *   # Back to the version before (run again to undo the rollback):
 *   node --env-file=.env --import tsx src/scripts/app-pages.ts rollback games-home
 *
 *   node --env-file=.env --import tsx src/scripts/app-pages.ts list
 *   node --env-file=.env --import tsx src/scripts/app-pages.ts export games-home /tmp/games-home.html
 *
 * To try a page without any of this, run a local backend with
 * APP_PAGE_DIR=<repo>/backend/app-pages: it then serves `<key>.html` from that
 * folder to every company, as version "dev", and nothing is written.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { userInfo } from 'node:os';
import { resolve } from 'node:path';
import { appPages, companies, connectDb } from '../config/db';
import type { AppPage } from '../models/app-page.model';
import {
  APP_PAGE_KEYS,
  AppPageKey,
  enabledOrgsAfter,
  isAppPageKey,
  rolledBack,
  withUpload,
} from '../services/app-page-rules';

/** `upsert page.html --key x --by "Y"` -> positionals and flags. */
function parseArgs(argv: string[]) {
  const positional: string[] = [];
  const flags: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) {
      positional.push(arg);
      continue;
    }
    const [name, inline] = arg.slice(2).split(/=(.*)/s, 2);
    if (inline !== undefined) flags[name] = inline;
    else if (argv[i + 1] !== undefined && !argv[i + 1].startsWith('--')) flags[name] = argv[++i];
    else flags[name] = 'true';
  }
  return { positional, flags };
}

function keyOrThrow(key: string | undefined): AppPageKey {
  if (!isAppPageKey(key)) throw new Error(`Unknown page "${key ?? ''}": use ${APP_PAGE_KEYS.join(', ')}`);
  return key;
}

function operator(flags: Record<string, string>): string {
  const by = flags.by?.trim();
  if (by) return by;
  try {
    return userInfo().username;
  } catch {
    return 'script';
  }
}

const kb = (html: string) => `${(Buffer.byteLength(html) / 1024).toFixed(1)} KB`;

async function current(key: AppPageKey): Promise<AppPage | null> {
  return appPages().findOne({ key }, { projection: { _id: 0 } });
}

async function upsert(positional: string[], flags: Record<string, string>) {
  const key = keyOrThrow(flags.key);
  const file = positional[0];
  if (!file) throw new Error('Usage: upsert <file.html> --key <key> [--by name]');
  const html = readFileSync(resolve(file), 'utf8');
  if (!/<html|<body|<script|<main/i.test(html)) throw new Error(`${file} does not look like an HTML page`);
  const before = await current(key);
  if (before && before.html === html) {
    console.log(`${key}: the file is version ${before.version} already; nothing written.`);
    await printPage(key);
    return;
  }
  const next = withUpload(before, key, html, new Date(), operator(flags));
  await appPages().replaceOne({ key }, next, { upsert: true });
  console.log(
    `${key}: version ${next.version} (${kb(html)})${before ? `, version ${before.version} kept for rollback` : ''}.`,
  );
  if (!next.enabledOrgs.length) console.log(`Note: no company has it yet; enable one with: enable <org> ${key}`);
  await printPage(key);
}

async function companyOrThrow(org: string) {
  const company = await companies().findOne({ id: org }, { projection: { _id: 0, id: 1, enabledTabs: 1 } });
  if (!company) throw new Error(`No company "${org}"`);
  return company;
}

async function setEnabled(org: string, rawKey: string, on: boolean) {
  if (!org || !rawKey) throw new Error(`Usage: ${on ? 'enable' : 'disable'} <org> <key>`);
  const key = keyOrThrow(rawKey);
  const company = await companyOrThrow(org);
  const page = await current(key);
  if (!page) throw new Error(`${key} has never been uploaded; upsert it first.`);
  const orgs = enabledOrgsAfter(page.enabledOrgs, org, on);
  await appPages().updateOne({ key }, { $set: { enabledOrgs: orgs } });
  console.log(`${key}: [${(page.enabledOrgs ?? []).join(', ')}] -> [${orgs.join(', ')}]`);
  if (on && key === 'games-home' && !company.enabledTabs?.includes('games')) {
    console.log(`Note: ${org}'s tabs do not include 'games', so the app does not show the Games tab there.`);
  }
}

async function rollback(rawKey: string, flags: Record<string, string>) {
  const key = keyOrThrow(rawKey);
  const page = await current(key);
  if (!page) throw new Error(`${key} has never been uploaded.`);
  const back = rolledBack(page, new Date(), operator(flags));
  if (!back) throw new Error(`${key} has no previous version to go back to.`);
  await appPages().replaceOne({ key }, back);
  console.log(`${key}: version ${page.version} -> ${back.version} (version ${page.version} kept; rollback again to undo).`);
  await printPage(key);
}

async function printPage(key: string) {
  const page = await appPages().findOne({ key }, { projection: { _id: 0 } });
  if (!page) {
    console.log(`  ${key.padEnd(14)} not uploaded`);
    return;
  }
  const previous = page.previous ? `previous v${page.previous.version} (${kb(page.previous.html)})` : 'no previous';
  console.log(
    `  ${key.padEnd(14)} v${page.version} (${kb(page.html)}); ${previous}; on for: ${page.enabledOrgs?.length ? page.enabledOrgs.join(', ') : 'nobody'}; updated ${page.updatedAt.toISOString()} by ${page.updatedBy}`,
  );
}

async function list() {
  console.log('App pages:');
  for (const key of APP_PAGE_KEYS) await printPage(key);
}

async function exportPage(rawKey: string, out: string) {
  if (!rawKey || !out) throw new Error('Usage: export <key> <file.html>');
  const key = keyOrThrow(rawKey);
  const page = await current(key);
  if (!page) throw new Error(`${key} has never been uploaded.`);
  writeFileSync(resolve(out), page.html);
  console.log(`Wrote ${key} v${page.version} (${kb(page.html)}) to ${out}`);
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  const { positional, flags } = parseArgs(rest);
  if (!command || command === 'help' || command === '--help') {
    console.log(
      'Usage: app-pages.ts upsert <file.html> --key k [--by name] | enable <org> <key> | disable <org> <key> | rollback <key> | list | export <key> <file>',
    );
    return;
  }
  await connectDb();
  switch (command) {
    case 'upsert':
      return upsert(positional, flags);
    case 'enable':
      return setEnabled(positional[0], positional[1], true);
    case 'disable':
      return setEnabled(positional[0], positional[1], false);
    case 'rollback':
      return rollback(positional[0], flags);
    case 'list':
      return list();
    case 'export':
      return exportPage(positional[0], positional[1]);
    default:
      throw new Error(`Unknown command "${command}"`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
