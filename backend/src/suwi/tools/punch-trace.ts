// Looking into one person's punch problem on one day (24 Nov, Suwi training: time): everything the
// server kept about their punches that day, read where recordPunch writes it. The day's attendance
// record (each punch's time, the office it matched, distance, the fix's accuracy, the mocked-location
// flag, an out-of-location remark), the requests the day raised (an out-of-location check-in, a face
// check the punch fell back from, a correction), any HR mark, and, for someone with the Face ID tab,
// each face check (passed or why not). Then the reason in words: late by how much past the grace, the
// day's mark, or why a punch was turned away. A punch refused for its location before anything was
// saved (no reason given, or a fix too rough) is answered to the phone and not stored: the tool says so.
import { attendanceOverrides, attendanceRecords, attendanceRegularizations, faceVerifications, facePhoneLogs, offices } from '../../config/db';
import { hasAllDashboardTabs } from '../../middleware/admin.middleware';
import { MAX_PUNCH_ACCURACY_METERS, PunchLocation } from '../../models/office.model';
import { PUNCH_OUT_MIN_GAP_MINUTES } from '../../models/attendance.model';
import { markForDay, minutesAfterShiftStart, minutesBeforeShiftEnd } from '../../services/attendance.service';
import { FACE_MESSAGES } from '../../services/face-id.service';
import { policyForUser } from '../../services/shift.service';
import { defineTools, str } from '../tools';
import { findPerson } from './people';
import { isDate, niceDate } from './team';

const ist = (d: Date | string | undefined | null) => (d ? new Date(new Date(d).getTime() + 5.5 * 3_600_000).toISOString().slice(11, 19) : null);
const GEOTAG = 'Geotag (powered by Sowaka)';

function place(loc?: PunchLocation | null) {
  if (!loc) return null;
  return {
    office: loc.officeName ?? null,
    distanceMeters: loc.distanceMeters ?? null,
    accuracyMeters: loc.accuracy ?? null,
    mocked: loc.mocked === true,
    inOffice: Boolean(loc.officeId) && loc.offsite !== true,
    offsite: loc.offsite === true,
  };
}

