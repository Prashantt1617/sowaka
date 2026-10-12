/**
 * Checks the Support desk's rules: how the requester is shown, who may do
 * what, the Manager-topic assignment rule, and the ticket types: the
 * defaults, a company's own list, and how an edit to it lands.
 *
 * No database: the rules live in `services/support-rules.ts`, which is pure.
 * Run with `npx tsx src/scripts/support-check.ts`.
 */
import {
  DEFAULT_SUPPORT_TOPICS,
  MANAGER_TOPIC,
  type SupportTicket,
  type SupportTopicOption,
} from '../models/support.model';
import {
  MAX_SUPPORT_TOPICS,
  MAX_TOPIC_LABEL,
  assignmentBlocked,
  cleanTopicLabel,
  effectiveSupportTopics,
  employeeMay,
  employeeStatus,
  mayEditSupportTopics,
  mergeSupportTopics,
  pickSupportTopic,
  preview,
  requesterView,
  slugTopicKey,
  staffMay,
  supportRoleOf,
  topicLabelOf,
  viewAllowed,
  type RequesterCard,
  type StaffAction,
  type TopicEdit,
} from '../services/support-rules';

let failures = 0;

function check(label: string, passed: boolean, detail = '') {
  if (!passed) failures += 1;
  console.log(`  ${passed ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
}

const card: RequesterCard = {
  userId: 'u-rahul',
  name: 'Rahul',
  employeeId: 'E042',
  department: 'Design',
  photoUrl: '/media/photo',
};
const at = new Date('2026-10-09T10:00:00Z');

function ticket(overrides: Partial<SupportTicket> = {}): SupportTicket {
  return {
    id: 't1', org: 'sowaka', ticketNo: 1, requesterUserId: 'u-rahul', topic: 'payroll',
    status: 'open', lastMessageAt: at, lastMessagePreview: '', unreadForEmployee: 0, unreadForStaff: 0,
    createdAt: at, updatedAt: at, version: 1, ...overrides,
  };
}

console.log('requester');
{
  const shown = requesterView(card);
  check('every dashboard viewer sees the requester', shown.userId === 'u-rahul' && shown.name === 'Rahul');
  check('every card field comes through', shown.employeeId === 'E042' && shown.department === 'Design'
    && shown.photoUrl === '/media/photo');
  check('missing fields are left out, not blank', !('photoUrl' in requesterView({ userId: 'u-x', name: 'X' })));
  check('a requester whose record is gone reads as a former employee', requesterView(null).name === 'Former employee');
}

console.log('permission matrix (dashboard)');
{
  const head = { userId: 'u-head', role: 'head' as const };
  const staff = { userId: 'u-kapil', role: 'staff' as const };
  const otherStaff = { userId: 'u-other', role: 'staff' as const };
  const nonMember = { userId: 'u-admin', role: null };
  const actions: StaffAction[] = ['read', 'reply', 'assign', 'send_back', 'resolve'];

  const onKapilsDesk = ticket({ status: 'assigned', assigneeUserId: 'u-kapil' });
  const allowed = (viewer: { userId: string; role: 'head' | 'staff' | null }, t: SupportTicket) =>
    actions.filter((action) => staffMay(action, viewer, t).ok).join(',');

  check('head on an assigned ticket: all but send-back', allowed(head, onKapilsDesk) === 'read,reply,assign,resolve',
    allowed(head, onKapilsDesk));
  check('assignee staff: read, reply, send back, resolve', allowed(staff, onKapilsDesk) === 'read,reply,send_back,resolve',
    allowed(staff, onKapilsDesk));
  check('other staff: nothing, and it reads as not found', allowed(otherStaff, onKapilsDesk) === ''
    && !staffMay('read', otherStaff, onKapilsDesk).ok && (staffMay('read', otherStaff, onKapilsDesk) as { status: number }).status === 404);
  check('no role (a dashboard admin without one): nothing', allowed(nonMember, onKapilsDesk) === '');

  const queued = ticket({ status: 'open' });
  check('staff never see the unassigned queue', allowed(staff, queued) === '');
  check('head on a new ticket: read, reply, assign, resolve', allowed(head, queued) === 'read,reply,assign,resolve', allowed(head, queued));

  const resolved = ticket({ status: 'resolved', assigneeUserId: 'u-kapil' });
  check('resolved: the assignee may still read it, nothing else', allowed(staff, resolved) === 'read', allowed(staff, resolved));
  check('resolved: a head may only read it', allowed(head, resolved) === 'read', allowed(head, resolved));

  const keptByHead = ticket({ status: 'assigned', assigneeUserId: 'u-head' });
  check('a head who kept a ticket reassigns rather than sending back', !staffMay('send_back', head, keptByHead).ok);

  check('lists: a head sees every view', ['new', 'assigned', 'mine', 'all'].every((v) => viewAllowed('head', v as never)));
  check('lists: staff only "mine"', viewAllowed('staff', 'mine') && !viewAllowed('staff', 'new') && !viewAllowed('staff', 'all')
    && !viewAllowed('staff', 'assigned'));
  check('lists: no role, no list', !viewAllowed(null, 'mine'));
}

console.log('permission matrix (app)');
{
  const mine = ticket();
  check('the requester reads and replies', employeeMay('read', 'u-rahul', mine).ok && employeeMay('reply', 'u-rahul', mine).ok);
  check("anyone else: not found", (employeeMay('read', 'u-someone', mine) as { status: number }).status === 404);
  check('no reply once resolved', !employeeMay('reply', 'u-rahul', ticket({ status: 'resolved' })).ok);
}

console.log('support roles');
check('a role needs dashboard access', supportRoleOf({ supportRole: 'head', dashboardAccess: false, lifecycleStatus: 'active' }) === null);
check('a role needs an active account', supportRoleOf({ supportRole: 'staff', dashboardAccess: true, lifecycleStatus: 'offboarded' }) === null);
check('dashboard admin alone is no role', supportRoleOf({ dashboardAccess: true, lifecycleStatus: 'active' }) === null);
check('head and staff come through', supportRoleOf({ supportRole: 'head', dashboardAccess: true, lifecycleStatus: 'active' }) === 'head'
  && supportRoleOf({ supportRole: 'staff', dashboardAccess: true, lifecycleStatus: 'notice' }) === 'staff');
check('anything else is no role', supportRoleOf({ supportRole: 'admin', dashboardAccess: true, lifecycleStatus: 'active' }) === null);

console.log('Manager-topic assignment rule');
{
  // ceo <- director <- manager <- rahul ; kapil reports to the ceo on another branch
  const people = [
    { userId: 'u-ceo' },
    { userId: 'u-director', managerUserId: 'u-ceo' },
    { userId: 'u-manager', managerUserId: 'u-director' },
    { userId: 'u-rahul', managerUserId: 'u-manager' },
    { userId: 'u-kapil', managerUserId: 'u-ceo' },
    { userId: 'u-peer', managerUserId: 'u-manager' },
  ];
  const byId = new Map(people.map((p) => [p.userId, p]));
  const requester = byId.get('u-rahul')!;
  const managerTicket = ticket({ topic: MANAGER_TOPIC });
  const blocked = (t: SupportTicket, target: string) => assignmentBlocked(t, requester, target, byId);

  check('never to their own manager', blocked(managerTicket, 'u-manager'));
  check('never to anyone above in the line', blocked(managerTicket, 'u-director') && blocked(managerTicket, 'u-ceo'));
  check('fine to someone outside the line', !blocked(managerTicket, 'u-kapil'));
  check('fine to a peer under the same manager', !blocked(managerTicket, 'u-peer'));
  check('never to the requester, on any topic', blocked(managerTicket, 'u-rahul') && blocked(ticket({ topic: 'payroll' }), 'u-rahul'));
  check('other topics may go to the manager', !blocked(ticket({ topic: 'payroll' }), 'u-manager'));
  const loop = new Map([['a', { userId: 'a', managerUserId: 'b' }], ['b', { userId: 'b', managerUserId: 'a' }]]);
  check('a loop in the reporting line ends', assignmentBlocked(ticket({ topic: MANAGER_TOPIC, requesterUserId: 'a' }), loop.get('a')!, 'b', loop)
    && !assignmentBlocked(ticket({ topic: MANAGER_TOPIC, requesterUserId: 'a' }), loop.get('a')!, 'z', loop));
}

console.log('default ticket types');
check('eight types', DEFAULT_SUPPORT_TOPICS.length === 8);
check('in the design order', DEFAULT_SUPPORT_TOPICS.map((t) => t.label).join('|') ===
  'Workplace|Manager|Payroll|Attendance|Leaves|Benefits|Safety issues|Other');
check('keys are unique and stable', new Set(DEFAULT_SUPPORT_TOPICS.map((t) => t.key)).size === 8
  && DEFAULT_SUPPORT_TOPICS.map((t) => t.key).join(',') === 'workplace,manager,payroll,attendance,leaves,benefits,safety,other');
check('the Manager type is one of them', pickSupportTopic(MANAGER_TOPIC, DEFAULT_SUPPORT_TOPICS)?.label === 'Manager');
check('unknown types are refused', !pickSupportTopic('finance', DEFAULT_SUPPORT_TOPICS) && !pickSupportTopic(undefined, DEFAULT_SUPPORT_TOPICS)
  && !pickSupportTopic({ key: 'payroll' }, DEFAULT_SUPPORT_TOPICS));

console.log("a company's own ticket types");
{
  const saved = (edit: TopicEdit): SupportTopicOption[] => (edit.ok ? edit.topics : []);
  const keys = (topics: SupportTopicOption[]) => topics.map((t) => t.key).join(',');
  const defaults = effectiveSupportTopics(null);

  check('no list of its own: the defaults are served', keys(defaults) === keys([...DEFAULT_SUPPORT_TOPICS])
    && keys(effectiveSupportTopics({ topics: [] })) === keys(defaults));
  const own = [{ key: 'payroll', label: 'Salary' }, { key: 'it', label: 'IT' }];
  check('a list of its own is served, in its order', keys(effectiveSupportTopics({ topics: own })) === 'payroll,it'
    && effectiveSupportTopics({ topics: own })[0].label === 'Salary');
  check('serving hands out a copy', effectiveSupportTopics(null)[0] !== DEFAULT_SUPPORT_TOPICS[0]);

  // Rename Leaves to Time off, move it first, drop Benefits, add two.
  const edited = saved(mergeSupportTopics([
    { key: 'leaves', label: '  Time   off ' },
    ...defaults.filter((t) => t.key !== 'leaves' && t.key !== 'benefits'),
    { label: 'IT & laptops' },
    { label: 'Café' },
  ], defaults));
  check('a rename keeps the key', edited[0]?.key === 'leaves' && edited[0]?.label === 'Time off', JSON.stringify(edited[0]));
  check('the order is as sent', keys(edited) === 'leaves,workplace,manager,payroll,attendance,safety,other,it-laptops,cafe', keys(edited));
  check('a removed type is gone from the list', !edited.some((t) => t.key === 'benefits'));
  check('a new type gets a key slugged from its name', slugTopicKey('IT & laptops') === 'it-laptops' && slugTopicKey('Café') === 'cafe'
    && slugTopicKey('वेतन') === 'type' && slugTopicKey('x'.repeat(60)).length === 32);

  const oldLeave = ticket({ topic: 'leaves', topicLabel: 'Leaves' });
  const oldBenefits = ticket({ topic: 'benefits', topicLabel: 'Benefits' });
  const legacy = ticket({ topic: 'leaves' });
  check('an old ticket keeps the label it was raised under', topicLabelOf(oldLeave, edited) === 'Leaves');
  check('a ticket of a removed type still reads as it did', topicLabelOf(oldBenefits, edited) === 'Benefits'
    && topicLabelOf(ticket({ topic: 'benefits' }), edited) === 'Benefits');
  check('a ticket from before per-company types reads as the default it was raised under', topicLabelOf(legacy, edited) === 'Leaves');
  check('a new ticket of a renamed type reads as the new name', pickSupportTopic('leaves', edited)?.label === 'Time off');
  check('a label nobody has falls back to the current list, then the key',
    topicLabelOf(ticket({ topic: 'it-laptops' }), edited) === 'IT & laptops' && topicLabelOf(ticket({ topic: 'gone' }), edited) === 'gone');
  check('a removed type is refused for new tickets', pickSupportTopic('benefits', edited) === null);

  const again = saved(mergeSupportTopics([{ label: 'Benefits' }, { label: 'Salary' }], own, ['benefits', 'payroll']));
  check('a type added back under a default name gets its old key back', again[0]?.key === 'benefits', keys(again));
  check('a type matching a current name keeps that key', again[1]?.key === 'payroll', keys(again));
  const fresh = saved(mergeSupportTopics([{ label: 'Travel' }], [{ key: 'other', label: 'Other' }], ['travel']));
  check('a new type never takes a key old tickets carry', fresh[0]?.key === 'travel-2', keys(fresh));
  const unknownKey = saved(mergeSupportTopics([{ key: 'travel', label: 'Travel desk' }], defaults, ['travel']));
  check('a key not on the current list is not taken on trust', unknownKey[0]?.key === 'travel-desk', keys(unknownKey));
  const swap = saved(mergeSupportTopics([{ key: 'payroll', label: 'Workplace' }, { key: 'workplace', label: 'Payroll' }], defaults));
  check('two types may trade names, each keeping its key', keys(swap) === 'payroll,workplace' && swap[0].label === 'Workplace');
  const renamedAndReadded = saved(mergeSupportTopics([{ key: 'leaves', label: 'Time off' }, { label: 'Leaves' }], defaults));
  check('a new type with a renamed one\'s old name gets a key of its own', keys(renamedAndReadded) === 'leaves,leaves-2', keys(renamedAndReadded));
}

console.log('the Manager key');
{
  const defaults = effectiveSupportTopics(null);
  const keys = (edit: TopicEdit) => (edit.ok ? edit.topics.map((t) => t.key).join(',') : `refused: ${edit.message}`);
  const withoutManager = defaults.filter((t) => t.key !== MANAGER_TOPIC);
  check('renaming the Manager type keeps the key', keys(mergeSupportTopics([{ key: MANAGER_TOPIC, label: 'Reporting manager' }], defaults)) === MANAGER_TOPIC);
  check('a new type whose name slugs to it gets another key', keys(mergeSupportTopics([{ label: 'Manager.' }], withoutManager)) === 'manager-2',
    keys(mergeSupportTopics([{ label: 'Manager.' }], withoutManager)));
  check('a new type sent with the Manager key does not get it', keys(mergeSupportTopics([{ key: MANAGER_TOPIC, label: 'Payroll queries' }], withoutManager)) === 'payroll-queries');
  check('a new "Manager" beside the renamed Manager type gets another key',
    keys(mergeSupportTopics([{ key: MANAGER_TOPIC, label: 'Line manager' }, { label: 'Manager' }], defaults)) === 'manager,manager-2');
  const dropped = mergeSupportTopics([{ key: 'payroll', label: 'Payroll' }, { label: 'Manager!' }, { label: 'Escalations' }], defaults);
  check('dropping the Manager type frees nothing for another type in the same edit', keys(dropped) === 'payroll,manager-2,escalations',
    keys(dropped));
  const restored = mergeSupportTopics([...withoutManager, { label: 'Manager' }], withoutManager, ['manager']);
  check('the Manager type added back under its own name gets its key, and its routing, back', keys(restored).endsWith(',manager'), keys(restored));
  const routed = ticket({ topic: restored.ok ? restored.topics.at(-1)!.key : '' });
  const byId = new Map([['u-rahul', { userId: 'u-rahul', managerUserId: 'u-manager' }], ['u-manager', { userId: 'u-manager' }]]);
  check('a ticket of it never goes to the requester\'s manager', assignmentBlocked(routed, byId.get('u-rahul')!, 'u-manager', byId));
}

console.log('ticket type limits');
{
  const defaults = effectiveSupportTopics(null);
  const refused = (edit: TopicEdit, pattern: RegExp) => !edit.ok && edit.status === 400 && pattern.test(edit.message);
  const many = (n: number) => Array.from({ length: n }, (_, i) => ({ label: `Type ${i + 1}` }));
  check('not a list: refused', refused(mergeSupportTopics('Workplace', defaults), /list/));
  check('none: refused', refused(mergeSupportTopics([], defaults), /at least one/));
  check('one: fine', mergeSupportTopics([{ label: 'Anything' }], defaults).ok);
  check(`${MAX_SUPPORT_TOPICS}: fine`, mergeSupportTopics(many(MAX_SUPPORT_TOPICS), defaults).ok);
  check(`${MAX_SUPPORT_TOPICS + 1}: refused`, refused(mergeSupportTopics(many(MAX_SUPPORT_TOPICS + 1), defaults), /Up to 20/));
  check('a blank name: refused', refused(mergeSupportTopics([{ label: '   ' }], defaults), /needs a name/)
    && refused(mergeSupportTopics([{ key: 'payroll' }], defaults), /needs a name/));
  check(`${MAX_TOPIC_LABEL} characters: fine`, mergeSupportTopics([{ label: 'x'.repeat(MAX_TOPIC_LABEL) }], defaults).ok);
  check(`${MAX_TOPIC_LABEL + 1} characters: refused`, refused(mergeSupportTopics([{ label: 'x'.repeat(MAX_TOPIC_LABEL + 1) }], defaults), /40 characters/));
  check('names are trimmed before they are measured', mergeSupportTopics([{ label: `  ${'x'.repeat(MAX_TOPIC_LABEL)}  ` }], defaults).ok
    && cleanTopicLabel(' a \n b\t') === 'a b');
  check('the same name twice, in any case: refused', refused(mergeSupportTopics([{ label: 'Payroll' }, { label: ' PAYROLL ' }], defaults), /listed twice/));
  check('one key twice: refused', refused(mergeSupportTopics([{ key: 'payroll', label: 'Payroll' }, { key: 'payroll', label: 'Pay' }], defaults), /listed twice/));
}

console.log('who may edit the ticket types');
{
  const active = { dashboardAccess: true, lifecycleStatus: 'active' };
  check('a Support head', mayEditSupportTopics({ ...active, supportRole: 'head' }));
  check('a dashboard admin, with or without a role', mayEditSupportTopics({ ...active, dashboardAdmin: true })
    && mayEditSupportTopics({ ...active, dashboardAdmin: true, supportRole: 'staff' }));
  check('not support staff', !mayEditSupportTopics({ ...active, supportRole: 'staff' }));
  check('not someone with dashboard access alone', !mayEditSupportTopics(active));
  check('not without dashboard access', !mayEditSupportTopics({ dashboardAccess: false, dashboardAdmin: true, supportRole: 'head', lifecycleStatus: 'active' }));
  check('not once offboarded', !mayEditSupportTopics({ ...active, dashboardAdmin: true, lifecycleStatus: 'offboarded' }));
}

console.log('chips');
check('open: Submitted', employeeStatus(ticket()).chip === 'Submitted' && employeeStatus(ticket()).status === 'open');
check('assigned: In-process', employeeStatus(ticket({ status: 'assigned', assigneeUserId: 'x' })).chip === 'In-process');
check('sent back after an assignment still reads as in progress to the employee',
  employeeStatus(ticket({ status: 'open', firstAssignedAt: at })).status === 'assigned');
check('resolved: Resolved', employeeStatus(ticket({ status: 'resolved' })).chip === 'Resolved');

console.log('previews');
check('long text is cut to 120', preview('x'.repeat(500)).length === 120);
check('whitespace is flattened', preview('  a\n\n b ') === 'a b');
check('a files-only message says so', preview('', 2) === '2 attachments');

if (failures > 0) {
  console.log(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log('\nall checks passed');
