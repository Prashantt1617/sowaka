/**
 * Onboarding · Final designs — HR and IT & admin in the app (Actions › Onboarding, FINAL-DESIGNS.md
 * §4.4): the tile, the four stage cards and everyone, a person's page with that role's rows and due
 * pills and their whole onboarding, the nine-section profile, and each task's screen.
 *
 * Built from the onboarding board's kept data (`lc-board-data`, patched per journey by every write)
 * and the kept templates (`lc-templates`); a person's page reads their journey live.
 */
import { employeePaymentDetails, journeys, letters, salaryStructures, taxDeclarations, users } from '../../config/db';
import type { Journey, JourneyTask } from '../../models/lifecycle.model';
import { boardData } from './board';
import { designOf } from './design';
import { shortDay } from './designRules';
import { TEAM_EARLY } from './designSeed';
import { accessTasks, initialsOf, place, setRowTick, type Placed, type PlacedRow } from './designRows';
import { LifecycleError, finishTaskById, loadJourney, reopenTaskById, tasksOf } from './engine';
import { heroOf, progressOf, rowDone, rowView, rowsFor, type RowView } from './teamApp';

type Me = { userId: string; name: string; org: string };
type StaffRole = 'hr' | 'it';

const OPEN_STATUSES = new Set(['accepted', 'finalised', 'active', 'docs_approved', 'joined', 'moved_to_app', 'confirmed']);
const onScreen = (j: Journey) => OPEN_STATUSES.has(String(j.status)) && !j.closedAt && !(j.status === 'confirmed' && j.probation?.decision?.revealedAt);

/** My staff roles over the org's open journeys, and each journey placed. */
async function myJourneys(me: Me, now = new Date()): Promise<Array<{ p: Placed; tasks: JourneyTask[]; roles: StaffRole[] }>> {
  const data = await boardData(me.org, now);
  const out: Array<{ p: Placed; tasks: JourneyTask[]; roles: StaffRole[] }> = [];
  for (const j of data.all.filter(onScreen)) {
    const design = await designOf(j);
    if (!design.isDesign) continue;
    const a = design.settings.assignees ?? {};
    // Quick test before placing: HR is the assignee, else the joiner's HR contact or the offer's maker; IT only the assignee.
    if (a.itUserId !== me.userId && a.hrUserId && a.hrUserId !== me.userId) continue;
    const p = await place(j, now, design);
    const roles: StaffRole[] = [];
    if (p.people.hr === me.userId) roles.push('hr');
    if (p.people.it === me.userId) roles.push('it');
    if (roles.length) out.push({ p, tasks: data.tasksBy.get(j.id) ?? [], roles });
  }
  return out;
}

function pickRole(roles: StaffRole[], as: unknown): StaffRole {
  if (as === 'it' && roles.includes('it')) return 'it';
  if (as === 'hr' && roles.includes('hr')) return 'hr';
  return roles.includes('hr') ? 'hr' : 'it';
}

/** The rows that count now: not done, at or before the joiner's step (or early ones). */
function counted(p: Placed, tasks: JourneyTask[], role: StaffRole, first: string): RowView[] {
  return rowsFor(p, [role]).map((r) => rowView(r, p, tasks, first, role, new Map())).filter((v) => !v.done && (v.step <= p.step || TEAM_EARLY.has(v.id)));
}

function personPill(rows: RowView[]): { text: string; tone: 'green' | 'red' | 'amber' | 'grey' } {
  if (!rows.length) return { text: 'All done', tone: 'green' };
  const late = rows.filter((r) => r.late);
  if (late.length > 1) return { text: `${late.length} late`, tone: 'red' };
  const sorted = [...rows].filter((r) => r.dueOn).sort((a, b) => (a.dueOn ?? '').localeCompare(b.dueOn ?? ''));
  const first = sorted[0];
  return first?.due ? { text: first.due.text, tone: first.due.tone } : { text: `${rows.length} to do`, tone: 'grey' };
}

const nameOfJourney = (j: Journey, names: Map<string, string>) => (j.userId ? names.get(j.userId) : undefined) ?? j.candidate?.name ?? '—';

