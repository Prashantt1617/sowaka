// The offer letter's merge values worked out from the offer form as HR types,
// so Documents › Offer letter previews the letter live, before (and between)
// saves. Mirrors backend/src/services/lifecycle/letters.ts mergeValues for the
// fields an offer carries; the server's values win once the offer is saved and
// nothing has changed since.
import type { OfferFields } from '../../../services/lifecycle';
import { addDays, todayKey } from './format';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Mon 1 Dec 2026", as the server writes days in letters. */
export function formatDay(day?: string): string {
  if (!day || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return '';
  const d = new Date(`${day}T00:00:00Z`);
  return `${WEEKDAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

function addMonths(day: string, months: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d.getUTCDate(), last));
  return target.toISOString().slice(0, 10);
}
const plural = (n: number, unit: string) => `${n} ${unit}${n === 1 ? '' : 's'}`;

const ONES = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
const under100 = (n: number): string => (n < 20 ? ONES[n] : `${TENS[Math.floor(n / 10)]}${n % 10 ? `-${ONES[n % 10]}` : ''}`);
const under1000 = (n: number): string => [Math.floor(n / 100) ? `${ONES[Math.floor(n / 100)]} hundred` : '', n % 100 ? under100(n % 100) : ''].filter(Boolean).join(' and ');
/** "Rupees fourteen lakh only" (the server's wording). */
function rupeesInWords(amount: number): string {
  let n = Math.round(amount);
  if (!Number.isFinite(n) || n <= 0) return '';
  const parts: string[] = [];
  const crore = Math.floor(n / 10_000_000); n %= 10_000_000;
  const lakh = Math.floor(n / 100_000); n %= 100_000;
  const thousand = Math.floor(n / 1000); n %= 1000;
  if (crore) parts.push(`${crore >= 100 ? under1000(crore) : under100(crore)} crore`);
  if (lakh) parts.push(`${under100(lakh)} lakh`);
  if (thousand) parts.push(`${under100(thousand)} thousand`);
  if (n) parts.push(under1000(n));
  return `Rupees ${parts.join(' ')} only`;
}

/** The merge fields the offer form fills, and the form field each one comes from. */
export type OfferFormKey = keyof OfferFields | 'name';
export const OFFER_VALUE_FIELD: Record<string, OfferFormKey> = {
  candidateName: 'name', firstName: 'name', name: 'name', fullName: 'name',
  designation: 'designation', department: 'department', location: 'location', managerName: 'managerUserId',
  joiningDate: 'tj', ctc: 'ctc', ctcWords: 'ctc', probationMonths: 'probationMonths', probationEndsOn: 'probationMonths',
  noticeDays: 'noticeDays', validTill: 'validTill', responsibilities: 'responsibilities',
};

/** The values the form gives the letter (empty strings where a field is empty, so the preview shows it missing). */
export function offerFormValues(f: OfferFields, opts: { name: string; managerName?: string }): Record<string, string> {
  const name = opts.name.trim();
  const ctc = f.ctc > 0 ? f.ctc : 0;
  return {
    candidateName: name,
    firstName: name.split(/\s+/)[0] ?? '',
    designation: f.designation.trim(),
    department: f.department?.trim() ?? '',
    location: f.location?.trim() ?? '',
    managerName: opts.managerName ?? '',
    joiningDate: formatDay(f.tj),
    ctc: ctc ? `₹${Math.round(ctc).toLocaleString('en-IN')}` : '',
    ctcWords: rupeesInWords(ctc),
    probationMonths: f.probationMonths ? plural(f.probationMonths, 'month') : '',
    probationEndsOn: f.tj && f.probationMonths ? formatDay(addMonths(f.tj, f.probationMonths)) : '',
    noticeDays: Number.isFinite(f.noticeDays) ? plural(f.noticeDays, 'day') : '',
    validTill: formatDay(f.validTill),
    responsibilities: f.responsibilities?.trim() ?? '',
  };
}

export const blankOfferFields = (): OfferFields => ({
  designation: '', department: '', location: '', ctc: 0, tj: addDays(todayKey(), 21), managerUserId: '',
  probationMonths: 6, noticeDays: 30, validTill: addDays(todayKey(), 7), responsibilities: '', employeeType: 'full_time',
});

/** The offer as the server keeps it: trimmed, empty optional fields left out. */
export function cleanOfferFields(f: OfferFields): OfferFields {
  return {
    ...f, designation: f.designation.trim(), managerUserId: f.managerUserId || undefined, department: f.department?.trim() || undefined,
    location: f.location?.trim() || undefined, responsibilities: f.responsibilities?.trim() || undefined,
  };
}

/** The checks New offer made before saving: role, pay, the two dates in order, notice. */
export function validateOffer(f: OfferFields, needPay: boolean): Partial<Record<keyof OfferFields, string>> {
  const e: Partial<Record<keyof OfferFields, string>> = {};
  if (!f.designation.trim()) e.designation = 'Needed for the offer';
  if (needPay && !(f.ctc > 0)) e.ctc = 'Enter the yearly CTC';
  if (!f.tj) e.tj = 'Pick the joining date';
  if (!f.validTill) e.validTill = 'Pick a date';
  else if (f.tj && f.validTill > f.tj) e.validTill = 'The offer should close before the joining day';
  if (f.noticeDays < 0) e.noticeDays = 'Days, 0 or more';
  return e;
}
