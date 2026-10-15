/**
 * Checks the Secret Squad word packs in `services/secret-squad-packs.ts`:
 * stable kebab-case ids, 4 themes per pack, at least 20 words per theme
 * (24 is the target), words of at most 14 characters in an uppercase-friendly
 * alphabet, a trap line on every theme, and no word twice anywhere in the
 * file (ignoring case, spaces and punctuation).
 *
 * No database. Run with `npx tsx src/scripts/secret-squad-packs-check.ts`.
 */
import { SQUAD_PACKS } from '../services/secret-squad-packs';

const MIN_WORDS = 20;
const TARGET_WORDS = 24;
const MAX_CHARS = 14;
const THEMES_PER_PACK = 4;
const DIFFICULTIES = new Set(['easy', 'medium', 'hard']);

const failures: string[] = [];
const fail = (message: string) => failures.push(message);

/** The key two words clash on: letters and digits only, lowercased. */
const keyOf = (word: string) => word.toLowerCase().replace(/[^a-z0-9]/g, '');

const packIds = new Set<string>();
const themeNames = new Map<string, string>();
const seen = new Map<string, string>(); // word key -> "pack / theme / WORD"
let themeCount = 0;
let wordCount = 0;
const short: string[] = [];

for (const pack of SQUAD_PACKS) {
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(pack.id)) fail(`pack id "${pack.id}" is not kebab-case`);
  if (packIds.has(pack.id)) fail(`pack id "${pack.id}" is used twice`);
  packIds.add(pack.id);
  if (!pack.name.trim()) fail(`${pack.id}: empty name`);
  if (!DIFFICULTIES.has(pack.difficulty)) fail(`${pack.id}: difficulty "${pack.difficulty}"`);
  if (pack.themes.length !== THEMES_PER_PACK) fail(`${pack.id}: ${pack.themes.length} themes, want ${THEMES_PER_PACK}`);

  for (const theme of pack.themes) {
    themeCount++;
    const where = `${pack.id} / ${theme.name}`;
    const nameKey = keyOf(theme.name);
    if (!nameKey) fail(`${pack.id}: a theme has no name`);
    else if (themeNames.has(nameKey)) fail(`theme name "${theme.name}" is in ${themeNames.get(nameKey)} and ${pack.id}`);
    else themeNames.set(nameKey, pack.id);
    if (!theme.traps.trim()) fail(`${where}: no traps line`);
    if (theme.words.length < MIN_WORDS) fail(`${where}: ${theme.words.length} words, want at least ${MIN_WORDS}`);
    if (theme.words.length < TARGET_WORDS) short.push(`${where} (${theme.words.length})`);

    for (const word of theme.words) {
      wordCount++;
      if (word !== word.trim() || /\s{2,}/.test(word)) fail(`${where}: "${word}" has stray spaces`);
      if (word.length > MAX_CHARS) fail(`${where}: "${word}" is ${word.length} characters, max ${MAX_CHARS}`);
      if (!/^[A-Z0-9][A-Z0-9 '\-]*$/.test(word)) fail(`${where}: "${word}" must be uppercase letters, digits, spaces, ' or -`);
      const key = keyOf(word);
      if (!key) {
        fail(`${where}: "${word}" has no letters`);
        continue;
      }
      const first = seen.get(key);
      if (first) fail(`"${word}" in ${where} clashes with ${first}`);
      else seen.set(key, `${where} / ${word}`);
    }
  }
}

const byDifficulty = SQUAD_PACKS.reduce<Record<string, number>>((acc, p) => {
  acc[p.difficulty] = (acc[p.difficulty] ?? 0) + 1;
  return acc;
}, {});

console.log(
  `${SQUAD_PACKS.length} packs, ${themeCount} themes, ${wordCount} words ` +
    `(easy ${byDifficulty.easy ?? 0}, medium ${byDifficulty.medium ?? 0}, hard ${byDifficulty.hard ?? 0})`,
);
if (short.length) console.log(`Below the ${TARGET_WORDS}-word target: ${short.join(', ')}`);

if (failures.length) {
  console.error(`\n${failures.length} problem(s):`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log('All pack checks passed.');
