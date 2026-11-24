// Moving joiners along (employee lifecycle, 24 Nov Suwi training): pre-boarding (approve or send back
// documents, send the letters to sign, record the candidate's yes, mark joined) and probation (record a
// check-in, confirm, extend or not confirm). One card for one or many joiners; nothing changes until
// HR confirms, and each step runs the same service the Onboarding page's buttons call, joiner by joiner,
// reporting the ones that fail. Only where features.lifecycle is on.
import { journeys } from '../../config/db';
import type { Journey, JourneyTask } from '../../models/lifecycle.model';
import { actOnTaskByHr } from '../../services/lifecycle/board';
import { journeyDocumentsView, reviewDocument } from '../../services/lifecycle/documents';
import { ACTIVE_STATUSES, tasksOf } from '../../services/lifecycle/engine';
import { listLetters, MERGE_FIELDS, sendLetter } from '../../services/lifecycle/letters';
import { finaliseOffer, markJoined } from '../../services/lifecycle/offers';
import { recordDecision } from '../../services/lifecycle/probation';
import { defineExecutor, propose } from '../proposals';
import { defineTools, num, str, SuwiContext } from '../tools';
import { dayText, hrActorOf, JoinerRow, lifecycleOff, namesOf, openJoiners, pickJoiner, plural, runEach, seesDocumentsOf } from './lifecycle-common';

const ONBOARDING_LINK = { label: 'Open Onboarding', view: 'onboarding' };
const DOCUMENTS_LINK = { label: 'Open Documents', view: 'lifecycle_documents' };
type Skip = { who: string; reason: string };
type Row = { name: string; current: string; next: string };
const LETTER_TITLE: Record<string, string> = { appointment: 'Appointment letter', nda: 'NDA' };

/** The joiners named (one card for many); each name must find exactly one open journey. */
function pickMany(rows: JoinerRow[], v: unknown): JoinerRow[] {
  const names = namesOf(v);
  if (!names.length) throw new Error('Say which joiners: their names');
  const out: JoinerRow[] = [];
  for (const n of names) { const j = pickJoiner(rows, n); if (!out.some((x) => x.id === j.id)) out.push(j); }
  return out;
}

const STEP_ACTIONS = ['approve_documents', 'send_back_documents', 'send_letters', 'mark_accepted', 'mark_joined'] as const;
type StepAction = (typeof STEP_ACTIONS)[number];

/** The letters to sign (appointment, NDA) of a joiner, not signed yet. */
async function lettersToSign(org: string, journeyId: string) {
  return (await listLetters(org, { journeyId })).filter((l) => (l.kind === 'appointment' || l.kind === 'nda') && !l.signature && !l.outdatedAt);
}

