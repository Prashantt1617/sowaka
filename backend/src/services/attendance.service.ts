import { ObjectId } from 'mongodb';
import { attendanceRecords, attendanceRegularizations, users } from '../config/db';
import {
  AttendanceRegularization,
  RegularizationPeriod,
  RegularizationStatus,
} from '../models/attendance.model';

const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const periods = new Set<RegularizationPeriod>(['present', 'half_day', 'late']);
const decisions = new Set<RegularizationStatus>(['approved', 'declined']);

export async function getMyAttendance(userId: string, fromInput: string, toInput: string) {
  const from = parseDate(fromInput, 'from');
  const to = parseDate(toInput, 'to');
  if (to < from) throw new AttendanceError(400, 'to cannot be before from');
  if (daysBetween(from, to) > 92) throw new AttendanceError(400, 'Date range cannot exceed 93 days');

  const employee = await users().findOne({ userId });
  if (!employee) throw new AttendanceError(404, 'Employee not found');
  const employeeId = employee.employeeId;
  const recordFilter = employeeId
    ? { $or: [{ userId }, { employeeId }], workDate: { $gte: fromInput, $lte: toInput } }
    : { userId, workDate: { $gte: fromInput, $lte: toInput } };
  const [records, regularizations] = await Promise.all([
    attendanceRecords().find(recordFilter).sort({ workDate: 1 }).toArray(),
    attendanceRegularizations()
      .find({ userId, workDate: { $gte: fromInput, $lte: toInput } })
      .sort({ createdAt: -1 }).toArray(),
  ]);
  return {
    records: records.map((item) => ({
      id: item._id?.toHexString(), workDate: item.workDate,
      punchIn: item.punchIn?.toISOString(), punchOut: item.punchOut?.toISOString(),
    })),
    regularizations: regularizations.map(toRegularizationView),
  };
}

export async function recordPunch(userId: string, type: string) {
  if (type !== 'in' && type !== 'out') throw new AttendanceError(400, 'type must be in or out');
  const employee = await users().findOne({ userId });
  if (!employee?.employeeId) throw new AttendanceError(409, 'Employee ID is not configured');
  const now = new Date();
  const workDate = now.toISOString().slice(0, 10);
  const existing = await attendanceRecords().findOne({ employeeId: employee.employeeId, workDate });

  if (type === 'in') {
    if (existing?.punchIn) throw new AttendanceError(409, 'Already punched in today');
    await attendanceRecords().updateOne(
      { employeeId: employee.employeeId, workDate },
      {
        $set: { employeeId: employee.employeeId, userId, workDate, punchIn: now, updatedAt: now },
        $setOnInsert: { source: 'manual', sourceKey: `manual|${employee.employeeId}|${workDate}`, importedAt: now },
      },
      { upsert: true },
    );
  } else {
    if (!existing?.punchIn) throw new AttendanceError(409, 'Punch in before punching out');
    if (existing?.punchOut) throw new AttendanceError(409, 'Already punched out today');
    await attendanceRecords().updateOne(
      { employeeId: employee.employeeId, workDate },
      { $set: { punchOut: now, updatedAt: now } },
    );
  }

  const updated = await attendanceRecords().findOne({ employeeId: employee.employeeId, workDate });
  return {
    workDate,
    punchIn: updated?.punchIn?.toISOString(),
    punchOut: updated?.punchOut?.toISOString(),
  };
}

export async function requestRegularization(
  userId: string,
  input: { workDate?: string; period?: string; note?: string },
) {
  const workDate = input.workDate ?? '';
  const date = parseDate(workDate, 'workDate');
  const today = new Date();
  const todayText = today.toISOString().slice(0, 10);
  if (workDate > todayText) throw new AttendanceError(400, 'Future dates cannot be regularized');
  if (daysBetween(date, new Date(`${todayText}T00:00:00.000Z`)) > 45) {
    throw new AttendanceError(400, 'Regularization window is 45 days');
  }
  const period = (input.period ?? '').trim() as RegularizationPeriod;
  if (!periods.has(period)) throw new AttendanceError(400, 'Invalid regularization period');
  const note = (input.note ?? '').trim();
  if (note.length > 500) throw new AttendanceError(400, 'Note cannot exceed 500 characters');

  const employee = await users().findOne({ userId });
  if (!employee?.employeeId) throw new AttendanceError(409, 'Employee ID is not configured');
  if (!employee.managerUserId) throw new AttendanceError(409, 'A manager must be assigned');
  const pending = await attendanceRegularizations().findOne({ userId, workDate, status: 'pending' });
  if (pending) throw new AttendanceError(409, 'A regularization request is already pending for this date');
  const createdAt = new Date();
  const result = await attendanceRegularizations().insertOne({
    userId, employeeId: employee.employeeId, managerUserId: employee.managerUserId,
    workDate, period, note, status: 'pending', createdAt,
  });
  return toRegularizationView({
    _id: result.insertedId, userId, employeeId: employee.employeeId,
    managerUserId: employee.managerUserId, workDate, period, note,
    status: 'pending', createdAt,
  });
}

