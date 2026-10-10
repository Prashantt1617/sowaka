/**
 * The Games tab's catalog, managed from here: no app release, no deploy.
 *
 * A game is one document in `game_catalog`; a web game carries its whole page
 * in it. Which games a company gets is `companies.enabledGames`. Neither is
 * touched by anything else, and this never changes a company's tabs: the
 * games show in the app only where the company's tabs include 'games'.
 *
 *   # Add a web game, or update it (only the fields given change):
 *   node --env-file=.env --import tsx src/scripts/game-catalog.ts upsert game-pages/odd-one-out.html \
 *     --key odd-one-out --name "Odd One Out" --tagline "Spot the tile that's different" \
 *     --thumbnail game-pages/odd-one-out.jpg --accent "#F5B82E" --background "#15122B" \
 *     --order 20 --scoring points --max-score 80000
 *   # Just the page, after editing the file:
 *   node --env-file=.env --import tsx src/scripts/game-catalog.ts upsert game-pages/odd-one-out.html --key odd-one-out
 *   # A native game (built into the app; the entry only describes it):
 *   node --env-file=.env --import tsx src/scripts/game-catalog.ts upsert --key gratitude-garden --kind native \
 *     --name "Gratitude Garden" --thumbnail assets/games/gratitude-garden.jpg --order 10
 *   # What its colleague challenges pay in engagement points (any field left out keeps
 *   # its current value, else the default; "none" goes back to every default):
 *   node --env-file=.env --import tsx src/scripts/game-catalog.ts upsert --key odd-one-out \
 *     --challenge-rewards perPoints=100,maxPerMatch=25,dailyWinCap=3,samePairPerDay=1,minLoserShare=0.25,participation=2,expiryHours=24
 *   # Take a game off everywhere without touching any company's list:
 *   node --env-file=.env --import tsx src/scripts/game-catalog.ts upsert --key odd-one-out --active false
 *
 *   # Which company gets which game:
 *   node --env-file=.env --import tsx src/scripts/game-catalog.ts enable sowaka odd-one-out
 *   node --env-file=.env --import tsx src/scripts/game-catalog.ts disable sowaka odd-one-out
 *   node --env-file=.env --import tsx src/scripts/game-catalog.ts set sowaka gratitude-garden,odd-one-out
 *
 *   node --env-file=.env --import tsx src/scripts/game-catalog.ts list
 *   node --env-file=.env --import tsx src/scripts/game-catalog.ts export odd-one-out /tmp/odd-one-out.html
 *
 * Upsert options: --key (required) --name --tagline --description --instructions
 * --kind web|native --accent #RRGGBB --background #RRGGBB --order N
 * --thumbnail <file | https URL | data: URI | assets/... | none>
 * --hosted-url <https URL | none> --scoring <label | none> --lower-is-better
 * --max-score N --active true|false
 * --challenge-rewards <field=value,... | JSON | none>   fields: perPoints maxPerMatch dailyWinCap
 *   samePairPerDay minLoserShare participation expiryHours
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { extname, resolve } from 'node:path';
import { companies, connectDb, gameCatalog } from '../config/db';
import {
  DEFAULT_ENABLED_GAMES,
  GAME_KEY_PATTERN,
  GameCatalogEntry,
  GameScoring,
} from '../models/game-catalog.model';
import { enabledGamesOf } from '../services/game-catalog.service';
import {
  CHALLENGE_REWARD_FIELDS,
  challengeRewardsOf,
  rewardFieldValue,
} from '../services/game-challenge-rules';
import type { ChallengeRewardRules } from '../models/game-challenge.model';

const IMAGE_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
};

/** `upsert page.html --key x --name "Y" --lower-is-better` -> positionals and flags. */
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

function hex(value: string, flag: string): string {
  if (!/^#[0-9A-Fa-f]{6}$/.test(value)) throw new Error(`--${flag} must look like #RRGGBB, not "${value}"`);
  return value.toUpperCase();
}

function bool(value: string, flag: string): boolean {
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new Error(`--${flag} must be true or false`);
}

function httpsUrl(value: string, flag: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`--${flag} is not a URL: "${value}"`);
  }
  if (url.protocol !== 'https:') throw new Error(`--${flag} must be https`);
  return url.toString();
}

