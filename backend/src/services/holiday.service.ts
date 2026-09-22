import { ObjectId } from 'mongodb';
import { holidays, users } from '../config/db';
import { Holiday, HolidayType } from '../models/holiday.model';
import {
  findHeaderIndex,
  meaningfulRows,
  normalizeHeader,
  parseSpreadsheet,
} from '../utils/spreadsheet';

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
  if (!lowerName.endsWith('.csv') && !lowerName.endsWith('.xlsx')) {
    throw new HolidayError(400, 'Holiday upload must be a CSV or XLSX file');
  }
  // Dates are the point of this sheet, so Excel's day-count cells are read back as dates.
  return rowsFromTable(parseSpreadsheet(fileName, bytes, { coerceSerialDates: true }));
}

function rowsFromTable(table: string[][]): HolidayImportRow[] {
  const nonEmptyRows = meaningfulRows(table);
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
