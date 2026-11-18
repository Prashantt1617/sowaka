// The old UI's pager ("Showing 1–10 of 42 · ← Prev 1 2 3 Next →"), shared by the Time office tables.
import { useEffect, useState } from 'react';
import './people.css';

export const PAGE_SIZE = 10;

export type Paged<T> = { rows: T[]; page: number; setPage: (p: number) => void; count: number; first: number; last: number; total: number };

/** One page of `rows`. Back to page 1 when `resetKey` changes (a filter, a tab, a day). */
export function usePaged<T>(rows: T[], resetKey: unknown, size = PAGE_SIZE): Paged<T> {
  const [page, setPage] = useState(1);
  useEffect(() => { setPage(1); }, [resetKey]);
  const count = Math.max(1, Math.ceil(rows.length / size));
  const cur = Math.min(page, count);
  const slice = rows.slice((cur - 1) * size, cur * size);
  return { rows: slice, page: cur, setPage, count, first: rows.length ? (cur - 1) * size + 1 : 0, last: (cur - 1) * size + slice.length, total: rows.length };
}

/** Page numbers to show: all of them when few, else the ends and the pages around this one. */
function pagesFor(cur: number, count: number): (number | '…')[] {
  if (count <= 7) return Array.from({ length: count }, (_, i) => i + 1);
  const keep = new Set([1, count, cur - 1, cur, cur + 1].filter((p) => p >= 1 && p <= count));
  const out: (number | '…')[] = [];
  let prev = 0;
  for (const p of [...keep].sort((a, b) => a - b)) {
    if (p - prev > 1) out.push('…');
    out.push(p);
    prev = p;
  }
  return out;
}

export function Pager<T>({ p }: { p: Paged<T> }) {
  if (p.total <= PAGE_SIZE) return null;
  return (
    <div className="pd-pager" style={{ padding: '0 4px' }}>
      <div>Showing {p.first}–{p.last} of {p.total}</div>
      <div className="pages">
        <button type="button" onClick={() => p.setPage(p.page - 1)} disabled={p.page === 1}>← Prev</button>
        {pagesFor(p.page, p.count).map((n, i) => (n === '…'
          ? <span key={`gap-${i}`} style={{ padding: '0 4px' }}>…</span>
          : <button key={n} type="button" onClick={() => p.setPage(n)} className={n === p.page ? 'on' : undefined} aria-current={n === p.page ? 'page' : undefined}>{n}</button>))}
        <button type="button" onClick={() => p.setPage(p.page + 1)} disabled={p.page === p.count}>Next →</button>
      </div>
    </div>
  );
}