defineTools({
  name: 'prepare_joiner_step',
  area: 'people',
  acts: true,
  label: (i) => `Prepared: ${String(i.action ?? 'step').replace(/_/g, ' ')} for ${namesOf(i.joiners).join(', ') || 'joiners'}`,
  description: 'Prepare ONE card that moves one or MANY joiners along pre-boarding (employee lifecycle). action approve_documents: approve their uploaded documents (all waiting ones, or only `documents` by label); the last required approval drafts the appointment letter and NDA. sendLetters true with it also emails the letters to sign when their PDFs are ready ("Approve Tanya\'s documents and send her letters"). action send_back_documents: ask the joiner to upload `documents` again with a `reason` (required; they are emailed). action send_letters: email the appointment letter and NDA to sign (their PDFs are generated on the Documents page; without them the answer says so). action mark_accepted: record that the candidate replied yes to the offer (opens their joining portal and emails its sign-in). action mark_joined: on or after the joining day, create the employee record ("Mark Kabir as joined"; workEmail if Basic details has none). Changes nothing until HR confirms. For offers use prepare_offer; for probation prepare_probation.',
  input_schema: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: [...STEP_ACTIONS] },
      joiners: { type: 'array', items: { type: 'string' }, description: 'Joiners\' names (or journey ids)' },
      documents: { type: 'array', items: { type: 'string' }, description: 'Document labels, e.g. "PAN card" (default: every one waiting for review)' },
      reason: { type: 'string', description: 'send_back_documents: what needs fixing (shown and emailed to the joiner)' },
      sendLetters: { type: 'boolean', description: 'approve_documents: also email the letters to sign when ready' },
      workEmail: { type: 'string', description: 'mark_joined, one joiner: their work email (else the one on Basic details)' },
      employeeId: { type: 'string', description: 'mark_joined, one joiner: their employee ID (else the one on Basic details)' },
    },
    required: ['action', 'joiners'],
  },
  api: { method: 'POST', path: '/admin/lifecycle/offers/x/mark-joined' },
  async run(ctx, i) {
    const off = await lifecycleOff(ctx);
    if (off) return off;
    const action = str(i.action) as StepAction;
    if (!STEP_ACTIONS.includes(action)) throw new Error(`action is one of ${STEP_ACTIONS.join(', ')}`);
    const hr = hrActorOf(ctx);
    if ((action === 'approve_documents' || action === 'send_back_documents') && !seesDocumentsOf(ctx)) {
      return { data: { prepared: false, message: 'Only HR (an admin, or someone with People › Employees) reviews candidates\' documents.' } };
    }
    const all = (await openJoiners(ctx)).filter((j) => !j.userId || action === 'mark_joined');
    const chosen = pickMany(all, i.joiners);
    const wanted = namesOf(i.documents).map((d) => d.toLowerCase());
    const reason = str(i.reason, 1000);
    if (action === 'send_back_documents' && !reason) throw new Error('Say what needs fixing (reason): the joiner is emailed it');
    if (action === 'send_back_documents' && !wanted.length) throw new Error('Say which documents to send back (documents: their labels)');
    const items: Array<Record<string, unknown> & { name: string; journeyId: string }> = [];
    const rows: Row[] = [];
    const skipped: Skip[] = [];
    const letterNote: string[] = [];

    for (const j of chosen) {
      const first = j.name.split(' ')[0];
      if (action === 'approve_documents' || action === 'send_back_documents') {
        const docs = await journeyDocumentsView(j.id);
        const match = (label: string) => !wanted.length || wanted.some((w) => label.toLowerCase().includes(w));
        const picked = docs.filter((d) => match(d.label) && (action === 'approve_documents' ? d.status === 'in_review' : d.status !== 'sent_back'));
        if (!picked.length) {
          const waiting = docs.filter((d) => d.status === 'todo' || d.status === 'sent_back').map((d) => d.label);
          skipped.push({ who: j.name, reason: action === 'approve_documents' ? `Nothing uploaded to review${waiting.length ? ` (still to upload: ${waiting.slice(0, 4).join(', ')})` : ''}` : 'No such document to send back' });
          continue;
        }
        const left = docs.filter((d) => d.required && d.status !== 'approved' && !picked.some((p) => p.id === d.id));
        items.push({ name: j.name, journeyId: j.id, docIds: picked.map((d) => d.id), personalEmail: j.candidate?.personalEmail ?? '' });
        rows.push({ name: j.name, current: picked.map((d) => d.label).join(', '), next: action === 'approve_documents' ? (left.length ? `Approved (${left.length} required still open)` : 'Approved: all required done, letters drafted') : 'Sent back' });
        if (action === 'approve_documents' && i.sendLetters === true) {
          const ready = (await lettersToSign(ctx.org, j.id)).filter((l) => l.pdfFileId);
          const sendable = ready.filter((l) => !l.missing.length);
          letterNote.push(sendable.length ? `${first}: ${sendable.map((l) => LETTER_TITLE[l.kind]).join(' and ')} emailed to sign after approval` : `${first}: the letters have no PDF yet. They are drafted when the last required document is approved; generate their PDFs on the Documents page and ${first} is emailed to sign as soon as both are there`);
        }
      } else if (action === 'send_letters') {
        const letters = await lettersToSign(ctx.org, j.id);
        if (!letters.length) {
          const day1 = (await journeys().findOne({ id: j.id }, { projection: { _id: 0, 'templateSnapshot.settings.signLettersOnDay1': 1 } }))?.templateSnapshot?.settings?.signLettersOnDay1 === true;
          skipped.push({ who: j.name, reason: day1 ? 'Their template has the letters signed on Day 1 in the app: nothing to send before joining' : 'No letters to sign yet: they are drafted once every required document is approved' });
          continue;
        }
        const noPdf = letters.filter((l) => !l.pdfFileId);
        const payBlocked = letters.filter((l) => l.kind === 'appointment' && !hr.seesPay);
        const gaps = letters.filter((l) => l.pdfFileId && l.missing.length);
        const ready = letters.filter((l) => l.pdfFileId && !l.missing.length && !payBlocked.includes(l));
        if (!ready.length) {
          skipped.push({
            who: j.name,
            reason: noPdf.length ? `Generate the PDF first (${noPdf.map((l) => LETTER_TITLE[l.kind]).join(', ')}) on the Documents page`
              : gaps.length ? `Fill the missing details first on the Documents page: ${[...new Set(gaps.flatMap((l) => l.missing))].map((k) => MERGE_FIELDS[k] ?? k).join(', ')}`
                : 'The appointment letter states pay: it needs access to pay',
          });
          continue;
        }
        if (gaps.length) letterNote.push(`${first}: ${gaps.map((l) => LETTER_TITLE[l.kind]).join(', ')} is missing details (${[...new Set(gaps.flatMap((l) => l.missing))].map((k) => MERGE_FIELDS[k] ?? k).join(', ')}) and is not sent`);
        items.push({ name: j.name, journeyId: j.id, letterIds: ready.map((l) => l.id), to: j.candidate?.personalEmail ?? '', tj: j.tj ?? '' });
        rows.push({ name: j.name, current: ready.map((l) => LETTER_TITLE[l.kind]).join(' and '), next: `Emailed to ${j.candidate?.personalEmail ?? '—'}` });
        if (noPdf.length) letterNote.push(`${first}: ${noPdf.map((l) => LETTER_TITLE[l.kind]).join(', ')} has no PDF yet and is not sent`);
      } else if (action === 'mark_accepted') {
        if (!['offer_sent', 'accepted'].includes(String(j.status))) { skipped.push({ who: j.name, reason: j.status === 'draft' ? 'The offer has not been sent yet' : `Already past acceptance (${j.status})` }); continue; }
        items.push({ name: j.name, journeyId: j.id });
        rows.push({ name: j.name, current: 'Offer sent', next: 'Accepted: joining portal opened' });
      } else {
        if (!['finalised', 'active', 'docs_approved'].includes(String(j.status))) { skipped.push({ who: j.name, reason: `Only a finalised offer can be marked joined (now: ${j.status})` }); continue; }
        if (j.tj && j.tj > ctx.today) { skipped.push({ who: j.name, reason: `Mark joined opens on the joining day (${dayText(j.tj)})` }); continue; }
        const full = await journeys().findOne({ id: j.id }, { projection: { _id: 0, candidate: 1, appAccess: 1, employeeId: 1 } }) as Pick<Journey, 'candidate' | 'appAccess' | 'employeeId'> | null;
        const single = chosen.length === 1;
        const workEmail = (single ? str(i.workEmail, 200) : '') || full?.candidate?.workEmail || '';
        if (!workEmail && !full?.appAccess) { skipped.push({ who: j.name, reason: 'Needs a work email: give workEmail, or set it on Basic details' }); continue; }
        items.push({ name: j.name, journeyId: j.id, workEmail, employeeId: (single ? str(i.employeeId, 40) : '') || full?.employeeId || '' });
        rows.push({ name: j.name, current: `Joining ${dayText(j.tj)}`, next: `Joined: employee record${workEmail ? ` (${workEmail})` : ''}` });
      }
    }
    if (!items.length) return { data: { prepared: false, message: 'Nothing to do for these joiners.', skipped }, links: [action === 'send_letters' ? DOCUMENTS_LINK : ONBOARDING_LINK] };

    const n = plural(items.length, 'joiner');
    const TITLES: Record<StepAction, string> = {
      approve_documents: `Approve documents for ${n}`, send_back_documents: `Send documents back to ${n}`, send_letters: `Send letters to sign to ${n}`,
      mark_accepted: `Mark ${n} as accepted`, mark_joined: `Mark ${n} as joined`,
    };
    const EFFECT: Record<StepAction, string> = {
      approve_documents: 'Each document listed is approved. When the last required one is, the joiner moves to Letters to sign and the appointment letter and NDA are drafted from the accepted offer.',
      send_back_documents: `Each document listed goes back to the joiner with your reason ("${reason}"); they are emailed to upload it again and it leads their portal.`,
      send_letters: 'Each letter\'s PDF is emailed to the joiner\'s personal email with a link to their joining portal, where they sign it.',
      mark_accepted: 'Records that the candidate replied yes: the offer is accepted, their joining portal account is made and its sign-in is emailed to them.',
      mark_joined: 'Creates the employee record from the accepted offer (role, team, manager, joining day), starts their first week in the app and emails them how to sign in. They count in headcount and payroll from their joining day.',
    };
    const title = TITLES[action];
    const proposalId = await propose(ctx, {
      kind: 'lifecycle_joiner_step', area: 'people', title,
      summary: `${title}: ${items.map((x) => x.name).join(', ')}.${skipped.length ? ` ${skipped.length} left out.` : ''}`,
      lines: [
        { text: `${title} (listed in the table), by ${ctx.user.name} as HR.` },
        { text: EFFECT[action], tone: 'info' },
        ...letterNote.map((t) => ({ text: t, tone: 'info' as const })),
        ...(skipped.length ? [{ text: `Left out: ${skipped.map((s) => `${s.who} (${s.reason})`).join('; ')}.`, tone: 'warn' as const }] : []),
        { text: 'Cannot be undone from Suwi: emails go out on Confirm.', tone: 'warn' },
      ],
      effectiveFrom: ctx.today, undoable: false,
      preview: { field: action === 'send_back_documents' ? 'Sent back' : 'After', rows, skipped },
      payload: { hr, action, reason, sendLetters: i.sendLetters === true, items },
    });
    return { data: { prepared: true, title, joiners: items.length, leftOut: skipped, note: 'Nothing changes until HR confirms. The table lists each joiner: do not repeat it.' }, proposalId, links: [ONBOARDING_LINK] };
  },
});

