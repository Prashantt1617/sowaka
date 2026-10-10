/**
 * Support desk (phase 1).
 *
 * An employee raises a ticket from the app; it lands in the Support heads'
 * queue; a head assigns it to someone with a Support role or keeps it; the
 * holder chats with the employee from the dashboard and resolves it.
 *
 * Every rule about who may do what lives in `support-rules.ts` and is applied
 * here. The requester is always shown to whoever may see the ticket.
 */
import { randomUUID } from 'node:crypto';
import type { Sort, UpdateFilter } from 'mongodb';
import { supportCounters, supportEvents, supportMessages, supportTickets, users } from '../config/db';
import {
  SUPPORT_TOPICS,
  isSupportTopic,
  supportTopicLabel,
  type SupportAttachment,
  type SupportChangeKind,
  type SupportEvent,
  type SupportEventType,
  type SupportMessage,
  type SupportRole,
  type SupportTicket,
} from '../models/support.model';
import type { User } from '../models/user.model';
import { logger } from '../utils/logger';
import { emitSupportChanged } from './connect-realtime.service';
import { notifyUsers } from './notification.service';
import { resolveProfilePhoto } from './s3-connect-media.service';
import {
  deleteSupportAttachment,
  hasReceiptStorage,
  presignReceiptDownload,
  uploadSupportAttachment,
} from './s3-receipt.service';
import {
  AUTO_REPLY,
  assignmentBlocked,
  employeeMay,
  employeeStatus,
  preview,
  requesterView,
  staffMay,
  supportRoleOf,
  viewAllowed,
  SUPPORT_VIEWS,
  type Decision,
  type RequesterCard,
  type RequesterView,
  type StaffAction,
  type SupportView,
} from './support-rules';

export class SupportError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'SupportError';
  }
}

/** The signed-in user, as `requireAuth` loads it. */
type Actor = Omit<User, 'profilePhotoUrl'>;

export interface SupportUpload {
  originalName: string;
  contentType: string;
  size: number;
  bytes: Buffer;
}

const MAX_TEXT = 4000;
const MAX_NOTE = 1000;
const LIST_LIMIT = 200;
/** Stops an accidental burst of repeats, well above any honest need. */
const MAX_TICKETS_PER_DAY = 10;
const INACTIVE = ['offboarded', 'terminated'];

function enforce(decision: Decision): void {
  if (!decision.ok) throw new SupportError(decision.status, decision.message);
}

function orgOf(actor: Actor): string {
  if (!actor.org) throw new SupportError(403, 'No organisation on this account');
  return actor.org;
}

function cleanText(value: unknown, max: number): string {
  const text = typeof value === 'string' ? value.trim() : '';
  if (text.length > max) throw new SupportError(400, `Keep it under ${max} characters`);
  return text;
}