/** A file becomes a data URI kept in the document; a URL or asset path is kept as given. */
function thumbnailFrom(value: string): string {
  if (/^(https:|data:image\/)/.test(value)) return value;
  if (value.startsWith('assets/')) return value;
  const type = IMAGE_TYPES[extname(value).toLowerCase()];
  if (!type) throw new Error(`--thumbnail ${value}: use a .png, .jpg, .webp, .gif or .svg file, an https URL or assets/...`);
  const bytes = readFileSync(resolve(value));
  if (bytes.length > 150 * 1024) {
    console.warn(`Note: the thumbnail is ${(bytes.length / 1024).toFixed(0)} KB; every catalog read carries it. Under 60 KB is kinder.`);
  }
  return `data:${type};base64,${bytes.toString('base64')}`;
}

async function upsert(positional: string[], flags: Record<string, string>) {
  const key = flags.key;
  if (!key || !GAME_KEY_PATTERN.test(key)) throw new Error('--key is required: lowercase letters, digits and dashes');
  const existing = await gameCatalog().findOne({ key });
  const set: Partial<GameCatalogEntry> = {};
  const unset: Record<string, ''> = {};

  const pageFile = positional[0];
  if (pageFile) {
    const html = readFileSync(resolve(pageFile), 'utf8');
    if (!/<html|<body|<script|<main|<title/i.test(html)) throw new Error(`${pageFile} does not look like an HTML page`);
    set.html = html;
  }
  for (const field of ['name', 'tagline', 'description', 'instructions'] as const) {
    if (flags[field] !== undefined) set[field] = flags[field].trim();
  }
  if (flags.kind !== undefined) {
    if (flags.kind !== 'web' && flags.kind !== 'native') throw new Error('--kind must be web or native');
    set.kind = flags.kind;
  }
  if (flags.accent !== undefined) set.accentColor = hex(flags.accent, 'accent');
  if (flags.background !== undefined) set.backgroundColor = hex(flags.background, 'background');
  if (flags.order !== undefined) {
    const order = Number(flags.order);
    if (!Number.isFinite(order)) throw new Error('--order must be a number');
    set.order = order;
  }
  if (flags.active !== undefined) set.active = bool(flags.active, 'active');
  if (flags.thumbnail !== undefined) {
    if (flags.thumbnail === 'none') unset.thumbnail = '';
    else set.thumbnail = thumbnailFrom(flags.thumbnail);
  }
  if (flags['hosted-url'] !== undefined) {
    if (flags['hosted-url'] === 'none') unset.hostedUrl = '';
    else set.hostedUrl = httpsUrl(flags['hosted-url'], 'hosted-url');
  }
  if (flags.scoring === 'none') {
    unset.scoring = '';
  } else if (flags.scoring !== undefined || flags['lower-is-better'] !== undefined || flags['max-score'] !== undefined) {
    const scoring: GameScoring = {
      higherIsBetter: existing?.scoring?.higherIsBetter ?? true,
      label: existing?.scoring?.label ?? 'points',
      ...(existing?.scoring?.max !== undefined ? { max: existing.scoring.max } : {}),
    };
    if (flags.scoring !== undefined && flags.scoring !== 'true') scoring.label = flags.scoring.trim();
    if (flags['lower-is-better'] !== undefined) scoring.higherIsBetter = !bool(flags['lower-is-better'], 'lower-is-better');
    if (flags['max-score'] !== undefined) {
      const max = Number(flags['max-score']);
      if (!Number.isFinite(max) || max <= 0) throw new Error('--max-score must be a positive number');
      scoring.max = max;
    }
    set.scoring = scoring;
  }

  if (flags['challenge-rewards'] !== undefined) {
    const raw = flags['challenge-rewards'].trim();
    if (raw === 'none') unset.challengeRewards = '';
    else set.challengeRewards = { ...(existing?.challengeRewards ?? {}), ...challengeRewardsFrom(raw) };
  }

  // What the document will be, to check it makes sense before writing it.
  const merged = { ...existing, ...set } as Partial<GameCatalogEntry>;
  for (const field of Object.keys(unset)) delete (merged as Record<string, unknown>)[field];
  const kind = merged.kind ?? 'web';
  if (!merged.name) throw new Error('--name is required for a new game');
  if (kind === 'web' && !merged.html && !merged.hostedUrl) {
    throw new Error('A web game needs a page (an HTML file as the first argument) or --hosted-url');
  }
  if (kind === 'native' && set.html) throw new Error('A native game is built into the app; it has no page');

  const now = new Date();
  const onInsert: Partial<GameCatalogEntry> = { key, createdAt: now };
  if (set.kind === undefined) onInsert.kind = 'web';
  if (set.active === undefined) onInsert.active = true;
  if (set.order === undefined) {
    const last = await gameCatalog().find({}, { projection: { order: 1 } }).sort({ order: -1 }).limit(1).next();
    onInsert.order = (last?.order ?? 0) + 10;
  }
  await gameCatalog().updateOne(
    { key },
    {
      $set: { ...set, updatedAt: now },
      ...(existing ? {} : { $setOnInsert: onInsert }),
      ...(Object.keys(unset).length ? { $unset: unset } : {}),
    },
    { upsert: true },
  );
  const changed = [...Object.keys(set), ...Object.keys(unset).map((field) => `-${field}`)];
  console.log(`${existing ? 'Updated' : 'Added'} ${key}${changed.length ? ` (${changed.join(', ')})` : ''}.`);
  await printGame(key);
}

