/**
 * The joiner app's own details screens (app build 90):
 *
 * - Employee profile, edit once: after joining, the joiner fills in the profile sections they left
 *   empty in pre-boarding (personal, contact, emergency, education, ID numbers: five). A
 *   section already filled, or saved once here, is read-only in the app; so is one HR approved
 *   (`locked` on the profile's section view, when HR's approval lock is there).
 * - Payroll details ("Complete your payroll details", screen 'payroll'): bank account, PF and
 *   nominees. It reuses the week-1 bank/PF change: the details wait for HR (decideBankPfRequest),
 *   who writes them to payroll. Sending them finishes the task. Since 24 Nov this is the only place
 *   the joiner gives bank and PF: it is no longer a profile section (profile.ts bankPfStatus: done
 *   once sent, approved once HR approves; HR can also edit it on the dashboard without the joiner).
 *
 * Kept in its own module so profile.ts and joinerApp.ts only gain what they export.
 */
import { employeePaymentDetails, journeys } from '../../config/db';
import type { BankPfChangeRequest, EmergencyContact, Journey, PfNominee } from '../../models/lifecycle.model';
import { encryptField, fieldKeyConfigured } from '../fieldCrypto';
import { joinerJourney } from './appOnboarding';
import { designOf } from './design';
import { joinerDesignTasks } from './designRows';
import { journeyDocumentsView, type CandidateDocumentView } from './documents';
import { LifecycleError, finishTaskById, tasksOf } from './engine';
import { PROFILE_OPTIONS, PROFILE_SECTIONS, appSectionTitle, profileView, sectionOfDocument, sectionStates, sectionValue, type ProfileSection } from './profile';
import { indianMobile } from './portal';

type Me = { userId: string; name: string; org: string };
type AppSection = Exclude<ProfileSection, 'photo'>;

const EMERGENCY_RELATIONS = ['Parent', 'Partner', 'Sibling', 'Friend'] as const;
export const NOMINEE_RELATIONS = ['Spouse', 'Father', 'Mother', 'Son', 'Daughter', 'Brother', 'Sister', 'Other'] as const;
const MAX_NOMINEES = 5;

const text = (v: unknown, max = 120) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const docDone = (d: CandidateDocumentView) => d.status !== 'todo' && d.status !== 'sent_back';

// ─── Employee profile, edit once ────────────────────────────────────────────

/** Whether each section's own fields are filled (uploads aside: the app does not take them). */
export function sectionsFilled(j: Pick<Journey, 'profile' | 'aboutYou'>): Record<AppSection, boolean> {
  const p = j.profile ?? {};
  const about = j.aboutYou ?? {};
  return {
    personal: Boolean(p.personal),
    contact: Boolean(p.contact),
    emergency: Boolean(about.emergencyContact),
    bank: Boolean(p.bank) && Boolean(about.pf),
    education: Boolean(p.education),
    ids: Boolean(p.ids?.aadhaarLast4 && p.ids?.panLast4),
  };
}

/** GET /lifecycle/joiner/profile — each section's answers (secrets as their last four) and whether it can still be filled here. */
export async function joinerProfileDetails(me: Me) {
  return profileDetailsOf(await joinerJourney(me.userId));
}

