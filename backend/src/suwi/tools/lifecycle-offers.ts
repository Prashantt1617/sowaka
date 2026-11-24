// Employee lifecycle, the onboarding side (24 Nov, Suwi training): the onboarding board as an answer
// (who has an offer waiting, who has not answered, who is in week 1 or probation) and one card to
// create, revise or send an offer. Only where features.lifecycle is on. Every change runs the same
// service as the dashboard's Onboarding page (services/lifecycle/offers.ts). Sending needs the offer
// letter PDF the dashboard generates: without it Suwi says so and points to the page, never fails silently.
import { BOARD_COLUMNS, onboardingBoard } from '../../services/lifecycle/board';
import { createOffer, offerView, reviseOffer, sendOffer } from '../../services/lifecycle/offers';
import type { OfferFields } from '../../models/lifecycle.model';
import { defineExecutor, propose } from '../proposals';
import { defineTools, num, str, SuwiContext } from '../tools';
import { dayText, daysBetween, hrActorOf, inr, isDay, lifecycleOff, openJoiners, pickJoiner } from './lifecycle-common';
import { findPerson, roster } from './people';

const TABS = ['pre_boarding', 'first_week', 'probation'] as const;
type Tab = (typeof TABS)[number];
const TAB_LABEL: Record<Tab, string> = { pre_boarding: 'Pre-boarding', first_week: 'First week', probation: 'Probation' };
const ONBOARDING_LINK = { label: 'Open Onboarding', view: 'onboarding' };
const PRE_JOIN = new Set(['draft', 'offer_sent', 'accepted', 'finalised', 'active', 'docs_approved']);

defineTools({
  name: 'lifecycle_onboarding_board',
  area: 'people',
  label: (i) => `Onboarding board${i.tab ? ` (${String(i.tab).replace('_', ' ')})` : ''}`,
  description: 'The Onboarding board (employee lifecycle): every joiner from offer to the end of probation, with their stage, joining date, offer dates and what or whom they are waiting on. tab pre_boarding (default): offers and joiners not yet joined; columns offer_sent (draft or sent, not answered), accepted, documents, letters, ready_to_join. Use it for "Who has an offer waiting?" (column offer_sent) and "Which offers are not answered after 3 days?" (notAnsweredAfterDays 3). tab first_week: joined in the last 7 days. tab probation: joined, on probation; dueOnly true gives only those in their final month, whose confirm / extend decision is due ("Who is due for probation confirmation?"). Never shows pay. To change anything use prepare_offer, prepare_joiner_step or prepare_probation.',
  input_schema: {
    type: 'object',
    properties: {
      tab: { type: 'string', enum: [...TABS] },
      column: { type: 'string', description: 'Only this column (pre_boarding: offer_sent, accepted, documents, letters, ready_to_join; first_week: day1, week1_tasks, day7_survey, week_done; probation: month1, months_2_5, final_month, confirmed)' },
      notAnsweredAfterDays: { type: 'number', description: 'Offers sent more than this many days ago and still not accepted' },
      dueOnly: { type: 'boolean', description: 'probation: only the final month (decision due)' },
      name: { type: 'string', description: 'Only joiners whose name, role, team or manager matches' },
    },
  },
  api: { method: 'GET', path: '/admin/lifecycle/board' },
  async run(ctx, i) {
    const off = await lifecycleOff(ctx);
    if (off) return off;
    const tab: Tab = TABS.includes(str(i.tab) as Tab) && i.notAnsweredAfterDays === undefined ? (str(i.tab) as Tab) : 'pre_boarding';
    const board = await onboardingBoard(ctx.org, ctx.userId, { tab, ...(str(i.name) ? { q: str(i.name) } : {}) });
    const late = num(i.notAnsweredAfterDays, -1, 0, 365);
    let column = str(i.column, 40);
    if (tab === 'probation' && i.dueOnly) column = 'final_month';
    if (late >= 0) column = 'offer_sent';
    const label = new Map(BOARD_COLUMNS[tab].map((c) => [c.key as string, c.label]));
    let cards = board.columns.filter((c) => !column || c.key === column).flatMap((c) => c.cards);
    if (late >= 0) cards = cards.filter((c) => c.status === 'offer_sent' && c.offerSentAt && daysBetween(c.offerSentAt.slice(0, 10), ctx.today) > late);
    const rows = cards.map((c) => {
      const sent = c.offerSentAt?.slice(0, 10);
      return {
        journeyId: c.journeyId, name: c.name, role: c.designation ?? null, manager: c.managerName ?? null, stage: label.get(c.column) ?? c.column, status: c.statusLabel,
        joining: c.tj ?? null, dayLabel: c.dayLabel,
        ...(tab === 'pre_boarding' ? {
          offerSent: sent ?? (c.status === 'draft' ? 'not sent (draft)' : null), daysSinceSent: sent ? daysBetween(sent, ctx.today) : null,
          replyBy: c.replyBy ?? null, accepted: c.acceptedAt?.slice(0, 10) ?? null,
        } : {}),
        waitingOn: c.waitingOn.map((w) => `${w.title} (${w.ownerName ?? w.ownerRole}${w.dueAt ? `, due ${String(w.dueAt).slice(0, 10)}` : ''}${w.late ? ', late' : ''})`),
        flags: c.flags,
      };
    });
    return {
      data: {
        tab: TAB_LABEL[tab], column: column ? label.get(column) ?? column : 'all', count: rows.length, countsByTab: board.counts,
        joiners: rows.slice(0, 60), ...(rows.length > 60 ? { more: rows.length - 60 } : {}),
        ...(late >= 0 ? { note: `Offers sent more than ${late} days ago that the candidate has not accepted yet.` } : {}),
      },
      tables: rows.length ? [{
        title: `${TAB_LABEL[tab]}${column ? ` · ${label.get(column) ?? column}` : ''}`,
        columns: tab === 'pre_boarding' ? ['Name', 'Role', 'Stage', 'Joining', 'Offer sent', 'Reply by', 'Waiting on'] : ['Name', 'Role', 'Stage', 'Day', 'Waiting on'],
        rows: rows.slice(0, 200).map((r) => tab === 'pre_boarding'
          ? [r.name, r.role ?? '—', r.stage, dayText(r.joining), String(r.offerSent ?? '—'), dayText(r.replyBy as string | null), r.waitingOn[0] ?? '—']
          : [r.name, r.role ?? '—', r.stage, r.dayLabel, r.waitingOn[0] ?? '—']),
      }] : undefined,
      links: [ONBOARDING_LINK],
    };
  },
});

