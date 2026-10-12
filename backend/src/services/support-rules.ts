/**
 * Support desk decisions that need no database: who may do what to a ticket,
 * how its requester is shown, whom a Manager ticket may never go to, and how
 * an edit to a company's ticket types lands.
 *
 * Pure, so `scripts/support-check.ts` can prove them; `support.service.ts`
 * calls these and nothing else decides the same questions.
 */
import {
  DEFAULT_SUPPORT_TOPICS,
  MANAGER_TOPIC,
  supportRoleOf,
  type SupportRole,
  type SupportTicket,
  type SupportTicketStatus,
  type SupportTopicOption,
} from '../models/support.model';
import type { User } from '../models/user.model';
import { reportsUpTo } from './manager.service';

export { supportRoleOf } from '../models/support.model';

/** What a ticket's requester looks like to someone on the dashboard. */
export interface RequesterView {
  userId?: string;
  name: string;
  employeeId?: string;
  department?: string;
  photoUrl?: string;
}

/** The requester's own record, as loaded for a staff-facing view. */
export interface RequesterCard {
  userId: string;
  name: string;
  employeeId?: string;
  department?: string;
  photoUrl?: string;
}

/**
 * The requester as every dashboard viewer of a ticket sees them: name,
 * employee id, department and photo, as their record has them.
 */
export function requesterView(requester: RequesterCard | null): RequesterView {
  if (!requester) return { name: 'Former employee' };
  return {
    userId: requester.userId,
    name: requester.name,
    ...(requester.employeeId ? { employeeId: requester.employeeId } : {}),
    ...(requester.department ? { department: requester.department } : {}),
    ...(requester.photoUrl ? { photoUrl: requester.photoUrl } : {}),
  };
}

export type StaffAction = 'read' | 'reply' | 'assign' | 'send_back' | 'resolve';
export type EmployeeAction = 'read' | 'reply';
export type Decision = { ok: true } | { ok: false; status: number; message: string };

const ALLOW: Decision = { ok: true };
const deny = (status: number, message: string): Decision => ({ ok: false, status, message });
const NOT_FOUND = deny(404, 'Ticket not found');

type TicketState = Pick<SupportTicket, 'status' | 'assigneeUserId'>;

/**
 * What a dashboard user may do to one ticket of their own org.
 *
 * Heads: everything. Staff: only while the ticket is assigned to them, and
 * never assign. Nobody without a role: nothing — the ticket reads
 * as not found, so its existence is not confirmed either.
 */
export function staffMay(
  action: StaffAction,
  viewer: { userId: string; role: SupportRole | null },
  ticket: TicketState,
): Decision {
  const { role } = viewer;
  if (!role) return NOT_FOUND;
  const isAssignee = Boolean(ticket.assigneeUserId) && ticket.assigneeUserId === viewer.userId;
  if (role === 'staff' && !isAssignee) return NOT_FOUND;
  const resolved = ticket.status === 'resolved';

  switch (action) {
    case 'read':
      return ALLOW;
    case 'reply':
      return resolved ? deny(409, 'This ticket is resolved') : ALLOW;
    case 'assign':
      if (role !== 'head') return deny(403, 'Only a Support head can assign tickets');
      return resolved ? deny(409, 'This ticket is resolved') : ALLOW;
    case 'send_back':
      if (role !== 'staff') return deny(403, 'Only the support staff holding a ticket can send it back');
      return ticket.status === 'assigned' ? ALLOW : deny(409, 'This ticket is not on your desk');
    case 'resolve':
      return resolved ? deny(409, 'This ticket is already resolved') : ALLOW;
    default:
      return deny(400, 'Unknown action');
  }
}

/** What the employee who raised a ticket may do to it. Anyone else: not found. */
export function employeeMay(
  action: EmployeeAction,
  viewerUserId: string,
  ticket: TicketState & Pick<SupportTicket, 'requesterUserId'>,
): Decision {
  if (ticket.requesterUserId !== viewerUserId) return NOT_FOUND;
  switch (action) {
    case 'read':
      return ALLOW;
    case 'reply':
      return ticket.status === 'resolved'
        ? deny(409, 'This ticket has been resolved. Please raise a new ticket to continue.')
        : ALLOW;
    default:
      return deny(400, 'Unknown action');
  }
}

