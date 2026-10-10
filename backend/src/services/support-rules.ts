/**
 * Support desk decisions that need no database: who may do what to a ticket,
 * how its requester is shown, and whom a Manager ticket may never go to.
 *
 * Pure, so `scripts/support-check.ts` can prove them; `support.service.ts`
 * calls these and nothing else decides the same questions.
 */
import {
  MANAGER_TOPIC,
  type SupportRole,
  type SupportTicket,
  type SupportTicketStatus,
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
