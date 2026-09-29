import { randomUUID } from 'node:crypto';
import { env } from '../config/env';
import { logger } from '../utils/logger';

/**
 * Sowaka's Zoom account, driven as a server-to-server app.
 *
 * The backend authenticates as the account itself, so nobody — neither the
 * counsellor nor the person booking — is ever asked to sign in to Zoom. A
 * meeting is created as the counsellor's Zoom user and the join link is what
 * the app hands to the person who booked.
 *
 * Without credentials (a developer's machine) every call returns a placeholder
 * pointing at Zoom's own test page, flagged as such, so the booking flow can
 * be walked end to end and the app can say plainly that the link is not real.
 */
export interface CreateZoomMeetingInput {
  /** The counsellor's login in the Zoom account. */
  hostUserId: string;
  topic: string;
  startsAt: Date;
  durationMinutes: number;
  timezone: string;
}

export interface ZoomMeeting {
  meetingId: string;
  joinUrl: string;
  startUrl: string;
  placeholder: boolean;
}

export class ZoomError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = 'ZoomError';
  }
}

export function zoomConfigured(): boolean {
  return Boolean(env.zoom.accountId && env.zoom.clientId && env.zoom.clientSecret);
}

let cachedToken: { value: string; expiresAt: number } | undefined;

/**
 * An account token, held until shortly before Zoom says it expires. Zoom
 * issues them for an hour; asking for a fresh one per booking would work but
 * counts against the app's rate limit for nothing.
 */
async function accessToken(): Promise<string> {
  const now = Date.now();
  if (cachedToken && cachedToken.expiresAt - 60_000 > now) return cachedToken.value;
  const basic = Buffer.from(`${env.zoom.clientId}:${env.zoom.clientSecret}`).toString('base64');
  const url = new URL('https://zoom.us/oauth/token');
  url.searchParams.set('grant_type', 'account_credentials');
  url.searchParams.set('account_id', env.zoom.accountId);
  const response = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Basic ${basic}` },
  });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    logger.error('Zoom token request refused', { status: response.status, body: body.slice(0, 300) });
    throw new ZoomError(502, 'Zoom did not accept our credentials');
  }
  const json = (await response.json()) as { access_token: string; expires_in: number };
  cachedToken = { value: json.access_token, expiresAt: now + json.expires_in * 1000 };
  return cachedToken.value;
}

export async function createZoomMeeting(input: CreateZoomMeetingInput): Promise<ZoomMeeting> {
  if (!zoomConfigured()) {
    logger.warn('Zoom is not configured; issuing a placeholder meeting link', {
      host: input.hostUserId,
      startsAt: input.startsAt.toISOString(),
    });
    return {
      meetingId: `placeholder-${randomUUID()}`,
      // Zoom's own test-meeting page: it opens, and it is obviously not a
      // real session.
      joinUrl: 'https://zoom.us/test',
      startUrl: 'https://zoom.us/test',
      placeholder: true,
    };
  }
  const token = await accessToken();
  const response = await fetch(
    `https://api.zoom.us/v2/users/${encodeURIComponent(input.hostUserId)}/meetings`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        topic: input.topic,
        type: 2, // scheduled
        start_time: input.startsAt.toISOString(),
        duration: input.durationMinutes,
        timezone: input.timezone,
        settings: {
          waiting_room: true,
          join_before_host: false,
          // The counsellor's mic and camera come on with them; the client's
          // stay as they left them.
          host_video: true,
          participant_video: false,
          mute_upon_entry: false,
          // One person, by invitation: nobody else should stumble in.
          approval_type: 2,
        },
      }),
    },
  );
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    logger.error('Zoom refused to create a meeting', {
      status: response.status,
      host: input.hostUserId,
      body: body.slice(0, 300),
    });
    if (response.status === 404) {
      throw new ZoomError(409, 'This counsellor is not set up in Zoom yet');
    }
    throw new ZoomError(502, 'Zoom could not create the meeting');
  }
  const json = (await response.json()) as { id: number | string; join_url: string; start_url: string };
  return {
    meetingId: String(json.id),
    joinUrl: json.join_url,
    startUrl: json.start_url,
    placeholder: false,
  };
}