export type SupportView = 'new' | 'assigned' | 'mine' | 'all';
export const SUPPORT_VIEWS: readonly SupportView[] = ['new', 'assigned', 'mine', 'all'];

/** Heads see every list; staff only their own desk. */
export function viewAllowed(role: SupportRole | null, view: SupportView): boolean {
  if (role === 'head') return SUPPORT_VIEWS.includes(view);
  if (role === 'staff') return view === 'mine';
  return false;
}

/**
 * Whether this person may never hold this ticket: the requester themselves,
 * and, on a Manager ticket, the requester's manager or anyone above them in
 * the reporting line.
 */
export function assignmentBlocked(
  ticket: Pick<SupportTicket, 'topic' | 'requesterUserId'>,
  requester: Pick<User, 'userId' | 'managerUserId'> | null,
  targetUserId: string,
  byId: Map<string, Pick<User, 'userId' | 'managerUserId'>>,
): boolean {
  if (targetUserId === ticket.requesterUserId) return true;
  if (ticket.topic !== MANAGER_TOPIC || !requester) return false;
  return reportsUpTo(requester as User, targetUserId, byId as Map<string, User>);
}

/** The status chip the app shows, with what status the employee is told. */
export function employeeStatus(
  ticket: Pick<SupportTicket, 'status' | 'firstAssignedAt' | 'assigneeUserId'>,
): { status: SupportTicketStatus; chip: string } {
  if (ticket.status === 'resolved') return { status: 'resolved', chip: 'Resolved' };
  // A send-back is not the employee's business: once anyone has had the
  // ticket, it stays in progress for them.
  if (ticket.status === 'assigned' || ticket.firstAssignedAt) return { status: 'assigned', chip: 'In-process' };
  return { status: 'open', chip: 'Submitted' };
}

export const AUTO_REPLY = 'Your ticket is raised, you should get a reply within 3 working days';
export const PREVIEW_LENGTH = 120;

export function preview(text: string, attachmentCount = 0): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  if (flat) return flat.length > PREVIEW_LENGTH ? `${flat.slice(0, PREVIEW_LENGTH - 1)}…` : flat;
  return attachmentCount > 0 ? `${attachmentCount} attachment${attachmentCount === 1 ? '' : 's'}` : '';
}

// ---------------------------------------------------------------------------
// Ticket types
// ---------------------------------------------------------------------------

export const MIN_SUPPORT_TOPICS = 1;
export const MAX_SUPPORT_TOPICS = 20;
export const MAX_TOPIC_LABEL = 40;
const MAX_TOPIC_KEY = 32;

/**
 * Who may change their company's ticket types: a Support head, or a dashboard
 * admin, either one still active and with dashboard access.
 */
export function mayEditSupportTopics(
  user: { supportRole?: unknown; dashboardAccess?: boolean; dashboardAdmin?: boolean; lifecycleStatus?: string } | null | undefined,
): boolean {
  if (supportRoleOf(user) === 'head') return true;
  if (!user || user.dashboardAccess !== true || user.dashboardAdmin !== true) return false;
  return user.lifecycleStatus !== 'offboarded' && user.lifecycleStatus !== 'terminated';
}

/** The types an org offers: its own list when it has one, else the defaults. */
export function effectiveSupportTopics(stored: { topics?: SupportTopicOption[] } | null | undefined): SupportTopicOption[] {
  const topics = stored?.topics?.length ? stored.topics : DEFAULT_SUPPORT_TOPICS;
  return topics.map(({ key, label }) => ({ key, label }));
}

/**
 * The type a new ticket is filed under, or null: only a key the org offers
 * now. One removed since the app loaded its list is refused.
 */
export function pickSupportTopic(value: unknown, topics: readonly SupportTopicOption[]): SupportTopicOption | null {
  return typeof value === 'string' ? topics.find((topic) => topic.key === value) ?? null : null;
}

/**
 * What a ticket's type reads as: the label it was raised under; for a ticket
 * from before types were per company (all raised under the defaults), the
 * default label; then the org's current list; then the bare key. A rename or
 * a removal never changes an old ticket.
 */
export function topicLabelOf(
  ticket: Pick<SupportTicket, 'topic' | 'topicLabel'>,
  current: readonly SupportTopicOption[] = [],
): string {
  return ticket.topicLabel
    || DEFAULT_SUPPORT_TOPICS.find((topic) => topic.key === ticket.topic)?.label
    || current.find((topic) => topic.key === ticket.topic)?.label
    || ticket.topic;
}