/** A file name fit to show and to put in a download header. */
function displayName(original: string): string {
  const base = original.split(/[\\/]/).pop() ?? '';
  // eslint-disable-next-line no-control-regex
  const clean = base.replace(/[\u0000-\u001f"]/g, '').trim().slice(-120);
  return clean || 'Attachment';
}

async function notifySafe(userIds: string[], input: Parameters<typeof notifyUsers>[1]): Promise<void> {
  try {
    await notifyUsers(userIds, input);
  } catch (error) {
    logger.error('Support notification failed', { scenario: input.scenario }, error);
  }
}

function emit(ticket: SupportTicket, kind: SupportChangeKind, heads: boolean, userIds: (string | undefined)[]): void {
  emitSupportChanged({ org: ticket.org, ticketId: ticket.id, kind, heads, userIds });
}

async function headsOf(org: string): Promise<string[]> {
  const rows = await users()
    .find(
      { org, supportRole: 'head', dashboardAccess: true, lifecycleStatus: { $nin: INACTIVE } } as never,
      { projection: { _id: 0, userId: 1 } },
    )
    .toArray();
  return rows.map((row) => row.userId);
}

async function namesOf(userIds: (string | undefined)[]): Promise<Map<string, string>> {
  const ids = [...new Set(userIds.filter((id): id is string => Boolean(id) && id !== 'system'))];
  if (!ids.length) return new Map();
  const rows = await users().find({ userId: { $in: ids } }, { projection: { _id: 0, userId: 1, name: 1 } }).toArray();
  return new Map(rows.map((row) => [row.userId, row.name]));
}

/** The requesters of these tickets, as the dashboard shows them, by userId. */
async function requestersOf(userIds: string[]): Promise<Map<string, RequesterView>> {
  const ids = [...new Set(userIds)];
  if (!ids.length) return new Map();
  const rows = await users()
    .find(
      { userId: { $in: ids } },
      { projection: { _id: 0, userId: 1, name: 1, employeeId: 1, department: 1, profilePhotoKey: 1 } },
    )
    .toArray();
  const cards = await Promise.all(
    rows.map(async (row): Promise<RequesterCard> => ({
      userId: row.userId,
      name: row.name,
      employeeId: row.employeeId,
      department: row.department,
      // Only a stored key: a legacy inline photo is hundreds of KB per row.
      photoUrl: row.profilePhotoKey ? await resolveProfilePhoto({ profilePhotoKey: row.profilePhotoKey }) : undefined,
    })),
  );
  return new Map(cards.map((card) => [card.userId, requesterView(card)]));
}

async function requesterOf(ticket: SupportTicket): Promise<RequesterView> {
  return (await requestersOf([ticket.requesterUserId])).get(ticket.requesterUserId) ?? requesterView(null);
}

/** The requester's name, as a staff-side notification names them. */
async function requesterName(ticket: SupportTicket): Promise<string> {
  const names = await namesOf([ticket.requesterUserId]);
  return names.get(ticket.requesterUserId) ?? 'a former employee';
}

async function storeAttachments(org: string, ticketId: string, files: SupportUpload[]): Promise<SupportAttachment[]> {
  if (!files.length) return [];
  if (!hasReceiptStorage()) throw new SupportError(503, 'Attachments are not available right now. Send your message without them.');
  const stored: SupportAttachment[] = [];
  try {
    for (const file of files) {
      const saved = await uploadSupportAttachment(org, ticketId, file);
      stored.push({ key: saved.objectKey, name: displayName(file.originalName), contentType: saved.contentType, size: saved.size });
    }
  } catch (error) {
    await Promise.all(stored.map((item) => deleteSupportAttachment(item.key).catch(() => undefined)));
    throw error;
  }
  return stored;
}

async function presentAttachments(items: SupportAttachment[] | undefined) {
  return Promise.all(
    (items ?? []).map(async (item) => {
      const url = await presignReceiptDownload(item.key, item.name).catch(() => '');
      return { name: item.name, contentType: item.contentType, size: item.size, url };
    }),
  );
}

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------

function ticketForEmployee(ticket: SupportTicket) {
  const { status, chip } = employeeStatus(ticket);
  return {
    id: ticket.id,
    ticketNo: ticket.ticketNo,
    topic: ticket.topic,
    topicLabel: supportTopicLabel(ticket.topic),
    status,
    chip,
    createdAt: ticket.createdAt,
    lastMessageAt: ticket.lastMessageAt,
    lastMessagePreview: ticket.lastMessagePreview,
    unread: ticket.unreadForEmployee,
  };
}

async function messageForEmployee(message: SupportMessage) {
  return {
    id: message.id,
    side: message.side,
    senderLabel: message.side === 'employee' ? 'You' : message.side === 'staff' ? 'HR team' : '',
    text: message.text,
    attachments: await presentAttachments(message.attachments),
    createdAt: message.createdAt,
  };
}

function eventForEmployee(event: SupportEvent) {
  const text: Partial<Record<SupportEventType, string>> = {
    assigned: 'Your ticket is with the team',
    kept: 'Your ticket is with the team',
    resolved: 'This ticket has been marked as resolved by the support team',
  };
  return {
    id: event.id,
    type: event.type,
    text: text[event.type] ?? '',
    createdAt: event.createdAt,
  };
}

function ticketForStaff(ticket: SupportTicket, requester: RequesterView, names: Map<string, string>) {
  return {
    id: ticket.id,
    ticketNo: ticket.ticketNo,
    topic: ticket.topic,
    topicLabel: supportTopicLabel(ticket.topic),
    status: ticket.status,
    requester,
    assignee: ticket.assigneeUserId
      ? { userId: ticket.assigneeUserId, name: names.get(ticket.assigneeUserId) ?? 'Former staff' }
      : null,
    createdAt: ticket.createdAt,
    lastMessageAt: ticket.lastMessageAt,
    lastMessagePreview: ticket.lastMessagePreview,
    unread: ticket.unreadForStaff,
    version: ticket.version,
  };
}

async function messageForStaff(message: SupportMessage, requester: RequesterView, names: Map<string, string>) {
  return {
    id: message.id,
    side: message.side,
    senderLabel: message.side === 'employee'
      ? requester.name
      : message.side === 'staff'
        ? names.get(message.senderUserId ?? '') ?? 'Support team'
        : '',
    text: message.text,
    attachments: await presentAttachments(message.attachments),
    createdAt: message.createdAt,
  };
}

function eventForStaff(event: SupportEvent, ticket: SupportTicket, requester: RequesterView, names: Map<string, string>) {
  const person = (userId?: string) => {
    if (!userId) return null;
    if (userId === 'system') return { name: 'System' };
    if (userId === ticket.requesterUserId) return requester;
    return { userId, name: names.get(userId) ?? 'Former staff' };
  };
  const actor = person(event.actorUserId);
  const to = person(event.toUserId);
  const from = person(event.fromUserId);
  const text: Record<SupportEventType, string> = {
    created: `${actor?.name ?? 'The employee'} raised this ticket`,
    assigned: `Assigned to ${to?.name ?? 'someone'} by ${actor?.name ?? 'a Support head'}`,
    reassigned: `Reassigned to ${to?.name ?? 'someone'} by ${actor?.name ?? 'a Support head'}`,
    kept: `${actor?.name ?? 'A Support head'} kept this ticket`,
    sent_back: `${actor?.name ?? 'The assignee'} sent this back to the Support head${event.note ? `: ${event.note}` : ''}`,
    resolved: `Resolved by ${actor?.name ?? 'the support team'}`,
    returned_on_exit: `Returned to the queue: ${from?.name ?? 'the assignee'} no longer works the Support desk`,
  };
  // Flat, as the dashboard reads it.
  const flat = (prefix: 'actor' | 'to' | 'from', who: { userId?: string; name: string } | null) =>
    who ? { ...(who.userId ? { [`${prefix}UserId`]: who.userId } : {}), [`${prefix}Name`]: who.name } : {};
  return {
    id: event.id,
    type: event.type,
    ...flat('actor', actor),
    ...flat('to', to),
    ...flat('from', from),
    ...(event.note ? { note: event.note } : {}),
    text: text[event.type],
    createdAt: event.createdAt,
  };
}

// ---------------------------------------------------------------------------
// Shared writes
// ---------------------------------------------------------------------------

async function recordEvent(
  ticket: Pick<SupportTicket, 'id' | 'org'>,
  event: Omit<SupportEvent, 'id' | 'ticketId' | 'org' | 'createdAt'> & { createdAt?: Date },
): Promise<void> {
  await supportEvents().insertOne({
    id: randomUUID(),
    ticketId: ticket.id,
    org: ticket.org,
    ...event,
    createdAt: event.createdAt ?? new Date(),
  });
}

/**
 * A state change that only lands on the version it was decided against: if
 * two heads act at once, the second is refused and reloads.
 */
async function changeTicket(ticket: SupportTicket, update: UpdateFilter<SupportTicket>): Promise<SupportTicket> {
  const now = new Date();
  const fresh = await supportTickets().findOneAndUpdate(
    { id: ticket.id, version: ticket.version },
    {
      ...update,
      $set: { ...(update.$set ?? {}), updatedAt: now },
      $inc: { ...(update.$inc ?? {}), version: 1 },
    } as UpdateFilter<SupportTicket>,
    { returnDocument: 'after', projection: { _id: 0 } },
  );
  if (!fresh) throw new SupportError(409, 'This ticket just changed. Reload it and try again.');
  return fresh;
}

/** Appends a message and moves the ticket's activity, unread and preview with it. */
async function appendMessage(
  ticket: SupportTicket,
  message: Omit<SupportMessage, 'id' | 'ticketId' | 'org' | 'createdAt'>,
  unreadFor: 'employee' | 'staff',
): Promise<{ message: SupportMessage; ticket: SupportTicket }> {
  const now = new Date();
  const doc: SupportMessage = { id: randomUUID(), ticketId: ticket.id, org: ticket.org, ...message, createdAt: now };
  await supportMessages().insertOne({ ...doc });
  const set: Partial<SupportTicket> = {
    lastMessageAt: now,
    updatedAt: now,
    lastMessagePreview: preview(message.text, message.attachments?.length ?? 0),
  };
  const inc = { version: 1, [unreadFor === 'employee' ? 'unreadForEmployee' : 'unreadForStaff']: 1 };
  const fresh = await supportTickets().findOneAndUpdate(
    { id: ticket.id },
    { $set: set, $inc: inc } as UpdateFilter<SupportTicket>,
    { returnDocument: 'after', projection: { _id: 0 } },
  );
  return { message: doc, ticket: fresh ?? ticket };
}

// ---------------------------------------------------------------------------
// App: the employee
// ---------------------------------------------------------------------------

export function listTopics() {
  return { topics: SUPPORT_TOPICS.map(({ key, label }) => ({ key, label })) };
}

async function ownTicket(actor: Actor, ticketId: string, action: 'read' | 'reply'): Promise<SupportTicket> {
  const ticket = await supportTickets().findOne({ id: ticketId }, { projection: { _id: 0 } });
  if (!ticket) throw new SupportError(404, 'Ticket not found');
  enforce(employeeMay(action, actor.userId, ticket));
  return ticket;
}

export async function createTicket(
  actor: Actor,
  // Older app builds also send `confidential`; it is ignored.
  input: { topic?: unknown; text?: unknown },
  files: SupportUpload[],
) {
  const org = orgOf(actor);
  if (!isSupportTopic(input.topic)) throw new SupportError(400, 'Choose a type of ticket');
  const text = cleanText(input.text, MAX_TEXT);
  if (!text) throw new SupportError(400, 'Describe your concern');

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const recent = await supportTickets().countDocuments({ requesterUserId: actor.userId, createdAt: { $gte: since } });
  if (recent >= MAX_TICKETS_PER_DAY) {
    throw new SupportError(429, 'You have raised a lot of tickets today. Please continue in one of your open tickets.');
  }

  const id = randomUUID();
  const attachments = await storeAttachments(org, id, files);
  // Per-org number, shown as SUP-0042.
  const counter = await supportCounters().findOneAndUpdate(
    { org },
    { $inc: { seq: 1 } },
    { upsert: true, returnDocument: 'after', projection: { _id: 0, seq: 1 } },
  );
  const now = new Date();
  const autoAt = new Date(now.getTime() + 1);
  const ticket: SupportTicket = {
    id,
    org,
    ticketNo: counter?.seq ?? 0,
    requesterUserId: actor.userId,
    topic: input.topic,
    status: 'open',
    lastMessageAt: autoAt,
    // The concern itself, not the automatic reply: it is what a head triages by.
    lastMessagePreview: preview(text, attachments.length),
    unreadForEmployee: 0,
    unreadForStaff: 1,
    createdAt: now,
    updatedAt: now,
    version: 1,
  };
  const first: SupportMessage = {
    id: randomUUID(), ticketId: id, org, senderUserId: actor.userId, side: 'employee', text,
    ...(attachments.length ? { attachments } : {}), createdAt: now,
  };
  const auto: SupportMessage = { id: randomUUID(), ticketId: id, org, side: 'system', text: AUTO_REPLY, createdAt: autoAt };
  await supportTickets().insertOne({ ...ticket });
  await supportMessages().insertMany([{ ...first }, { ...auto }]);
  await recordEvent(ticket, { type: 'created', actorUserId: actor.userId, visibleToEmployee: false, createdAt: now });

  emit(ticket, 'created', true, [actor.userId]);
  void headsOf(org).then((heads) =>
    notifySafe(heads, {
      scenario: 'support_ticket_new',
      title: 'New support ticket',
      body: `${supportTopicLabel(ticket.topic)} ticket from ${actor.name}`,
      data: { destination: 'support_ticket', ticketId: id },
    }),
  );

  return {
    ticket: ticketForEmployee(ticket),
    messages: await Promise.all([first, auto].map(messageForEmployee)),
  };
}

export async function listMyTickets(actor: Actor) {
  const rows = await supportTickets()
    .find({ requesterUserId: actor.userId }, { projection: { _id: 0 } })
    .sort({ lastMessageAt: -1 })
    .limit(LIST_LIMIT)
    .toArray();
  return { tickets: rows.map(ticketForEmployee) };
}

export async function getMyTicket(actor: Actor, ticketId: string) {
  let ticket = await ownTicket(actor, ticketId, 'read');
  const [messages, events] = await Promise.all([
    supportMessages().find({ ticketId }, { projection: { _id: 0 } }).sort({ createdAt: 1 }).toArray(),
    supportEvents().find({ ticketId, visibleToEmployee: true }, { projection: { _id: 0 } }).sort({ createdAt: 1 }).toArray(),
  ]);
  if (ticket.unreadForEmployee > 0) {
    await supportTickets().updateOne({ id: ticketId }, { $set: { unreadForEmployee: 0 } });
    ticket = { ...ticket, unreadForEmployee: 0 };
  }
  return {
    ticket: ticketForEmployee(ticket),
    messages: await Promise.all(messages.map(messageForEmployee)),
    events: events.map(eventForEmployee).filter((event) => event.text),
  };
}

export async function postEmployeeMessage(actor: Actor, ticketId: string, input: { text?: unknown }, files: SupportUpload[]) {
  const ticket = await ownTicket(actor, ticketId, 'reply');
  const text = cleanText(input.text, MAX_TEXT);
  if (!text && !files.length) throw new SupportError(400, 'Write a message or attach a file');
  const attachments = await storeAttachments(ticket.org, ticket.id, files);
  const { message, ticket: fresh } = await appendMessage(
    ticket,
    { senderUserId: actor.userId, side: 'employee', text, ...(attachments.length ? { attachments } : {}) },
    'staff',
  );

  emit(fresh, 'message', true, [fresh.assigneeUserId, actor.userId]);
  const recipients = fresh.status === 'assigned' && fresh.assigneeUserId ? [fresh.assigneeUserId] : await headsOf(fresh.org);
  void notifySafe(recipients, {
    scenario: 'support_employee_reply',
    title: 'New reply on a support ticket',
    body: `${actor.name} replied on a ${supportTopicLabel(fresh.topic)} ticket`,
    data: { destination: 'support_ticket', ticketId: fresh.id },
  });
  return { message: await messageForEmployee(message) };
}

// ---------------------------------------------------------------------------
// Dashboard: Support heads and staff
// ---------------------------------------------------------------------------

interface StaffViewer {
  userId: string;
  org: string;
  role: SupportRole;
}

function staffViewer(actor: Actor): StaffViewer {
  const role = supportRoleOf(actor);
  if (!role) throw new SupportError(403, "You don't have a Support desk role");
  return { userId: actor.userId, org: orgOf(actor), role };
}

/** Requires a role: mounted behind `GET /admin/support/me`, which does not. */
export function requireSupportRole(actor: Actor): void {
  staffViewer(actor);
}

async function staffTicket(viewer: StaffViewer, ticketId: string, action: StaffAction): Promise<SupportTicket> {
  const ticket = await supportTickets().findOne({ id: ticketId, org: viewer.org }, { projection: { _id: 0 } });
  if (!ticket) throw new SupportError(404, 'Ticket not found');
  enforce(staffMay(action, viewer, ticket));
  return ticket;
}

async function staffTicketView(ticket: SupportTicket) {
  const [requester, names] = await Promise.all([requesterOf(ticket), namesOf([ticket.assigneeUserId])]);
  return ticketForStaff(ticket, requester, names);
}

export function supportMe(actor: Actor) {
  return { role: supportRoleOf(actor) };
}

export async function listStaffTickets(actor: Actor, viewInput: unknown) {
  const viewer = staffViewer(actor);
  const view = (typeof viewInput === 'string' && viewInput ? viewInput : viewer.role === 'head' ? 'new' : 'mine') as SupportView;
  if (!SUPPORT_VIEWS.includes(view)) throw new SupportError(400, 'view must be new, assigned, mine or all');
  if (!viewAllowed(viewer.role, view)) throw new SupportError(403, 'Support staff see only their own tickets');
  const { org, userId } = viewer;

  if (viewer.role === 'head') await returnTicketsFromInactiveAssignees(org);

  const filter =
    view === 'new' ? { org, status: 'open' as const }
      : view === 'assigned' ? { org, status: 'assigned' as const }
        : view === 'mine' ? { org, assigneeUserId: userId }
          : { org };
  // The queue is worked oldest first; every other list by latest activity.
  const sort: Sort = view === 'new' ? { createdAt: 1 } : { lastMessageAt: -1 };
  const [rows, counts] = await Promise.all([
    supportTickets().find(filter, { projection: { _id: 0 } }).sort(sort).limit(LIST_LIMIT).toArray(),
    viewer.role === 'head'
      ? Promise.all([
          supportTickets().countDocuments({ org, status: 'open' }),
          supportTickets().countDocuments({ org, status: 'assigned' }),
          supportTickets().countDocuments({ org, assigneeUserId: userId, status: 'assigned' }),
          supportTickets().countDocuments({ org }),
        ])
      : Promise.all([0, 0, supportTickets().countDocuments({ org, assigneeUserId: userId, status: 'assigned' }), 0]),
  ]);
  const [requesters, names] = await Promise.all([
    requestersOf(rows.map((row) => row.requesterUserId)),
    namesOf(rows.map((row) => row.assigneeUserId)),
  ]);
  return {
    tickets: rows.map((row) => ticketForStaff(row, requesters.get(row.requesterUserId) ?? requesterView(null), names)),
    counts: { new: counts[0], assigned: counts[1], mine: counts[2], all: counts[3] },
  };
}

export async function getStaffTicket(actor: Actor, ticketId: string) {
  const viewer = staffViewer(actor);
  let ticket = await staffTicket(viewer, ticketId, 'read');
  const [messages, events] = await Promise.all([
    supportMessages().find({ ticketId }, { projection: { _id: 0 } }).sort({ createdAt: 1 }).toArray(),
    supportEvents().find({ ticketId }, { projection: { _id: 0 } }).sort({ createdAt: 1 }).toArray(),
  ]);
  // Read by whoever holds it — or by a head, while nobody does. A head
  // glancing at someone else's ticket leaves their unread count alone.
  const holder = ticket.assigneeUserId === viewer.userId || (!ticket.assigneeUserId && viewer.role === 'head');
  if (holder && ticket.unreadForStaff > 0) {
    await supportTickets().updateOne({ id: ticketId }, { $set: { unreadForStaff: 0 } });
    ticket = { ...ticket, unreadForStaff: 0 };
  }
  const [requester, names] = await Promise.all([
    requesterOf(ticket),
    namesOf([
      ticket.assigneeUserId,
      ...messages.filter((m) => m.side === 'staff').map((m) => m.senderUserId),
      ...events.flatMap((e) => [e.actorUserId, e.toUserId, e.fromUserId]),
    ]),
  ]);
  return {
    ticket: ticketForStaff(ticket, requester, names),
    messages: await Promise.all(messages.map((message) => messageForStaff(message, requester, names))),
    events: events.map((event) => eventForStaff(event, ticket, requester, names)),
  };
}

export async function postStaffMessage(actor: Actor, ticketId: string, input: { text?: unknown }, files: SupportUpload[]) {
  const viewer = staffViewer(actor);
  let ticket = await staffTicket(viewer, ticketId, 'reply');
  const text = cleanText(input.text, MAX_TEXT);
  if (!text && !files.length) throw new SupportError(400, 'Write a message or attach a file');
  // A head answering a ticket nobody holds keeps it, so the employee hears one voice.
  if (ticket.status === 'open' && viewer.role === 'head') {
    await checkAssignable(ticket, viewer, viewer.userId);
    ticket = await assignTo(ticket, viewer, viewer.userId);
  }
  const attachments = await storeAttachments(ticket.org, ticket.id, files);
  const { message, ticket: fresh } = await appendMessage(
    ticket,
    { senderUserId: viewer.userId, side: 'staff', text, ...(attachments.length ? { attachments } : {}) },
    'employee',
  );
  emit(fresh, 'message', true, [fresh.requesterUserId, fresh.assigneeUserId]);
  void notifySafe([fresh.requesterUserId], {
    scenario: 'support_reply',
    title: 'HR team replied',
    body: `New reply on your ${supportTopicLabel(fresh.topic)} ticket`,
    data: { destination: 'support_ticket', ticketId: fresh.id },
  });
  const [requester, names] = await Promise.all([requesterOf(fresh), namesOf([viewer.userId])]);
  return { message: await messageForStaff(message, requester, names) };
}

/**
 * Refuses a holder the ticket may never go to: someone without a Support
 * role, the requester, or — on a Manager ticket — anyone in the requester's
 * reporting line above them.
 */
async function checkAssignable(ticket: SupportTicket, viewer: StaffViewer, targetUserId: string): Promise<void> {
  const target = await users().findOne(
    { userId: targetUserId, org: viewer.org },
    { projection: { _id: 0, userId: 1, supportRole: 1, dashboardAccess: 1, lifecycleStatus: 1 } },
  );
  if (!target || !supportRoleOf(target)) throw new SupportError(400, 'Choose someone with a Support desk role');
  const roster = await users()
    .find({ org: viewer.org }, { projection: { _id: 0, userId: 1, managerUserId: 1 } })
    .toArray();
  const byId = new Map(roster.map((person) => [person.userId, person]));
  if (!assignmentBlocked(ticket, byId.get(ticket.requesterUserId) ?? null, targetUserId, byId)) return;
  throw new SupportError(
    409,
    targetUserId === ticket.requesterUserId
      ? "A ticket can't be assigned to the person who raised it"
      : "A Manager ticket can't go to the requester's manager or anyone above them",
  );
}

/** Moves a ticket onto someone's desk, after every check has passed. */
async function assignTo(ticket: SupportTicket, viewer: StaffViewer, targetUserId: string): Promise<SupportTicket> {
  const previous = ticket.status === 'assigned' ? ticket.assigneeUserId : undefined;
  const type: SupportEventType = targetUserId === viewer.userId ? 'kept' : previous ? 'reassigned' : 'assigned';
  const now = new Date();
  const firstTime = !ticket.firstAssignedAt;
  const fresh = await changeTicket(ticket, {
    $set: {
      status: 'assigned',
      assigneeUserId: targetUserId,
      assignedByUserId: viewer.userId,
      assignedAt: now,
      ...(firstTime ? { firstAssignedAt: now } : {}),
    },
  });
  await recordEvent(fresh, {
    type,
    actorUserId: viewer.userId,
    toUserId: targetUserId,
    ...(previous ? { fromUserId: previous } : {}),
    // The employee hears only "Your ticket is with the team", and only once.
    visibleToEmployee: firstTime,
    createdAt: now,
  });
  emit(fresh, 'assigned', true, [targetUserId, previous, fresh.requesterUserId]);
  if (targetUserId !== viewer.userId) {
    const name = await requesterName(fresh);
    void notifySafe([targetUserId], {
      scenario: 'support_ticket_assigned',
      title: 'Support ticket assigned to you',
      body: `${supportTopicLabel(fresh.topic)} ticket from ${name}`,
      data: { destination: 'support_ticket', ticketId: fresh.id },
    });
  }
  return fresh;
}

export async function assignTicket(actor: Actor, ticketId: string, input: { assigneeUserId?: unknown; version?: unknown }) {
  const viewer = staffViewer(actor);
  const ticket = await staffTicket(viewer, ticketId, 'assign');
  const targetUserId = typeof input.assigneeUserId === 'string' ? input.assigneeUserId.trim() : '';
  if (!targetUserId) throw new SupportError(400, 'Choose who to assign it to');
  if (input.version !== undefined && input.version !== null && Number(input.version) !== ticket.version) {
    const names = await namesOf([ticket.assigneeUserId]);
    throw new SupportError(409, 'This ticket just changed. Reload it and try again.', {
      assignee: ticket.assigneeUserId ? { userId: ticket.assigneeUserId, name: names.get(ticket.assigneeUserId) ?? '' } : null,
      version: ticket.version,
    });
  }
  if (ticket.status === 'assigned' && ticket.assigneeUserId === targetUserId) {
    return { ticket: await staffTicketView(ticket) };
  }

  await checkAssignable(ticket, viewer, targetUserId);
  const fresh = await assignTo(ticket, viewer, targetUserId);
  return { ticket: await staffTicketView(fresh) };
}

export async function sendBackTicket(actor: Actor, ticketId: string, input: { note?: unknown }) {
  const viewer = staffViewer(actor);
  const ticket = await staffTicket(viewer, ticketId, 'send_back');
  const note = cleanText(input.note, MAX_NOTE);
  const fresh = await changeTicket(ticket, {
    $set: { status: 'open' },
    $unset: { assigneeUserId: '', assignedByUserId: '', assignedAt: '' },
  });
  await recordEvent(fresh, {
    type: 'sent_back',
    actorUserId: viewer.userId,
    fromUserId: viewer.userId,
    ...(note ? { note } : {}),
    visibleToEmployee: false,
  });
  emit(fresh, 'sent_back', true, [viewer.userId]);
  const names = await namesOf([viewer.userId]);
  void headsOf(fresh.org).then((heads) =>
    notifySafe(heads, {
      scenario: 'support_ticket_sent_back',
      title: 'Support ticket sent back',
      body: `${names.get(viewer.userId) ?? 'Support staff'} sent back a ${supportTopicLabel(fresh.topic)} ticket`,
      data: { destination: 'support_ticket', ticketId: fresh.id },
    }),
  );
  return { ticket: await staffTicketView(fresh) };
}

export async function resolveTicket(actor: Actor, ticketId: string) {
  const viewer = staffViewer(actor);
  const ticket = await staffTicket(viewer, ticketId, 'resolve');
  const now = new Date();
  const fresh = await changeTicket(ticket, { $set: { status: 'resolved', resolvedAt: now, resolvedByUserId: viewer.userId } });
  await recordEvent(fresh, { type: 'resolved', actorUserId: viewer.userId, visibleToEmployee: true, createdAt: now });
  emit(fresh, 'resolved', true, [fresh.requesterUserId, fresh.assigneeUserId]);
  void notifySafe([fresh.requesterUserId], {
    scenario: 'support_resolved',
    title: 'Ticket resolved',
    body: `Your ${supportTopicLabel(fresh.topic)} ticket was marked as resolved`,
    data: { destination: 'support_ticket', ticketId: fresh.id },
  });
  return { ticket: await staffTicketView(fresh) };
}

export async function listAssignees(actor: Actor) {
  const viewer = staffViewer(actor);
  if (viewer.role !== 'head') throw new SupportError(403, 'Only a Support head can assign tickets');
  const rows = await users()
    .find(
      { org: viewer.org, supportRole: { $in: ['head', 'staff'] }, dashboardAccess: true, lifecycleStatus: { $nin: INACTIVE } } as never,
      { projection: { _id: 0, userId: 1, name: 1, supportRole: 1 } },
    )
    .sort({ name: 1 })
    .toArray();
  return { people: rows.map((row) => ({ userId: row.userId, name: row.name, role: row.supportRole as SupportRole })) };
}

// ---------------------------------------------------------------------------
// Someone leaves the desk
// ---------------------------------------------------------------------------

/**
 * Returns everything open on someone's desk to the heads' queue, thread
 * intact, with a `returned_on_exit` event. Called when People › Accesses
 * removes their role or their dashboard access; offboarding is caught by
 * `returnTicketsFromInactiveAssignees` the next time a head opens a list,
 * since no API offboards anyone today.
 */
export async function returnTicketsOf(userId: string, org: string, actorUserId = 'system'): Promise<number> {
  const held = await supportTickets()
    .find({ org, assigneeUserId: userId, status: 'assigned' }, { projection: { _id: 0 } })
    .toArray();
  let returned = 0;
  for (const ticket of held) {
    const fresh = await supportTickets().findOneAndUpdate(
      { id: ticket.id, assigneeUserId: userId, status: 'assigned' },
      {
        $set: { status: 'open', updatedAt: new Date() },
        $unset: { assigneeUserId: '', assignedByUserId: '', assignedAt: '' },
        $inc: { version: 1 },
      },
      { returnDocument: 'after', projection: { _id: 0 } },
    );
    if (!fresh) continue;
    returned += 1;
    await recordEvent(fresh, { type: 'returned_on_exit', actorUserId, fromUserId: userId, visibleToEmployee: false });
    emit(fresh, 'sent_back', true, [userId]);
  }
  if (returned) logger.info('Support tickets returned to the queue', { org, userId, returned });
  return returned;
}

const lastSweep = new Map<string, number>();
const SWEEP_EVERY_MS = 60_000;

/** Tickets held by someone offboarded, or no longer on the desk, go back to the queue. */
export async function returnTicketsFromInactiveAssignees(org: string): Promise<number> {
  const now = Date.now();
  if (now - (lastSweep.get(org) ?? 0) < SWEEP_EVERY_MS) return 0;
  lastSweep.set(org, now);
  try {
    const holders = (await supportTickets().distinct('assigneeUserId', { org, status: 'assigned' })).filter(Boolean) as string[];
    if (!holders.length) return 0;
    const people = await users()
      .find({ userId: { $in: holders } }, { projection: { _id: 0, userId: 1, supportRole: 1, dashboardAccess: 1, lifecycleStatus: 1 } })
      .toArray();
    const onDesk = new Set(people.filter((person) => supportRoleOf(person)).map((person) => person.userId));
    let returned = 0;
    for (const holder of holders) {
      if (!onDesk.has(holder)) returned += await returnTicketsOf(holder, org);
    }
    return returned;
  } catch (error) {
    logger.error('Support sweep failed', { org }, error);
    return 0;
  }
}
