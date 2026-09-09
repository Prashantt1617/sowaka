import { inflateRawSync } from 'node:zlib';
import { ObjectId } from 'mongodb';
import { holidays, users } from '../config/db';
import { Holiday, HolidayType } from '../models/holiday.model';

/** The location value meaning "everyone", whatever their work location. */
export const ALL_LOCATIONS = '*';
const HOLIDAY_TYPES: HolidayType[] = ['Public', 'Restricted', 'Optional'];

export interface HolidayView {
  id: string;
  org: string;
  state: string;
  type: HolidayType;
  date: string;
  name: string;
}

export interface HolidayBulkUploadResult {
  state: string;
  created: number;
  updated: number;
  skipped: number;
  errors: Array<{ row: number; message: string }>;
  holidays: HolidayView[];
}

type HolidayImportRow = {
  row: number;
  date: string;
  name: string;
};

export async function listCompanyHolidays(
  userId: string,
  input: { state?: string } = {},
): Promise<HolidayView[]> {
  const user = await users().findOne({ userId });
  if (!user) throw new HolidayError(404, 'User not found');
  const org = user.org ?? 'default';
  const requested = input.state?.trim();
  // The dashboard's holiday master asks for every location at once with `*`;
  // an employee's app asks for their own and gets the all-locations days too.
  if (requested === '*') {
    const all = await holidays().find({ org }).sort({ date: 1 }).toArray();
    return all.map(toHolidayView);
  }
  const keys = requested ? [requested.toLowerCase()] : locationKeysFor(user);
  if (!keys.length) throw new HolidayError(400, 'A work location is required');
  const documents = await holidays()
    .find({ org, $or: [{ state: { $in: keys } }, { state: ALL_LOCATIONS }] })
    .sort({ date: 1 })
    .toArray();
  return documents.map(toHolidayView);
}

export async function createCompanyHoliday(
  userId: string,
  input: { date: string; name: string; state: string; org?: string; type?: string },
): Promise<HolidayView> {
  const user = await users().findOne({ userId });
  if (!user) throw new HolidayError(404, 'User not found');
  const org = input.org?.trim() || user.org || 'default';
  const state = normalizeState(input.state);
  const date = parseDateOnly(input.date, 'date');
  const name = normalizeHolidayName(input.name);

  const now = Date.now();
  const type = (input.type ?? 'Public').trim() as HolidayType;
  if (!HOLIDAY_TYPES.includes(type)) {
    throw new HolidayError(400, `Type must be one of: ${HOLIDAY_TYPES.join(', ')}`);
  }
  const document: Holiday = {
    org,
    state,
    type,
    date,
    name,
    createdByUserId: userId,
    createdAt: now,
    updatedAt: new Date(now),
  };
  try {
    const result = await holidays().insertOne(document);
    return toHolidayView({ ...document, _id: result.insertedId });
  } catch (error) {
    if (isDuplicateKey(error)) {
      throw new HolidayError(409, 'A holiday already exists for this state and date');
    }
    throw error;
  }
}

