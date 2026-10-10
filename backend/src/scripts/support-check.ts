/**
 * Checks the Support desk's rules: how the requester is shown, who may do
 * what, the Manager-topic assignment rule, and the topic list.
 *
 * No database: the rules live in `services/support-rules.ts`, which is pure.
 * Run with `npx tsx src/scripts/support-check.ts`.
 */
import {
  MANAGER_TOPIC,
  SUPPORT_TOPICS,
  isSupportTopic,
  supportTopicLabel,
  type SupportTicket,
} from '../models/support.model';
import {
  assignmentBlocked,
  employeeMay,
  employeeStatus,
  preview,
  requesterView,
  staffMay,
  supportRoleOf,
  viewAllowed,
  type RequesterCard,
  type StaffAction,
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

console.log('topics');
check('eight topics', SUPPORT_TOPICS.length === 8);
check('in the design order', SUPPORT_TOPICS.map((t) => t.label).join('|') ===
  'Workplace|Manager|Payroll|Attendance|Leaves|Benefits|Safety issues|Other');
check('keys are unique and stable', new Set(SUPPORT_TOPICS.map((t) => t.key)).size === 8
  && SUPPORT_TOPICS.map((t) => t.key).join(',') === 'workplace,manager,payroll,attendance,leaves,benefits,safety,other');
check('the Manager topic is one of them', isSupportTopic(MANAGER_TOPIC) && supportTopicLabel(MANAGER_TOPIC) === 'Manager');
check('unknown topics are refused', !isSupportTopic('finance') && !isSupportTopic(undefined));

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
