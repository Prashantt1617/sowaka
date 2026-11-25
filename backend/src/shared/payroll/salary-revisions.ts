/**
 * Split-month salary revisions (25 Nov 2026). A CTC revision applies from its
 * effective date only: each day of a pay period is paid on the salary in force
 * that day, so a period with a revision inside it is paid in parts ("26 Oct –
 * 19 Nov on ₹12,00,000 a year; 20 Nov – 25 Nov on ₹15,00,000 a year"), a
 * revision dated after the period does not touch it, and one dated in a period
 * already submitted is paid as arrears on the next run.
 *
 * Pure: no I/O, money in integer paise. The run (payrollRun.service) reads the
 * data and calls these.
 *
 * The rule, per part i of a period with D calendar days and B base days:
 *   counted days  c_i = days_i × B / D           (= days_i when B = D, the usual case)
 *   paid share    s_i = (c_i − LOP_i) / B
 *   a prorated earning pays  Σ monthly_i × s_i  (rounded to the rupee once)
 *   its full-month "rate" is Σ monthly_i × days_i / D (rounded to the rupee)
 * A component the revision did not change (the same amount in every part) is
 * paid exactly as before; a person with no revision in the period is not split
 * at all, and their payslip is the one the run always made.
 *
 * Template moves are not dated (HR, 25 Nov 2026): moving someone to another
 * template applies to the next run's whole period. Only CTC revisions split.
 */
import type { SalaryRevision, StructureOverrides } from '../../models/salaryStructure.model';
import type { SalaryCalcResult, ComponentLine } from './salary-calculator';
import { roundToRupee } from './statutory-engine';

/** The parts of a salary that differ from one revision to the next. */
export interface SalaryState {
  salaryTemplateCode?: string;
  annualCtcPaise: number;
  componentValues?: Record<string, number>;
  overrides?: StructureOverrides;
}

/** The structure fields the timeline reads. */
export interface StructureLike extends SalaryState {
  revisions?: SalaryRevision[];
}

const DAY_MS = 86_400_000;
const isDay = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));
export const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
export const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS) + 1;
const atIso = (at: unknown) => {
  const d = at instanceof Date ? at : new Date(String(at));
  return Number.isNaN(d.getTime()) ? String(at) : d.toISOString();
};
export const atTime = (at: unknown) => new Date(atIso(at)).getTime();

/** A revision's stable id: its own, else (older ones) its date and when it was saved. */
export function revisionKey(r: SalaryRevision): string {
  return r.id ?? `${r.effectiveFrom}|${atIso(r.at)}`;
}

/**
 * The revisions that change pay, in date order, one per effective date. Several saved for the
 * same day are one change: the latest saved wins, from what the first replaced (a monthly figure
 * typed in the yearly box and corrected minutes later is the corrected salary from that day).
 * Left out: the first CTC ever given (from 0, so also a same-day correction of it), corrections
 * (`kind`), changes made while the salary was still being set up (`whileActive` false), and, on
 * revisions saved before 25 Nov 2026 (no flag), a monthly CTC multiplied by 12 (a correction).
 */