export async function bulkUploadCompanyHolidays(
  userId: string,
  input: { state: string; org?: string; fileName: string; bytes: Buffer },
): Promise<HolidayBulkUploadResult> {
  const user = await users().findOne({ userId });
  if (!user) throw new HolidayError(404, 'User not found');
  const org = input.org?.trim() || user.org || 'default';
  const state = normalizeState(input.state);
  const rows = parseHolidayFile(input.fileName, input.bytes);
  if (rows.length === 0) throw new HolidayError(400, 'Holiday upload has no rows');

  let created = 0;
  let updated = 0;
  let skipped = 0;
  const errors: Array<{ row: number; message: string }> = [];
  const changedIds: ObjectId[] = [];

  for (const row of rows) {
    try {
      const date = parseDateOnly(row.date, 'date');
      const name = normalizeHolidayName(row.name);
      const now = Date.now();
      const existing = await holidays().findOne({ org, state, date }, { projection: { _id: 1 } });
      const result = await holidays().updateOne(
        { org, state, date },
        {
          $set: { name, updatedAt: new Date(now) },
          $setOnInsert: { org, state, date, createdByUserId: userId, createdAt: now },
        },
        { upsert: true },
      );
      const id = existing?._id ?? result.upsertedId;
      if (id) changedIds.push(id);
      if (result.upsertedCount > 0) {
        created += 1;
      } else if (result.matchedCount > 0) {
        updated += 1;
      }
    } catch (error) {
      skipped += 1;
      errors.push({
        row: row.row,
        message: error instanceof HolidayError ? error.message : 'Row could not be imported',
      });
    }
  }

  const imported = changedIds.length
    ? await holidays().find({ _id: { $in: changedIds } }).sort({ date: 1 }).toArray()
    : [];
  return {
    state,
    created,
    updated,
    skipped,
    errors,
    holidays: imported.map(toHolidayView),
  };
}

export async function deleteCompanyHoliday(userId: string, holidayIdInput: string): Promise<void> {
  if (!ObjectId.isValid(holidayIdInput)) throw new HolidayError(400, 'Invalid holiday ID');
  const user = await users().findOne({ userId });
  if (!user) throw new HolidayError(404, 'User not found');
  const result = await holidays().deleteOne({
    _id: new ObjectId(holidayIdInput),
    org: user.org ?? 'default',
  });
  if (result.deletedCount === 0) throw new HolidayError(404, 'Holiday not found');
}

function parseHolidayFile(fileName: string, bytes: Buffer): HolidayImportRow[] {
  const lowerName = fileName.toLowerCase();
  if (lowerName.endsWith('.csv')) return rowsFromTable(parseCsv(bytes.toString('utf8')));
  if (lowerName.endsWith('.xlsx')) return rowsFromTable(parseXlsx(bytes));
  throw new HolidayError(400, 'Holiday upload must be a CSV or XLSX file');
}

function rowsFromTable(table: string[][]): HolidayImportRow[] {
  const nonEmptyRows = table.filter((row) => row.some((cell) => cell.trim().length > 0));
  if (nonEmptyRows.length === 0) return [];
  const first = nonEmptyRows[0].map(normalizeHeader);
  const dateIndex = findHeaderIndex(first, ['date', 'holidaydate']);
  const nameIndex = findHeaderIndex(first, ['name', 'holiday', 'holidayname', 'title']);
  const hasHeader = dateIndex >= 0 || nameIndex >= 0;
  const resolvedDateIndex = dateIndex >= 0 ? dateIndex : 0;
  const resolvedNameIndex = nameIndex >= 0 ? nameIndex : 1;
  const start = hasHeader ? 1 : 0;
  return nonEmptyRows.slice(start).map((row, index) => ({
    row: index + start + 1,
    date: row[resolvedDateIndex]?.trim() ?? '',
    name: row[resolvedNameIndex]?.trim() ?? '',
  }));
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

function parseXlsx(bytes: Buffer): string[][] {
  const files = unzip(bytes);
  const workbookXml = readZipText(files, 'xl/workbook.xml');
  const relsXml = readZipText(files, 'xl/_rels/workbook.xml.rels');
  const sharedStringsXml = files.get('xl/sharedStrings.xml')?.toString('utf8') ?? '';
  const sharedStrings = parseSharedStrings(sharedStringsXml);
  const sheetPath = firstWorksheetPath(workbookXml, relsXml);
  const sheetXml = readZipText(files, sheetPath);
  return parseWorksheet(sheetXml, sharedStrings);
}

function unzip(bytes: Buffer): Map<string, Buffer> {
  const files = new Map<string, Buffer>();
  const eocdOffset = bytes.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocdOffset < 0) throw new HolidayError(400, 'XLSX file is invalid');
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
  if (!value) throw new HolidayError(400, 'XLSX file is missing worksheet data');
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
    decodeXml(stripTags([...match[1].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((part) => part[1]).join(''))),
  );
}