/** A label as stored: control characters out, runs of spaces as one, trimmed. */
export function cleanTopicLabel(value: unknown): string {
  // eslint-disable-next-line no-control-regex
  return typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim() : '';
}

/** A key from a label: lowercase letters and digits joined by dashes. */
export function slugTopicKey(label: string): string {
  const slug = label
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .slice(0, MAX_TOPIC_KEY)
    .replace(/^-+|-+$/g, '');
  // A label in another script has no letters to slug.
  return slug || 'type';
}

/** `base`, or `base-2`, `base-3`… whichever is free. */
function uniqueKey(base: string, taken: Set<string>): string {
  if (!taken.has(base)) return base;
  for (let n = 2; ; n += 1) {
    const key = `${base}-${n}`;
    if (!taken.has(key)) return key;
  }
}

const sameLabel = (a: string, b: string) => a.toLocaleLowerCase('en') === b.toLocaleLowerCase('en');

export type TopicEdit = { ok: true; topics: SupportTopicOption[] } | { ok: false; status: number; message: string };

/**
 * An edited list of ticket types, as it will be saved: the full list in its
 * new order, each `{ key?, label }`.
 *
 * Keys are stable. An entry carrying a key from the current list keeps it
 * (a rename or a move). Anything else is new: it takes the key of a current
 * or default type with the same label, else a key slugged from its label,
 * made unique against every key the current list has and every key old
 * tickets carry (`ticketKeys`), so no new type ever inherits old tickets. The
 * Manager key is never slugged: only the Manager type keeps it, or gets it
 * back under its own name. A type left out is removed; tickets raised under
 * it keep its key and label.
 *
 * Refused: fewer than 1 or more than 20 types, a label empty or over 40
 * characters, two labels alike ignoring case, one key listed twice.
 */
export function mergeSupportTopics(
  input: unknown,
  current: readonly SupportTopicOption[],
  ticketKeys: Iterable<string> = [],
): TopicEdit {
  const bad = (message: string): TopicEdit => ({ ok: false, status: 400, message });
  if (!Array.isArray(input)) return bad('Send the ticket types as a list');
  if (input.length < MIN_SUPPORT_TOPICS) return bad('Keep at least one type of ticket');
  if (input.length > MAX_SUPPORT_TOPICS) return bad(`Up to ${MAX_SUPPORT_TOPICS} types of ticket`);

  const entries = input.map((raw) => {
    const item = (raw && typeof raw === 'object' ? raw : {}) as { key?: unknown; label?: unknown };
    return { key: typeof item.key === 'string' ? item.key.trim() : '', label: cleanTopicLabel(item.label) };
  });
  for (const [i, entry] of entries.entries()) {
    if (!entry.label) return bad(`Type ${i + 1} needs a name`);
    if (entry.label.length > MAX_TOPIC_LABEL) return bad(`"${entry.label.slice(0, 20)}…" is too long: keep names to ${MAX_TOPIC_LABEL} characters`);
    if (entries.slice(0, i).some((other) => sameLabel(other.label, entry.label))) return bad(`"${entry.label}" is listed twice`);
  }

  const currentKeys = new Set(current.map((topic) => topic.key));
  const keys: (string | null)[] = entries.map(() => null);
  const claimed = new Set<string>();
  // Existing types first, so a new one can't take a key a renamed one keeps.
  for (const [i, entry] of entries.entries()) {
    if (!entry.key || !currentKeys.has(entry.key)) continue;
    if (claimed.has(entry.key)) return bad('One type is listed twice');
    claimed.add(entry.key);
    keys[i] = entry.key;
  }
  const taken = new Set([...currentKeys, ...ticketKeys, MANAGER_TOPIC]);
  for (const [i, entry] of entries.entries()) {
    if (keys[i]) continue;
    const match = [...current, ...DEFAULT_SUPPORT_TOPICS]
      .find((topic) => sameLabel(topic.label, entry.label) && !claimed.has(topic.key));
    const key = match?.key ?? uniqueKey(slugTopicKey(entry.label), new Set([...taken, ...claimed]));
    claimed.add(key);
    keys[i] = key;
  }
  return { ok: true, topics: entries.map((entry, i) => ({ key: keys[i]!, label: entry.label })) };
}