export function payRevisions(structure: StructureLike): SalaryRevision[] {
  const byDay = new Map<string, SalaryRevision[]>();
  for (const r of structure.revisions ?? []) {
    if (!isDay(r.effectiveFrom) || r.kind === 'correction') continue;
    byDay.set(r.effectiveFrom, [...(byDay.get(r.effectiveFrom) ?? []), r]);
  }
  // A same-day group is one change, except that a real raise saved on the same date as the very first
  // salary is a revision of its own (25 Nov 2026: three raises back-dated to 1 Oct, the day their salary
  // was first entered on, would otherwise read as the first salary and pay no arrears). Within a group
  // that starts at the first salary, only a monthly figure ×12 is folded in as a correction.
  const chunks: SalaryRevision[][] = [];
  for (const day of [...byDay.keys()].sort()) {
    const group = byDay.get(day)!.sort((a, b) => atTime(a.at) - atTime(b.at));
    let chunk: SalaryRevision[] = [];
    for (const r of group) {
      const prev = chunk[chunk.length - 1];
      const startsAtFirstSalary = chunk.length > 0 && !(chunk[0].previousCtcPaise > 0);
      if (prev && startsAtFirstSalary && r.annualCtcPaise !== prev.annualCtcPaise * 12) { chunks.push(chunk); chunk = []; }
      chunk.push(r);
    }
    chunks.push(chunk);
  }
  const out: SalaryRevision[] = [];
  for (const group of chunks) {
    const first = group[0];
    const last = group[group.length - 1];
    const one: SalaryRevision = { ...last, id: revisionKey(last), previousCtcPaise: first.previousCtcPaise };
    delete one.previous;
    delete one.whileActive;
    if (first.previous) one.previous = first.previous;
    if (first.whileActive !== undefined) one.whileActive = first.whileActive;
    if (!(one.previousCtcPaise > 0) || one.annualCtcPaise === one.previousCtcPaise) continue;
    if (one.whileActive === false) continue;
    if (one.whileActive === undefined && one.annualCtcPaise === one.previousCtcPaise * 12) continue;
    out.push(one);
  }
  return out;
}

export interface SalaryVersion {
  /** First day in force; absent for the salary before the first revision. */
  from?: string;
  /** The revision that started it. */
  revision?: SalaryRevision;
  key?: string;
  state: SalaryState;
  /** Its revision is held for the period being paid (its arrears for that period were paid on another run). */
  held?: boolean;
}

const stateOf = (s: SalaryState): SalaryState => ({
  salaryTemplateCode: s.salaryTemplateCode,
  annualCtcPaise: s.annualCtcPaise,
  componentValues: s.componentValues,
  overrides: s.overrides,
});

/**
 * What a revision replaced, as a salary: its snapshot (template, fixed amounts, own changes) at
 * its previous CTC. Revisions saved before 25 Nov 2026 have no snapshot: the current template,
 * fixed amounts and own changes stand in, at the previous CTC. A template move made after the
 * latest revision (moves are not dated) applies to every part: then every part uses the current
 * template and own changes.
 */
function stateBefore(structure: StructureLike): (r: SalaryRevision) => SalaryState {
  const current = stateOf(structure);
  const lastWithTemplate = [...(structure.revisions ?? [])].reverse().find((r) => r.templateCode);
  const movedSince = !!lastWithTemplate && lastWithTemplate.templateCode !== current.salaryTemplateCode;
  return (r) => ({
    annualCtcPaise: r.previousCtcPaise,
    salaryTemplateCode: movedSince ? current.salaryTemplateCode : r.previous ? r.previous.salaryTemplateCode ?? current.salaryTemplateCode : current.salaryTemplateCode,
    componentValues: r.previous ? r.previous.componentValues : current.componentValues,
    overrides: movedSince ? current.overrides : r.previous ? r.previous.overrides : current.overrides,
  });
}

/**
 * The person's salaries in date order: the one before the first revision, then one per revision.
 *
 * `held`: revisions whose arrears for the period being paid were already paid on another run:
 * for that period they are left out (their days stay on the salary before them), so the days are
 * not paid twice.
 */
export function salaryVersions(structure: StructureLike, held?: Set<string>): SalaryVersion[] {
  const current = stateOf(structure);
  const revs = payRevisions(structure);
  if (revs.length === 0) return [{ state: current }];
  const before = stateBefore(structure);
  const out: SalaryVersion[] = [{ state: before(revs[0]) }];
  revs.forEach((r, k) => {
    const key = revisionKey(r);
    const own = k + 1 < revs.length ? before(revs[k + 1]) : current;
    const isHeld = held?.has(key) ?? false;
    out.push({ from: r.effectiveFrom, revision: r, key, state: isHeld ? out[out.length - 1].state : own, ...(isHeld ? { held: true } : {}) });
  });
  return out;
}

/** The salary in force on a day. */
export function versionOn(versions: SalaryVersion[], day: string): SalaryVersion {
  let v = versions[0];
  for (const x of versions) if (!x.from || x.from <= day) v = x;
  return v;
}

