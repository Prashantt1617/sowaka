import packedWords from '../content/tileup-words.json';

/**
 * Tile Up's rules, the server's copy: classic Scrabble on a 15×15 board, the
 * usual premium squares and letter values, a 100-tile bag with two blanks, and
 * 50 points for using all 7 tiles. Ported line for line from the game page's
 * shared rules block (`game-pages/tile-up.html`, `window.TU`), which uses them
 * only to preview a play as tiles go down: the server is the judge.
 *
 * On the board a letter is lowercase; a blank is stored as the uppercase of
 * the letter it stands for, and scores 0.
 */

export const N = 15;
export const MID = 7;
export const ALL7 = 50;

export const VAL: Record<string, number> = {
  a: 1, b: 3, c: 3, d: 2, e: 1, f: 4, g: 2, h: 4, i: 1, j: 8, k: 5, l: 1, m: 3,
  n: 1, o: 1, p: 3, q: 10, r: 1, s: 1, t: 1, u: 1, v: 4, w: 4, x: 8, y: 4, z: 10,
};

export const BAG: Record<string, number> = {
  a: 9, b: 2, c: 2, d: 4, e: 12, f: 2, g: 3, h: 2, i: 9, j: 1, k: 1, l: 4, m: 2,
  n: 6, o: 8, p: 2, q: 1, r: 6, s: 4, t: 6, u: 4, v: 2, w: 2, x: 1, y: 2, z: 1, '?': 2,
};

export type Square = 'TW' | 'DW' | 'TL' | 'DL';
export const SQ: Record<number, Square> = {};
const put = (t: Square, list: Array<[number, number]>) => list.forEach(([r, c]) => { SQ[r * N + c] = t; });
put('TW', [[0, 0], [0, 7], [0, 14], [7, 0], [7, 14], [14, 0], [14, 7], [14, 14]]);
put('DW', [[1, 1], [2, 2], [3, 3], [4, 4], [10, 10], [11, 11], [12, 12], [13, 13], [1, 13], [2, 12], [3, 11], [4, 10], [10, 4], [11, 3], [12, 2], [13, 1], [7, 7]]);
put('TL', [[1, 5], [1, 9], [5, 1], [5, 5], [5, 9], [5, 13], [9, 1], [9, 5], [9, 9], [9, 13], [13, 5], [13, 9]]);
put('DL', [[0, 3], [0, 11], [2, 6], [2, 8], [3, 0], [3, 7], [3, 14], [6, 2], [6, 6], [6, 8], [6, 12], [7, 3], [7, 11], [8, 2], [8, 6], [8, 8], [8, 12], [11, 0], [11, 7], [11, 14], [12, 6], [12, 8], [14, 3], [14, 11]]);

export const emptyBoard = (): string[] => Array<string>(N * N).fill('');
export const isEmpty = (b: string[]) => b.every((x) => !x);
const inb = (r: number, c: number) => r >= 0 && c >= 0 && r < N && c < N;
export const valOf = (ch: string) => (ch && ch === ch.toLowerCase() ? VAL[ch] || 0 : 0);
export const newBag = (): string[] => Object.entries(BAG).flatMap(([ch, n]) => Array<string>(n).fill(ch));
export const rackValue = (rack: string[]) => rack.reduce((n, ch) => n + (ch === '?' ? 0 : VAL[ch] || 0), 0);

/** A tile put down this turn: row and column 0-14, the letter it reads as, and whether a blank stands for it. */
export interface PlacedTile { r: number; c: number; ch: string; blank?: boolean }

/** Why a play was refused: its shape (`taken`, `line`, `gap`, `centre`, `short`, `alone`, `empty`), or a word not in the dictionary (`word`). */
export type ShapeWhy = '' | 'empty' | 'taken' | 'line' | 'gap' | 'centre' | 'short' | 'alone' | 'word';

export interface Evaluation {
  ok: boolean;
  why: ShapeWhy;
  shape: boolean;
  words: Array<{ word: string; score: number; known: boolean | null; cells: number[] }>;
  score: number;
  all7: boolean;
}

/**
 * `tiles`: the new tiles; `board`: N*N squares; `has(word)`: the dictionary.
 * The page's `evaluate`, unchanged: `why` is the short reason when the shape
 * is wrong, or 'word' when a word is not in the dictionary; `known` is null
 * for every word when `has` is left out.
 */
