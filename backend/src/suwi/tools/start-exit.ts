// Recording someone's exit instead of deleting them ("Start an exit for Meera, last day 14 Nov, end of
// contract"). A company with the employee lifecycle on starts it the way Offboarding's "Start an exit" does
// (lifecycle/offboarding.ts startExit: the exit, its journey, clearance and handover), with notice handling
// "not applicable"; any other company records it as People › Employee › Record exit does (exit.service
// recordExit). Either way the person keeps their records, works their notice and loses access the day after
// the last working day. The notice is the person's own, from their offer letter (noticeDaysForUser), never
// typed in, and no notice pay or recovery is set. Undo withdraws a classic exit; a lifecycle exit has a
// journey that is closed from the Offboarding board, so it has no Undo here.
import { companies, journeys, resignations, users } from '../../config/db';
import { exitSettings, recordExit, withdrawExit } from '../../services/exit.service';
import { EXIT_TYPE_LABEL, EXIT_TYPES, KIND_OF, appPageDefault, requireLifecycleOrg, startExit } from '../../services/lifecycle/offboarding';
import { DEFAULT_PERSON_NOTICE_DAYS, noticeDaysForUser } from '../../services/lifecycle/templates';
import type { OffboardingExitType } from '../../models/user.model';
import { defineTools, str } from '../tools';
import { defineExecutor, propose } from '../proposals';
import { waitingOn } from './manager';
import { findPerson, norm, roster, teamOf } from './people';
import { addDays, isDate, niceDate } from './team';

const TYPE_WORDS: [RegExp, OffboardingExitType][] = [
  [/contract|fixed term|tenure/, 'end_of_contract'], [/retire/, 'retirement'], [/terminat|fired|let go|dismiss/, 'termination'],
  [/abscond|no show|stopped coming/, 'absconding'], [/resign|quit|leaving|left/, 'resignation'],
];
const typeOf = (v: unknown): OffboardingExitType | null => {
  const k = norm(v).replace(/ /g, '_');
  if ((EXIT_TYPES as string[]).includes(k)) return k as OffboardingExitType;
  return TYPE_WORDS.find(([re]) => re.test(norm(v)))?.[1] ?? null;
};