/** The structure as it pays on `day` ('YYYY-MM-DD'): a revision dated later is not in force yet. */
export function structureAsOf<T extends StructureLike>(structure: T, day: string): T {
  const v = versionOn(salaryVersions(structure), day);
  return { ...structure, ...v.state };
}

export interface SalarySegment {
  from: string;
  to: string;
  days: number;
  version: SalaryVersion;
}

export const sameState = (a: SalaryState, b: SalaryState) => JSON.stringify(stateOf(a)) === JSON.stringify(stateOf(b));

/** The parts of [from, to] each paid on one salary, in date order (one part when nothing changes inside it). */
export function salarySegments(versions: SalaryVersion[], from: string, to: string): SalarySegment[] {
  const starts = [{ day: from, version: versionOn(versions, from) }];
  for (const v of versions) {
    if (!v.from || v.from <= from || v.from > to) continue;
    const last = starts[starts.length - 1];
    if (last.day === v.from) last.version = v; // two revisions on one day: the later one is in force
    else starts.push({ day: v.from, version: v });
  }
  const out: SalarySegment[] = [];
  starts.forEach((s, i) => {
    const end = i + 1 < starts.length ? addDays(starts[i + 1].day, -1) : to;
    const prev = out[out.length - 1];
    if (prev && sameState(prev.version.state, s.version.state)) {
      prev.to = end;
      prev.days = daysBetween(prev.from, end);
    } else out.push({ from: s.day, to: end, days: daysBetween(s.day, end), version: s.version });
  });
  return out;
}

// ———————————————————————————————————————————— loss of pay in each part

export interface LopPart {
  /** Days of the period in this part, counted in base days (days × B / D). */
  capacity: number;
  /** Days before joining / after leaving that fall in this part. */
  notEmployed: number;
  /** Leave without pay dated in this part (never covered by the paid-leave allowance). */
  unpaid?: number;
  /** Absences, half days and missed punches the calendar docks, dated in this part. */
  docked?: number;
}

/**
 * Places a period's loss of pay (whatever the run made it: attendance, or HR's figure) in its
 * parts, so each day lost costs the salary of its own part:
 *   1. days not employed, where they fall;
 *   2. leave without pay, where it falls;
 *   3. the calendar's absences, half days and missed punches, where they fall, less the
 *      template's paid-leave days (`covered`), which cover the first days docked;
 *   4. whatever is left (the template's late/early rules, or HR's figure beyond the dated days)
 *      spread over the parts by their days still unpaid-for, in half days.
 * Each part takes no more than its own days; the parts add up to `total`.
 */
export function allocateLop(total: number, parts: LopPart[], covered = 0): number[] {
  const out = parts.map(() => 0);
  let remaining = Math.max(0, total);
  const take = (i: number, want: number) => {
    const t = Math.max(0, Math.min(want, parts[i].capacity - out[i], remaining));
    out[i] += t;
    remaining -= t;
  };
  parts.forEach((p, i) => take(i, p.notEmployed));
  parts.forEach((p, i) => take(i, p.unpaid ?? 0));
  let cover = Math.max(0, covered);
  parts.forEach((p, i) => {
    const docked = p.docked ?? 0;
    const off = Math.min(cover, docked);
    cover -= off;
    take(i, docked - off);
  });
  if (remaining > 1e-9) {
    const free = parts.map((p, i) => Math.max(0, p.capacity - out[i]));
    const freeTotal = free.reduce((t, f) => t + f, 0);
    if (freeTotal > 0) {
      const units = Math.floor(remaining * 2 + 1e-9);
      const raw = free.map((f) => (units * f) / freeTotal);
      const given = raw.map((r) => Math.floor(r + 1e-9));
      let left = units - given.reduce((t, g) => t + g, 0);
      // Largest remainder first; a tie goes to the later part.
      const order = raw.map((r, i) => ({ i, frac: r - given[i] })).sort((a, b) => b.frac - a.frac || b.i - a.i);
      for (const { i } of order) { if (left <= 0) break; given[i] += 1; left -= 1; }
      const spread = remaining;
      given.forEach((g, i) => take(i, g / 2));
      // A fraction under half a day (a rule docking a quarter day): to the part with most days left.
      if (remaining > 1e-9 && spread > 0) {
        const most = free.map((_, i) => ({ i, f: parts[i].capacity - out[i] })).sort((a, b) => b.f - a.f || b.i - a.i)[0];
        take(most.i, remaining);
      }
    }
  }
  return out;
}

