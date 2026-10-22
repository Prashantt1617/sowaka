// Shift gaps and attendance patterns: who is on the Default only, who keeps
// missing punches, who punches away from the office — and a weekly summary
// of the same per manager or department, each item with the days behind it.
// Everything is read from the org attendance report, the out-of-location
// list the OOL check-ins page shows, and the punch locations on the records.
import { attendanceRecords, offices, shiftTemplates, users } from '../../config/db';
import { attendanceReport } from '../../services/attendance-report.service';
import { listOutOfLocationForAdmin } from '../../services/attendance.service';
import { placeLabel } from '../../services/geofence.service';
import { defineTools, num, str, SuwiContext } from '../tools';
import { countReport, DEVICE_SYNC_NOTE } from './attendance';
import { ACTIVE, addDays, isDate, rangeOf, weekdayOf } from './team';

type FarPunch = { userId: string; date: string; punch: 'in' | 'out'; place: string; distanceMeters: number | null; reason?: string; status?: string };

/** Each active person's reporting manager's userId, so answers can link managers too. */
async function managerIds(ctx: SuwiContext): Promise<Map<string, string>> {
  const rows = await users().find({ org: ctx.org, ...ACTIVE } as never, { projection: { _id: 0, userId: 1, managerUserId: 1 } }).toArray();
  return new Map(rows.filter((u) => u.managerUserId).map((u) => [u.userId, u.managerUserId!]));
}

/**
 * Punches taken away from every office in a range: the out-of-location rows
 * (requests and present-with-remark days) plus any punch whose location
 * matched no office, was marked off-site, or landed outside its office's
 * radius. Keyed by person; dates and places kept so an answer can link them.
 */
async function farPunches(ctx: SuwiContext, from: string, to: string): Promise<Map<string, FarPunch[]>> {
  const out = new Map<string, FarPunch[]>();
  const add = (p: FarPunch) => { const list = out.get(p.userId) ?? []; if (!list.some((x) => x.date === p.date && x.punch === p.punch)) list.push(p); out.set(p.userId, list); };
  const ool = await listOutOfLocationForAdmin(ctx.userId, from, to);
  for (const r of ool) add({ userId: r.userId, date: r.workDate, punch: r.punchType, place: r.place, distanceMeters: r.distanceMeters ?? null, reason: r.reason, status: r.outcome === 'present' ? 'marked present' : r.status });
  const radius = new Map((await offices().find({ org: ctx.org }).toArray()).map((o) => [o.id, o.radiusMeters]));
  const ids = (await users().find({ org: ctx.org, ...ACTIVE } as never, { projection: { _id: 0, userId: 1 } }).toArray()).map((u) => u.userId);
  const located = await attendanceRecords().find({ userId: { $in: ids }, workDate: { $gte: from, $lte: to }, $or: [{ punchInLocation: { $exists: true } }, { punchOutLocation: { $exists: true } }] }, { projection: { userId: 1, workDate: 1, punchInLocation: 1, punchOutLocation: 1 } }).toArray();
  for (const rec of located) {
    for (const [punch, loc] of [['in', rec.punchInLocation], ['out', rec.punchOutLocation]] as const) {
      if (!loc) continue;
      const limit = loc.officeId ? radius.get(loc.officeId) : undefined;
      const far = loc.offsite || !loc.officeId || (limit !== undefined && (loc.distanceMeters ?? 0) > limit);
      if (far) add({ userId: rec.userId!, date: rec.workDate, punch, place: placeLabel(loc.distanceMeters, loc.officeName), distanceMeters: loc.distanceMeters ?? null });
    }
  }
  for (const list of out.values()) list.sort((a, b) => a.date.localeCompare(b.date));
  return out;
}

