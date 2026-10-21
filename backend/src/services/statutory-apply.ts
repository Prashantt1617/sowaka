/**
 * Applies the org's statutory settings to one person's month. Shared by the
 * salary-structure calculator (the entitled month) and the payslip calculator
 * (the month actually paid), so both treat PF, ESI, PT and LWF the same way.
 * Pure: no I/O, money in INTEGER PAISE.
 */
import { ResolvedRuleSet } from '../models/statutoryRule.model';
import { StatutorySettings } from '../models/statutorySettings.model';
import {
  computeEpf,
  computeEsi,
  computeLwf,
  computePt,
  EpfResult,
  isEsiApplicable,
  NO_EPF,
  pfWageWithConditional,
} from './statutory-engine';

/** A person's own statutory switches, from their salary structure. Absent = applies. */
export interface PersonStatutory {
  epf?: boolean;
  esi?: boolean;
  lwf?: boolean;
  /** 12% of actual PF wage for this person; honoured only when the org allows overrides. */
  pfActualWage?: boolean;
  /** false: the employer's 12% all goes to PF, nothing to the pension scheme. */
  contributeEps?: boolean;
  /** This person's restricted PF wage, when it differs from the ceiling (Zoho's per-employee "Restricted to ₹…"). */
  pfRestrictedWagePaise?: number;
}

export interface StatutoryApplyInput {
  settings: StatutorySettings;
  ruleSet: ResolvedRuleSet;
  /** 1-based calendar month, for PT and LWF month rules. */
  month: number;
  grossPaise: number;
  /** PF wage from components that always count. */
  pfAlwaysPaise: number;
  /** PF wage from components that count only while the PF wage is under the ceiling. */
  pfConditionalPaise: number;
  /** The always-counted PF wage the "under the ceiling" test is made on. */
  pfTestPaise: number;
  ceilingPaise: number;
  person?: PersonStatutory;
  /** ESI covered this person earlier in the same contribution period. */
  esiCoveredEarlier?: boolean;
  /** The ESI wage, when the template names its components. Absent: gross pay. */
  esiWagePaise?: number;
  /** The template's PF mode. Absent or 'org': the org's restricted/actual setting. */
  pfWageMode?: 'org' | 'actual' | 'ceiling';
}

export interface StatutoryApplied {
  pfWagePaise: number;
  epf: EpfResult;
  esi: { applicable: boolean; employeePaise: number; employerPaise: number };
  pt: { amountPaise: number };
  lwf: { applicable: boolean; employeePaise: number; employerPaise: number };
  /** Employer contributions the settings place inside CTC. */
  includedInCtcPaise: number;
  /** Everything the employer pays on top of gross: PF, EDLI, admin, ESI, LWF. */
  employerContributionsPaise: number;
}

export function applyStatutory(input: StatutoryApplyInput): StatutoryApplied {
  const { settings, person } = input;

  const ceilingPaise = person?.pfRestrictedWagePaise && person.pfRestrictedWagePaise > 0
    ? person.pfRestrictedWagePaise
    : input.ceilingPaise;
  const pfWagePaise = pfWageWithConditional({
    alwaysPaise: input.pfAlwaysPaise,
    conditionalPaise: input.pfConditionalPaise,
    testPaise: input.pfTestPaise,
    ceilingPaise,
  });

  const epfOn = settings.epf.enabled && person?.epf !== false;
  const employeeActual = settings.epf.overrideAtEmployee && person?.pfActualWage === true;
  // A template may set PF on the actual wage or capped at the ceiling for
  // everyone on it; otherwise the org's setting (and a person's override).
  const mode = input.pfWageMode ?? 'org';
  const employeeRestricted = mode === 'actual' ? false : mode === 'ceiling' ? true : employeeActual ? false : settings.epf.employeeRate === 'restricted';
  const employerRestricted = mode === 'actual' ? false : mode === 'ceiling' ? true : settings.epf.employerRate === 'restricted';
  const epf = epfOn
    ? computeEpf({
        pfWagePaise,
        employeeRestricted,
        employerRestricted,
        ceilingPaise,
        eps: person?.contributeEps !== false,
      })
    : NO_EPF;

  const esiOn = settings.esi.enabled && person?.esi !== false;
  const esiWage = input.esiWagePaise ?? input.grossPaise;
  const esi = computeEsi({
    grossPaise: esiWage,
    applicable: esiOn && isEsiApplicable({ grossPaise: esiWage, wasApplicableAtPeriodStart: input.esiCoveredEarlier }),
  });

  const pt = input.ruleSet.pt ? computePt(input.ruleSet.pt, { grossPaise: input.grossPaise, month: input.month }) : { amountPaise: 0 };

  const lwfOn =
    person?.lwf !== false && Boolean(input.ruleSet.lwf) && !settings.lwfDisabledStates.includes(input.ruleSet.state.toLowerCase());
  const lwf = lwfOn
    ? computeLwf(input.ruleSet.lwf!, { grossPaise: input.grossPaise, month: input.month })
    : { applicable: false, employeePaise: 0, employerPaise: 0 };

  const edli = epf.edliPaise ?? 0;
  const admin = epf.adminPaise ?? 0;
  const includedInCtcPaise =
    (settings.epf.includeEmployer
      ? epf.employerTotalPaise + (settings.epf.includeEDLI ? edli : 0) + (settings.epf.includeAdmin ? admin : 0)
      : 0) + (settings.esi.includeEmployer ? esi.employerPaise : 0);

  return {
    pfWagePaise,
    epf,
    esi,
    pt,
    lwf,
    includedInCtcPaise,
    employerContributionsPaise: epf.employerTotalPaise + edli + admin + esi.employerPaise + lwf.employerPaise,
  };
}
