import { inflateRawSync } from 'node:zlib';

export class SpreadsheetError extends Error {
  constructor(public statusCode: number, message: string) {
    super(message);
  }
}

export interface SpreadsheetOptions {
  /**
   * Excel stores dates as day counts, indistinguishable from any other number.
   * A holiday sheet wants them read back as dates; a roster does not, or an
   * employee code in the same numeric range silently becomes a date.
   */
  coerceSerialDates?: boolean;
}

/** A CSV or XLSX upload, read as rows of trimmed-as-written cell text. */
export function parseSpreadsheet(
  fileName: string,
  bytes: Buffer,
  options: SpreadsheetOptions = {},
): string[][] {
  const lowerName = fileName.toLowerCase();
  if (lowerName.endsWith('.csv')) return parseCsv(bytes.toString('utf8'));
  if (lowerName.endsWith('.xlsx')) return parseXlsx(bytes, options);
  throw new SpreadsheetError(400, 'Upload must be a CSV or XLSX file');
}

/** Rows with at least one non-empty cell, so trailing blank lines don't count. */
export function meaningfulRows(table: string[][]): string[][] {
  return table.filter((row) => row.some((cell) => cell.trim().length > 0));
}

export function normalizeHeader(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function findHeaderIndex(headers: string[], names: string[]) {
  return headers.findIndex((header) => names.includes(header));
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (quoted) {
      if (char === '"' && next === '"') {
        cell += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        cell += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      row.push(cell);
      cell = '';
    } else if (char === '\n') {
      row.push(cell.replace(/\r$/, ''));
      rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += char;
    }
  }
  row.push(cell.replace(/\r$/, ''));
  rows.push(row);
  return rows;
}

function parseXlsx(bytes: Buffer, options: SpreadsheetOptions): string[][] {
  const files = unzip(bytes);
  const workbookXml = readZipText(files, 'xl/workbook.xml');
  const relsXml = readZipText(files, 'xl/_rels/workbook.xml.rels');
  const sharedStringsXml = files.get('xl/sharedStrings.xml')?.toString('utf8') ?? '';
  const sharedStrings = parseSharedStrings(sharedStringsXml);
  const sheetPath = firstWorksheetPath(workbookXml, relsXml);
  const sheetXml = readZipText(files, sheetPath);
  return parseWorksheet(sheetXml, sharedStrings, options);
}

function unzip(bytes: Buffer): Map<string, Buffer> {
  const files = new Map<string, Buffer>();
  const eocdOffset = bytes.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocdOffset < 0) throw new SpreadsheetError(400, 'XLSX file is invalid');
  const centralDirectoryOffset = bytes.readUInt32LE(eocdOffset + 16);
  let offset = centralDirectoryOffset;
  while (offset < eocdOffset && bytes.readUInt32LE(offset) === 0x02014b50) {
    const compression = bytes.readUInt16LE(offset + 10);
    const compressedSize = bytes.readUInt32LE(offset + 20);
    const fileNameLength = bytes.readUInt16LE(offset + 28);
    const extraLength = bytes.readUInt16LE(offset + 30);
    const commentLength = bytes.readUInt16LE(offset + 32);
    const localHeaderOffset = bytes.readUInt32LE(offset + 42);
    const fileName = bytes.subarray(offset + 46, offset + 46 + fileNameLength).toString('utf8');
    const localNameLength = bytes.readUInt16LE(localHeaderOffset + 26);
    const localExtraLength = bytes.readUInt16LE(localHeaderOffset + 28);
    const dataOffset = localHeaderOffset + 30 + localNameLength + localExtraLength;
    const compressed = bytes.subarray(dataOffset, dataOffset + compressedSize);
    if (!fileName.endsWith('/')) {
      if (compression === 0) {
        files.set(fileName, compressed);
      } else if (compression === 8) {
        files.set(fileName, inflateRawSync(compressed));
      }
    }
    offset += 46 + fileNameLength + extraLength + commentLength;
  }
  return files;
}

function readZipText(files: Map<string, Buffer>, path: string): string {
  const value = files.get(path);
  if (!value) throw new SpreadsheetError(400, 'XLSX file is missing worksheet data');
  return value.toString('utf8');
}

function firstWorksheetPath(workbookXml: string, relsXml: string): string {
  const sheetMatch = workbookXml.match(/<sheet\b[^>]*\br:id="([^"]+)"/);
  if (!sheetMatch) return 'xl/worksheets/sheet1.xml';
  const relId = sheetMatch[1];
  const relPattern = new RegExp(`<Relationship\\b[^>]*\\bId="${escapeRegExp(relId)}"[^>]*>`, 'i');
  const relMatch = relsXml.match(relPattern);
  const targetMatch = relMatch?.[0].match(/\bTarget="([^"]+)"/i);
  const target = targetMatch?.[1] ?? 'worksheets/sheet1.xml';
  return target.startsWith('/') ? target.slice(1) : `xl/${target}`;
}

function parseSharedStrings(xml: string): string[] {
  return [...xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)].map((match) =>
    decodeXml(
      stripTags([...match[1].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((part) => part[1]).join('')),
    ),
  );
}

function parseWorksheet(
  xml: string,
  sharedStrings: string[],
  options: SpreadsheetOptions,
): string[][] {
  return [...xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)].map((rowMatch) => {
    const row: string[] = [];
    for (const cellMatch of rowMatch[1].matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)) {
      const attrs = cellMatch[1];
      const body = cellMatch[2];
      const ref = attrs.match(/\br="([A-Z]+)\d+"/)?.[1];
      const index = ref ? columnIndex(ref) : row.length;
      const type = attrs.match(/\bt="([^"]+)"/)?.[1];
      const rawValue =
        body.match(/<v>([\s\S]*?)<\/v>/)?.[1] ??
        body.match(/<t\b[^>]*>([\s\S]*?)<\/t>/)?.[1] ??
        '';
      row[index] = cellValue(type, rawValue, sharedStrings, options);
    }
    return row.map((value) => value ?? '');
  });
}

function cellValue(
  type: string | undefined,
  rawValue: string,
  sharedStrings: string[],
  options: SpreadsheetOptions,
) {
  const value = decodeXml(rawValue.trim());
  if (type === 's') return sharedStrings[Number(value)] ?? '';
  if (type === 'inlineStr' || type === 'str') return value;
  if (options.coerceSerialDates && /^\d+(\.\d+)?$/.test(value)) {
    const serial = Number(value);
    if (serial > 20_000 && serial < 80_000) return excelSerialDate(serial);
  }
  return value;
}

function excelSerialDate(serial: number) {
  const epoch = Date.UTC(1899, 11, 30);
  return new Date(epoch + Math.round(serial) * 86_400_000).toISOString().slice(0, 10);
}

function columnIndex(column: string) {
  return column.split('').reduce((total, char) => total * 26 + char.charCodeAt(0) - 64, 0) - 1;
}

function decodeXml(value: string) {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function stripTags(value: string) {
  return value.replace(/<[^>]+>/g, '');
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