async function emailLetters(hr: ReturnType<typeof hrActorOf>, name: string, letterIds: string[], to: string, tj: string) {
  const first = name.split(' ')[0];
  for (const id of letterIds) {
    await sendLetter(hr, id, {
      to, withPortalLink: true, subject: 'Your letters are ready to sign',
      body: `Hi ${first},\n\nYour letter is attached. Please read it and sign it on your joining portal${tj ? ` before ${dayText(tj)}` : ''}.\n\nWarm regards,\n${hr.name}`,
    });
  }
}

defineExecutor('lifecycle_joiner_step', {
  async run(p) {
    const { hr, action, reason, sendLetters, items } = p.payload as { hr: ReturnType<typeof hrActorOf>; action: StepAction; reason: string; sendLetters: boolean; items: Array<Record<string, unknown> & { name: string; journeyId: string }> };
    const VERB: Record<StepAction, string> = { approve_documents: 'Approved documents for', send_back_documents: 'Sent documents back to', send_letters: 'Sent letters to', mark_accepted: 'Marked accepted:', mark_joined: 'Marked joined:' };
    const r = await runEach(items, async (x) => {
      if (action === 'approve_documents' || action === 'send_back_documents') {
        for (const id of x.docIds as string[]) await reviewDocument(hr, id, { decision: action === 'approve_documents' ? 'approve' : 'send_back', ...(reason ? { note: reason } : {}) });
        if (action === 'approve_documents' && sendLetters) {
          const ready = (await lettersToSign(hr.org, x.journeyId)).filter((l) => l.pdfFileId && !l.missing.length && (l.kind !== 'appointment' || hr.seesPay));
          const j = await journeys().findOne({ id: x.journeyId }, { projection: { _id: 0, candidate: 1, tj: 1 } });
          if (ready.length && j?.candidate?.personalEmail) await emailLetters(hr, x.name, ready.map((l) => l.id), j.candidate.personalEmail, j.tj ?? '');
        }
      } else if (action === 'send_letters') {
        await emailLetters(hr, x.name, x.letterIds as string[], String(x.to), String(x.tj ?? ''));
      } else if (action === 'mark_accepted') {
        await finaliseOffer(hr, x.journeyId);
      } else {
        await markJoined(hr, x.journeyId, { ...(x.workEmail ? { workEmail: x.workEmail } : {}), ...(x.employeeId ? { employeeId: x.employeeId } : {}) });
      }
    }, VERB[action]);
    return { message: r.message };
  },
});