// ———————————————————————————————————————————— one month from its parts

export interface SegmentCalc {
  calc: SalaryCalcResult;
  days: number;
  lopDays: number;
}

/**
 * The period as one month from its parts: every line's monthly figure is its day-weighted
 * amount over the parts (a line the same in every part keeps its amount exactly), and
 * `paidPaise` holds what each prorated earning that differs between parts is paid
 * (Σ monthly_i × paid share_i, rounded to the rupee once). Statutory (PF, ESI, PT, LWF) then
 * runs on this month exactly as it does on any other. The latest part's statutory figures and
 * settings stand for the month (they are what the person is on now).
 */
export function combineSegments(parts: SegmentCalc[], periodDays: number, baseDays: number): { calc: SalaryCalcResult; paidPaise: Record<string, number> } {
  const latest = parts[parts.length - 1].calc;
  const paidPaise: Record<string, number> = {};
  const merge = (pick: (c: SalaryCalcResult) => ComponentLine[], earnings: boolean): ComponentLine[] => {
    const order: string[] = [];
    const meta = new Map<string, ComponentLine>();
    for (let i = parts.length - 1; i >= 0; i--) {
      for (const line of pick(parts[i].calc)) {
        if (!meta.has(line.code)) { meta.set(line.code, line); order.push(line.code); }
      }
    }
    // The latest part's order first, then lines only earlier parts had.
    const latestCodes = pick(latest).map((l) => l.code);
    const sorted = [...latestCodes, ...order.filter((c) => !latestCodes.includes(c))];
    return sorted.map((code) => {
      const m = meta.get(code)!;
      const amounts = parts.map((p) => pick(p.calc).find((l) => l.code === code)?.monthlyPaise ?? 0);
      // A one-time amount (entered on the run) is the same for the whole month: paid once, in full.
      if (m.oneTime || amounts.every((a) => a === amounts[0])) {
        const monthly = m.oneTime ? m.monthlyPaise : amounts[0];
        return { ...m, monthlyPaise: monthly, annualPaise: monthly * 12 };
      }
      const monthly = roundToRupee(amounts.reduce((t, a, i) => t + a * parts[i].days, 0) / periodDays);
      if (earnings && m.prorate) {
        // Σ a_i × (days_i × B − LOP_i × D) / (B × D), worked in whole numbers (LOP in half days).
        const num = amounts.reduce((t, a, i) => t + a * (2 * parts[i].days * baseDays - Math.round(2 * parts[i].lopDays * periodDays * 1e6) / 1e6), 0);
        paidPaise[code] = roundToRupee(num / (2 * baseDays * periodDays));
      }
      return { ...m, monthlyPaise: monthly, annualPaise: monthly * 12 };
    });
  };
  const earnings = merge((c) => c.earnings, true);
  const calc: SalaryCalcResult = {
    ...latest,
    earnings,
    reimbursements: merge((c) => c.reimbursements ?? [], false),
    benefits: merge((c) => c.benefits, false),
    deductions: merge((c) => c.deductions, false),
    grossMonthlyPaise: earnings.reduce((t, l) => t + l.monthlyPaise, 0),
  };
  return { calc, paidPaise };
}

/** Paid days of a part, in base days. */
export const paidDaysOf = (days: number, lopDays: number, periodDays: number, baseDays: number) =>
  Math.round(((days * baseDays) / periodDays - lopDays) * 100) / 100;

// ———————————————————————————————————————————— arrears for an earlier period

export interface ArrearsPeriod {
  period: string;
  from: string;
  to: string;
  baseDays: number;
  /** The earlier payslip's loss of pay (all of it, days not employed included). */
  lopDays: number;
  /** Joined / left inside that period, for where its days not employed fall. */
  joinedOn?: string;
  leftOn?: string;
}

