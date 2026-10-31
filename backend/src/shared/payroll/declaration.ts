/**
 * An employee's investment declaration, item by item, and how the items roll
 * up into the sections the TDS engine reads. Pure: no I/O, money in paise.
 *
 * The person declares PPF, ELSS and life insurance separately; the engine
 * only needs section totals (`TaxDeclarations`). Caps are the FY's old-regime
 * limits from `tds_configs`; on the new regime nothing here reduces tax.
 */
import type { TaxDeclarations, TaxRegime, TdsConfig } from './tds';

export type DeclarationItemKey =
  | 'ppf'
  | 'elss'
  | 'lifeInsurance'
  | 'other80C'
  | 'nps'
  | 'healthSelf'
  | 'healthParents'
  | 'rentMonthly'
  | 'homeLoanInterest';

export type DeclarationSectionKey = '80C' | '80CCD1B' | '80D' | 'HRA' | '24B';

export interface DeclarationItemDef {
  key: DeclarationItemKey;
  label: string;
  section: DeclarationSectionKey;
}

/** The items the app lists, in its order. `epf` is not one: payroll supplies it. */
export const DECLARATION_ITEMS: DeclarationItemDef[] = [
  { key: 'ppf', label: 'PPF', section: '80C' },
  { key: 'elss', label: 'ELSS mutual funds', section: '80C' },
  { key: 'lifeInsurance', label: 'Life insurance', section: '80C' },
  { key: 'other80C', label: 'Other 80C (tuition, NSC, FD, home loan principal)', section: '80C' },
  { key: 'nps', label: 'NPS, your own contribution', section: '80CCD1B' },
  { key: 'healthSelf', label: 'Health insurance, self and family', section: '80D' },
  { key: 'healthParents', label: 'Health insurance, parents', section: '80D' },
  { key: 'rentMonthly', label: 'Rent a month', section: 'HRA' },
  { key: 'homeLoanInterest', label: 'Home loan interest', section: '24B' },
];

export const DECLARATION_ITEM_KEYS = new Set<string>(DECLARATION_ITEMS.map((i) => i.key));

export const SECTION_LABELS: Record<DeclarationSectionKey, string> = {
  '80C': '80C investments',
  '80CCD1B': 'NPS (80CCD 1B)',
  '80D': '80D health insurance',
  HRA: 'Rent (HRA)',
  '24B': 'Home loan interest (24b)',
};

export type DeclarationItems = Partial<Record<DeclarationItemKey, number>>;

export interface DeclarationFlags {
  metro?: boolean;
  selfSenior?: boolean;
  parentsSenior?: boolean;
}

const R = (rupees: number) => rupees * 100;

/**
 * Old regime limits when the FY has no config row: the Income-tax Act's
 * figures for FY 2025-26 and 2026-27 (80C ₹1.5 lakh, 80CCD(1B) ₹50,000, 80D
 * ₹25,000 / ₹50,000 senior, 24(b) ₹2 lakh).
 */
export const FALLBACK_OLD_LIMITS: TdsConfig['limits'] = {
  sec80C: R(1_50_000),
  sec80CCD1B: R(50_000),
  sec80DSelf: R(25_000),
  sec80DSelfSenior: R(50_000),
  sec80DParents: R(25_000),
  sec80DParentsSenior: R(50_000),
  sec24bHomeLoan: R(2_00_000),
  sec80TTA: R(10_000),
};

export interface DeclarationItemView {
  key: DeclarationItemKey | 'epf';
  label: string;
  amountPaise: number;
  readOnly: boolean;
  proofNeeded: boolean;
}

export interface DeclarationSectionView {
  key: DeclarationSectionKey;
  label: string;
  capPaise: number | null;
  declaredPaise: number;
  countedPaise: number;
  applicable: boolean;
  note: string | null;
  items: DeclarationItemView[];
}

export const NEW_REGIME_NOTE = 'Not needed on the new regime';

/**
 * The sections as the app shows them: what was declared, the cap, and what
 * counts. `epfYearPaise` is the year's employee PF from payroll (80C).
 */
