/**
 * Income tax configuration and declarations. `tds_configs` holds one row per
 * financial year and regime (slabs, limits, rebate, surcharge, cess), national
 * and dated, so a new Finance Act is a new row, not a code change.
 * `tax_declarations` holds one person's regime and declarations for one FY.
 */
import type { TaxDeclarations, TaxRegime, TdsConfig } from '../shared/payroll/tds';
import type { DeclarationItems } from '../shared/payroll/declaration';

export type TdsConfigRow = TdsConfig & { createdAt: Date; updatedAt: Date };

export interface TaxDeclarationRow {
  org: string;
  userId: string;
  /** "2026-27" */
  fy: string;
  regime: TaxRegime;
  declarations: TaxDeclarations;
  /** Proofs of the declared investments: none yet, submitted, or checked by HR. */
  proofs: 'none' | 'submitted' | 'verified';
  /** What the employee declared on the app, item by item; `declarations` holds the section totals the engine reads. */
  items?: DeclarationItems;
  /** The employee saved it, or submitted it ("Declaration submitted"). Absent: entered by HR. */
  status?: 'saved' | 'submitted';
  submittedAt?: Date;
  updatedAt: Date;
  updatedByUserId: string;
}
