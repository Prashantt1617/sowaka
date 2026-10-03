/**
 * Talk: a counselling session booked from the app.
 *
 * One record per booking. Slots are never stored — they are worked out on
 * request from the counsellor's hours minus the sessions that already exist,
 * the same way attendance days are computed rather than kept, so there is no
 * slot table to drift out of date.
 */
export type TalkSessionStatus = 'booked' | 'completed' | 'cancelled';

export interface TalkZoomMeeting {
  meetingId: string;
  /** What the person who booked opens. */
  joinUrl: string;
  /** What the counsellor opens to start it as host. Never sent to the app. */
  startUrl: string;
  /**
   * True when no Zoom credentials were configured and the link is a stand-in,
   * so a developer can walk the flow. Never true on a configured host.
   */
  placeholder?: boolean;
}

export interface TalkSession {
  id: string;
  clientUserId: string;
  /** The booker's company; a session crosses companies, so it is kept here. */
  clientOrg: string;
  counsellorUserId: string;
  startsAt: Date;
  endsAt: Date;
  status: TalkSessionStatus;
  zoom?: TalkZoomMeeting;
  /** How the person said they felt just before joining, when they said. */
  checkIn?: { feeling: SessionFeeling; note?: string; at: Date };
  /** What they made of it afterwards, when they said. */
  review?: { rating: number; note?: string; at: Date };
  createdAt: Date;
  updatedAt: Date;
  cancelledAt?: Date;
}

/** The five answers to "how are you feeling?" before a session. */
export const SESSION_FEELINGS = ['low', 'anxious', 'okay', 'hopeful', 'good'] as const;
export type SessionFeeling = (typeof SESSION_FEELINGS)[number];
/** Longest check-in or review note, in characters. */
export const SESSION_NOTE_MAX = 300;
/**
 * How long the card asking about a finished session stays on Help before it
 * gives up, in days. Long enough to survive a weekend, short enough that the
 * question is still about something remembered.
 */
export const SESSION_REVIEW_WINDOW_DAYS = 3;

/** How far ahead a session may be booked, in days from today. */
export const TALK_BOOKING_HORIZON_DAYS = 14;
