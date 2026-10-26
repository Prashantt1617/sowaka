import type { CompanyFaceIdSettings } from './face.model';

/**
 * Pay Schedule (PRD §5.1 / ORG-3). The payroll run derives actual working days
 * from `weekoffDays` + holidays; this captures the org's declared cadence and,
 * optionally, locks it once the first run has happened (DEC-5).
 */
export interface PaySchedule {
  frequency: 'monthly';
  /** Day pay is released: a day-of-month (1–28) or the last day of the month. */
  payDay: 'last_day' | number;
  /** First period payroll runs for, as 'YYYY-MM'. */
  firstPayPeriod?: string;
  /** Optional declared working days per month (informational). */
  workingDaysPerMonth?: number;
  /** When true, the schedule can no longer be edited once a run exists. */
  lockedAfterFirstRun?: boolean;
}

export interface DeductorDetails {
  type?: string;
  name?: string;
  designation?: string;
}

/**
 * Statutory Registration (PRD §5.1 / ORG-2). Org-level tax identity required
 * before any statutory filing output can be generated.
 */
export interface StatutoryRegistration {
  pan?: string;
  tan?: string;
  tdsCircle?: string;
  aoCode?: string;
  taxPaymentFrequency?: 'monthly' | 'quarterly';
  deductor?: DeductorDetails;
}

/** A tab in the app's bottom bar, as the app names them. */
export type AppTab = 'connect' | 'team' | 'grow' | 'actions' | 'games' | 'care' | 'talk';

/** What a company gets when it has never been given a list. */
export const DEFAULT_APP_TABS: AppTab[] = ['connect', 'team', 'grow', 'actions'];

/**
 * The company's own details, from the dashboard's Organisation page: legal and
 * display names, filing address and contact emails. Every field optional; an
 * empty string means HR cleared it.
 */
export interface OrganisationProfile {
  registeredName?: string;
  displayName?: string;
  country?: string;
  industry?: string;
  /** YYYY-MM-DD, or empty. */
  incorporatedOn?: string;
  addressLine1?: string;
  addressLine2?: string;
  city?: string;
  state?: string;
  pincode?: string;
  addressCountry?: string;
  primaryContactEmail?: string;
  senderEmail?: string;
  senderName?: string;
  replyToEmail?: string;
  updatedAt?: Date;
  updatedBy?: string;
}

export interface Company {
  id: string;
  name: string;
  /** The Organisation page's details; absent until HR first saves it. */
  profile?: OrganisationProfile;
  address?: string;
  // Weekly off days as JS weekday numbers (0 = Sunday .. 6 = Saturday).
  // Used to decide which days count as a "week-off" for full-day overtime.
  // Absent/empty is treated as the default [0] (Sunday) by consumers.
  weekoffDays?: number[];
  // Departments (User.department) for which the overtime feature is hidden/disabled.
  overtimeDisabledDepartments?: string[];
  // Departments and designations HR created on the dashboard, before anyone
  // holds them; the ones people hold come from their own records.
  departmentList?: string[];
  designationList?: string[];
  /**
   * Day of the month review cycles open on (1-28). A value of 10 means the
   * cycle runs 10 Sep - 10 Oct and is keyed `2026-09`. Absent means the 1st,
   * i.e. plain calendar months, which is what existing records assume.
   */
  reviewCycleStartDay?: number;
  paySchedule?: PaySchedule;
  statutoryRegistration?: StatutoryRegistration;
  /**
   * Which tabs this company's people see in the app, by key: connect, team,
   * grow, actions, games, care, talk. Absent means the four the app has always had,
   * so nothing changes for a company that predates this. Written by Sowaka,
   * not by the client's own HR dashboard; the control dashboard that sets it
   * comes later, a script does it until then.
   */
  enabledTabs?: AppTab[];
  /**
   * Which games from `game_catalog` this company's Games tab shows, by key.
   * Absent means the tab's original game, Gratitude Garden, for a company
   * that shows the tab, and nothing for one that does not; see
   * DEFAULT_ENABLED_GAMES. Set by Sowaka with src/scripts/game-catalog.ts.
   */
  enabledGames?: string[];
  /**
   * Which app versions this company's people must, or are asked to, update
   * from; see AppUpdateRule. Absent means no prompt at all. Set by Sowaka with
   * src/scripts/app-update.ts, never by the client's HR dashboard.
   */
  appUpdate?: AppUpdateRule;
  /**
   * The most accounts this company may have (offboarded and terminated people
   * not counted). Absent means no limit. Set by Sowaka per agreement; the HR
   * dashboard cannot raise it, and adding an employee past it is refused.
   */
  maxUsers?: number;
  /** Face ID at punch-in, HR's to switch on; see CompanyFaceIdSettings. Absent is off. */
  faceId?: CompanyFaceIdSettings;
  createdAt?: number;
  updatedAt?: Date;
}

/** Versions by store: the App Store and Play Store builds ship separately. */
export interface AppVersionByPlatform {
  ios?: string;
  android?: string;
}

/**
 * An app older than `force` gets the full-screen update it cannot close; one
 * older than `optional` (and not forced) gets the closable one. Versions are
 * "1.3.8", or "1.3.8+41" to name a build.
 */
export interface AppUpdateRule {
  force?: AppVersionByPlatform;
  optional?: AppVersionByPlatform;
  updatedAt?: Date;
  updatedBy?: string;
}
