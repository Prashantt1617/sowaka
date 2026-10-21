/**
 * Income tax configuration and declarations. `tds_configs` holds one row per
 * financial year and regime (slabs, limits, rebate, surcharge, cess), national
 * and dated, so a new Finance Act is a new row, not a code change.
 * `tax_declarations` holds one person's regime and declarations for one FY.
 */
import type { TaxDeclarations, TaxRegime, TdsConfig } from '../shared/payroll/tds';

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
  /** End-to-end encrypted orgs: the declarations, sealed; `declarations` above is empty. */
  sealed?: import('../shared/payroll/crypto').Sealed;
  updatedAt: Date;
  updatedByUserId: string;
}