// ─── prepare_offer ──────────────────────────────────────────────────────────

const FIELD_LABEL: Partial<Record<keyof OfferFields, string>> = {
  designation: 'Role', department: 'Department', location: 'Location', ctc: 'Yearly CTC', tj: 'Joining date', managerUserId: 'Reporting manager',
  probationMonths: 'Probation', noticeDays: 'Notice period', validTill: 'Reply by', employeeType: 'Type',
};
const TYPE_LABEL: Record<string, string> = { full_time: 'Full-time', intern: 'Intern', contract: 'Contract' };

/** The offer fields HR gave (only those), checked the way the form checks them; the manager by name. */
async function fieldsFrom(ctx: SuwiContext, i: Record<string, unknown>): Promise<Partial<OfferFields> & { allowNonWorkingDay?: boolean }> {
  const f: Partial<OfferFields> & { allowNonWorkingDay?: boolean } = {};
  if (str(i.designation)) f.designation = str(i.designation, 120);
  if (str(i.department)) f.department = str(i.department, 120);
  if (str(i.location)) f.location = str(i.location, 120);
  if (i.ctc !== undefined && i.ctc !== null && i.ctc !== '') {
    const ctc = num(i.ctc, NaN);
    if (!Number.isFinite(ctc) || ctc <= 0) throw new Error('ctc is the yearly CTC in rupees (₹7.2L = 720000)');
    if (ctc < 10_000) throw new Error(`A yearly CTC of ₹${ctc} looks like lakhs, not rupees: give it in rupees (₹7.2L = 720000)`);
    f.ctc = Math.round(ctc);
  }
  if (str(i.joiningDate)) {
    if (!isDay(str(i.joiningDate))) throw new Error('joiningDate is YYYY-MM-DD');
    if (str(i.joiningDate) <= ctx.today) throw new Error(`The joining date must be after today (${dayText(ctx.today)})`);
    f.tj = str(i.joiningDate);
  }
  if (str(i.validTill)) {
    if (!isDay(str(i.validTill))) throw new Error('validTill is YYYY-MM-DD');
    f.validTill = str(i.validTill);
  }
  if (str(i.manager)) f.managerUserId = (await findPerson(ctx, i.manager, await roster(ctx))).userId;
  if (i.probationMonths !== undefined) f.probationMonths = num(i.probationMonths, 6, 0, 24);
  if (i.noticeDays !== undefined) f.noticeDays = num(i.noticeDays, 60, 0, 365);
  if (str(i.employeeType)) {
    if (!['full_time', 'intern', 'contract'].includes(str(i.employeeType))) throw new Error('employeeType is full_time, intern or contract');
    f.employeeType = str(i.employeeType) as OfferFields['employeeType'];
  }
  if (i.allowNonWorkingDay === true) f.allowNonWorkingDay = true;
  return f;
}

