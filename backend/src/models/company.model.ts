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

export interface Company {
  id: string;
  name: string;
  address?: string;
  // Weekly off days as JS weekday numbers (0 = Sunday .. 6 = Saturday).
  // Used to decide which days count as a "week-off" for full-day overtime.
  // Absent/empty is treated as the default [0] (Sunday) by consumers.
  weekoffDays?: number[];
  // Departments (User.department) for which the overtime feature is hidden/disabled.
  overtimeDisabledDepartments?: string[];
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
  createdAt?: number;
  updatedAt?: Date;
}
