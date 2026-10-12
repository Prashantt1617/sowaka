/**
 * Support desk: an employee raises a concern from the app, a Support head
 * assigns it (or keeps it), and whoever holds it chats with the employee from
 * the dashboard. See the support contract for the rules; the service enforces
 * them, and `services/support-rules.ts` holds the pure decisions.
 */

/** Who works the desk. Set per person by a dashboard admin in People › Accesses. */
export type SupportRole = 'head' | 'staff';
export const SUPPORT_ROLES: readonly SupportRole[] = ['head', 'staff'];

/**
 * A person's working role on the desk: needs dashboard access, an active
 * account and a role. Anything else is no role at all.
 */
export function supportRoleOf(
  user: { supportRole?: unknown; dashboardAccess?: boolean; lifecycleStatus?: string } | null | undefined,
): SupportRole | null {
  if (!user || user.dashboardAccess !== true) return null;
  if (user.lifecycleStatus === 'offboarded' || user.lifecycleStatus === 'terminated') return null;
  return SUPPORT_ROLES.includes(user.supportRole as SupportRole) ? (user.supportRole as SupportRole) : null;
}

export type SupportTicketStatus = 'open' | 'assigned' | 'resolved';

/** One type of ticket, as the app's "Type of request" sheet lists it. */
export interface SupportTopicOption {
  /** Stored on the ticket and never changed: a rename keeps it. */
  key: string;
  /** What the app and dashboard show. */
  label: string;
}

/**
 * The eight types from the design's "Type of request" sheet (Figma node
 * 2896:32710), in its order. What every company has until HR edits its own
 * list (`support_topics`, see `services/support-topics.service.ts`), and what
 * `reset` goes back to. Served by `GET /support/topics` so neither the app nor
 * the dashboard hard-codes them.
 */
export const DEFAULT_SUPPORT_TOPICS: readonly SupportTopicOption[] = [
  { key: 'workplace', label: 'Workplace' },
  { key: 'manager', label: 'Manager' },
  { key: 'payroll', label: 'Payroll' },
  { key: 'attendance', label: 'Attendance' },
  { key: 'leaves', label: 'Leaves' },
  { key: 'benefits', label: 'Benefits' },
  { key: 'safety', label: 'Safety issues' },
  { key: 'other', label: 'Other' },
];

/**
 * The type a ticket about the requester's own manager is filed under. Routing
 * keys off it (see `assignmentBlocked`), so an edit never hands it to another
 * type: renaming the Manager type keeps it, and a new type gets it only when it
 * is the Manager type added back under its own name (see `mergeSupportTopics`).
 */
export const MANAGER_TOPIC = 'manager';

/**
 * A company's own list of ticket types, one document per org, edited by a
 * Support head or a dashboard admin (or `scripts/support-topics.ts`). No
 * document: the defaults.
 */
export interface SupportTopicList {
  org: string;
  /** In the order the app lists them. */
  topics: SupportTopicOption[];
  updatedAt: Date;
  /** A userId, or `cli:<name>` from the script. */
  updatedByUserId: string;
}

export interface SupportTicket {
  id: string;
  org: string;
  /** Per-org running number, shown as SUP-0042. */
  ticketNo: number;
  requesterUserId: string;
  /** The type's key, as the org's list had it when the ticket was raised. */
  topic: string;
  /**
   * The type's label at that moment, so a later rename or removal never
   * changes what an old ticket reads as. Absent on tickets raised before
   * types were per company, which were all raised under the defaults.
   */
  topicLabel?: string;
  status: SupportTicketStatus;
  assigneeUserId?: string;
  assignedByUserId?: string;
  assignedAt?: Date;
  /**
   * When a head first assigned it. A send-back returns the ticket to `open`,
   * but the employee is never told about send-backs, so their app keeps
   * showing it as in progress once anyone has had it.
   */
  firstAssignedAt?: Date;
  resolvedAt?: Date;
  resolvedByUserId?: string;
  lastMessageAt: Date;
  lastMessagePreview: string;
  unreadForEmployee: number;
  unreadForStaff: number;
  createdAt: Date;
  updatedAt: Date;
  /** Bumped on every change; an assign only lands on the version it was made against. */
  version: number;
}

export interface SupportAttachment {
  /** S3 object key. Never sent to a client; clients get a short-lived signed URL. */
  key: string;
  name: string;
  contentType: string;
  size: number;
}

export type SupportMessageSide = 'employee' | 'staff' | 'system';

export interface SupportMessage {
  id: string;
  ticketId: string;
  org: string;
  /** Absent on system lines. Never sent to a client. */
  senderUserId?: string;
  side: SupportMessageSide;
  text: string;
  attachments?: SupportAttachment[];
  createdAt: Date;
}

export type SupportEventType =
  | 'created'
  | 'assigned'
  | 'reassigned'
  | 'kept'
  | 'sent_back'
  | 'resolved'
  | 'returned_on_exit';

/** Append-only audit trail of a ticket. */
export interface SupportEvent {
  id: string;
  ticketId: string;
  org: string;
  type: SupportEventType;
  /** A userId, or 'system' for automatic returns. */
  actorUserId: string;
  toUserId?: string;
  fromUserId?: string;
  note?: string;
  visibleToEmployee: boolean;
  createdAt: Date;
}

/** Kinds carried by the `support:changed` socket event. */
export type SupportChangeKind = 'created' | 'message' | 'assigned' | 'sent_back' | 'resolved';
