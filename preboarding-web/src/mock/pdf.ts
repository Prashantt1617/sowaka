/**
 * Dev-only: builds small text PDFs for the mock fixtures (offer letter, appointment
 * letter, NDA) so the PDF viewer has something real to render. ASCII only.
 */
export interface PdfLine {
  text: string;
  size?: number;
  bold?: boolean;
  /** Orange highlight (changed offer fields). */
  mark?: boolean;
  gap?: number;
}

const ascii = (s: string) =>
  s
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/·/g, '-')
    .replace(/—|–/g, '-')
    .replace(/₹/g, 'Rs ')
    .replace(/[^\x20-\x7E]/g, '');
const esc = (s: string) => ascii(s).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');

function wrap(text: string, size: number, width = 495): string[] {
  const max = Math.floor(width / (size * 0.5));
  const words = ascii(text).split(' ');
  const out: string[] = [];
  let cur = '';
  for (const w of words) {
    if ((cur + ' ' + w).trim().length > max) {
      out.push(cur.trim());
      cur = w;
    } else cur += ' ' + w;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

function pageStream(lines: PdfLine[], pageNo: number, pages: number, logo: string): string {
  const ops: string[] = [];
  // header band
  ops.push('0.020 0.443 0.651 rg 50 790 28 28 re f');
  ops.push(`BT /F2 12 Tf 0.133 0.133 0.133 rg 86 799 Td (${esc(logo)}) Tj ET`);
  ops.push('0.92 0.92 0.92 RG 0.8 w 50 775 m 545 775 l S');
  let y = 748;
  for (const l of lines) {
    const size = l.size ?? 11;
    const rows = wrap(l.text, size);
    for (const row of rows) {
      if (l.mark) {
        ops.push(`1 0.957 0.898 rg 46 ${y - 4} 503 ${size + 7} re f`);
        ops.push(`BT /${l.bold ? 'F2' : 'F1'} ${size} Tf 0.698 0.208 0 rg 50 ${y} Td (${esc(row)}) Tj ET`);
      } else {
        ops.push(`BT /${l.bold ? 'F2' : 'F1'} ${size} Tf 0.133 0.133 0.133 rg 50 ${y} Td (${esc(row)}) Tj ET`);
      }
      y -= size + 6;
    }
    y -= l.gap ?? 4;
  }
  ops.push(`BT /F1 9 Tf 0.443 0.443 0.443 rg 50 40 Td (Page ${pageNo} of ${pages}) Tj ET`);
  return ops.join('\n');
}

export function makePdf(pages: PdfLine[][], logo: string): ArrayBuffer {
  const objs: string[] = [];
  objs[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  const kids: string[] = [];
  objs[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>';
  objs[4] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>';
  pages.forEach((lines, i) => {
    const pageObj = 5 + i * 2;
    const contentObj = pageObj + 1;
    kids.push(`${pageObj} 0 R`);
    const stream = pageStream(lines, i + 1, pages.length, logo);
    objs[pageObj] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentObj} 0 R >>`;
    objs[contentObj] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
  });
  objs[2] = `<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${pages.length} >>`;

  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  for (let n = 1; n < objs.length; n++) {
    offsets[n] = out.length;
    out += `${n} 0 obj\n${objs[n]}\nendobj\n`;
  }
  const xref = out.length;
  out += `xref\n0 ${objs.length}\n0000000000 65535 f \n`;
  for (let n = 1; n < objs.length; n++) out += `${String(offsets[n]).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${objs.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  const bytes = new Uint8Array(out.length);
  for (let i = 0; i < out.length; i++) bytes[i] = out.charCodeAt(i) & 0xff;
  return bytes.buffer;
}
