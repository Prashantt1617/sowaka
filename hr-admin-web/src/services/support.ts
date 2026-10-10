// Support desk: tickets employees raise from the app, worked from the dashboard.
// A Support head sees every ticket and assigns them; support staff see only
// the tickets assigned to them. Both always see who raised a ticket.
import { api, apiUpload } from './http';

export type SupportRole = 'head' | 'staff';
export type SupportView = 'new' | 'assigned' | 'mine' | 'all';
export type SupportStatus = 'open' | 'assigned' | 'resolved';

/** Who raised it: name, employee id, department and photo, as their record has them. */
export type SupportRequester = {
  userId?: string;
  name: string;
  employeeId?: string;
  department?: string;
  photoUrl?: string;
};

export type SupportTicket = {
  id: string;
  topic: string;
  topicLabel: string;
  status: SupportStatus;
  requester: SupportRequester;
  assignee: { userId: string; name: string } | null;
  createdAt: string;
  lastMessageAt: string;
  lastMessagePreview: string;
  unread: number;
  /** Goes up on every change; an assign sent with an older one is refused (409). */
  version: number;
};

export type SupportAttachment = { name: string; contentType: string; size: number; url: string };

export type SupportMessage = {
  id: string;
  side: 'employee' | 'staff' | 'system';
  /** Staff's real name, the requester's display name, or '' for system lines. */
  senderLabel: string;
  text: string;
  attachments: SupportAttachment[];
  createdAt: string;
};

export type SupportEventType =
  | 'created'
  | 'assigned'
  | 'reassigned'
  | 'kept'
  | 'sent_back'
  | 'resolved'
  | 'returned_on_exit';

/**
 * One line of a ticket's history. The contract leaves the dashboard shape
 * open; this reads the stored event plus the names the server resolves
 * (`actorName`, `toName`). Without names it falls back to neutral wording.
 */
export type SupportEvent = {
  id: string;
  type: SupportEventType;
  actorUserId?: string;
  actorName?: string;
  toUserId?: string;
  toName?: string;
  /** Who it left: the previous holder on a reassign, the person off the desk on `returned_on_exit`. */
  fromUserId?: string;
  fromName?: string;
  note?: string;
  createdAt: string;
};

export type SupportCounts = Record<SupportView, number>;
export type SupportAssignee = { userId: string; name: string; role: SupportRole };

export const SUPPORT_MAX_FILES = 5;
export const SUPPORT_MAX_FILE_BYTES = 10 * 1024 * 1024;

export const getSupportMe = () => api<{ role: SupportRole | null }>('/admin/support/me');

export const listSupportTickets = (view: SupportView) =>
  api<{ tickets: SupportTicket[]; counts: SupportCounts }>(`/admin/support/tickets?view=${view}`);

/** Opening a ticket marks the employee's messages read for the desk. */
export const getSupportTicket = (id: string) =>
  api<{ ticket: SupportTicket; messages: SupportMessage[]; events: SupportEvent[] }>(`/admin/support/tickets/${encodeURIComponent(id)}`);

/** Text alone goes as JSON; with files it goes multipart, the files under "files". */
export function sendSupportMessage(id: string, text: string, files: File[] = []) {
  const path = `/admin/support/tickets/${encodeURIComponent(id)}/messages`;
  if (files.length === 0) return api<{ message: SupportMessage }>(path, { method: 'POST', body: { text } });
  const form = new FormData();
  form.append('text', text);
  for (const f of files) form.append('files', f, f.name);
  return apiUpload<{ message: SupportMessage }>(path, form);
}

/**
 * Head only. Assigning to yourself is "Keep it". `version` is the ticket as
 * the head saw it: if someone changed it since, the server refuses with 409.
 */
export const assignSupportTicket = (id: string, assigneeUserId: string, version?: number) =>
  api<unknown>(`/admin/support/tickets/${encodeURIComponent(id)}/assign`, { method: 'POST', body: { assigneeUserId, version } });

/** Assignee (staff) only: back to the head's queue, unassigned. */
export const sendBackSupportTicket = (id: string, note?: string) =>
  api<unknown>(`/admin/support/tickets/${encodeURIComponent(id)}/send-back`, { method: 'POST', body: note ? { note } : {} });

export const resolveSupportTicket = (id: string) =>
  api<unknown>(`/admin/support/tickets/${encodeURIComponent(id)}/resolve`, { method: 'POST', body: {} });

/** Head only: everyone in the company with a Support role. */
export const listSupportAssignees = () => api<{ people: SupportAssignee[] }>('/admin/support/assignees');