/** GET /lifecycle/staff/onboarding */
export async function staffOnboarding(me: Me, as?: unknown, now = new Date()) {
  const mine = await myJourneys(me, now);
  const roles = [...new Set(mine.flatMap((m) => m.roles))];
  if (!roles.length) throw new LifecycleError(404, 'No joiners for you');
  const viewingAs = pickRole(roles, as);
  const data = await boardData(me.org, now);
  const rows = mine.filter((m) => m.roles.includes(viewingAs)).map(({ p, tasks }) => {
    const name = nameOfJourney(p.j, data.names);
    const open = counted(p, tasks, viewingAs, name.split(/\s+/)[0] ?? name);
    const labels = ['Before Day 1', 'Day 1', 'Week 1', ...Array.from({ length: p.months }, (_, i) => `Month ${i + 1}`), 'Confirmed'];
    return {
      p, open,
      row: {
        journeyId: p.j.id, name, initials: initialsOf(name), stepLabel: p.step === 0 && p.j.tj ? `Joins ${shortDay(p.j.tj)}` : labels[p.step],
        pill: personPill(open),
      },
    };
  });
  const card = (key: 'joining_soon' | 'week1' | 'month1' | 'probation', title: string, test: (step: number) => boolean) => {
    const people = rows.filter((r) => test(r.p.step));
    return { key, title, count: people.length, late: people.filter((r) => r.open.some((o) => o.late)).length, people: people.map((r) => r.row) };
  };
  const cards = [
    card('joining_soon', 'Joining soon', (s) => s === 0),
    card('week1', 'Week 1', (s) => s === 1 || s === 2),
    card('month1', 'Month 1', (s) => s === 3),
    card('probation', 'Probation', (s) => s >= 4),
  ];
  return { viewingAs, canSwitch: roles.length > 1, cards, everyone: cards.flatMap((c) => c.people) };
}

/** `/lifecycle/me` · `staff`: the Actions tile for HR or IT & admin (none when nobody is theirs). */
export async function staffTile(me: Me, now = new Date()) {
  let mine: Awaited<ReturnType<typeof myJourneys>>;
  try { mine = await myJourneys(me, now); } catch { return undefined; }
  if (!mine.length) return undefined;
  const role = pickRole([...new Set(mine.flatMap((m) => m.roles))], undefined);
  const open = mine.filter((m) => m.roles.includes(role)).flatMap(({ p, tasks }) => counted(p, tasks, role, 'them'));
  const late = open.filter((r) => r.late).length;
  const dueToday = open.filter((r) => r.due?.text === 'Due today').length;
  const pill = late ? `${late} late` : dueToday ? `${dueToday} due today` : open.length ? `${open.length} to do` : undefined;
  return { role, open: open.length, late, dueToday, ...(pill ? { pill } : {}) };
}

async function staffJourney(me: Me, journeyId: string, as?: unknown) {
  const j = await loadJourney(journeyId);
  if (j.kind !== 'onboarding' || j.org !== me.org || j.closedAt) throw new LifecycleError(404, 'Joiner not found');
  const p = await place(j);
  const roles: StaffRole[] = [];
  if (p.people.hr === me.userId) roles.push('hr');
  if (p.people.it === me.userId) roles.push('it');
  if (!roles.length || !p.design.isDesign) throw new LifecycleError(404, 'Joiner not found');
  return { j, p, role: pickRole(roles, as), tasks: await tasksOf(j.id) };
}

/** GET /lifecycle/staff/joiners/:journeyId */
export async function staffJoinerPage(me: Me, journeyId: string, as?: unknown) {
  const { p, role, tasks } = await staffJourney(me, journeyId, as);
  const { first, joiner, names } = await heroOf(p, me, tasks);
  const rows = rowsFor(p, [role]).map((r) => rowView(r, p, tasks, first, role, names));
  const progress = await progressOf(p, tasks, role, names);
  return {
    joiner, viewingAs: role,
    card: { title: `Your tasks for ${first}`, toDo: rows.filter((r) => !r.done && r.step <= p.step).length },
    tasks: rows,
    onboarding: { status: joiner.status.label, rows: progress.rows },
    lists: progress.lists,
  };
}

// ─── The nine-section profile ───────────────────────────────────────────────

