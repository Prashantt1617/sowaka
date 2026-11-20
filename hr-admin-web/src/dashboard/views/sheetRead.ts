// Reading an uploaded sheet the way every dashboard import does (People › Import,
// Time office › Leave balances): the header row and sheet are found, cells come
// back as text, each row with its row number in the sheet.
import type { WorkBook } from 'xlsx';

/** A cell as text: dates as YYYY-MM-DD (read in the sheet's own day), everything else as written. */
export const cellText = (v: unknown): string => {
  if (v instanceof Date && !Number.isNaN(v.valueOf())) return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}`;
  return v === null || v === undefined ? '' : String(v).trim();
};
/** A header as compared: lower case, words only, brackets dropped — as the server compares it. */
export const keyOf = (s: unknown) => String(s ?? '').toLowerCase().replace(/\([^)]*\)/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim();

/**
 * Finds the header: of every sheet's first 30 rows, the row naming the most
 * columns Import knows (first sheet wins a tie). The rows under it become
 * objects keyed by its cells, each with its row number in the sheet.
 */
export function readWorkbook(XLSX: typeof import('xlsx'), wb: WorkBook, names: string[], only?: string) {
  const known = (c: unknown) => { const k = keyOf(c); return k !== '' && names.some((n) => k === n || k.startsWith(`${n} `)); };
  let best = { score: 0, sheet: wb.SheetNames[0], at: 0, aoa: [] as unknown[][] };
  wb.SheetNames.forEach((n, si) => {
    if (only && n !== only) return;
    const aoa = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[n], { header: 1, defval: '', raw: true, blankrows: true });
    if ((si === 0 || n === only) && best.aoa.length === 0) best = { ...best, sheet: n, aoa };
    for (let i = 0; i < Math.min(aoa.length, 30); i++) {
      const score = aoa[i].filter(known).length;
      if (score > best.score) best = { score, sheet: n, at: i, aoa };
    }
  });
  const seen = new Map<string, number>();
  const header = (best.aoa[best.at] ?? []).map((c, j) => {
    const h = cellText(c) || `Column ${j + 1}`;
    const n = (seen.get(h) ?? 0) + 1; seen.set(h, n);
    return n > 1 ? `${h} (${n})` : h;
  });
  const rows = best.aoa.slice(best.at + 1)
    .map((r, i) => ({ __row: String(best.at + i + 2), ...Object.fromEntries(header.map((h, j) => [h, cellText(r[j])])) }))
    .filter((r) => Object.entries(r).some(([k, v]) => k !== '__row' && v !== ''));
  return { sheet: best.sheet, sheets: wb.SheetNames.length, headerRow: best.at + 1, rows };
}
