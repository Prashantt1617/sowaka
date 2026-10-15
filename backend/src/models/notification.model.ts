export interface DeviceToken {
  userId: string;
  token: string;
  platform: 'android' | 'ios' | 'web';
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