async function profileDetailsOf(j: Journey) {
  const docs = await journeyDocumentsView(j.id);
  const view = await profileView(j, docs);
  const done = sectionStates(j, docs);
  const filled = sectionsFilled(j);
  const sections = PROFILE_SECTIONS.map((key) => {
    const k = key as AppSection;
    // HR's approval lock, when the profile's section view carries it.
    const locked = (view.sections.find((s) => s.key === key) as { locked?: boolean } | undefined)?.locked === true;
    const savedAt = j.profileAppSaved?.[k];
    const missingDocuments = docs.filter((d) => d.required && sectionOfDocument(d) === key && !docDone(d)).map((d) => d.label);
    return {
      key, title: appSectionTitle(key),
      state: done[key] ? 'done' as const : filled[k] ? 'saved' as const : 'todo' as const,
      filled: filled[k],
      editable: !filled[k] && !savedAt && !locked,
      ...(savedAt ? { savedInAppAt: new Date(savedAt).toISOString() } : {}),
      ...(locked ? { locked: true as const } : {}),
      ...(missingDocuments.length ? { missingDocuments } : {}),
    };
  });
  return {
    sections,
    done: PROFILE_SECTIONS.filter((k) => done[k]).length,
    total: PROFILE_SECTIONS.length,
    values: {
      ...view.profile,
      ...(view.emergencyContact ? { emergencyContact: view.emergencyContact } : {}),
      ...(view.pf ? { pf: view.pf } : {}),
    },
    options: { ...PROFILE_OPTIONS, relations: EMERGENCY_RELATIONS },
  };
}

function emergencyContactOf(raw: unknown, ownPhone: unknown): EmergencyContact {
  const ec = (raw ?? {}) as Record<string, unknown>;
  const name = text(ec.name, 80);
  if (!name) throw new LifecycleError(400, 'Add your emergency contact’s name');
  const relation = String(ec.relation ?? '') as EmergencyContact['relation'];
  if (!EMERGENCY_RELATIONS.includes(relation)) throw new LifecycleError(400, 'Pick how your emergency contact is related to you');
  const phone = indianMobile(ec.phone);
  if (!phone) throw new LifecycleError(400, 'The emergency contact’s mobile number must be +91 and 10 digits');
  if (ownPhone && phone === indianMobile(ownPhone)) throw new LifecycleError(400, 'Add someone else’s number, not your own');
  return { name, relation, phone };
}

/** PUT /lifecycle/joiner/profile/:section — fills one section left empty before joining; once. */
export async function saveJoinerProfileSection(me: Me, sectionRaw: string, body: Record<string, unknown>, now = new Date()) {
  const j = await joinerJourney(me.userId);
  const section = PROFILE_SECTIONS.find((k) => k === sectionRaw) as AppSection | undefined;
  if (!section) throw new LifecycleError(400, `section is one of ${PROFILE_SECTIONS.join(', ')}`);
  const current = (await profileDetailsOf(j)).sections.find((s) => s.key === section)!;
  if (current.locked) throw new LifecycleError(409, 'HR approved this section; ask HR to change it');
  if (current.filled || current.savedInAppAt) throw new LifecycleError(409, 'This section is saved; ask HR to change it');
  const set: Record<string, unknown> = { [`profileAppSaved.${section}`]: now, updatedAt: now };
  if (section === 'emergency') {
    set['aboutYou.emergencyContact'] = emergencyContactOf(body.emergencyContact ?? body, j.candidate?.phone);
    set['aboutYou.savedAt'] = now;
  } else {
    const value = sectionValue(section, body, j, now);
    for (const [k, v] of Object.entries(value)) set[`profile.${k}`] = v;
    set['profile.savedAt'] = now;
  }
  // Once: the write only lands while the section is still unsaved here.
  const res = await journeys().updateOne({ id: j.id, [`profileAppSaved.${section}`]: { $exists: false } }, { $set: set });
  if (!res.modifiedCount) throw new LifecycleError(409, 'This section is saved; ask HR to change it');
  return profileDetailsOf(await joinerJourney(me.userId));
}

// ─── Payroll details: bank account, PF and nominees ─────────────────────────

const isDone = (status: string) => status === 'done' || status === 'skipped';

async function payrollTaskOf(j: Journey) {
  return joinerDesignTasks(j, await tasksOf(j.id), await designOf(j)).find((x) => x.row.design?.screen === 'payroll')?.task;
}

/** GET /lifecycle/joiner/payroll — what the form shows: the last details sent, else payroll's, else pre-boarding's. */
export async function joinerPayroll(me: Me) {
  return payrollViewOf(me, await joinerJourney(me.userId));
}

