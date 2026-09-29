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
  createdAt: Date;
  updatedAt: Date;
  cancelledAt?: Date;
}

/** How far ahead a session may be booked, in days from today. */
export const TALK_BOOKING_HORIZON_DAYS = 14;