defineTools({
  name: 'prepare_start_exit',
  area: 'people',
  acts: true,
  label: (i) => `Prepared: start an exit for ${str(i.person) || 'someone'}`,
  description: 'Prepare recording that someone is LEAVING (resignation, retirement, end of contract, termination, absconding) with their last working day, e.g. "Start an exit for Meera, last day 14 Nov, end of contract". This is the right tool for anyone who is leaving or has left: it keeps their record, attendance, payslips and documents, puts them on notice until the last day and ends app access the day after (People › Exits, or Offboarding when the employee lifecycle is on). Inputs: person, lastWorkingDay YYYY-MM-DD, exitType, newManager (needed when people report to them: who they report to next), note. The notice period comes from their offer letter and is never asked for; no notice pay or recovery is set. Changes nothing until HR confirms by typing the name. Use prepare_delete_employee only to remove a record added by mistake.',
  input_schema: {
    type: 'object',
    properties: {
      person: { type: 'string', description: 'Name, employee ID or userId of the person leaving' },
      lastWorkingDay: { type: 'string', description: 'YYYY-MM-DD' },
      exitType: { type: 'string', enum: EXIT_TYPES, description: 'Why they are leaving' },
      newManager: { type: 'string', description: 'Who their team reports to next (name, employee ID or userId)' },
      note: { type: 'string', description: 'HR note on the exit (max 1000 characters)' },
    },
    required: ['person', 'lastWorkingDay', 'exitType'],
  },
  api: { method: 'PUT', path: '/admin/employees/x/exit' },
  async run(ctx, i) {
    if (ctx.user.dashboardAdmin !== true) throw new Error('Only a dashboard admin can record an exit');
    const company = await companies().findOne({ id: ctx.org }, { projection: { _id: 0, features: 1 } });
    if (company?.features?.exits !== true) throw new Error('Exits are not switched on for this company. Ask Sowaka to switch them on (until then prepare_delete_employee is the only way to remove someone).');
    const lifecycle = await requireLifecycleOrg(ctx.org).then(() => true, () => false);
    const all = await roster(ctx);
    const person = await findPerson(ctx, i.person, all);
    if (person.userId === ctx.userId) throw new Error('You cannot record your own exit');
    const exitType = typeOf(i.exitType);
    if (!exitType) throw new Error(`exitType is one of ${EXIT_TYPES.join(', ')}`);
    const lastWorkingDay = str(i.lastWorkingDay);
    if (!isDate(lastWorkingDay)) throw new Error('lastWorkingDay must be YYYY-MM-DD');
    const full = await users().findOne({ userId: person.userId, org: ctx.org }, { projection: { _id: 0, exit: 1, joiningDate: 1 } });
    if (full?.exit) return { data: { blocked: true, reason: `An exit is already recorded for ${person.name} (last working day ${full.exit.lastWorkingDay}). Change it on their exit${lifecycle ? ' on the Offboarding board' : ''}.` }, links: [{ label: `Open ${person.name.split(' ')[0]}'s profile`, userId: person.userId }] };
    const joined = full?.joiningDate ? new Date(full.joiningDate.getTime() + 5.5 * 3_600_000).toISOString().slice(0, 10) : null;
    if (joined && lastWorkingDay < joined) throw new Error(`The last working day can't be before they joined (${joined})`);
    if (lifecycle && await resignations().findOne({ org: ctx.org, userId: person.userId, status: { $in: ['with_manager', 'with_hr'] } }, { projection: { _id: 1 } })) {
      return { data: { blocked: true, reason: `${person.name} has resigned in the app. Accept that resignation on the Offboarding board instead of starting a new exit.` }, links: [{ label: 'Open Offboarding', view: 'offboarding' }] };
    }
    const reports = teamOf(person.userId, all, false);
    const joining = await journeys().countDocuments({ org: ctx.org, kind: 'onboarding', managerUserId: person.userId, closedAt: { $exists: false }, userId: { $exists: false } } as never);
    const team = reports.length + joining;
    let successor: { userId: string; name: string } | null = null;
    if (team) {
      if (!str(i.newManager)) {
        return { data: { blocked: true, reason: `${[reports.length && `${reports.length} ${reports.length === 1 ? 'person reports' : 'people report'} to ${person.name}`, joining && `${joining} ${joining === 1 ? 'person is' : 'people are'} joining under them`].filter(Boolean).join(' and ')}. Ask HR who they report to next and call again with newManager.`, reports: reports.slice(0, 12).map((r) => r.name) } };
      }
      const m = await findPerson(ctx, i.newManager, all);
      if (m.userId === person.userId) throw new Error('Pick someone other than the person leaving as the new manager');
      successor = { userId: m.userId, name: m.name };
    }
    const noticeDays = await noticeDaysForUser(ctx.org, person.userId);
    const kind = KIND_OF[exitType];
    const rules = (await exitSettings(ctx.userId)).kinds.find((k) => k.kind === kind)?.rules;
    const past = lastWorkingDay < ctx.today;
    const atOnce = past || rules?.access === 'at_once';
    const waiting = await waitingOn(person.userId);
    const note = str(i.note, 1000);
    const typeLabel = EXIT_TYPE_LABEL[exitType];
    const title = `Start an exit for ${person.name}: ${typeLabel.toLowerCase()}, last working day ${niceDate(lastWorkingDay)}`;
    const proposalId = await propose(ctx, {
      kind: 'start_exit', area: 'people', title,
      summary: `${person.name}${person.designation ? `, ${person.designation}` : ''}, is recorded as leaving (${typeLabel}). ${past ? 'The last working day has passed, so they leave at once.' : `They are on notice until ${niceDate(lastWorkingDay)}.`} Their record and history stay.`,
      lines: [
        { text: `${typeLabel}, last working day ${niceDate(lastWorkingDay)}${past ? '' : `; on notice from ${niceDate(ctx.today)}`}.` },
        { text: `Notice period: ${noticeDays} days, from their offer letter${noticeDays === DEFAULT_PERSON_NOTICE_DAYS ? ` (${DEFAULT_PERSON_NOTICE_DAYS} days is also the default when the letter does not say)` : ''}. It is shown on the exit only: no notice pay and no recovery.`, why: 'HR asked that leaving before the notice ends is simply paid for the days worked.' },
        { text: atOnce ? 'App access ends as soon as you confirm: sessions are signed out and device notifications stop.' : `App access ends the day after the last working day (${niceDate(addDays(lastWorkingDay, 1))}, 00:00).` },
        { text: 'Payroll pays them up to the last working day and nothing after it.' },
        ...(successor ? [{ text: `Their team (${team}) moves to ${successor.name} ${atOnce ? 'now' : 'the day after the last working day'}, with their waiting requests.` }] : []),
        ...(lifecycle ? [{ text: `An offboarding journey starts on the Offboarding board: clearance for IT, Admin and Finance, handover, and the settlement. ${appPageDefault(exitType) ? 'Their app shows the Off-boarding page; their manager is told.' : 'Their app does not show the Off-boarding page; their manager is told.'}`, tone: 'info' as const }] : []),
        ...(waiting.total ? [{ text: `${waiting.total} request${waiting.total === 1 ? '' : 's'} of theirs still waiting: decide them before the last day.`, tone: 'warn' as const }] : []),
        { text: 'Kept: attendance, leave, payslips, Form 16, documents and posts. Nothing is deleted.', tone: 'info' },
        ...(note ? [{ text: `Note on the exit: "${note}".`, tone: 'info' as const }] : []),
        { text: lifecycle ? 'No Undo from Suwi: a started offboarding is changed or closed on the Offboarding board.' : 'Undo withdraws the exit while they still have access (they go back to active).', tone: lifecycle ? 'warn' : 'info' },
      ],
      effectiveFrom: lastWorkingDay, undoable: !lifecycle, typeToConfirm: person.name,
      payload: { byUserId: ctx.userId, userId: person.userId, name: person.name, lifecycle, exitType, kind, lastWorkingDay, newManagerUserId: successor?.userId ?? '', note },
    });
    return {
      data: { prepared: true, title, path: lifecycle ? 'Offboarding (employee lifecycle)' : 'People › Exits', noticeDays, accessEnds: atOnce ? 'at once' : addDays(lastWorkingDay, 1), typeToConfirm: person.name, note: 'Nothing happens until HR types the name and presses Confirm.' },
      proposalId,
      links: [lifecycle ? { label: 'Open Offboarding', view: 'offboarding' } : { label: 'Open Exits', view: 'exits' }],
    };
  },
});