async function payrollViewOf(me: Me, j: Journey) {
  const [pay, task] = await Promise.all([
    employeePaymentDetails().findOne({ org: me.org, userId: me.userId }, { projection: { _id: 0, accountHolder: 1, bankName: 1, ifsc: 1, accountLast4: 1, uanLast4: 1, nominees: 1 } }),
    payrollTaskOf(j),
  ]);
  const req = j.bankPfRequest?.source === 'payroll_task' ? j.bankPfRequest : undefined;
  const pre = j.profile?.bank;
  const about = j.aboutYou?.pf;
  const pick = <T>(...values: Array<T | undefined>) => values.find((v) => v !== undefined && v !== '');
  const holderName = pick(req?.changes.accountHolder, pay?.accountHolder, pre?.holderName);
  const bankName = pick(req?.changes.bankName, pay?.bankName, pre?.bankName);
  const ifsc = pick(req?.changes.ifsc, pay?.ifsc, pre?.ifsc);
  const accountLast4 = pick(req?.changes.accountLast4, pay?.accountLast4, pre?.accountLast4);
  const firstJob = req ? req.firstJob === true : about?.firstJob === true;
  // The joiner's own UAN from pre-boarding is theirs to read back in full; one sent here or with payroll is its last four.
  const uan = !req && !firstJob && about?.uan ? about.uan : undefined;
  const uanLast4 = uan ? undefined : pick(req?.changes.uanLast4, pay?.uanLast4);
  const nominees = req?.nominees ?? pay?.nominees ?? [];
  return {
    bank: { ...(holderName ? { holderName } : {}), ...(bankName ? { bankName } : {}), ...(ifsc ? { ifsc } : {}), ...(accountLast4 ? { accountLast4 } : {}) },
    pf: { firstJob, ...(uan ? { uan } : {}), ...(uanLast4 ? { uanLast4 } : {}) },
    nominees: nominees.map((n) => ({ name: n.name, relation: n.relation, share: n.share })),
    relations: NOMINEE_RELATIONS,
    // todo: not sent; pending: with HR; approved: in payroll; declined: HR sent it back (with their note), send again.
    state: !req ? 'todo' as const : req.status,
    editable: !req || req.status === 'declined',
    ...(req ? { sentAt: new Date(req.requestedAt).toISOString() } : {}),
    ...(req?.decidedAt ? { decidedAt: new Date(req.decidedAt).toISOString() } : {}),
    ...(req?.hrNote ? { hrNote: req.hrNote } : {}),
    ...(task ? { taskId: task.id, taskDone: isDone(task.status) } : {}),
  };
}

function nomineesOf(raw: unknown): PfNominee[] {
  if (!Array.isArray(raw) || !raw.length) throw new LifecycleError(400, 'Add at least one nominee');
  if (raw.length > MAX_NOMINEES) throw new LifecycleError(400, `Add at most ${MAX_NOMINEES} nominees`);
  const list = raw.map((x, i) => {
    const n = (x ?? {}) as Record<string, unknown>;
    const which = raw.length === 1 ? 'your nominee' : `nominee ${i + 1}`;
    const name = text(n.name, 80);
    if (!name) throw new LifecycleError(400, `Add the name of ${which}`);
    const relation = String(n.relation ?? '');
    if (!(NOMINEE_RELATIONS as readonly string[]).includes(relation)) throw new LifecycleError(400, `Pick how ${which} is related to you`);
    const share = Number(n.share);
    if (!Number.isInteger(share) || share < 1 || share > 100) throw new LifecycleError(400, `The share of ${which} is a whole number from 1 to 100`);
    return { name, relation, share };
  });
  const total = list.reduce((sum, n) => sum + n.share, 0);
  if (total !== 100) throw new LifecycleError(400, `The nominees’ shares add up to ${total}%; they must add up to 100%`);
  return list;
}

/**
 * POST /lifecycle/joiner/payroll — the bank account, PF and nominees, to HR for approval (the week-1
 * bank/PF change: HR's approval writes them to payroll). Sending finishes the payroll details task.
 * Read-only while HR has it or once approved; sent again after HR declines it.
 */