async function nameOfUser(ctx: SuwiContext, userId: string | undefined) {
  if (!userId) return '—';
  return (await roster(ctx)).find((p) => p.userId === userId)?.name ?? userId;
}
async function show(ctx: SuwiContext, k: keyof OfferFields, v: unknown): Promise<string> {
  if (v === undefined || v === null || v === '') return '—';
  if (k === 'ctc') return `${inr(Number(v))} a year`;
  if (k === 'tj' || k === 'validTill') return dayText(String(v));
  if (k === 'managerUserId') return nameOfUser(ctx, String(v));
  if (k === 'probationMonths') return `${v} months`;
  if (k === 'noticeDays') return `${v} days`;
  if (k === 'employeeType') return TYPE_LABEL[String(v)] ?? String(v);
  return String(v);
}

defineTools({
  name: 'prepare_offer',
  area: 'people',
  acts: true,
  label: (i) => `Prepared: ${str(i.action) || 'offer'} offer for ${str(i.candidate) || 'a candidate'}`,
  description: 'Prepare ONE card for an offer (employee lifecycle; needs access to pay). action create: a new candidate\'s offer as a draft (candidate = full name, personalEmail required, designation, ctc in RUPEES a year (₹7.2L = 720000), joiningDate YYYY-MM-DD after today, manager = reporting manager\'s name (required: ask if not given), optional department, location, probationMonths, noticeDays, validTill (reply-by, default a week), employeeType). action revise: change an open offer\'s terms (only the fields given change; a sent offer gets a new version the candidate must accept again). action send: email the current offer version with its PDF. "Send Ishaan an offer as …" with no offer yet is action create: the offer letter PDF is generated on the Onboarding page before it can be sent, and the card says so. Changes nothing until HR confirms. Not for documents, letters or joining (prepare_joiner_step) or probation (prepare_probation).',
  input_schema: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['create', 'revise', 'send'] },
      candidate: { type: 'string', description: 'Candidate\'s full name (create) or the joiner\'s name / journey id (revise, send)' },
      personalEmail: { type: 'string' }, phone: { type: 'string' },
      designation: { type: 'string' }, department: { type: 'string' }, location: { type: 'string' },
      ctc: { type: 'number', description: 'Yearly CTC in rupees, e.g. 720000 for ₹7.2L' },
      joiningDate: { type: 'string', description: 'YYYY-MM-DD' },
      manager: { type: 'string', description: 'Reporting manager: name, employee ID or userId' },
      probationMonths: { type: 'number' }, noticeDays: { type: 'number' },
      validTill: { type: 'string', description: 'Reply-by date YYYY-MM-DD (not after the joining date)' },
      employeeType: { type: 'string', enum: ['full_time', 'intern', 'contract'] },
      allowNonWorkingDay: { type: 'boolean', description: 'Only when HR confirms the joining day really is a holiday or week-off' },
    },
    required: ['action', 'candidate'],
  },
  api: { method: 'POST', path: '/admin/lifecycle/offers' },
  async run(ctx, i) {
    const off = await lifecycleOff(ctx);
    if (off) return off;
    const hr = hrActorOf(ctx);
    if (!hr.seesPay) return { data: { prepared: false, message: 'Making, changing or sending an offer needs access to pay (an admin, Payroll runs or Salary details). Ask someone with it.' } };
    const action = str(i.action);
    if (action === 'create') {
      const name = str(i.candidate, 120);
      const personalEmail = str(i.personalEmail, 200).toLowerCase();
      if (!name) throw new Error('Give the candidate\'s full name');
      if (!/^\S+@\S+\.\S+$/.test(personalEmail)) throw new Error(`Ask for ${name.split(' ')[0]}'s personal email: the offer goes there`);
      const f = await fieldsFrom(ctx, i);
      const missing = [!f.designation && 'role (designation)', !f.ctc && 'yearly CTC', !f.tj && 'joining date', !f.managerUserId && 'reporting manager'].filter(Boolean);
      if (missing.length) throw new Error(`To make the offer, ask for: ${missing.join(', ')}`);
      const open = (await openJoiners(ctx)).find((j) => (j.candidate?.personalEmail ?? '').toLowerCase() === personalEmail && PRE_JOIN.has(String(j.status)));
      if (open) return { data: { prepared: false, message: `${open.name} already has an open offer (${open.status}). Use action revise or send for them.` }, links: [ONBOARDING_LINK] };
      const lines = [];
      for (const k of ['designation', 'department', 'location', 'ctc', 'tj', 'managerUserId', 'employeeType', 'probationMonths', 'noticeDays', 'validTill'] as (keyof OfferFields)[]) {
        if (f[k] !== undefined) lines.push(`${FIELD_LABEL[k]}: ${await show(ctx, k, f[k])}`);
      }
      const title = `Offer for ${name}`;
      const proposalId = await propose(ctx, {
        kind: 'lifecycle_offer_create', area: 'people', title,
        summary: `A draft offer for ${name} (${personalEmail}) as ${f.designation}, ${inr(f.ctc!)} a year, joining ${dayText(f.tj)}. Nothing is emailed yet.`,
        lines: [
          { text: `Creates ${name}'s offer as a draft on the Onboarding board (Pre-boarding › Offer sent), with: ${lines.join('; ')}.` },
          { text: 'Probation and notice not given here take the onboarding template\'s and the company\'s defaults; reply-by defaults to a week from today (never after the joining day).', tone: 'info' },
          { text: `Not sent yet: the offer letter PDF is generated on Onboarding › ${name.split(' ')[0]} › Offer. Once it is there, press Send there or ask me to send it.`, tone: 'warn', why: 'The email carries the offer letter PDF; the dashboard makes it from the company\'s template.' },
          { text: 'No Undo from Suwi: a draft offer can be changed (revise) or closed on the Onboarding page.', tone: 'warn' },
        ],
        effectiveFrom: ctx.today, undoable: false,
        payload: { hr, candidate: { name, personalEmail, ...(str(i.phone) ? { phone: str(i.phone, 20) } : {}) }, fields: f },
      });
      return { data: { prepared: true, title, note: 'Nothing happens until HR confirms. The offer cannot be emailed until its PDF is generated on the Onboarding page.' }, proposalId, links: [ONBOARDING_LINK] };
    }

    if (action !== 'revise' && action !== 'send') throw new Error('action is create, revise or send');
    const joiner = pickJoiner((await openJoiners(ctx)).filter((j) => PRE_JOIN.has(String(j.status))), i.candidate, 'offer');
    const offer = await offerView(joiner.id);
    if (!offer) return { data: { prepared: false, message: `${joiner.name} has no offer on record (they may have been added with Confirm new user).` }, links: [ONBOARDING_LINK] };
    const first = joiner.name.split(' ')[0];

    if (action === 'send') {
      if (offer.status !== 'draft' && offer.status !== 'sent') return { data: { prepared: false, message: `${joiner.name}'s latest offer is ${offer.status}; there is nothing to send. Revise it to make a new version.` } };
      if (!offer.pdfFileId) {
        return {
          data: { prepared: false, blocked: 'Upload the offer letter PDF first', message: `${joiner.name}'s offer (version ${offer.version}) has no offer letter PDF yet, so it cannot be sent. Generate it on Onboarding › ${first} › Offer (the dashboard makes it from the company's template), then press Send there or ask me again.` },
          links: [ONBOARDING_LINK],
        };
      }
      if (offer.validTill < ctx.today) return { data: { prepared: false, message: `The reply-by date (${dayText(offer.validTill)}) has passed. Revise the offer with a new validTill first.` } };
      const to = joiner.candidate?.personalEmail ?? '';
      const title = `Send ${joiner.name}'s offer`;
      const f = offer.fields;
      const proposalId = await propose(ctx, {
        kind: 'lifecycle_offer_send', area: 'people', title,
        summary: `Emails ${joiner.name}'s offer letter (version ${offer.version}) to ${to}.`,
        lines: [
          { text: `Emails the offer letter PDF to ${to}: ${f.designation}, ${f.ctc ? `${inr(f.ctc)} a year, ` : ''}joining ${dayText(f.tj)}, reply by ${dayText(offer.validTill)}. The email asks ${first} to reply to accept.` },
          ...(offer.version > 1 && offer.status === 'draft' ? [{ text: `This is revision ${offer.version}: the earlier version is replaced and ${first} accepts again.`, tone: 'info' as const }] : []),
          ...(offer.status === 'sent' ? [{ text: 'This version was sent before: it goes again as a fresh email.', tone: 'info' as const }] : []),
          { text: 'Cannot be undone: the email goes out on Confirm.', tone: 'warn' },
        ],
        effectiveFrom: ctx.today, undoable: false,
        payload: { hr, journeyId: joiner.id, name: joiner.name, to },
      });
      return { data: { prepared: true, title, note: 'Nothing is emailed until HR confirms.' }, proposalId, links: [ONBOARDING_LINK] };
    }

    // revise
    const f = await fieldsFrom(ctx, i);
    const before = offer.fields as Partial<OfferFields>;
    const changes = (Object.keys(f) as (keyof OfferFields | 'allowNonWorkingDay')[])
      .filter((k): k is keyof OfferFields => k !== 'allowNonWorkingDay' && JSON.stringify(before[k] ?? null) !== JSON.stringify(f[k] ?? null));
    if (!changes.length) return { data: { prepared: false, message: 'Nothing would change: give the new terms (role, ctc, joiningDate, manager, …).' } };
    const rows = [];
    for (const k of changes) rows.push({ name: FIELD_LABEL[k] ?? k, current: await show(ctx, k, before[k]), next: await show(ctx, k, f[k]) });
    const draft = offer.status === 'draft';
    const title = `Change ${joiner.name}'s offer`;
    const proposalId = await propose(ctx, {
      kind: 'lifecycle_offer_revise', area: 'people', title,
      summary: `${rows.map((r) => `${r.name}: ${r.current} → ${r.next}`).join('; ')}.`,
      lines: [
        { text: `Changes ${joiner.name}'s offer: ${rows.map((r) => `${r.name} ${r.current} → ${r.next}`).join('; ')}.` },
        draft
          ? { text: `The offer is still a draft: it is edited in place. Its PDF showed the old terms, so it is generated again on the Onboarding page before sending.`, tone: 'info' }
          : { text: `The offer was sent: this makes version ${offer.version + 1} as a draft. ${first} keeps seeing the current one until the new version (with its PDF) is sent, then accepts again.`, tone: 'info' },
        { text: draft ? 'Undo puts the old terms back.' : 'No Undo from Suwi for a new version: change it again or close it on the Onboarding page.', tone: draft ? 'info' : 'warn' },
      ],
      effectiveFrom: ctx.today, undoable: draft,
      preview: { field: 'Offer', rows, skipped: [] },
      payload: { hr, journeyId: joiner.id, name: joiner.name, fields: f, before: Object.fromEntries(changes.map((k) => [k, before[k] ?? null])) },
    });
    return { data: { prepared: true, title, changes: rows, note: 'Nothing changes until HR confirms.' }, proposalId, links: [ONBOARDING_LINK] };
  },
});