export function declarationSections(args: {
  regime: TaxRegime;
  items: DeclarationItems;
  flags: DeclarationFlags;
  limits: TdsConfig['limits'];
  epfYearPaise: number;
}): DeclarationSectionView[] {
  const { regime, items, flags, limits } = args;
  const old = regime === 'old';
  const amount = (k: DeclarationItemKey) => Math.max(0, items[k] ?? 0);
  const itemView = (def: DeclarationItemDef): DeclarationItemView => ({
    key: def.key,
    label: def.label,
    amountPaise: amount(def.key),
    readOnly: false,
    proofNeeded: old && amount(def.key) > 0,
  });
  const of = (section: DeclarationSectionKey) => DECLARATION_ITEMS.filter((d) => d.section === section).map(itemView);

  const sections: { key: DeclarationSectionKey; cap: number | null; items: DeclarationItemView[]; declared?: number }[] = [
    {
      key: '80C',
      cap: limits.sec80C,
      items: [{ key: 'epf', label: 'Provident fund (from payroll)', amountPaise: args.epfYearPaise, readOnly: true, proofNeeded: false }, ...of('80C')],
    },
    { key: '80CCD1B', cap: limits.sec80CCD1B, items: of('80CCD1B') },
    {
      key: '80D',
      // Self and parents have separate limits; the section's cap is the two together.
      cap: (flags.selfSenior ? limits.sec80DSelfSenior : limits.sec80DSelf) + (flags.parentsSenior ? limits.sec80DParentsSenior : limits.sec80DParents),
      items: of('80D'),
    },
    // HRA: the exemption is worked out by the TDS engine from Basic, HRA and a year's rent.
    { key: 'HRA', cap: null, items: of('HRA'), declared: amount('rentMonthly') * 12 },
    { key: '24B', cap: limits.sec24bHomeLoan, items: of('24B') },
  ];

  return sections.map((s) => {
    const declared = s.declared ?? s.items.reduce((sum, i) => sum + i.amountPaise, 0);
    let counted = 0;
    if (old) {
      if (s.key === '80D') {
        const selfCap = flags.selfSenior ? limits.sec80DSelfSenior : limits.sec80DSelf;
        const parentsCap = flags.parentsSenior ? limits.sec80DParentsSenior : limits.sec80DParents;
        counted = Math.min(selfCap, amount('healthSelf')) + Math.min(parentsCap, amount('healthParents'));
      } else {
        counted = s.cap === null ? declared : Math.min(s.cap, declared);
      }
    }
    return {
      key: s.key,
      label: SECTION_LABELS[s.key],
      capPaise: s.cap,
      declaredPaise: declared,
      countedPaise: counted,
      applicable: old,
      note: old ? null : NEW_REGIME_NOTE,
      items: s.items,
    };
  });
}

/**
 * The section totals the TDS engine reads. Employee PF is not added here: the
 * engine adds it to 80C itself. Rent is a year's rent.
 */
export function toTaxDeclarations(items: DeclarationItems, flags: DeclarationFlags, keep: TaxDeclarations = {}): TaxDeclarations {
  const a = (k: DeclarationItemKey) => Math.max(0, items[k] ?? 0);
  const out: TaxDeclarations = {
    // Fields HR may have entered that the app does not ask for.
    ...(keep.sec80TTA !== undefined ? { sec80TTA: keep.sec80TTA } : {}),
    ...(keep.otherIncomePaise !== undefined ? { otherIncomePaise: keep.otherIncomePaise } : {}),
    ...(keep.previousEmployerSalaryPaise !== undefined ? { previousEmployerSalaryPaise: keep.previousEmployerSalaryPaise } : {}),
    ...(keep.previousEmployerTdsPaise !== undefined ? { previousEmployerTdsPaise: keep.previousEmployerTdsPaise } : {}),
    sec80C: a('ppf') + a('elss') + a('lifeInsurance') + a('other80C'),
    sec80CCD1B: a('nps'),
    sec80DSelf: a('healthSelf'),
    sec80DParents: a('healthParents'),
    homeLoanInterest: a('homeLoanInterest'),
    rentPaidPaise: a('rentMonthly') * 12,
    selfSenior: Boolean(flags.selfSenior),
    parentsSenior: Boolean(flags.parentsSenior),
    metro: Boolean(flags.metro),
  };
  return out;
}

// —— Flexible split ——

export interface FlexibleComponentLimit {
  code: string;
  limitPaise: number;
  name?: string;
}

/**
 * Why a split cannot be saved, or null when it can: every code flexible, each
 * amount whole rupees within its limit, and the total within the pool.
 */
export function splitProblem(amounts: Record<string, number>, components: FlexibleComponentLimit[], poolPaise: number): string | null {
  const byCode = new Map(components.map((c) => [c.code, c]));
  let total = 0;
  for (const [code, value] of Object.entries(amounts)) {
    const c = byCode.get(code);
    if (!c) return `${code} is not one of your flexible components`;
    if (!Number.isInteger(value) || value < 0) return `The amount for ${c.name ?? code} must be a whole, non-negative number of paise`;
    if (value % 100 !== 0) return `The amount for ${c.name ?? code} must be in whole rupees`;
    if (value > c.limitPaise) return `${c.name ?? code} can be at most ₹${(c.limitPaise / 100).toLocaleString('en-IN')} a month`;
    total += value;
  }
  if (total > poolPaise) return `The split adds up to ₹${(total / 100).toLocaleString('en-IN')}, more than your ₹${(poolPaise / 100).toLocaleString('en-IN')} a month`;
  return null;
}

/** "2026-11" → the months up to and including March of its FY. */
export function fyEndPeriod(period: string): string {
  const [y, m] = period.split('-').map(Number);
  return `${m >= 4 ? y + 1 : y}-03`;
}
