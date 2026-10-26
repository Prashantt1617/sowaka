// A file HR attaches to a question for Suwi: an image (PNG or JPEG) sent as
// it is, or a spreadsheet (XLSX, XLS or CSV) read here into CSV text, one
// block per sheet, so the server only ever receives rows. One per message.
import type { SuwiAttachment } from '../../services/suwi';

export const MAX_ATTACH_BYTES = 5 * 1024 * 1024;
/** What the server accepts of a spreadsheet's text. */
const MAX_TABLE_CHARS = 150_000;
const MAX_SHEETS = 5;

export const ATTACH_ACCEPT = '.png,.jpg,.jpeg,.xlsx,.xls,.csv,image/png,image/jpeg';
export const WRONG_TYPE = 'Only images and Excel files can be attached.';

/** What the thread shows of a file: a thumbnail for an image, a card for a sheet. */
export interface ShownFile {
  kind: 'image' | 'sheet';
  name: string;
  size: number;
  /** An object URL for an image's thumbnail and full-size view. */
  url?: string;
}

export interface Attached {
  send: SuwiAttachment;
  shown: ShownFile;
}

export class AttachError extends Error {}

const extOf = (name: string) => (name.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? '');

export function fileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const base64Of = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).replace(/^data:[^,]*,/, ''));
    reader.onerror = () => reject(new AttachError('Could not read that file. Try again.'));
    reader.readAsDataURL(file);
  });

/** Checks a picked file and makes it ready to send, or throws an AttachError saying why not. */
export async function readAttachment(file: File): Promise<Attached> {
  const ext = extOf(file.name);
  const image = ext === 'png' || ext === 'jpg' || ext === 'jpeg';
  const sheet = ext === 'xlsx' || ext === 'xls' || ext === 'csv';
  if (!image && !sheet) throw new AttachError(WRONG_TYPE);
  if (file.size > MAX_ATTACH_BYTES) throw new AttachError(`That file is too large. Attach one under ${fileSize(MAX_ATTACH_BYTES)}.`);
  if (file.size === 0) throw new AttachError('That file is empty.');
  if (image) {
    const mimeType = ext === 'png' ? 'image/png' : 'image/jpeg';
    return {
      send: { kind: 'image', name: file.name, mimeType, data: await base64Of(file) },
      shown: { kind: 'image', name: file.name, size: file.size, url: URL.createObjectURL(file) },
    };
  }
  let text: string;
  if (ext === 'csv') {
    text = (await file.text()).trim();
  } else {
    // The library only when someone attaches a workbook.
    const XLSX = await import('xlsx');
    let book;
    try {
      book = XLSX.read(await file.arrayBuffer(), { type: 'array' });
    } catch {
      throw new AttachError('Could not read that spreadsheet. Save it as XLSX or CSV and try again.');
    }
    const blocks = book.SheetNames.slice(0, MAX_SHEETS)
      .map((sheetName) => ({ sheetName, csv: XLSX.utils.sheet_to_csv(book.Sheets[sheetName], { blankrows: false }).trim() }))
      .filter((b) => b.csv);
    text = blocks.length === 1 ? blocks[0].csv : blocks.map((b) => `--- Sheet: ${b.sheetName} ---\n${b.csv}`).join('\n\n');
  }
  if (!text) throw new AttachError('That spreadsheet looks empty.');
  if (text.length > MAX_TABLE_CHARS) throw new AttachError('That spreadsheet is too large. Attach one with fewer rows.');
  return { send: { kind: 'table', name: file.name, text }, shown: { kind: 'sheet', name: file.name, size: file.size } };
}