defineExecutor('start_exit', {
  async run(p) {
    const { byUserId, userId, name, lifecycle, exitType, kind, lastWorkingDay, newManagerUserId, note } = p.payload as {
      byUserId: string; userId: string; name: string; lifecycle: boolean; exitType: OffboardingExitType; kind: string; lastWorkingDay: string; newManagerUserId: string; note: string;
    };
    if (lifecycle) {
      await startExit(byUserId, userId, { exitType, lastWorkingDay, noticeHandling: 'not_applicable', ...(newManagerUserId ? { newManagerUserId } : {}), ...(note ? { hrNote: note } : {}) });
    } else {
      await recordExit(byUserId, userId, { kind, lastWorkingDay, ...(newManagerUserId ? { newManagerUserId } : {}), ...(note ? { note } : {}) });
    }
    return { message: `${name}'s exit is recorded: last working day ${niceDate(lastWorkingDay)}.${lifecycle ? ' Their offboarding is on the Offboarding board.' : ''}` };
  },
  async undo(p) {
    const { byUserId, userId, name, lifecycle } = p.payload as { byUserId: string; userId: string; name: string; lifecycle: boolean };
    if (lifecycle) throw new Error('A started offboarding is changed or closed on the Offboarding board');
    await withdrawExit(byUserId, userId);
    return `${name}'s exit is withdrawn: they are active again.`;
  },
});