/** `perPoints=100,maxPerMatch=25` or `{"perPoints":500}` -> the fields given, each checked. */
function challengeRewardsFrom(raw: string): Partial<ChallengeRewardRules> {
  let given: Record<string, unknown>;
  if (raw.startsWith('{')) {
    try {
      given = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      throw new Error('--challenge-rewards is not valid JSON');
    }
  } else {
    given = Object.fromEntries(
      raw.split(',').map((pair) => pair.trim()).filter(Boolean).map((pair) => {
        const [name, value] = pair.split('=');
        if (value === undefined) throw new Error(`--challenge-rewards: "${pair}" should be field=value`);
        return [name.trim(), value.trim()];
      }),
    );
  }
  const out: Partial<ChallengeRewardRules> = {};
  for (const [name, value] of Object.entries(given)) {
    const field = CHALLENGE_REWARD_FIELDS.find((f) => f === name);
    if (!field) throw new Error(`--challenge-rewards: unknown field "${name}"; use ${CHALLENGE_REWARD_FIELDS.join(', ')}`);
    const parsed = rewardFieldValue(field, value);
    if (parsed === null) throw new Error(`--challenge-rewards: ${name}=${String(value)} is out of range`);
    out[field] = parsed;
  }
  return out;
}

async function printGame(key: string) {
  const game = await gameCatalog().findOne({ key });
  if (!game) return;
  const page = game.html ? `page ${(Buffer.byteLength(game.html) / 1024).toFixed(1)} KB` : game.hostedUrl ? `hosted ${game.hostedUrl}` : 'no page';
  const thumb = !game.thumbnail ? 'no thumbnail' : game.thumbnail.startsWith('data:') ? `thumbnail ${(game.thumbnail.length / 1024).toFixed(0)} KB data URI` : `thumbnail ${game.thumbnail}`;
  const scoring = game.scoring ? `${game.scoring.label}${game.scoring.higherIsBetter === false ? ', lowest wins' : ''}${game.scoring.max ? `, max ${game.scoring.max}` : ''}` : 'no scores';
  console.log(
    `  ${String(game.order).padStart(4)}  ${game.key.padEnd(20)} ${game.kind.padEnd(6)} ${game.active ? 'active  ' : 'INACTIVE'}  "${game.name}"  ${page}; ${thumb}; ${scoring}; updated ${game.updatedAt.toISOString()}`,
  );
  if (game.scoring && game.scoring.higherIsBetter !== false) {
    const rules = challengeRewardsOf(game.challengeRewards);
    const own = new Set(Object.keys(game.challengeRewards ?? {}));
    console.log(
      `        challenge rewards: ${CHALLENGE_REWARD_FIELDS.map((f) => `${f}=${rules[f]}${own.has(f) ? '' : '*'}`).join(' ')}  (* default)`,
    );
  }
}