defineTools({
  name: 'punch_attempts',
  area: 'attendance',
  label: (i) => `Punches of ${i.name ?? 'one person'} on ${i.date ?? 'today'}`,
  description: 'Look into a punch problem: "why did <person>\'s punch fail on 15 Nov?", "why was she marked late", "did his punch reach the server". For one person and one date (default today) it lists every punch attempt the server kept, times in India time: the attendance record\'s punch-in/out with the office matched, distance from it, the location fix\'s accuracy and the mocked-location flag; out-of-location check-ins and face-check fallbacks the day raised (with their status); attendance corrections; HR\'s mark on the day; and, for people with the Face ID tab, each face check (passed, or the reason it failed). Then the reasons: late by how many minutes past the grace, early exit, the day\'s mark under their shift, or why a punch was refused (outside the office, face check, location too rough, the 30-minute punch-out wait). Give person (name, employee ID or userId) and date (YYYY-MM-DD). For a month of punches use person_attendance instead.',
  input_schema: { type: 'object', properties: { person: { type: 'string', description: 'Name, employee ID or userId' }, name: { type: 'string', description: 'Same as person' }, date: { type: 'string', description: 'YYYY-MM-DD (default today)' } } },
  api: { method: 'GET', path: '/admin/punch-log' },
  async run(ctx, i) {
    const p = await findPerson(ctx, str(i.person) || str(i.name));
    const date = isDate(i.date) ? i.date : ctx.today;
    const dayStart = new Date(`${date}T00:00:00.000+05:30`);
    const dayEnd = new Date(dayStart.getTime() + 86_400_000);
    const faceAccess = hasAllDashboardTabs(ctx.user) || (ctx.user.dashboardTabs ?? []).includes('faceid');
    const [records, requests, mark, policy, sites, faces, phone] = await Promise.all([
      attendanceRecords().find({ workDate: date, $or: [{ userId: p.userId }, ...(p.employeeId ? [{ employeeId: p.employeeId }] : [])] } as never).toArray(),
      attendanceRegularizations().find({ userId: p.userId, workDate: date }).sort({ createdAt: 1 }).toArray(),
      attendanceOverrides().findOne({ userId: p.userId, workDate: date }),
      policyForUser(p.userId, date),
      offices().find({ org: ctx.org, active: true }, { projection: { _id: 0, name: 1, radiusMeters: 1 } }).toArray(),
      faceAccess ? faceVerifications().find({ userId: p.userId, kind: 'verify', at: { $gte: dayStart, $lt: dayEnd } }, { projection: { _id: 0, at: 1, passed: 1, reason: 1, usedFor: 1, 'liveness.mode': 1 } }).sort({ at: 1 }).toArray() : Promise.resolve([]),
      faceAccess ? facePhoneLogs().find({ userId: p.userId, at: { $gte: dayStart, $lt: dayEnd } }, { projection: { _id: 0, at: 1, summary: 1 } }).sort({ at: 1 }).limit(30).toArray() : Promise.resolve([]),
    ]);
    const format = policy.correction?.punchFormat ?? '';
    const reasons: string[] = [];
    const punches = records.map((r) => ({
      source: r.source, dayType: r.dayType ?? null,
      punchIn: ist(r.punchIn), punchInPlace: place(r.punchInLocation), punchInFace: r.punchInFace ? 'passed' : null,
      punchOut: ist(r.punchOut), punchOutPlace: place(r.punchOutLocation),
      outsideLocation: r.outsideLocation ? { reason: r.outsideLocation.reason, punch: r.outsideLocation.punchType, at: ist(r.outsideLocation.at), office: r.outsideLocation.officeName ?? null, distanceMeters: r.outsideLocation.distanceMeters ?? null, accuracyMeters: r.outsideLocation.accuracy ?? null } : null,
    }));
    const rec = records.find((r) => r.punchIn || r.punchOut);
    if (rec) {
      const pin = rec.punchIn ? new Date(rec.punchIn) : null;
      const pout = rec.punchOut ? new Date(rec.punchOut) : null;
      if (pin) {
        const after = minutesAfterShiftStart(pin, policy.startTime);
        if (!policy.lateMarkingEnabled) reasons.push(`In at ${ist(pin)}: late marking is off on ${policy.shiftName ?? 'their shift'}, so no late mark.`);
        else if (after > policy.lateGraceMinutes) reasons.push(`Marked late: in at ${ist(pin)}, ${after} min after the ${policy.startTime} start, ${after - policy.lateGraceMinutes} min past the ${policy.lateGraceMinutes}-min grace.`);
        else reasons.push(`In at ${ist(pin)}: ${after > 0 ? `${after} min after the start, within the ${policy.lateGraceMinutes}-min grace` : 'on time'}; not late.`);
        if (policy.halfDay?.lateArrivalEnabled && after > policy.halfDay.lateArrivalMinutes) reasons.push(`More than the ${policy.halfDay.lateArrivalMinutes}-min very-late cut-off: that alone makes the day a half day.`);
      }
      if (pout && policy.correction?.punchMode !== 'Single punch') {
        const before = minutesBeforeShiftEnd(pout, policy.startTime, policy.endTime);
        if (policy.earlyMarkingEnabled && before > policy.earlyOutGraceMinutes) reasons.push(`Early exit: out at ${ist(pout)}, ${before} min before the ${policy.endTime} end (grace ${policy.earlyOutGraceMinutes} min).`);
      }
      const m = rec.dayType ? `${rec.dayType} (set by an approved correction)` : markForDay(policy, pin, pout);
      reasons.push(`The punches grade the day as ${m} on ${policy.shiftName ?? 'the company policy'} (${policy.startTime}–${policy.endTime}).`);
      for (const loc of [rec.punchInLocation, rec.punchOutLocation]) {
        if (loc?.mocked) reasons.push('The phone reported a mocked (fake) location on a punch: the punch was still accepted, but the location cannot be trusted.');
        if (loc && loc.offsite) reasons.push(`A punch was taken outside the office (${loc.distanceMeters ?? '?'} m from ${loc.officeName ?? 'the nearest office'}) and kept with the employee's reason.`);
      }
    }
    const reqs = requests.map((q) => {
      const loc = q.outsideLocation ?? q.faceCheck;
      return {
        kind: q.kind === 'out_of_location' ? 'out-of-location check-in' : q.kind === 'face_check' ? 'face check fallback (punch sent to the manager)' : 'attendance correction',
        status: q.status, raisedAt: ist(q.createdAt), decidedAt: ist(q.decidedAt), decidedBy: q.decidedByRole ?? null, managerNote: q.managerNote || null,
        punchIn: ist(q.punchIn), punchOut: ist(q.punchOut),
        reason: q.outsideLocation?.reason ?? (q.faceCheck ? FACE_MESSAGES[q.faceCheck.reason as keyof typeof FACE_MESSAGES] ?? q.faceCheck.reason : null) ?? q.note ?? null,
        ...(q.faceCheck ? { faceAttempts: q.faceCheck.attempts } : {}),
        ...(loc ? { office: loc.officeName ?? null, distanceMeters: loc.distanceMeters ?? null, accuracyMeters: loc.accuracy ?? null } : {}),
        ...(q.requestedDayType ? { askedFor: q.requestedDayType } : {}),
      };
    });
    for (const q of requests) {
      if (q.kind === 'out_of_location') reasons.push(`Punched in from outside every office (${q.outsideLocation?.distanceMeters ?? '?'} m from ${q.outsideLocation?.officeName ?? 'the nearest office'}, reason "${q.outsideLocation?.reason ?? ''}"), so the punch became a check-in request: ${q.status === 'pending' ? 'still waiting on a decision; the day stays absent until approved' : q.status}.`);
      if (q.kind === 'face_check') reasons.push(`The face check refused the punch${q.faceCheck ? ` (${q.faceCheck.attempts} tries; last: ${FACE_MESSAGES[q.faceCheck.reason as keyof typeof FACE_MESSAGES] ?? q.faceCheck.reason})` : ''}, so it went to the manager: ${q.status}.`);
    }
    const failedFaces = faces.filter((f) => !f.passed);
    if (failedFaces.length) reasons.push(`${failedFaces.length} face check${failedFaces.length === 1 ? '' : 's'} failed: ${[...new Set(failedFaces.map((f) => FACE_MESSAGES[f.reason] ?? f.reason))].join('; ')}`);
    if (mark) reasons.push(`HR marked the day ${mark.status.replace('_', ' ')}${mark.setByName ? ` (${mark.setByName})` : ''}: that outranks the punches.`);
    if (format === 'Present by default (Auto Punch)') reasons.push(`${policy.shiftName ?? 'Their shift'} is Auto Punch: nobody punches, and the day is present unless marked otherwise.`);
    const nothing = !records.length && !requests.length && !faces.length && !phone.length;
    const notKept = format === GEOTAG
      ? `A punch turned away for its location before anything was saved leaves no trace on the server: outside every office without choosing a reason, or a location fix rougher than ${MAX_PUNCH_ACCURACY_METERS} m ("not precise enough yet"). So does a punch-out tried within ${PUNCH_OUT_MIN_GAP_MINUTES} min of the punch-in, or a punch that never reached the server (no network).`
      : `A punch turned away before anything was saved leaves no trace on the server (a punch-out within ${PUNCH_OUT_MIN_GAP_MINUTES} min of the punch-in, or no network).`;
    if (nothing) reasons.push(`The server kept nothing for ${niceDate(date)}: no punch, no request${faceAccess ? ', no face check' : ''}. ${notKept} Ask what message the app showed.`);
    return {
      data: {
        name: p.name, employeeId: p.employeeId ?? null, date,
        shift: { name: policy.shiftName ?? 'company policy', window: `${policy.startTime}–${policy.endTime}`, lateGraceMinutes: policy.lateMarkingEnabled ? policy.lateGraceMinutes : 'late marking off', punchFormat: format, punchMode: policy.correction?.punchMode ?? null },
        ...(format === GEOTAG ? { offices: sites.map((s) => ({ name: s.name, radiusMeters: s.radiusMeters })), roughestFixAccepted: `${MAX_PUNCH_ACCURACY_METERS} m` } : {}),
        punches, requests: reqs, hrMark: mark ? { status: mark.status, note: mark.note ?? null } : null,
        ...(faceAccess ? { faceChecks: faces.map((f) => ({ at: ist(f.at), passed: f.passed, reason: f.passed ? 'matched' : FACE_MESSAGES[f.reason] ?? f.reason, usedFor: (f as { usedFor?: string }).usedFor ?? null, liveness: f.liveness?.mode ?? null })), phoneLog: phone.map((x) => ({ at: ist(x.at), what: x.summary })) } : { faceChecks: 'Not shown: needs the Face ID tab' }),
        reasons,
        notKept,
        timesAre: 'India time (IST)',
      },
      links: [{ label: 'Open punch log', view: 'punchlog' }, { label: `Open ${p.name.split(' ')[0]}'s calendar`, userId: p.userId, tab: 'calendar' }],
    };
  },
});