type Row = { label: string; value?: string };
type Section = { key: string; title: string; missing: number; rows: Row[] };
const section = (key: string, title: string, rows: Row[]): Section => ({ key, title, missing: rows.filter((r) => !r.value).length, rows });
const rupees = (n?: number) => (typeof n === 'number' ? `₹${Math.round(n).toLocaleString('en-IN')}` : undefined);
const addressOf = (a?: { line: string; city: string; state: string; pin: string }) => (a ? `${a.line}, ${a.city}, ${a.state} ${a.pin}` : undefined);
const dobOf = (key?: string) => (key ? new Date(`${key}T00:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }) : undefined);
const masked = (last4?: string) => (last4 ? `XXXX XXXX ${last4}` : undefined);

/** The nine sections; HR only sees bank, PF, salary and tax (never IT). */
export async function profileSections(j: Journey, role: StaffRole): Promise<{ pct: number; sections: Section[] }> {
  const pr = j.profile ?? {};
  const about = j.aboutYou ?? {};
  const user = j.userId ? await users().findOne({ userId: j.userId }, { projection: { _id: 0, name: 1, phone: 1, personalEmail: 1, employeeId: 1 } }) : null;
  const sections: Section[] = [
    section('personal', 'Personal details', [
      { label: 'Full name', value: pr.personal?.fullName ?? user?.name ?? j.candidate?.name },
      { label: 'Date of birth', value: dobOf(pr.personal?.dob) },
      { label: 'Gender', value: pr.personal?.gender },
      { label: 'Blood group', value: pr.personal?.bloodGroup },
      { label: 'Marital status', value: pr.personal?.maritalStatus },
      { label: 'Nationality', value: pr.personal?.nationality },
    ]),
    section('contact', 'Contact and address', [
      { label: 'Mobile', value: pr.contact?.mobile ?? user?.phone ?? j.candidate?.phone },
      { label: 'Personal email', value: user?.personalEmail ?? j.candidate?.personalEmail },
      { label: 'Current address', value: addressOf(pr.contact?.current) },
      { label: 'Permanent address', value: pr.contact?.permanentSame ? 'Same as current' : addressOf(pr.contact?.permanent) },
    ]),
    section('emergency', 'Emergency contact', [
      { label: 'Name', value: about.emergencyContact?.name },
      { label: 'Relation', value: about.emergencyContact?.relation },
      { label: 'Mobile', value: about.emergencyContact?.phone },
    ]),
    section('education', 'Education and experience', [
      { label: 'Highest degree', value: pr.education ? `${pr.education.qualification}, ${pr.education.institution}, ${pr.education.year}` : undefined },
      { label: 'Last employer', value: pr.experience?.firstJob ? 'First job' : pr.experience?.jobs?.[0]?.company },
      { label: 'Last role', value: pr.experience?.firstJob ? 'First job' : pr.experience?.jobs?.[0]?.role },
    ]),
    section('ids', 'ID documents', [
      { label: 'Aadhaar card', value: pr.ids?.aadhaarLast4 ? `Ending ${pr.ids.aadhaarLast4}` : undefined },
      { label: 'PAN card', value: pr.ids?.panLast4 ? `Ending ${pr.ids.panLast4}` : undefined },
      { label: 'Photo', value: pr.photoFileId ? 'Uploaded' : undefined },
    ]),
  ];
  if (role === 'hr') {
    const [pay, structure, tax] = j.userId ? await Promise.all([
      employeePaymentDetails().findOne({ org: j.org, userId: j.userId }, { projection: { _id: 0 } }),
      salaryStructures().findOne({ org: j.org, userId: j.userId }, { projection: { _id: 0 } }),
      taxDeclarations().find({ org: j.org, userId: j.userId }, { projection: { _id: 0 } }).sort({ fy: -1 }).limit(1).next(),
    ]) : [null, null, null];
    const bankName = pay?.bankName ?? pr.bank?.bankName;
    sections.push(section('bank', 'Bank account', [
      { label: 'Account holder', value: pay?.accountHolder ?? pr.bank?.holderName },
      { label: 'Bank', value: bankName },
      { label: 'Account number', value: masked(pay?.accountLast4 ?? pr.bank?.accountLast4) },
      { label: 'IFSC', value: pay?.ifsc ?? pr.bank?.ifsc },
    ]));
    let uan = pay?.uanLast4 ? masked(pay.uanLast4) : undefined;
    if (!uan && about.pf?.uan) uan = masked(about.pf.uan.slice(-4));
    sections.push(section('pf', 'PF and UAN', [
      { label: 'UAN', value: about.pf?.firstJob && !uan ? 'First job' : uan },
    ]));
    const ctc = structure?.annualCtcPaise ? structure.annualCtcPaise / 100 : undefined;
    sections.push(section('salary', 'Salary structure', [
      { label: 'CTC', value: ctc ? `${rupees(ctc)} a year` : undefined },
    ]));
    const d = tax?.declarations ?? {};
    const paise = (n?: number) => (typeof n === 'number' ? rupees(n / 100) : undefined);
    sections.push(section('tax', 'Tax and investments', [
      { label: 'Tax regime', value: tax?.regime ? (tax.regime === 'old' ? 'Old regime' : 'New regime') : undefined },
      ...(tax?.regime === 'new' ? [] : [
        { label: 'Section 80C', value: rupees(d.sec80C) },
        { label: 'Health insurance (80D)', value: rupees((d.sec80DSelf ?? 0) + (d.sec80DParents ?? 0) || undefined) },
        { label: 'Rent (HRA)', value: paise(d.rentPaidPaise) },
      ]),
      { label: 'Last employer, this year', value: d.previousEmployerSalaryPaise ? `${paise(d.previousEmployerSalaryPaise)} · TDS ${paise(d.previousEmployerTdsPaise ?? 0)}` : undefined },
    ]));
  }
  const filled = sections.reduce((n, s) => n + s.rows.filter((r) => r.value).length, 0);
  const total = sections.reduce((n, s) => n + s.rows.length, 0);
  return { pct: total ? Math.round((filled / total) * 100) : 0, sections };
}

/** GET /lifecycle/staff/joiners/:journeyId/profile */
export async function staffProfile(me: Me, journeyId: string, as?: unknown) {
  const { j, role } = await staffJourney(me, journeyId, as);
  const { pct, sections } = await profileSections(j, role);
  const name = j.candidate?.name ?? (j.userId ? (await users().findOne({ userId: j.userId }, { projection: { _id: 0, name: 1 } }))?.name : undefined) ?? '—';
  return { name, pct, sections };
}

// ─── Task screens ───────────────────────────────────────────────────────────

function myStaffRow(p: Placed, role: StaffRole, key: string): PlacedRow {
  const r = rowsFor(p, [role]).find((x) => x.rowKey === key);
  if (!r) throw new LifecycleError(404, 'Task not found');
  return r;
}

/** GET /lifecycle/staff/joiners/:journeyId/tasks/:key — what is needed to do it. */
export async function staffTaskScreen(me: Me, journeyId: string, key: string, as?: unknown) {
  const { j, p, role, tasks } = await staffJourney(me, journeyId, as);
  const r = myStaffRow(p, role, key);
  const base = r.row.team?.key ?? key;
  const checks = j.staffChecks?.[key];
  const out: Record<string, unknown> = { key, done: rowDone(r, j, tasks, p.design), ...(checks?.checks ? { checks: checks.checks } : {}) };
  if (r.row.design?.section === 'meeting') {
    out.meeting = { agenda: [...(r.row.agenda ?? r.row.team?.agenda ?? [])] };
    return out;
  }
  if (base === 'hr_prepare_kit' || base === 'hr_hand_kit') {
    const user = j.userId ? await users().findOne({ userId: j.userId }, { projection: { _id: 0, name: 1, designation: 1, department: 1, employeeId: 1 } }) : null;
    const idCard = {
      name: user?.name ?? j.candidate?.name ?? '—', ...((j.designation ?? user?.designation) ? { designation: j.designation ?? user?.designation } : {}),
      ...((j.department ?? user?.department) ? { department: j.department ?? user?.department } : {}), ...(user?.employeeId ? { employeeId: user.employeeId } : {}),
      ...(j.profile?.personal?.bloodGroup ? { bloodGroup: j.profile.personal.bloodGroup } : {}),
      ...(j.aboutYou?.emergencyContact ? { emergencyContact: j.aboutYou.emergencyContact.name } : {}),
      photo: j.profile?.photoFileId ? 'uploaded' : 'missing',
    };
    out.idCard = idCard;
    if (checks?.accessCardNo) out.accessCardNo = checks.accessCardNo;
    return out;
  }
  if (base === 'hr_check_payroll' || base === 'hr_check_form') {
    const { sections } = await profileSections(j, 'hr');
    const keys = base === 'hr_check_payroll' ? ['bank', 'pf', 'tax'] : ['personal', 'contact', 'emergency', 'education'];
    out.sections = sections.filter((s) => keys.includes(s.key));
    return out;
  }
  if (base === 'hr_confirmation_letter') {
    const rec = j.probation?.recommendation;
    const a = j.probation?.hodApproval;
    const decision = j.probation?.decision;
    const letter = await letters().find({ journeyId: j.id, kind: { $in: ['confirmation', 'extension'] } }, { projection: { _id: 0, id: 1, kind: 1, pdfFileId: 1, email: 1 } }).sort({ createdAt: -1 }).limit(1).next();
    out.facts = [
      { label: 'Approved by', value: a && a.outcome !== 'discuss' ? `${a.byName ?? ''} · ${shortDay(new Date(a.at).toISOString().slice(0, 10))}` : 'Waiting for the head of department' },
      ...(rec ? [{ label: 'Recommended by', value: rec.byName ?? '' }] : []),
      ...(decision ? [{ label: 'Confirmed from', value: shortDay(new Date(decision.decidedAt).toISOString().slice(0, 10)) }] : []),
      ...((decision?.designation ?? j.designation) ? [{ label: 'Designation', value: decision?.designation ?? j.designation ?? '' }] : []),
    ];
    if (letter) out.letter = { id: letter.id, state: letter.email?.sentAt ? 'sent' : letter.pdfFileId ? 'ready' : 'draft' };
    return out;
  }
  if (base === 'it_accesses' || base === 'hr_accesses') {
    const user = j.userId ? await users().findOne({ userId: j.userId }, { projection: { _id: 0, email: 1, phone: 1 } }) : null;
    const manager = j.managerUserId ? await users().findOne({ userId: j.managerUserId }, { projection: { _id: 0, name: 1 } }) : null;
    out.accesses = accessTasks(j, tasks, p.design).filter((t) => t.ownerRole === role).map((t) => {
      const details: Array<{ label: string; value: string }> = [];
      if (/email/i.test(t.title) && (j.candidate?.workEmail ?? user?.email)) details.push({ label: 'Address', value: (j.candidate?.workEmail ?? user?.email)! });
      if (/sowaka/i.test(t.title)) {
        if (user?.phone) details.push({ label: 'Sign-in', value: `OTP on ${user.phone.replace(/\d(?=\d{3})/g, 'X')}` });
        if (manager?.name) details.push({ label: 'Reports to', value: manager.name });
      }
      return { id: t.id, title: t.title, ready: t.status === 'done' || t.status === 'skipped', details };
    });
    return out;
  }
  return out;
}

/** POST /lifecycle/staff/joiners/:journeyId/tasks/:key */
export async function staffTaskAction(me: Me, journeyId: string, key: string, body: Record<string, unknown>, as?: unknown) {
  const { j, p, role, tasks } = await staffJourney(me, journeyId, as);
  const r = myStaffRow(p, role, key);
  const meeting = r.row.design?.section === 'meeting';
  if (meeting && r.opensOn && p.today < r.opensOn) throw new LifecycleError(409, 'A meeting is done on its day');
  const base = r.row.team?.key ?? key;
  const by = { userId: me.userId, name: me.name };
  if (base === 'it_accesses' || base === 'hr_accesses') {
    const wanted = (body.accesses ?? {}) as Record<string, unknown>;
    const mine = accessTasks(j, tasks, p.design).filter((t) => t.ownerRole === role);
    for (const [id, ready] of Object.entries(wanted)) {
      const t = mine.find((x) => x.id === id);
      if (!t) throw new LifecycleError(400, 'That access is not yours to set up');
      const isDone = t.status === 'done' || t.status === 'skipped';
      if (ready === true && !isDone) await finishTaskById(j.id, t.id, 'done', by);
      if (ready === false && isDone) await reopenTaskById(j.id, t.id);
    }
    return staffJoinerPage(me, journeyId, role);
  }
  const now = new Date();
  if (body.checks !== undefined || body.accessCardNo !== undefined) {
    const checks = body.checks && typeof body.checks === 'object' ? Object.fromEntries(Object.entries(body.checks as Record<string, unknown>)
      .filter(([, v]) => ['looks_right', 'ask', 'matches', 'mismatch'].includes(String(v))).map(([k, v]) => [k.slice(0, 40), String(v)])) : undefined;
    const card = typeof body.accessCardNo === 'string' ? body.accessCardNo.trim().slice(0, 40) : undefined;
    await journeys().updateOne({ id: j.id }, { $set: { [`staffChecks.${key}`]: { ...(checks ? { checks } : {}), ...(card ? { accessCardNo: card } : {}), at: now, byName: me.name }, updatedAt: now } });
  }
  if (body.action === 'done') await setRowTick(j.id, key, by);
  else if (body.action === 'undo') await setRowTick(j.id, key, null);
  else if (body.checks === undefined && body.accessCardNo === undefined) throw new LifecycleError(400, 'action is done or undo');
  return staffJoinerPage(me, journeyId, role);
}

