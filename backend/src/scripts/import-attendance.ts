/**
 * Imports directional ESSL punch rows from SQL Server into daily MongoDB
 * attendance records. Connection details and source identifiers are configured
 * with environment variables; see backend/.env.example.
 */
import { createHash } from 'node:crypto';
import { closeDb, connectDb, getDb, users } from '../config/db';

type PunchRow = {
  source_id: number;
  scan_watermark: number;
  employee_id: string;
  work_date: string;
  log_time: string;
  direction: string;
};

type DailyPunches = {
  employeeId: string;
  workDate: string;
  punchIn?: Date;
  punchOut?: Date;
};

const table = identifier(process.env.ATTENDANCE_SQL_TABLE ?? 'dbo.Essl_Data');
const idColumn = identifier(process.env.ATTENDANCE_SQL_ID_COLUMN ?? 'Sno');
const employeeColumn = identifier(process.env.ATTENDANCE_SQL_EMPLOYEE_COLUMN ?? 'Emp_Code');
const dateColumn = identifier(process.env.ATTENDANCE_SQL_DATE_COLUMN ?? 'Log_Date');
const timeColumn = identifier(process.env.ATTENDANCE_SQL_TIME_COLUMN ?? 'Log_Time');
const directionColumn = identifier(process.env.ATTENDANCE_SQL_DIRECTION_COLUMN ?? 'Direction');
const timezone = timezoneOffset(process.env.ATTENDANCE_SQL_TIMEZONE ?? '+05:30');
const batchSize = positiveInt(process.env.ATTENDANCE_IMPORT_BATCH_SIZE ?? '500');
const stateKey = `mssql:${table}`;

async function main() {
  await connectDb();

  const stateCollection = getDb().collection<{ key: string; lastSourceId: number }>(
    'attendance_import_state',
  );
  const previousState = await stateCollection.findOne({ key: stateKey });
  const lastSourceId = nonNegativeInt(
    process.env.ATTENDANCE_IMPORT_AFTER_ID ?? String(previousState?.lastSourceId ?? 0),
  );
  const fromDate = optionalIsoDate(process.env.ATTENDANCE_IMPORT_FROM);
  const rows = await readPunches(lastSourceId, fromDate);

  if (rows.length === 0) {
    console.log(`Attendance import complete: no punches found after Sno ${lastSourceId}.`);
    return;
  }

  const days = groupPunches(rows);
  const employeeIds = [...new Set(days.map((day) => day.employeeId))];
  const userRows = await users()
    .find({ employeeId: { $in: employeeIds } })
    .project({ employeeId: 1, userId: 1 })
    .toArray();
  const userByEmployee = new Map(userRows.map((item) => [item.employeeId, item.userId]));
  const collection = getDb().collection('attendance_records');
  let imported = 0;

  for (let offset = 0; offset < days.length; offset += batchSize) {
    const operations = days.slice(offset, offset + batchSize).map((day) => {
      const sourceKey = createHash('sha256')
        .update(`mssql|${table}|${day.employeeId}|${day.workDate}`)
        .digest('hex');
      const now = new Date();
      const set: Record<string, unknown> = {
        employeeId: day.employeeId,
        userId: userByEmployee.get(day.employeeId),
        workDate: day.workDate,
        source: 'sql_import',
        sourceKey,
        importedAt: now,
        updatedAt: now,
      };
      const min: Record<string, Date> = {};
      const max: Record<string, Date> = {};
      if (day.punchIn) min.punchIn = day.punchIn;
      if (day.punchOut) max.punchOut = day.punchOut;

      return {
        updateOne: {
          filter: { sourceKey },
          update: { $set: set, ...(day.punchIn ? { $min: min } : {}), ...(day.punchOut ? { $max: max } : {}) },
          upsert: true,
        },
      };
    });
    await collection.bulkWrite(operations, { ordered: false });
    imported += operations.length;
  }

  const newestSourceId = Math.max(...rows.map((row) => row.scan_watermark));
  await stateCollection.updateOne(
    { key: stateKey },
    { $set: { lastSourceId: newestSourceId, updatedAt: new Date() } },
    { upsert: true },
  );
  console.log(
    `Attendance import complete: ${rows.length} punch(es) merged into ${imported} day(s); watermark Sno ${newestSourceId}.`,
  );
}