export async function getTeamMemberAttendance(
  managerUserId: string,
  employeeUserId: string,
  fromInput: string,
  toInput: string,
) {
  const employee = await users().findOne({ userId: employeeUserId });
  if (!employee) throw new AttendanceError(404, 'Employee not found');
  if (employee.managerUserId !== managerUserId) {
    throw new AttendanceError(403, "Not authorized to view this employee's attendance");
  }
  return getMyAttendance(employeeUserId, fromInput, toInput);
}

export async function getManagerRegularizations(managerUserId: string) {
  const values = await attendanceRegularizations()
    .find({ managerUserId }).sort({ createdAt: -1 }).toArray();
  return enrichRegularizations(values);
}

export async function decideRegularization(
  managerUserId: string, id: string, input: { decision?: string; managerNote?: string },
) {
  if (!ObjectId.isValid(id)) throw new AttendanceError(400, 'Invalid request ID');
  const decision = (input.decision ?? '').trim() as RegularizationStatus;
  if (!decisions.has(decision)) throw new AttendanceError(400, 'Decision must be approved or declined');
  const managerNote = (input.managerNote ?? '').trim();
  if (managerNote.length > 500) throw new AttendanceError(400, 'Manager note cannot exceed 500 characters');
  const decidedAt = new Date();
  const result = await attendanceRegularizations().findOneAndUpdate(
    { _id: new ObjectId(id), managerUserId, status: 'pending' },
    { $set: { status: decision, managerNote, decidedAt, decidedByUserId: managerUserId } },
    { returnDocument: 'after' },
  );
  if (!result) throw new AttendanceError(404, 'Pending regularization request not found');
  return (await enrichRegularizations([result]))[0];
}

async function enrichRegularizations(values: AttendanceRegularization[]) {
  const userIds = [...new Set(values.map((value) => value.userId))];
  const employeeIds = [...new Set(values.map((value) => value.employeeId))];
  const [employeeRows, punchRows] = await Promise.all([
    users().find({ userId: { $in: userIds } }).project({ userId: 1, name: 1, department: 1 }).toArray(),
    attendanceRecords().find({ employeeId: { $in: employeeIds } }).toArray(),
  ]);
  const employeeById = new Map(employeeRows.map((value) => [value.userId, value]));
  const punchByKey = new Map(punchRows.map((value) => [`${value.employeeId}|${value.workDate}`, value]));
  return values.map((value) => {
    const employee = employeeById.get(value.userId);
    const punch = punchByKey.get(`${value.employeeId}|${value.workDate}`);
    return {
      ...toRegularizationView(value),
      employee: { name: employee?.name ?? 'Employee', department: employee?.department ?? 'Team' },
      punchIn: punch?.punchIn?.toISOString(),
      punchOut: punch?.punchOut?.toISOString(),
    };
  });
}

function parseDate(value: string, field: string): Date {
  if (!datePattern.test(value)) throw new AttendanceError(400, `${field} must use YYYY-MM-DD format`);
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new AttendanceError(400, `${field} is not a valid date`);
  }
  return parsed;
}

function daysBetween(a: Date, b: Date) { return Math.floor((b.getTime() - a.getTime()) / 86_400_000); }
function toRegularizationView(value: AttendanceRegularization) {
  const { _id, ...rest } = value;
  return { ...rest, id: _id?.toHexString() };
}

export class AttendanceError extends Error {
  constructor(public readonly statusCode: number, message: string) { super(message); }
}