export function evaluate(board: string[], tiles: PlacedTile[], has?: (word: string) => boolean): Evaluation {
  const res: Evaluation = { ok: false, why: '', words: [], score: 0, shape: false, all7: false };
  if (!tiles || !tiles.length) { res.why = 'empty'; return res; }
  const at: Record<number, string> = {};
  for (const t of tiles) {
    const k = t.r * N + t.c;
    if (!inb(t.r, t.c) || board[k] || at[k]) { res.why = 'taken'; return res; }
    at[k] = t.blank ? String(t.ch).toUpperCase() : String(t.ch).toLowerCase();
  }
  const L = (r: number, c: number) => (inb(r, c) ? board[r * N + c] || at[r * N + c] || '' : '');
  const rows = new Set(tiles.map((t) => t.r));
  const cols = new Set(tiles.map((t) => t.c));
  let dir: 'h' | 'v' | null = null;
  if (rows.size === 1 && tiles.length > 1) dir = 'h';
  else if (cols.size === 1 && tiles.length > 1) dir = 'v';
  else if (tiles.length > 1) { res.why = 'line'; return res; }
  const first = isEmpty(board);
  if (first) {
    if (!at[MID * N + MID]) { res.why = 'centre'; return res; }
    if (tiles.length < 2) { res.why = 'short'; return res; }
  }
  if (!dir) { const t = tiles[0]; dir = L(t.r, t.c - 1) || L(t.r, t.c + 1) ? 'h' : 'v'; }
  const dr = dir === 'v' ? 1 : 0;
  const dc = dir === 'h' ? 1 : 0;
  const s = tiles.slice().sort((a, b) => a.r - b.r || a.c - b.c);
  const a = s[0];
  const z = s[s.length - 1];
  for (let r = a.r, c = a.c; r <= z.r && c <= z.c; r += dr, c += dc) {
    if (!L(r, c)) { res.why = 'gap'; return res; }
  }
  const word = (r: number, c: number, dr2: number, dc2: number) => {
    while (L(r - dr2, c - dc2)) { r -= dr2; c -= dc2; }
    let w = '';
    let sum = 0;
    let mul = 1;
    const cells: number[] = [];
    while (L(r, c)) {
      const ch = L(r, c);
      const k = r * N + c;
      const fresh = !board[k];
      let v = valOf(ch);
      if (fresh) {
        const q = SQ[k];
        if (q === 'DL') v *= 2;
        else if (q === 'TL') v *= 3;
        else if (q === 'DW') mul *= 2;
        else if (q === 'TW') mul *= 3;
      }
      w += ch.toLowerCase();
      sum += v;
      cells.push(k);
      r += dr2;
      c += dc2;
    }
    return { word: w, score: sum * mul, cells };
  };
  const words: Array<{ word: string; score: number; cells: number[] }> = [];
  const main = word(a.r, a.c, dr, dc);
  if (main.word.length >= 2) words.push(main);
  for (const t of tiles) { const x = word(t.r, t.c, dc, dr); if (x.word.length >= 2) words.push(x); }
  if (!words.length) { res.why = 'short'; return res; }
  if (!first && !words.some((w) => w.cells.some((k) => board[k]))) { res.why = 'alone'; return res; }
  res.shape = true;
  res.all7 = tiles.length === 7;
  res.words = words.map((w) => ({ word: w.word, score: w.score, known: has ? has(w.word) : null, cells: w.cells }));
  res.score = words.reduce((n, w) => n + w.score, 0) + (res.all7 ? ALL7 : 0);
  res.ok = has ? res.words.every((w) => w.known) : true;
  if (has && !res.ok) res.why = 'word';
  return res;
}

/**
 * The dictionary: the same 111,199 words the page carries (packed so each word
 * spells only what differs from the one before it: a digit for the letters it
 * shares, then the rest), unpacked once on first use.
 */
let dictionary: Set<string> | null = null;
export function words(): Set<string> {
  if (dictionary) return dictionary;
  const FC = (packedWords as { packed: string }).packed;
  const out = new Set<string>();
  let prev = '';
  let i = 0;
  while (i < FC.length) {
    const k = FC.charCodeAt(i) - 48;
    i++;
    let j = i;
    while (j < FC.length) { const c = FC.charCodeAt(j); if (c >= 48 && c <= 57) break; j++; }
    const w = prev.slice(0, k) + FC.slice(i, j);
    out.add(w);
    prev = w;
    i = j;
  }
  dictionary = out;
  return out;
}
export const hasWord = (word: string): boolean => words().has(word);
