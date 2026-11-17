/**
 * How a push looks and sounds on the phone, per kind of notification: the
 * sound it plays and the picture it carries. The words stay with each
 * notification (the server writes them); this is only the look.
 *
 * One row per company (`org`), and an optional Sowaka-wide row (`org: '*'`)
 * that stands in for any kind a company has not set. Kinds neither has set
 * take `SOWAKA_DEFAULT_LOOKS` (services/notification-look.service.ts).
 */

/** The kinds a company can give a look to. `other` is every other notification. */
export const NOTIFICATION_KINDS = [
  'contest_posted',
  'contest_closing',
  'contest_results',
  'cup_lobby',
  'cup_match_open',
  'cup_betting_open',
  'cup_champion',
  'other',
] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

export interface KindLook {
  /** Off: the push goes out plainly, with the phone's own sound and no picture. */
  enabled: boolean;
  /** A sound key (built in or uploaded); null for the phone's own notification sound. */
  sound: string | null;
  /** The post's or event's own picture first, when it has one. */
  ownPicture: boolean;
  /** Otherwise this picture (a Connect media key), or none. */
  pictureKey: string | null;
}

export interface NotificationLookDoc {
  org: string;
  kinds: Partial<Record<NotificationKind, KindLook>>;
  updatedAt: Date;
  updatedBy: string;
}

/**
 * A sound uploaded through the dashboard. Built-in sounds ship in the app and
 * have no row. Uploading a sound under a key that already exists (a built-in
 * one included) makes a new version: Android fixes a channel's sound when the
 * channel is made, so every version is a channel of its own on the phone.
 */
export interface NotificationSoundRecord {
  /** Random; the file's public URL is `/notifications/sounds/file/<id>`. */
  id: string;
  /** The company it belongs to, or '*' for every company. */
  org: string;
  key: string;
  name: string;
  version: number;
  /** In S3 under `notification-sounds/`, or `mongo-sound/<id>` where S3 is not set up. */
  objectKey: string;
  contentType: 'audio/wav';
  size: number;
  durationMs: number;
  createdAt: Date;
  createdBy: string;
}
