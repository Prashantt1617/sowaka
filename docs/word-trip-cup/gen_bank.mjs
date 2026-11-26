#!/usr/bin/env node
/**
 * The Word Trip Tournament's word bank, made from Word Trip's own lists (game-pages/word-trip.html, never changed):
 *
 *   node docs/word-trip-cup/gen_bank.mjs   →   backend/src/content/word-trip-cup.json
 *
 * - words: Word Trip's common words of 3 to 7 letters; rare: its rare finds of 3 to 7 letters. The server scores with
 *   these exactly as Word Trip does (rare pays half again).
 * - Offensive words (BLOCKED below) are taken out of both lists, so they are never a valid answer and never reach the TV.
 * - stops: Word Trip's letter sets of 5, 6 and 7 letters that make at least MIN_COMMON common words, whose all-letter
 *   words are all clean, and that make at least one common word with every letter.
 * Run it again after Word Trip's lists change; the server reads the JSON at start.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const html = readFileSync(join(root, 'backend/game-pages/word-trip.html'), 'utf8');
const grab = (name) => new RegExp(`const ${name}="([^"]*)"`).exec(html)[1].split(' ');
const STOPS = Function(`return (${/const STOPS=(\{[^;]*\});/.exec(html)[1]})`)();

/* Never a valid answer in the tournament (and so never on the TV): profanity, slurs, sexual words and body parts. */
export const BLOCKED = new Set(`
anal anus anuses arse arses ass asses balls bastard bastards bitch bitched bitches bitchy bonk bonks boner boners boob boobs booby
bugger buggers bum bums butt butts clit clits cock cocks coon coons crap craps crappy cum cums cunt cunts damn damned damns
dick dicks dildo dildos dyke dykes erotic fag fags faggot fart farted farts fuck fucked fucks gook gooks gyp gyps hell hells
homo homos honky hooker hookers horny hump humped humps jap japs jizz kike kikes kinky lesbo milf nazi nazis negro nigger
niggers nipple nipples nude nudes nudity orgasm orgies orgy paki pakis pee pees peed penis penises perv pervs pimp pimps
piss pissed pisses poo poop poops porn porno prick pricks pube pubes pubic queer queers rape raped rapes rapist retard retards
scrotum semen sex sexed sexes sexy shag shags shit shits sissy slut sluts smut spic spics sperm spunk tit tits titty tosser turd
turds twat twats vagina vaginas wank wanked wanks whore whores wop wops
`.trim().split(/\s+/));

const MIN_COMMON = { 5: 12, 6: 20, 7: 30 };
const clean = (list) => list.filter((w) => w.length >= 3 && w.length <= 7 && !BLOCKED.has(w));
const words = clean(grab('WORDS'));
const rare = clean(grab('RARE'));
const removed = grab('WORDS').concat(grab('RARE')).filter((w) => BLOCKED.has(w));

function made(key, list) {
  const have = {};
  for (const c of key) have[c] = (have[c] || 0) + 1;
  return list.filter((w) => {
    if (w.length > key.length) return false;
    const n = {};
    for (const c of w) {
      n[c] = (n[c] || 0) + 1;
      if (n[c] > (have[c] || 0)) return false;
    }
    return true;
  });
}

const stops = {};
for (const len of [5, 6, 7]) {
  stops[len] = STOPS[len].split(' ').filter((key) => {
    const common = made(key, words);
    if (common.length < MIN_COMMON[len]) return false;
    if (!common.some((w) => w.length === len)) return false;
    const fullAll = made(key, grab('WORDS').concat(grab('RARE'))).filter((w) => w.length === len);
    return !fullAll.some((w) => BLOCKED.has(w));
  });
}

const out = { v: 1, words: words.join(' '), rare: rare.join(' '), stops };
writeFileSync(join(root, 'backend/src/content/word-trip-cup.json'), JSON.stringify(out));
console.log(`words ${words.length} · rare ${rare.length} · stops 5:${stops[5].length} 6:${stops[6].length} 7:${stops[7].length} · blocked words found in Word Trip's lists: ${removed.length ? removed.join(', ') : 'none'}`);
