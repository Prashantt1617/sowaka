/** Pure statutory-settings helpers, shared by the server and the dashboard. */
import type { BonusSettings, StatutorySettings } from '../../models/statutorySettings.model';

/**
 * Defaults for an org that has never saved its settings. They reproduce how
 * payroll calculated before the screen was wired: PF on, both sides capped at
 * the ceiling, employer contributions on top of CTC, ESI on, no statutory bonus.
 */
export function defaultStatutorySettings(org: string): StatutorySettings {
  return {
    org,
    epf: {
      enabled: true,
      employeeRate: 'restricted',
      employerRate: 'restricted',
      includeEmployer: false,
      includeEDLI: false,
      includeAdmin: false,
      overrideAtEmployee: false,
      proRateRestricted: false,
      considerLOP: true,
    },
    esi: { enabled: true, includeEmployer: false },
    bonus: { enabled: false, frequency: 'monthly', ratePercent: 8.33, minWages: {} },
    lwfDisabledStates: [],
    tds: { enabled: false, defaultRegime: 'new' },
  };
}

/**
 * The minimum wage for a category in a state for a month, if one is set:
 * the latest row whose effective month is not after `period`.
 */
export function minimumWageFor(bonus: BonusSettings, state: string | undefined, category: string | undefined, period: string): number {
  if (!state || !category) return 0;
  const rows = bonus.minWages[state.trim().toLowerCase()] ?? [];
  const match = rows
    .filter((r) => r.category.trim().toLowerCase() === category.trim().toLowerCase() && r.effectiveFrom <= period)
    .sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))[0];
  return match?.minWagePaise ?? 0;
}

