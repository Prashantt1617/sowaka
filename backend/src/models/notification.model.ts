export interface DeviceToken {
  userId: string;
  token: string;
  platform: 'android' | 'ios' | 'web';
  /**
   * The notification sounds this phone has, as `key@version` (built in and
   * downloaded). Absent on app builds before sounds: those get the plain push.
   */
  sounds?: string[];
  updatedAt: Date;
  createdAt: Date;
}

export interface AppNotification {
  id: string;
  userId: string;
  org: string;
  scenario: string;
  title: string;
  body: string;
  data: Record<string, string>;
  /** Whether it also went out as a push; false for inbox-only entries. */
  pushed?: boolean;
  readAt?: Date;
  createdAt: Date;
}