/**
 * The paid share of the days [from, to] of an earlier period, from that period's payslip: its
 * loss of pay placed by allocateLop (days not employed where they fall, the rest by days).
 * Returns the days, the LOP placed in them and the prorated / not-prorated shares.
 */
export function arrearsShare(p: ArrearsPeriod, from: string, to: string) {
  const periodDays = daysBetween(p.from, p.to);
  const cuts = [
    { from: p.from, to: addDays(from, -1) },
    { from, to },
    { from: addDays(to, 1), to: p.to },
  ].filter((c) => c.from <= c.to);
  const notEmployedIn = (c: { from: string; to: string }) => {
    let n = 0;
    if (p.joinedOn && p.joinedOn > p.from) {
      const end = addDays(p.joinedOn, -1);
      if (end >= c.from) n += daysBetween(c.from, end < c.to ? end : c.to);
    }
    if (p.leftOn && p.leftOn < p.to) {
      const start = addDays(p.leftOn, 1);
      if (start <= c.to) n += daysBetween(start > c.from ? start : c.from, c.to);
    }
    return n;
  };
  const lop = allocateLop(p.lopDays, cuts.map((c) => ({ capacity: (daysBetween(c.from, c.to) * p.baseDays) / periodDays, notEmployed: notEmployedIn(c) })));
  const i = cuts.findIndex((c) => c.from === from);
  const days = daysBetween(from, to);
  return {
    days,
    lopDays: lop[i],
    periodDays,
    paidDays: paidDaysOf(days, lop[i], periodDays, p.baseDays),
    prorated: (days * p.baseDays - lop[i] * periodDays) / (p.baseDays * periodDays),
    whole: days / periodDays,
  };
}

export interface MonthlyLine {
  code: string;
  name: string;
  monthlyPaise: number;
  /** Paid by paid days (prorated) rather than by calendar days. */
  prorate: boolean;
}

/** A salary's recurring earnings as arrears compare them (one-time items left out). */
export const recurringEarnings = (calc: SalaryCalcResult): MonthlyLine[] =>
  calc.earnings.filter((l) => !l.oneTime).map((l) => ({ code: l.code, name: l.payslipName ?? l.name, monthlyPaise: l.monthlyPaise, prorate: l.prorate }));

/**
 * Arrears lines for part of an earlier period: per earning, the revised monthly amount less the
 * monthly amount the earlier payslip used, times the share of those days that payslip paid
 * (prorated earnings by its paid days, others by calendar days). Each line rounds to the rupee;
 * the total is their sum (it can be below zero: a revision that lowered pay. Never recovered
 * automatically: the run shows it and pays nothing for it).
 */
export function arrearsLines(oldLines: MonthlyLine[], newLines: MonthlyLine[], share: { prorated: number; whole: number }) {
  const codes = [...new Set([...newLines, ...oldLines].map((l) => l.code))];
  const lines = codes.map((code) => {
    const n = newLines.find((l) => l.code === code);
    const o = oldLines.find((l) => l.code === code);
    const meta = (n ?? o)!;
    const diff = (n?.monthlyPaise ?? 0) - (o?.monthlyPaise ?? 0);
    const amountPaise = roundToRupee(diff * (meta.prorate ? share.prorated : share.whole));
    return { code, name: meta.name, oldMonthlyPaise: o?.monthlyPaise ?? 0, newMonthlyPaise: n?.monthlyPaise ?? 0, amountPaise };
  }).filter((l) => l.amountPaise !== 0);
  return { lines, amountPaise: lines.reduce((t, l) => t + l.amountPaise, 0) };
}

/**
 * The structure as it stood at `at` (an earlier run's submission): the revisions saved by then,
 * and the salary the first revision saved after it replaced.
 */
export function structureAsKnownAt(structure: StructureLike, at: number): StructureLike {
  const later = (structure.revisions ?? []).filter((r) => atTime(r.at) > at).sort((a, b) => atTime(a.at) - atTime(b.at));
  if (later.length === 0) return structure;
  return { ...stateBefore(structure)(later[0]), revisions: (structure.revisions ?? []).filter((r) => atTime(r.at) <= at) };
}
