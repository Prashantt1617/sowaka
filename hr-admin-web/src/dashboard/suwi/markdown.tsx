// The little markdown Suwi answers use: paragraphs, **bold**, bullet and
// numbered lists, pipe tables, and links. A link to emp:USER_ID opens that
// person's profile; http links open in a new tab. Rule lines (---) are
// dropped and LaTeX $$ markers stripped, should a model write them anyway.
import type { ReactNode } from 'react';

export function Markdown({ text, onPerson }: { text: string; onPerson: (userId: string) => void }) {
  const isHr = (l: string) => /^\s*([-*_])(\s*\1){2,}\s*$/.test(l);
  const lines = text.replace(/\r/g, '').replace(/\$\$/g, '').split('\n').filter((l) => !isHr(l));
  const out: ReactNode[] = [];
  let i = 0, key = 0;
  const inline = (s: string): ReactNode[] => {
    const parts: ReactNode[] = [];
    const re = /\*\*(.+?)\*\*|\[([^\]]+)\]\((emp:[^)\s]+|https?:[^)\s]+)\)|`([^`]+)`/g;
    let last = 0, m: RegExpExecArray | null;
    while ((m = re.exec(s))) {
      if (m.index > last) parts.push(s.slice(last, m.index));
      if (m[1] !== undefined) parts.push(<strong key={key++}>{m[1]}</strong>);
      else if (m[2] !== undefined) {
        const href = m[3];
        if (href.startsWith('emp:')) parts.push(<button key={key++} type="button" onClick={() => onPerson(href.slice(4))} style={{ background: 'none', border: 'none', padding: 0, color: 'var(--accent-ink)', fontWeight: 500, cursor: 'pointer', font: 'inherit' }}>{m[2]}</button>);
        else parts.push(<a key={key++} href={href} target="_blank" rel="noreferrer" style={{ color: 'var(--accent-ink)' }}>{m[2]}</a>);
      } else parts.push(<code key={key++} style={{ fontSize: '0.92em', background: 'var(--surface-2)', padding: '0 4px', borderRadius: 4 }}>{m[4]}</code>);
      last = m.index + m[0].length;
    }
    if (last < s.length) parts.push(s.slice(last));
    return parts;
  };
  const isRow = (l: string) => /^\s*\|.*\|\s*$/.test(l);
  const isSep = (l: string) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(l);
  const cells = (l: string) => l.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
  while (i < lines.length) {
    const l = lines[i];
    if (!l.trim()) { i++; continue; }
    if (isRow(l) && i + 1 < lines.length && isSep(lines[i + 1])) {
      const head = cells(l); i += 2;
      const rows: string[][] = [];
      while (i < lines.length && isRow(lines[i])) rows.push(cells(lines[i++]));
      out.push(
        <div key={key++} style={{ overflowX: 'auto', margin: '6px 0' }}>
          <table style={{ borderCollapse: 'collapse', fontSize: 12.5, width: '100%' }}>
            <thead><tr>{head.map((h, j) => <th key={j} style={{ textAlign: 'left', padding: '6px 8px', borderBottom: '1px solid var(--line)', color: 'var(--ink-3)', fontWeight: 500, fontSize: 11.5, whiteSpace: 'nowrap' }}>{inline(h)}</th>)}</tr></thead>
            <tbody>{rows.map((r, ri) => <tr key={ri}>{r.map((c, j) => <td key={j} style={{ padding: '6px 8px', borderBottom: '1px solid var(--line)', verticalAlign: 'top' }}>{inline(c)}</td>)}</tr>)}</tbody>
          </table>
        </div>,
      );
      continue;
    }
    if (/^\s*([-*•]|\d+[.)])\s+/.test(l)) {
      const ordered = /^\s*\d+[.)]\s+/.test(l);
      const items: string[] = [];
      while (i < lines.length && /^\s*([-*•]|\d+[.)])\s+/.test(lines[i])) items.push(lines[i++].replace(/^\s*([-*•]|\d+[.)])\s+/, ''));
      const Tag = ordered ? 'ol' : 'ul';
      out.push(<Tag key={key++} style={{ margin: '4px 0', paddingLeft: 20, display: 'grid', gap: 3 }}>{items.map((it, j) => <li key={j}>{inline(it)}</li>)}</Tag>);
      continue;
    }
    if (/^#{1,3}\s/.test(l)) { out.push(<div key={key++} style={{ fontWeight: 600, marginTop: 6 }}>{inline(l.replace(/^#{1,3}\s/, ''))}</div>); i++; continue; }
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !isRow(lines[i]) && !/^\s*([-*•]|\d+[.)])\s+/.test(lines[i]) && !/^#{1,3}\s/.test(lines[i])) para.push(lines[i++]);
    out.push(<p key={key++} style={{ margin: '4px 0' }}>{inline(para.join(' '))}</p>);
  }
  return <div style={{ lineHeight: 1.55 }}>{out}</div>;
}
