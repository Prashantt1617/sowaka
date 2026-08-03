/**
 * Creates deterministic sample attendance records for one employee and an
 * inclusive date range.
 *
 * Usage:
 *   npm run attendance:seed -- SYS-001 2026-07-01 2026-07-31
 *   npm run attendance:seed -- SYS-001 01-07-2026 31-07-2026
 *
 * Existing non-sample attendance records are never overwritten. Re-running
 * the command updates only records previously created by this script.
 */
import { createHash } from 'node:crypto';
import { attendanceRecords, closeDb, connectDb, users } from '../config/db';
import type { AttendanceRecord } from '../models/attendance.model';

const isoDatePattern = /^\d{4}-\d{2}-\d{2}$/;
const displayDatePattern = /^\d{2}-\d{2}-\d{4}$/;
const dayMs = 86_400_000;
const timezone = process.env.ATTENDANCE_SAMPLE_TIMEZONE?.trim() || '+05:30';

async function main() {
  const [employeeId, startInput, endInput] = process.argv.slice(2);
  if (!employeeId || !startInput || !endInput) {
    throw new Error(
      'Usage: npm run attendance:seed -- <employee-code> <start-date> <end-date>',
    );
  }

  const start = parseDate(startInput, 'start date');
  const end = parseDate(endInput, 'end date');
  const startDate = toDateOnly(start);
  const endDate = toDateOnly(end);
  if (end < start) throw new Error('End date cannot be before start date');
  const rangeDays = Math.floor((end.getTime() - start.getTime()) / dayMs) + 1;
  if (rangeDays > 366) throw new Error('Sample date range cannot exceed 366 days');
  validateTimezone(timezone);

  await connectDb();
  const employeeCodes = await users()
    .find(
      { employeeId: { $type: 'string', $ne: '' } },
      { projection: { _id: 0, employeeId: 1 } },
    )
    .sort({ employeeId: 1 })
    .toArray();
  console.log(
    'Available employee codes:',
    employeeCodes.map(({ employeeId }) => employeeId).join(', ') || 'none',
  );

  const employee = await users().findOne(
    { employeeId: employeeId.trim() },
    { projection: { userId: 1, employeeId: 1, name: 1 } },
  );
  if (!employee?.employeeId) {
    throw new Error(`Employee code "${employeeId}" was not found`);
  }
  const validatedEmployeeId = employee.employeeId;

  const workDates = datesBetween(start, end).filter(
    (date) => date.getUTCDay() !== 0 && date.getUTCDay() !== 6,
  );
  const existing = await attendanceRecords()
    .find({
      employeeId: validatedEmployeeId,
      workDate: { $gte: startDate, $lte: endDate },
    })
    .project({ workDate: 1, sourceKey: 1 })
    .toArray();
  const protectedDates = new Set(
    existing
      .filter((record) => !record.sourceKey.startsWith('sample|'))
      .map((record) => record.workDate),
  );

  const now = new Date();
  const operations = workDates
    .filter((date) => !protectedDates.has(toDateOnly(date)))
    .map((date, index) => {
      const workDate = toDateOnly(date);
      const punches = samplePunches(workDate, index);
      const sourceKey = `sample|${validatedEmployeeId}|${workDate}`;
      const record: AttendanceRecord = {
        employeeId: validatedEmployeeId,
        userId: employee.userId,
        workDate,
        punchIn: punches.punchIn,
        punchOut: punches.punchOut,
        source: 'manual',
        sourceKey,
        importedAt: now,
        updatedAt: now,
      };
      return {
        updateOne: {
          filter: { sourceKey },
          update: { $set: record },
          upsert: true,
        },
      };
    });

  if (operations.length > 0) {
    await attendanceRecords().bulkWrite(operations, { ordered: false });
  }

  console.log(
    [
      `Attendance sample complete for ${employee.name} (${validatedEmployeeId}).`,
      `${operations.length} workday record(s) created or refreshed.`,
      `${protectedDates.size} existing non-sample record(s) preserved.`,
      `${rangeDays - workDates.length} weekend day(s) skipped.`,
    ].join(' '),
  );
}

function samplePunches(workDate: string, index: number) {
  const variation = deterministicNumber(workDate) % 18;
  const inMinute = 20 + (deterministicNumber(`${workDate}:in`) % 31);
  const punchIn = timestamp(workDate, 9, inMinute);

  // A predictable mix makes all important calendar states easy to inspect.
  if (variation === 3) return { punchIn }; // missing punch-out
  if (variation === 7) {
    return { punchIn: undefined, punchOut: timestamp(workDate, 18, 10) };
  }
  if (variation === 11) {
    return { punchIn, punchOut: timestamp(workDate, 13, 15) }; // half day
  }

  const minutesWorked =
    variation === 15
      ? 10 * 60 + 30 // overtime
      : 8 * 60 + 5 + ((index * 13 + variation) % 46);
  return {
    punchIn,
    punchOut: new Date(punchIn.getTime() + minutesWorked * 60_000),
  };
}

function deterministicNumber(value: string) {
  return createHash('sha256').update(value).digest().readUInt32BE(0);
}

function timestamp(workDate: string, hour: number, minute: number) {
  return new Date(
    `${workDate}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00${timezone}`,
  );
}

function datesBetween(start: Date, end: Date) {
  const dates: Date[] = [];
  for (
    let timestamp = start.getTime();
    timestamp <= end.getTime();
    timestamp += dayMs
  ) {
    dates.push(new Date(timestamp));
  }
  return dates;
}

function parseDate(value: string, label: string) {
  let normalized = value;
  if (displayDatePattern.test(value)) {
    const [day, month, year] = value.split('-');
    normalized = `${year}-${month}-${day}`;
  } else if (!isoDatePattern.test(value)) {
    throw new Error(`${label} must use YYYY-MM-DD or DD-MM-YYYY format`);
  }

  const parsed = new Date(`${normalized}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || toDateOnly(parsed) !== normalized) {
    throw new Error(`${label} is not a valid date`);
  }
  return parsed;
}

function toDateOnly(value: Date) {
  return value.toISOString().slice(0, 10);
}

function validateTimezone(value: string) {
  if (!/^[+-](?:0\d|1\d|2[0-3]):[0-5]\d$/.test(value)) {
    throw new Error('ATTENDANCE_SAMPLE_TIMEZONE must be an offset such as +05:30');
  }
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(closeDb);
