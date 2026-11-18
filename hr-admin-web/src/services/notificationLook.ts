// Setup › Notification sounds and pictures: each kind of push's sound and
// picture (/admin/notification-look, dashboard admins only).
import { api, apiUpload } from './http';

export type NotificationKind =
  | 'contest_posted' | 'contest_closing' | 'contest_results'
  | 'cup_lobby' | 'cup_match_open' | 'cup_betting_open' | 'cup_champion'
  | 'other';

export type KindLook = {
  /** Off: sent plainly, with the phone's own sound and no picture. */
  enabled: boolean;
  /** A sound key; null for the phone's own notification sound. */
  sound: string | null;
  /** The post's or event's own picture first, when it has one. */
  ownPicture: boolean;
  /** Otherwise this uploaded picture (a media key). */
  pictureKey: string | null;
};

export type KindRow = {
  kind: NotificationKind;
  label: string;
  when: string;
  hasOwnPicture: boolean;
  look: KindLook;
  defaultLook: KindLook;
  isDefault: boolean;
  /** `/media/...` for the uploaded picture, resolved with mediaUrl. */
  pictureUrl: string | null;
};

export type NotificationSound = {
  key: string;
  name: string;
  version: number;
  builtIn: boolean;
  /** An uploaded one's file on the API; built-ins play from the dashboard's own copy. */
  url: string | null;
};

export type NotificationLookDTO = { kinds: KindRow[]; sounds: NotificationSound[]; updatedAt: string | null };

const P = '/admin/notification-look';

export async function getNotificationLook(): Promise<NotificationLookDTO> {
  return api<NotificationLookDTO>(P);
}

/** A kind sent as null goes back to Sowaka's default. */
export async function saveNotificationLook(kinds: Partial<Record<NotificationKind, KindLook | null>>): Promise<NotificationLookDTO> {
  return api<NotificationLookDTO>(P, { method: 'PUT', body: { kinds } });
}

export async function uploadNotificationSound(file: File, name: string): Promise<NotificationSound> {
  const form = new FormData();
  form.append('name', name);
  form.append('file', file);
  return (await apiUpload<{ sound: NotificationSound }>(`${P}/sounds`, form)).sound;
}

export async function uploadNotificationPicture(file: File): Promise<{ objectKey: string; url: string }> {
  const form = new FormData();
  form.append('file', file);
  return apiUpload<{ objectKey: string; url: string }>(`${P}/pictures`, form);
}