// ─── Probation ──────────────────────────────────────────────────────────────

const PROBATION_ACTIONS = ['checkin', 'confirm', 'extend', 'not_confirm'] as const;
type ProbationAction = (typeof PROBATION_ACTIONS)[number];
const isActive = (t: JourneyTask) => ACTIVE_STATUSES.includes(t.status);

defineTools({
  name: 'prepare_probation',
  area: 'people',
  acts: true,
  label: (i) => `Prepared: ${String(i.action ?? 'probation').replace('_', ' ')} for ${namesOf(i.joiners).join(', ') || 'joiners'}`,
  description: 'Prepare ONE card for probation (employee lifecycle) for one or MANY joined employees. action confirm ("Confirm Dev after probation"), extend with extendMonths 1–6 ("Extend Ritika by 2 months"), not_confirm: HR\'s final-month decision; it opens in the final probation month, and the card says when it opens if it is not open yet. action checkin: record this month\'s probation check-in as done, with a note (the meeting happened). The confirmation or extension letter is then made and sent from the Documents page. Changes nothing until HR confirms. To see who is due use lifecycle_onboarding_board with tab probation and dueOnly true.',
  input_schema: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: [...PROBATION_ACTIONS] },
      joiners: { type: 'array', items: { type: 'string' }, description: 'Employees\' names' },
      extendMonths: { type: 'number', description: 'extend: 1 to 6 months' },
      month: { type: 'number', description: 'checkin: which probation month (default the one open now)' },
      note: { type: 'string', description: 'checkin: what was discussed' },
    },
    required: ['action', 'joiners'],
  },
  api: { method: 'POST', path: '/admin/lifecycle/journeys/x/decision' },
  async run(ctx: SuwiContext, i) {
    const off = await lifecycleOff(ctx);
    if (off) return off;
    const action = str(i.action) as ProbationAction;
    if (!PROBATION_ACTIONS.includes(action)) throw new Error(`action is one of ${PROBATION_ACTIONS.join(', ')}`);
    const extendMonths = action === 'extend' ? num(i.extendMonths, NaN) : undefined;
    if (action === 'extend' && (!Number.isInteger(extendMonths) || extendMonths! < 1 || extendMonths! > 6)) throw new Error('Extend by a whole number of months, 1 to 6 (extendMonths)');
    const note = str(i.note, 1000);
    const chosen = pickMany((await openJoiners(ctx)).filter((j) => !!j.userId), i.joiners);
    const items: Array<{ name: string; journeyId: string; taskId?: string; month?: number }> = [];
    const rows: Row[] = [];
    const skipped: Skip[] = [];
    for (const j of chosen) {
      const tasks = (await tasksOf(j.id)).filter((t) => t.status !== 'cancelled');
      if (action === 'checkin') {
        const checkins = tasks.filter((t) => t.systemKey === 'monthly_checkin').sort((a, b) => (a.month ?? 0) - (b.month ?? 0));
        const want = i.month !== undefined ? num(i.month, 0, 1, 24) : 0;
        const task = want ? checkins.find((t) => t.month === want) : checkins.find(isActive);
        if (!task) { skipped.push({ who: j.name, reason: want ? `No month-${want} check-in` : 'No check-in is open now' }); continue; }
        if (task.status === 'done' || task.status === 'skipped') { skipped.push({ who: j.name, reason: `The month-${task.month} check-in is already done` }); continue; }
        if (task.status === 'locked') { skipped.push({ who: j.name, reason: `The month-${task.month} check-in opens ${task.opensAt ? `on ${dayText(new Date(task.opensAt).toISOString().slice(0, 10))}` : 'later'}` }); continue; }
        items.push({ name: j.name, journeyId: j.id, taskId: task.id, month: task.month });
        rows.push({ name: j.name, current: `Month ${task.month} check-in open`, next: `Done${note ? `: "${note.slice(0, 80)}"` : ''}` });
        continue;
      }
      if (j.status === 'confirmed') { skipped.push({ who: j.name, reason: 'Already confirmed' }); continue; }
      const discussion = tasks.filter((t) => t.systemKey === 'confirmation_discussion').sort((a, b) => (b.month ?? 0) - (a.month ?? 0))[0];
      if (discussion && !isActive(discussion)) {
        skipped.push({ who: j.name, reason: discussion.status === 'locked' ? `The decision opens in the final month${discussion.opensAt ? ` (${dayText(new Date(discussion.opensAt).toISOString().slice(0, 10))})` : ''}` : 'A decision was already recorded for this cycle' });
        continue;
      }
      items.push({ name: j.name, journeyId: j.id });
      rows.push({
        name: j.name, current: `On probation since ${dayText(j.tj)}`,
        next: action === 'confirm' ? 'Confirmed' : action === 'extend' ? `Extended by ${extendMonths} months` : 'Not confirmed',
      });
    }
    if (!items.length) return { data: { prepared: false, message: 'Nothing to record for these people.', skipped }, links: [ONBOARDING_LINK] };
    const n = plural(items.length, 'person', 'people');
    const title = action === 'checkin' ? `Record check-in for ${n}` : action === 'confirm' ? `Confirm ${n} after probation` : action === 'extend' ? `Extend probation of ${n} by ${extendMonths} months` : `Record ${n} as not confirmed`;
    const effect = action === 'checkin'
      ? 'The month\'s check-in task is marked done by you, with your note. The month\'s review stays with the manager.'
      : action === 'confirm'
        ? 'Each is confirmed: what is left of their probation tasks closes and their manager is told. Next: make and send the confirmation letter from the Documents page (their reveal in the app opens with it).'
        : action === 'extend'
          ? `Each one's probation runs ${extendMonths} more months with a new review cycle and a new final month; their manager is told. Next: send the extension letter from the Documents page.`
          : 'Each is recorded as not confirmed and their manager is told. If they are leaving, start their exit from Offboarding.';
    const proposalId = await propose(ctx, {
      kind: 'lifecycle_probation', area: 'people', title,
      summary: `${title}: ${items.map((x) => x.name).join(', ')}.${skipped.length ? ` ${skipped.length} left out.` : ''}`,
      lines: [
        { text: `${title} (listed in the table), by ${ctx.user.name} as HR.` },
        { text: effect, tone: 'info' },
        ...(skipped.length ? [{ text: `Left out: ${skipped.map((s) => `${s.who} (${s.reason})`).join('; ')}.`, tone: 'warn' as const }] : []),
        action === 'checkin'
          ? { text: 'Undo opens the check-in again.', tone: 'info' }
          : { text: 'Cannot be undone from Suwi: a recorded decision stays (the manager is told at once).', tone: 'warn' },
      ],
      effectiveFrom: ctx.today, undoable: action === 'checkin',
      preview: { field: 'After', rows, skipped },
      payload: { hr: hrActorOf(ctx), action, extendMonths, note, items },
    });
    return { data: { prepared: true, title, people: items.length, leftOut: skipped, note: 'Nothing changes until HR confirms. The table lists each person: do not repeat it.' }, proposalId, links: [ONBOARDING_LINK] };
  },
});