async function readPunches(lastSourceId: number, fromDate?: string): Promise<PunchRow[]> {
  const fromClause = fromDate ? ` AND ${quote(dateColumn)} >= @fromDate` : '';
  const sql = `
    WITH deduplicated AS (
      SELECT
        ${quote(idColumn)} AS source_id,
        MAX(${quote(idColumn)}) OVER () AS scan_watermark,
        LTRIM(RTRIM(${quote(employeeColumn)})) AS employee_id,
        CONVERT(char(10), ${quote(dateColumn)}, 23) AS work_date,
        CONVERT(varchar(16), ${quote(timeColumn)}, 114) AS log_time,
        LOWER(LTRIM(RTRIM(${quote(directionColumn)}))) AS direction,
        ROW_NUMBER() OVER (
          PARTITION BY ${quote(employeeColumn)}, ${quote(dateColumn)}, ${quote(timeColumn)}, LOWER(LTRIM(RTRIM(${quote(directionColumn)})))
          ORDER BY ${quote(idColumn)} ASC
        ) AS duplicate_number
      FROM ${quotePath(table)}
      WHERE ${quote(idColumn)} > @lastSourceId${fromClause}
    )
    SELECT source_id, scan_watermark, employee_id, work_date, log_time, direction
    FROM deduplicated
    WHERE duplicate_number = 1
    ORDER BY source_id ASC;
  `;
  const mssql = await import('mssql');
  const pool = process.env.ATTENDANCE_SQL_URL?.trim()
    ? await mssql.connect(process.env.ATTENDANCE_SQL_URL)
    : await mssql.connect({
        server: required('ATTENDANCE_SQL_SERVER'),
        database: process.env.ATTENDANCE_SQL_DATABASE ?? 'etimetracklite1',
        user: required('ATTENDANCE_SQL_USER'),
        password: required('ATTENDANCE_SQL_PASSWORD'),
        options: {
          instanceName: process.env.ATTENDANCE_SQL_INSTANCE ?? 'SQLEXPRESS01',
          encrypt: booleanValue(process.env.ATTENDANCE_SQL_ENCRYPT ?? 'true'),
          trustServerCertificate: booleanValue(
            process.env.ATTENDANCE_SQL_TRUST_SERVER_CERTIFICATE ?? 'true',
          ),
        },
      });
  try {
    const request = pool.request().input('lastSourceId', mssql.Int, lastSourceId);
    if (fromDate) request.input('fromDate', mssql.Date, fromDate);
    return (await request.query<PunchRow>(sql)).recordset;
  } finally {
    await pool.close();
  }
}

function groupPunches(rows: PunchRow[]): DailyPunches[] {
  const days = new Map<
    string,
    { employeeId: string; workDate: string; swipes: { at: Date; hour: number }[]; ins: Date[]; outs: Date[] }
  >();
  for (const row of rows) {
    const employeeId = String(row.employee_id ?? '').trim();
    const workDate = String(row.work_date ?? '');
    if (row.direction !== 'in' && row.direction !== 'out') continue;
    const timestamp = punchTimestamp(workDate, String(row.log_time ?? ''));
    if (!employeeId || !timestamp) continue;
    const key = `${employeeId}|${workDate}`;
    const day = days.get(key) ?? { employeeId, workDate, swipes: [], ins: [], outs: [] };
    // The device's own wall clock, so the test below does not depend on what
    // timezone this process happens to run in.
    day.swipes.push({ at: timestamp, hour: Number(String(row.log_time ?? '').slice(0, 2)) });
    (row.direction === 'in' ? day.ins : day.outs).push(timestamp);
    days.set(key, day);
  }

  return [...days.values()].map((day) => {
    const earliest = (list: Date[]) => list.reduce((a, b) => (b < a ? b : a));
    const latest = (list: Date[]) => list.reduce((a, b) => (b > a ? b : a));
    let punchIn = day.ins.length ? earliest(day.ins) : undefined;
    let punchOut = day.outs.length ? latest(day.outs) : undefined;

    // The device labels some arrivals as exits — a handful of people a day come
    // through with an exit swipe and no entry, at nine in the morning. Somebody
    // whose only swipes are exits still arrived, so the first one is read as the
    // arrival rather than left as a day that looks like it began by leaving.
    //
    // Only inside a window somebody could plausibly have arrived in. An
    // afternoon swipe is somebody who forgot to swipe in, and the small hours
    // are a late shift leaving — a two in the morning exit read as an arrival
    // would invent a day that ran until midnight.
    const ordered = [...day.swipes].sort((a, b) => a.at.getTime() - b.at.getTime());
    const ARRIVAL_FROM = 5;
    const ARRIVAL_UNTIL = 12;
    const first = ordered[0];
    if (!punchIn && punchOut && first && first.hour >= ARRIVAL_FROM && first.hour < ARRIVAL_UNTIL) {
      punchIn = ordered[0].at;
      punchOut = ordered.length > 1 ? ordered[ordered.length - 1].at : undefined;
    }
    return { employeeId: day.employeeId, workDate: day.workDate, punchIn, punchOut };
  });
}


function punchTimestamp(date: string, time: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}:\d{2}(\.\d{1,7})?$/.test(time)) return undefined;
  const value = new Date(`${date}T${time.slice(0, 12)}${timezone}`);
  return Number.isNaN(value.getTime()) ? undefined : value;
}

function quote(value: string) { return `[${value.replaceAll(']', ']]')}]`; }
function quotePath(value: string) { return value.split('.').map(quote).join('.'); }
function identifier(value: string) {
  if (!/^[A-Za-z_][A-Za-z0-9_.]*$/.test(value)) throw new Error(`Unsafe SQL identifier: ${value}`);
  return value;
}
function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}
function positiveInt(value: string) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1) throw new Error(`Expected a positive integer, got ${value}`);
  return number;
}
function nonNegativeInt(value: string) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) throw new Error(`Expected a non-negative integer, got ${value}`);
  return number;
}
function booleanValue(value: string) {
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new Error(`Expected true or false, got ${value}`);
}
function timezoneOffset(value: string) {
  if (!/^[+-](?:0\d|1\d|2[0-3]):[0-5]\d$/.test(value)) throw new Error(`Invalid timezone offset: ${value}`);
  return value;
}
function optionalIsoDate(value?: string) {
  if (!value?.trim()) return undefined;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(new Date(`${value}T00:00:00Z`).getTime())) {
    throw new Error('ATTENDANCE_IMPORT_FROM must use YYYY-MM-DD format');
  }
  return value;
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(closeDb);