defineTools(
  {
    name: 'shift_gaps',
    area: 'attendance',
    label: (i) => `Shift gaps ${i.from ?? 'from the 1st'} to ${i.to ?? 'today'}`,
    description: 'Gaps in shift setup and punching for a date range (default this month to today): who follows the Default shift only (never explicitly assigned a template), who keeps missing punches (at least minMissed, default 2, with the days), and who punches away from the office (out-of-location requests, present-with-remark days, and punches outside the office radius, with place and date). Optionally one department or manager.',
    input_schema: { type: 'object', properties: { from: { type: 'string' }, to: { type: 'string' }, minMissed: { type: 'number', description: 'Default 2' }, department: { type: 'string' }, manager: { type: 'string' }, limit: { type: 'number' } } },
    api: { method: 'GET', path: '/admin/reports/attendance' },
    async run(ctx, i) {
      const { from, to } = rangeOf(i, ctx.today);
      const [report, templates, far, mgrOf] = await Promise.all([attendanceReport(ctx.userId, { from, to }), shiftTemplates().find({ org: ctx.org, deletedAt: { $exists: false }, active: true } as never).toArray(), farPunches(ctx, from, to), managerIds(ctx)]);
      const dep = str(i.department).toLowerCase();
      const mgr = str(i.manager).toLowerCase();
      const inScope = (uid: string) => {
        const p = report.people[uid];
        if (!p) return false;
        if (dep && !p.department.toLowerCase().includes(dep)) return false;
        if (mgr && !p.manager.toLowerCase().includes(mgr)) return false;
        return true;
      };
      const who = (uid: string) => ({ userId: uid, name: report.people[uid]?.name ?? uid, department: report.people[uid]?.department ?? '', manager: report.people[uid]?.manager ?? '', managerUserId: report.people[uid]?.manager ? mgrOf.get(uid) ?? null : null, shift: report.people[uid]?.template ?? 'Default' });
      const assigned = new Set(templates.flatMap((t) => t.assignedUserIds ?? []));
      const def = templates.find((t) => t.isDefault);
      const onDefaultOnly = Object.keys(report.people).filter((uid) => inScope(uid) && !assigned.has(uid)).map(who);
      const per = countReport(report.days);
      const minMissed = num(i.minMissed, 2, 1, 31);
      const missing = [...per.entries()].filter(([uid, c]) => inScope(uid) && c.missed >= minMissed).map(([uid, c]) => ({ ...who(uid), missedPunches: c.missed, days: c.missedDays, punchFormat: report.people[uid]?.punchFormat })).sort((a, b) => b.missedPunches - a.missedPunches);
      const away = [...far.entries()].filter(([uid]) => inScope(uid)).map(([uid, list]) => ({ ...who(uid), punches: list.length, days: list.slice(0, 8) })).sort((a, b) => b.punches - a.punches);
      const limit = num(i.limit, 25, 1, 200);
      return {
        data: {
          from, to,
          onDefaultOnly: { count: onDefaultOnly.length, template: def?.name ?? 'the org policy', people: onDefaultOnly.slice(0, limit), note: 'These people were never assigned a template, so any change to the Default changes their rules too.' },
          repeatedMissedPunches: { minMissed, count: missing.length, people: missing.slice(0, limit), note: DEVICE_SYNC_NOTE },
          awayFromOffice: { count: away.length, people: away.slice(0, limit), note: 'Only people on a geotag shift send a location; biometric and auto-punch days have none.' },
        },
        links: [{ label: 'Open shift templates', view: 'shifttypes' }, { label: 'Open OOL check-ins', view: 'oolcheckins' }, { label: 'Open attendance report', view: 'attendancereport' }],
      };
    },
  },
  {
    name: 'team_attendance_patterns',
    area: 'attendance',
    label: (i) => `Attendance patterns by ${i.groupBy ?? 'manager'}, week to ${i.to ?? 'today'}`,
    description: 'A weekly summary per manager (default) or department: repeated missed punches (2 or more), Monday lates, punches far from the office; each with the person, the count and the dates behind it. Default week: the last 7 days to today. Use for "what should managers look at this week", "patterns in the Sales team".',
    input_schema: { type: 'object', properties: { groupBy: { type: 'string', enum: ['manager', 'department'] }, from: { type: 'string', description: 'YYYY-MM-DD, default 6 days before `to`' }, to: { type: 'string', description: 'YYYY-MM-DD, default today' }, group: { type: 'string', description: 'Only this manager or department' } } },
    api: { method: 'GET', path: '/admin/reports/attendance' },
    async run(ctx, i) {
      const to = isDate(i.to) ? i.to : ctx.today;
      const from = isDate(i.from) ? i.from : addDays(to, -6);
      const by = i.groupBy === 'department' ? 'department' : 'manager';
      const only = str(i.group).toLowerCase();
      const [report, far, mgrOf] = await Promise.all([attendanceReport(ctx.userId, { from, to }), farPunches(ctx, from, to), managerIds(ctx)]);
      const per = countReport(report.days, 31);
      // Who punched at all in the range: with nobody, there are no patterns to find, and other tools won't find any either.
      const punched = new Set(report.days.filter((d) => d[4] || d[5]).map((d) => d[0]));
      type Item = { userId: string; name: string; count: number; days: string[] };
      const groups = new Map<string, { managerUserId?: string; missedPunches: Item[]; mondayLates: Item[]; farPunches: Item[]; people: number }>();
      for (const [uid, p] of Object.entries(report.people)) {
        const key = (by === 'manager' ? p.manager : p.department) || (by === 'manager' ? '(no manager)' : '(no department)');
        if (only && !key.toLowerCase().includes(only)) continue;
        const g = groups.get(key) ?? { ...(by === 'manager' && p.manager && mgrOf.get(uid) ? { managerUserId: mgrOf.get(uid) } : {}), missedPunches: [], mondayLates: [], farPunches: [], people: 0 };
        g.people++;
        const c = per.get(uid);
        if (c && c.missed >= 2) g.missedPunches.push({ userId: uid, name: p.name, count: c.missed, days: c.missedDays });
        const mondays = c ? c.lateDays.filter((d) => weekdayOf(d) === 'Mon') : [];
        if (mondays.length) g.mondayLates.push({ userId: uid, name: p.name, count: mondays.length, days: mondays });
        const away = far.get(uid);
        if (away?.length) g.farPunches.push({ userId: uid, name: p.name, count: away.length, days: away.map((x) => `${x.date} ${x.punch}: ${x.place}${x.reason ? ` (${x.reason})` : ''}`) });
        groups.set(key, g);
      }
      const summary = [...groups.entries()].map(([group, g]) => ({ [by]: group, ...(g.managerUserId ? { managerUserId: g.managerUserId } : {}), people: g.people, flagged: g.missedPunches.length + g.mondayLates.length + g.farPunches.length, missedPunches: g.missedPunches, mondayLates: g.mondayLates, farPunches: g.farPunches })).sort((a, b) => b.flagged - a.flagged);
      return {
        data: {
          from, to, groupBy: by, peopleWithPunches: punched.size,
          ...(punched.size === 0 ? { noData: `Nobody has a punch between ${from} and ${to}, so there are no patterns to report. If punches come from a biometric device, check it has synced; other attendance tools will show the same.` } : {}),
          groups: summary.slice(0, 40), note: `Missed punches: 2 or more graded working days with a punch missing. Monday lates: late beyond grace on a Monday. ${DEVICE_SYNC_NOTE}`,
        },
        links: [{ label: 'Open attendance report', view: 'attendancereport' }, { label: 'Open OOL check-ins', view: 'oolcheckins' }],
      };
    },
  },
);