type HrPayload = { hr: ReturnType<typeof hrActorOf> };

defineExecutor('lifecycle_offer_create', {
  async run(p) {
    const { hr, candidate, fields } = p.payload as HrPayload & { candidate: { name: string; personalEmail: string; phone?: string }; fields: Record<string, unknown> };
    await createOffer(hr, { candidate, fields });
    return { message: `${candidate.name}'s offer is saved as a draft. Generate the offer letter PDF on Onboarding › ${candidate.name.split(' ')[0]} › Offer, then send it.` };
  },
});

defineExecutor('lifecycle_offer_send', {
  async run(p) {
    const { hr, journeyId, name, to } = p.payload as HrPayload & { journeyId: string; name: string; to: string };
    const offer = await sendOffer(hr, journeyId, {});
    return { message: `${name}'s offer (version ${offer.version}) was emailed to ${to}.` };
  },
});

defineExecutor('lifecycle_offer_revise', {
  async run(p) {
    const { hr, journeyId, name, fields, before } = p.payload as HrPayload & { journeyId: string; name: string; fields: Record<string, unknown>; before: Record<string, unknown> };
    const was = await offerView(journeyId);
    const offer = await reviseOffer(hr, journeyId, fields);
    const inPlace = was?.status === 'draft' && offer.version === was.version;
    return {
      message: inPlace ? `${name}'s draft offer is updated. Generate its PDF again before sending.` : `${name}'s offer has a new version ${offer.version} (draft). Generate its PDF and send it.`,
      ...(inPlace ? { undo: { journeyId, before, version: offer.version } } : {}),
    };
  },
  async undo(p) {
    const { hr, name } = p.payload as HrPayload & { name: string };
    const u = p.undo as { journeyId: string; before: Record<string, unknown>; version: number } | undefined;
    if (!u) throw new Error('This change made a new offer version; it cannot be undone from Suwi');
    const now = await offerView(u.journeyId);
    if (!now || now.status !== 'draft' || now.version !== u.version) throw new Error('The offer has moved on since (sent or changed again); change it on the Onboarding page');
    const back = Object.fromEntries(Object.entries(u.before).filter(([, v]) => v !== null));
    await reviseOffer(hr, u.journeyId, { ...back, allowNonWorkingDay: true });
    return `${name}'s draft offer has its earlier terms back.`;
  },
});
