// Dashboard › Engagement › App usage: who is on the app and what they do in it.
// Shapes match backend/src/services/engagement-usage.service.ts.
import { api } from './http';

export type UsageGroup = 'app' | 'bio' | 'present';

export type UsagePersonDTO = {
  id: string;
  name: string;
  dept: string;
  loc: string;
  mgr: string;
  group: UsageGroup;
  reports: number;
  loggedIn: boolean;
  lastLoginAt: string | null;
  photo: boolean;
  interests: boolean;
  face: boolean;
  lastOpen: string | null;
  opened: boolean;
  game: boolean;
  post: boolean;
  contest: boolean;
  tour: boolean;
  appPunch: boolean;
  missed: boolean;
  fixed: boolean;
  hasManager: boolean;
  otEligible: boolean;
  leave: boolean;
  ot: boolean;
  reimb: boolean;
  decidedOnApp: boolean;
  review: boolean;
  payslips: boolean;
  payroll: boolean;
  proofs: boolean;
};

export type UsageManagerDTO = { id: string; got: number; app: number; web: number; wait: number };

export type UsageSummaryDTO = {
  from: string;
  to: string;
  today: string;
  trackingSince: string | null;
  /** Last day whose app opens are estimated from app activity rather than tracked; null when none are. */
  estimatedUntil: string | null;
  missedKnown: boolean;
  people: UsagePersonDTO[];
  managers: UsageManagerDTO[];
  departments: string[];
  locations: string[];
};

export type UsageWhenDTO = {
  from: string;
  to: string;
  trackingSince: string | null;
  hours: number[];
  weekdays: number[];
  trackedDays: number;
};

export type UsageTrendBucketDTO = {
  from: string;
  to: string;
  app: number;
  bio: number;
  present: number;
  untracked: boolean;
  partial: boolean;
  /** Some or all of its days are estimated from app activity rather than tracked. */
  estimated?: boolean;
};

export type UsageTrendDTO = {
  gran: 'date' | 'week' | 'month';
  trackingSince: string | null;
  estimatedUntil?: string | null;
  buckets: UsageTrendBucketDTO[];
  groups: Record<UsageGroup, number>;
};

const qs = (params: Record<string, string>) => new URLSearchParams(params).toString();

export const getUsageSummary = (from: string, to: string) =>
  api<{ summary: UsageSummaryDTO }>(`/admin/engagement/usage/summary?${qs({ from, to })}`).then((r) => r.summary);

export const getUsageWhen = (from: string, to: string, dept: string, loc: string) =>
  api<{ when: UsageWhenDTO }>(`/admin/engagement/usage/when?${qs({ from, to, dept, loc })}`).then((r) => r.when);

export const getUsageTrend = (gran: 'date' | 'week' | 'month', from: string, to: string, dept: string, loc: string) =>
  api<{ trend: UsageTrendDTO }>(`/admin/engagement/usage/trend?${qs({ gran, from, to, dept, loc })}`).then((r) => r.trend);

/** One push to the people picked; the server skips anyone reminded in the last week. */
export const remindPeople = (userIds: string[]) =>
  api<{ sent: number; skipped: number }>('/admin/engagement/usage/remind', { method: 'POST', body: { userIds } });