async function companyOrThrow(org: string) {
  const company = await companies().findOne({ id: org });
  if (!company) throw new Error(`No company "${org}"`);
  return company;
}

/** The list as it is written; a company without one starts from the default. */
function currentList(company: { enabledGames?: string[] }): string[] {
  return Array.isArray(company.enabledGames) ? [...company.enabledGames] : [...DEFAULT_ENABLED_GAMES];
}

async function writeList(org: string, before: string[] | undefined, games: string[]) {
  await companies().updateOne({ id: org }, { $set: { enabledGames: games, updatedAt: new Date() } });
  console.log(`${org}: ${before === undefined ? '(no list)' : `[${before.join(', ')}]`} -> [${games.join(', ')}]`);
  const company = await companyOrThrow(org);
  if (!company.enabledTabs?.includes('games')) {
    console.log(`Note: ${org}'s tabs do not include 'games', so the app does not show the Games tab there yet.`);
  }
}

async function requireKnownKeys(keys: string[]) {
  const known = new Set((await gameCatalog().find({ key: { $in: keys } }).project<{ key: string }>({ _id: 0, key: 1 }).toArray()).map((row) => row.key));
  const unknown = keys.filter((key) => !known.has(key));
  if (unknown.length) throw new Error(`Not in the catalog: ${unknown.join(', ')}. Add it with upsert first.`);
}

async function enable(org: string, key: string) {
  if (!org || !key) throw new Error('Usage: enable <org> <key>');
  const company = await companyOrThrow(org);
  await requireKnownKeys([key]);
  const list = currentList(company);
  if (!list.includes(key)) list.push(key);
  await writeList(org, company.enabledGames, list);
}

async function disable(org: string, key: string) {
  if (!org || !key) throw new Error('Usage: disable <org> <key>');
  const company = await companyOrThrow(org);
  await writeList(org, company.enabledGames, currentList(company).filter((k) => k !== key));
}

async function setList(org: string, raw: string | undefined) {
  if (!org || raw === undefined) throw new Error('Usage: set <org> <key,key,...>   ("" for none)');
  const company = await companyOrThrow(org);
  const keys = [...new Set(raw.split(',').map((k) => k.trim()).filter(Boolean))];
  await requireKnownKeys(keys);
  await writeList(org, company.enabledGames, keys);
}

async function list() {
  const games = await gameCatalog().find({}, { projection: { key: 1 } }).sort({ order: 1, name: 1 }).toArray();
  console.log(games.length ? 'Catalog:' : 'The catalog is empty.');
  for (const game of games) await printGame(game.key);
  console.log('\nCompanies:');
  const rows = await companies()
    .find({}, { projection: { _id: 0, id: 1, name: 1, enabledTabs: 1, enabledGames: 1 } })
    .sort({ id: 1 })
    .toArray();
  for (const company of rows) {
    const tab = company.enabledTabs?.includes('games');
    const effective = enabledGamesOf(company);
    const source = Array.isArray(company.enabledGames) ? 'its list' : 'default';
    console.log(
      `  ${company.id.padEnd(14)} Games tab ${tab ? 'on ' : 'off'}   games (${source}): ${effective.length ? effective.join(', ') : 'none'}`,
    );
  }
}

async function exportPage(key: string, out: string) {
  if (!key || !out) throw new Error('Usage: export <key> <file.html>');
  const game = await gameCatalog().findOne({ key });
  if (!game?.html) throw new Error(`${key} has no page in the catalog`);
  writeFileSync(resolve(out), game.html);
  console.log(`Wrote ${key}'s page (${(Buffer.byteLength(game.html) / 1024).toFixed(1)} KB) to ${out}`);
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  const { positional, flags } = parseArgs(rest);
  if (!command || command === 'help' || command === '--help') {
    console.log('Usage: game-catalog.ts upsert [page.html] --key k [...] | enable <org> <key> | disable <org> <key> | set <org> <keys> | list | export <key> <file>');
    return;
  }
  await connectDb();
  switch (command) {
    case 'upsert':
      return upsert(positional, flags);
    case 'enable':
      return enable(positional[0], positional[1]);
    case 'disable':
      return disable(positional[0], positional[1]);
    case 'set':
      return setList(positional[0], positional[1]);
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
