/**
 * The standard component library on the server: an org's catalog as the
 * template builder and salary editor see it (its own pay heads plus the
 * standard components it hasn't added), and turning the standard ones a
 * template or salary uses into real pay heads for that org.
 */
import { payHeads } from '../config/db';
import { PayHead } from '../models/payHead.model';
import { standardAsPayHead, standardNotAdded, STANDARD_COMPONENTS } from '../shared/payroll/standard-components';

/** The org's own pay heads plus the standard components it has not added (not saved). */
export async function catalogWithStandard(org: string): Promise<{ own: PayHead[]; all: PayHead[] }> {
  const own = await payHeads().find({ org }).toArray();
  const now = new Date();
  return { own, all: [...own, ...standardNotAdded(own).map((s) => standardAsPayHead(s, org, now))] };
}

/**
 * Save as this org's pay heads the standard components among `codes` it
 * doesn't have yet. Basic first, so "% of Basic" components resolve. Returns
 * the codes created. Only ever writes for the org asked.
 */
export async function materializeStandard(org: string, codes: Iterable<string>): Promise<string[]> {
  const own = await payHeads().find({ org }, { projection: { code: 1, componentType: 1 } }).toArray();
  const wanted = new Set(codes);
  const todo = standardNotAdded(own)
    .filter((s) => wanted.has(s.code))
    .sort((a, b) => Number(b.componentType === 'basic') - Number(a.componentType === 'basic'));
  const created: string[] = [];
  const now = new Date();
  for (const s of todo) {
    try {
      await payHeads().insertOne(standardAsPayHead(s, org, now));
      created.push(s.code);
    } catch (error) {
      if ((error as { code?: number }).code !== 11000) throw error; // added meanwhile: fine
    }
  }
  return created;
}

export const STANDARD_CODES = new Set(STANDARD_COMPONENTS.map((s) => s.code));