function parseWorksheet(xml: string, sharedStrings: string[]): string[][] {
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
      row[index] = cellValue(type, rawValue, sharedStrings);
    }
    return row.map((value) => value ?? '');
  });
}

function cellValue(type: string | undefined, rawValue: string, sharedStrings: string[]) {
  const value = decodeXml(rawValue.trim());
  if (type === 's') return sharedStrings[Number(value)] ?? '';
  if (type === 'inlineStr' || type === 'str') return value;
  if (/^\d+(\.\d+)?$/.test(value)) {
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

function parseDateOnly(value: string, field: string): Date {
  const normalized = normalizeDateInput(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    throw new HolidayError(400, `${field} must use YYYY-MM-DD format`);
  }
  const date = new Date(`${normalized}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== normalized) {
    throw new HolidayError(400, `${field} is not a valid date`);
  }
  return date;
}

function normalizeDateInput(value: string) {
  const text = value.trim();
  const slash = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (slash) {
    const day = slash[1].padStart(2, '0');
    const month = slash[2].padStart(2, '0');
    return `${slash[3]}-${month}-${day}`;
  }
  return text;
}

function normalizeHolidayName(value: string) {
  const name = value.trim();
  if (name.length < 2) throw new HolidayError(400, 'Holiday name is required');
  if (name.length > 120) throw new HolidayError(400, 'Holiday name cannot exceed 120 characters');
  return name;
}

function normalizeState(value: string) {
  const state = value.trim();
  // The all-locations marker is the one value shorter than two characters.
  if (state === ALL_LOCATIONS) return ALL_LOCATIONS;
  if (state.length < 2) throw new HolidayError(400, 'State is required');
  if (state.length > 80) throw new HolidayError(400, 'State cannot exceed 80 characters');
  return state.toLowerCase();
}

/**
 * The holidays one employee actually observes: the ones targeted at their work
 * location, plus the all-locations days. A holiday in another office is not a
 * day off here, so it must not reach their calendar or their leave count.
 */
export async function holidaysForUser(
  user: { org?: string; state?: string; location?: string; branch?: string },
  range?: { from: Date; to: Date },
) {
  if (!user.org) return [];
  const filter: Record<string, unknown> = {
    org: user.org,
    $or: [{ state: { $in: locationKeysFor(user) } }, { state: ALL_LOCATIONS }],
  };
  if (range) filter.date = { $gte: range.from, $lte: range.to };
  return holidays().find(filter).sort({ date: 1 }).toArray();
}

/** The same, as a set of `YYYY-MM-DD` keys. */
export async function holidayDatesForUser(
  user: { org?: string; state?: string; location?: string; branch?: string },
  range?: { from: Date; to: Date },
): Promise<Set<string>> {
  const rows = await holidaysForUser(user, range);
  return new Set(rows.map((row) => row.date.toISOString().slice(0, 10)));
}

/**
 * Every value a holiday for this employee might be keyed by. Rows written
 * before holidays moved to work location may still carry a state or a branch,
 * so all three are matched rather than only the winner.
 */
function locationKeysFor(user: { state?: string; location?: string; branch?: string }): string[] {
  return [...new Set(
    [user.location, user.state, user.branch]
      .map((value) => (value ?? '').trim().toLowerCase())
      .filter(Boolean),
  )];
}

function normalizeHeader(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function findHeaderIndex(headers: string[], names: string[]) {
  return headers.findIndex((header) => names.includes(header));
}

function toHolidayView(holiday: Holiday & { _id: ObjectId }): HolidayView {
  return {
    id: holiday._id.toHexString(),
    org: holiday.org,
    state: holiday.state,
    type: holiday.type ?? 'Public',
    date: holiday.date.toISOString().slice(0, 10),
    name: holiday.name,
  };
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

function isDuplicateKey(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: number }).code === 11000
  );
}

export class HolidayError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
  ) {
    super(message);
  }
}