export async function sendJoinerPayroll(me: Me, body: Record<string, unknown>, now = new Date()) {
  const j = await joinerJourney(me.userId);
  const task = await payrollTaskOf(j);
  if (task?.status === 'locked') throw new LifecycleError(409, 'This opens later');
  const previous = j.bankPfRequest?.source === 'payroll_task' ? j.bankPfRequest : undefined;
  if (previous && previous.status !== 'declined') throw new LifecycleError(409, previous.status === 'pending' ? 'HR has these details; they will approve or send them back' : 'These details are with payroll; ask HR to change them');

  const bank = (body.bank ?? {}) as Record<string, unknown>;
  const accountHolder = text(bank.holderName, 120);
  if (!accountHolder) throw new LifecycleError(400, 'Add the account holder’s name');
  const bankName = text(bank.bankName, 80);
  if (!bankName) throw new LifecycleError(400, 'Add the bank’s name');
  const ifsc = text(bank.ifsc, 11).toUpperCase();
  if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifsc)) throw new LifecycleError(400, 'That IFSC is not valid: 4 letters, 0, then 6 letters or digits');
  const changes: BankPfChangeRequest['changes'] = { accountHolder, bankName, ifsc };
  const acc = text(bank.accountNumber, 24).replace(/\s+/g, '');
  if (acc) {
    // Payroll's own rule (setPaymentDetails), so HR's approval can always write it.
    if (!/^\d{9,18}$/.test(acc)) throw new LifecycleError(400, 'An account number is 9 to 18 digits');
    if (text(bank.accountNumberAgain, 24).replace(/\s+/g, '') !== acc) throw new LifecycleError(400, 'The two account numbers don’t match');
    changes.accountLast4 = acc.slice(-4);
    if (fieldKeyConfigured()) changes.accountNumberEnc = encryptField(acc);
  } else {
    // Left blank: the number already given (sent here before, or in pre-boarding), or payroll's own.
    const kept = previous?.changes.accountLast4 ? previous.changes : j.profile?.bank;
    const pay = await employeePaymentDetails().findOne({ org: me.org, userId: me.userId }, { projection: { _id: 0, accountLast4: 1 } });
    if (kept?.accountLast4) {
      changes.accountLast4 = kept.accountLast4;
      if (kept.accountNumberEnc) changes.accountNumberEnc = kept.accountNumberEnc;
    } else if (!pay?.accountLast4) throw new LifecycleError(400, 'Add your account number');
  }

  const pf = (body.pf ?? {}) as Record<string, unknown>;
  const firstJob = pf.firstJob === true;
  if (!firstJob) {
    const uan = String(pf.uan ?? '').replace(/\s/g, '');
    if (uan) {
      if (!/^\d{12}$/.test(uan)) throw new LifecycleError(400, 'A UAN is 12 digits');
      changes.uanLast4 = uan.slice(-4);
      if (fieldKeyConfigured()) changes.uanEnc = encryptField(uan);
    } else if (previous?.changes.uanLast4) {
      changes.uanLast4 = previous.changes.uanLast4;
      if (previous.changes.uanEnc) changes.uanEnc = previous.changes.uanEnc;
    } else {
      const pay = await employeePaymentDetails().findOne({ org: me.org, userId: me.userId }, { projection: { _id: 0, uanLast4: 1 } });
      if (!pay?.uanLast4) throw new LifecycleError(400, 'Add your UAN, or choose “This is my first job”');
    }
  }
  const nominees = nomineesOf(body.nominees);

  const request: BankPfChangeRequest = { status: 'pending', source: 'payroll_task', changes, firstJob, nominees, requestedAt: now };
  await journeys().updateOne({ id: j.id }, { $set: { bankPfRequest: request, updatedAt: now } });
  if (task && !isDone(task.status)) await finishTaskById(j.id, task.id, 'done', { userId: me.userId, name: me.name });
  // HR approves it on the dashboard (no app push to HR).
  return payrollViewOf(me, await joinerJourney(me.userId));
}
