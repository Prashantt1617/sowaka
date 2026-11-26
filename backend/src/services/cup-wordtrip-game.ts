/**
 * The Word Trip Tournament's game, read from Word Trip's own page (no database here, so the rules checks load it too).
 */
import vm from 'node:vm';
import { WT_BLOCKED, WT_DEFAULT_RULES, type WtBoards, type WtKeyAt, type WtRules, type WtStop } from './cup-rules';

/**
 * The normal game the tournament is played in: Word Trip's page as phones get
 * it (the catalog's `word-trip`, else this repo's file on a machine without
 * one), its stops (`boardAt`, from its own seeded-boards block, run in a
 * sandbox) and its rules (the numbers its page plays by). The tournament page
 * plays this same page; the server checks every word against the same stops.
 */
export interface WtGame {
  version: string;
  html: string;
  boards: WtBoards;
  /** A stop's letters, sorted (cheap: for choosing seeds whose stops a player has not seen). */
  keyAt: WtKeyAt;
  rules: WtRules;
}
export function loadWordTripGame(html: string, version: string): WtGame {
  const block = /\/\* seeded-boards:start[\s\S]*?\/\* seeded-boards:end \*\//.exec(html)?.[0];
  if (!block) throw new Error("Word Trip's page has no seeded-boards block");
  // The game's own boardAt; the words a stop's letters make are worked out once per stop (the same answer every time).
  const memo = "\n;madeFrom=(function(f){var m=new Map();return function(letters,list){var k=letters+'|'+(list===WORDS?'w':list===RARE?'r':String(list).length);var v=m.get(k);if(!v){v=f(letters,list);m.set(k,v);}return v;};})(madeFrom);";
  const boardAt = vm.runInNewContext(`${block}${memo}\n;boardAt`, {}, { timeout: 5000 }) as (seed: number, g: number) => { len: number; letters: string; words: string[]; rare: string[] };
  const rules: WtRules = { ...WT_DEFAULT_RULES, VAL: { ...WT_DEFAULT_RULES.VAL }, TIMEB: { ...WT_DEFAULT_RULES.TIMEB } };
  const line = /const (VAL=\{[^}]*\}, FULL=\d+, COMBO_WINDOW=\d+, MAXCOMBO=\d+, TIMEB=\{[^}]*\}, FULL_TIME=\d+, MAX_ADDED=\d+);/.exec(html)?.[1];
  if (line) Object.assign(rules, JSON.parse(vm.runInNewContext(`(()=>{ const ${line}; return JSON.stringify({VAL,FULL,COMBO_WINDOW,MAXCOMBO,TIMEB,FULL_TIME,MAX_ADDED}); })()`, {}, { timeout: 1000 }) as string));
  const round = /ROUND=(\d+)/.exec(html)?.[1];
  if (round) rules.ROUND = Number(round);
  const skip = /const SKIP_COST=(\d+);/.exec(html)?.[1];
  if (skip) rules.SKIP_COST = Number(skip);
  const cache = new Map<string, WtStop>();
  const boards: WtBoards = (seed, g) => {
    const key = `${seed}:${g}`;
    let stop = cache.get(key);
    if (!stop) {
      const b = boardAt(seed, g);
      const clean = (list: string[]) => new Set(Array.from(list).filter((w) => !WT_BLOCKED.has(w)));
      stop = { g, len: b.len, letters: String(b.letters), words: clean(b.words), rare: clean(b.rare) };
      if (cache.size > 20_000) cache.clear();
      cache.set(key, stop);
    }
    return stop;
  };
  const keyAt: WtKeyAt = (seed, g) => String(boardAt(seed, g).letters).split('').sort().join('');
  return { version, html, boards, keyAt, rules };
}

