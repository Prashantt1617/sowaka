// Client-side CSV export. Builds a CSV blob from column defs + rows and triggers
// a download. Used by the Leaves / Overtime / Reimbursement / Feedback views.

export type Column<T> = { header: string; value: (row: T) => string | number };

function escapeCell(input: string | number): string {
  const s = String(input ?? '');
  // Quote if the cell contains a comma, quote, or newline; double up quotes.
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv<T>(columns: Column<T>[], rows: T[]): string {
  const head = columns.map((c) => escapeCell(c.header)).join(',');
  const body = rows
    .map((r) => columns.map((c) => escapeCell(c.value(r))).join(','))
    .join('\n');
  return `${head}\n${body}`;
}

/**
 * One CSV made of several labelled blocks, sharing a column set.
 *
 * Used where a single file has to carry two groups that must not be conflated
 * — this cycle's assignments and next cycle's — with a heading row between
 * them so the reader can tell which is which.
 */
export function toSectionedCsv<T>(
  columns: Column<T>[],
  sections: { heading?: string; rows: T[] }[],
): string {
  const head = columns.map((c) => escapeCell(c.header)).join(',');
  const blank = ','.repeat(Math.max(0, columns.length - 1));
  const blocks = sections
    .filter((section) => section.rows.length > 0)
    .map((section) => {
      const body = section.rows
        .map((r) => columns.map((c) => escapeCell(c.value(r))).join(','))
        .join('\n');
      // The heading sits in the first cell; the rest are padded so the row
      // still has the right shape for a spreadsheet.
      return section.heading
        ? `${blank}\n${escapeCell(section.heading)}${blank}\n${body}`
        : body;
    });
  return [head, ...blocks].join('\n');
}

export function downloadCsvSections<T>(
  filename: string,
  columns: Column<T>[],
  sections: { heading?: string; rows: T[] }[],
): void {
  download(filename, toSectionedCsv(columns, sections));
}

export function downloadCsv<T>(filename: string, columns: Column<T>[], rows: T[]): void {
  download(filename, toCsv(columns, rows));
}

function download(filename: string, csv: string): void {
  // Prepend BOM so Excel opens UTF-8 (₹ etc.) correctly.
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.endsWith('.csv') ? filename : `${filename}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
