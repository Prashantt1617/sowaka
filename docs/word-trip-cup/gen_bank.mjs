#!/usr/bin/env node
/**
 * The Word Trip Tournament's word lists, from Word Trip's own (game-pages/word-trip.html, never changed):
 *
 *   node docs/word-trip-cup/gen_bank.mjs [out.json]
 *
 * The tournament plays the normal game: the same stops (Word Trip's STOPS, walked by its own `boardAt(seed, g)`), the
 * same common words (WORDS) and rare finds (RARE), with one difference: the offensive words below (BLOCKED) never
 * count, in the page or on the server (the server reads the same list: services/cup-rules.ts WT_BLOCKED).
 * Writes { words, rare, stops, removed, stopsWithoutCleanFullWord } (stops: every letter set, sorted letters, by length).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const html = readFileSync(join(root, 'backend/game-pages/word-trip.html'), 'utf8');
const grab = (name) => new RegExp(`const ${name}="([^"]*)"`).exec(html)[1].split(' ');
const STOPS = Function(`return (${/const STOPS=(\{[^;]*\});/.exec(html)[1]})`)();
const rules = readFileSync(join(root, 'backend/src/services/cup-rules.ts'), 'utf8');
const BLOCKED = new Set(/export const WT_BLOCKED = new Set\(\s*\(([\s\S]*?)\)\.split/.exec(rules)[1].replace(/['+\s]+/g, ' ').trim().split(' '));

const WORDS = grab('WORDS'), RARE = grab('RARE');
const words = WORDS.filter((w) => !BLOCKED.has(w));
const rare = RARE.filter((w) => !BLOCKED.has(w));
const removed = WORDS.concat(RARE).filter((w) => BLOCKED.has(w));
const made = (key, w) => { const have = {}; for (const c of key) have[c] = (have[c] || 0) + 1; for (const c of w) { if (!have[c]) return false; have[c] -= 1; } return true; };
const stops = {};
const stopsWithoutCleanFullWord = [];
for (const len of Object.keys(STOPS)) {
  stops[len] = STOPS[len].split(' ');
  for (const key of stops[len]) {
    const full = words.concat(rare).filter((w) => w.length === key.length && made(key, w));
    if (!full.length) stopsWithoutCleanFullWord.push(key);
  }
}
const out = process.argv[2] || join(root, 'docs/word-trip-cup/word-lists.json');
writeFileSync(out, JSON.stringify({ words, rare, stops, removed, stopsWithoutCleanFullWord }));
console.log(`words ${words.length} · rare ${rare.length} · stops ${Object.entries(stops).map(([k, v]) => `${k}:${v.length}`).join(' ')} · removed ${removed.length}: ${removed.join(', ')} · stops whose every all-letter word is removed: ${stopsWithoutCleanFullWord.length ? stopsWithoutCleanFullWord.join(', ') : 'none'}`);