defineExecutor('lifecycle_probation', {
  async run(p) {
    const { hr, action, extendMonths, note, items } = p.payload as { hr: ReturnType<typeof hrActorOf>; action: ProbationAction; extendMonths?: number; note: string; items: Array<{ name: string; journeyId: string; taskId?: string }> };
    const done: Array<{ journeyId: string; taskId: string }> = [];
    const r = await runEach(items, async (x) => {
      if (action === 'checkin') {
        await actOnTaskByHr(hr.org, x.journeyId, x.taskId!, { action: 'done', ...(note ? { note } : {}) }, hr);
        done.push({ journeyId: x.journeyId, taskId: x.taskId! });
      } else {
        await recordDecision(x.journeyId, hr, { outcome: action, ...(action === 'extend' ? { extendMonths } : {}) });
      }
    }, action === 'checkin' ? 'Recorded the check-in of' : action === 'confirm' ? 'Confirmed' : action === 'extend' ? 'Extended the probation of' : 'Recorded as not confirmed:', 'person');
    return { message: r.message, ...(action === 'checkin' ? { undo: { done } } : {}) };
  },
  async undo(p) {
    const { hr } = p.payload as { hr: ReturnType<typeof hrActorOf> };
    const { done } = (p.undo ?? { done: [] }) as { done: Array<{ journeyId: string; taskId: string }> };
    for (const d of done) await actOnTaskByHr(hr.org, d.journeyId, d.taskId, { action: 'reopen' }, hr);
    return `Opened ${plural(done.length, 'check-in')} again.`;
  },
});

