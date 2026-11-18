/**
 * A Convrse-sized company on a scratch database, for the slow-routes check
 * (slow-routes-check.ts): engagement-speed-check's fifty-to-a-hundred people
 * with months of punches, plus what the slow routes read: payroll set up with
 * seven released runs, bank details, flexible splits; feedback history; inline
 * photos and documents on some people (what made whole-record reads heavy);
 * exits; a catalog of web games with whole pages; the Games home page with a
 * previous version kept; feed posts with comments and inboxes of a hundred.
 *
 * Deterministic: the same people, ids and amounts on every run (dates move
 * with today). Refuses any database whose name does not say scratch.
 */
import { randomBytes } from 'node:crypto';
import {
  appPages, companies, connectPosts, employeePaymentDetails, feedbackRecords, flexibleSplits, gameCatalog, getDb, notifications, payHeads, payrollPeriods,
  salaryStructures, salaryTemplates, statutoryConfigs, statutorySettings, tdsConfigs, users,
} from '../config/db';
import type { PayHead } from '../models/payHead.model';
import { createRun, submitRun } from '../services/payrollRun.service';
import { encryptField } from '../services/fieldCrypto';
import { HR, ORG, seedSpeedOrg } from './engagement-speed-check';
import { STATUTORY_SEED, TDS_SEED } from './payroll-config-seed-data';

export { HR, ORG };
const R = (rupees: number) => rupees * 100;
const IST = 330 * 60_000;
const istToday = () => new Date(Date.now() + IST).toISOString().slice(0, 10);
const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
/** A fixed scratch key, so a dump made by one checkout decrypts the same in another. */
export const SCRATCH_FIELD_KEY = Buffer.alloc(32, 7).toString('base64');

const filler = (kb: number, seed: string) => (seed.repeat(Math.ceil((kb * 1024) / seed.length))).slice(0, kb * 1024);

const head = (h: Partial<PayHead> & Pick<PayHead, 'code' | 'name' | 'category' | 'calculation'>): PayHead => ({
  org: ORG, componentType: 'other', active: true, showInPayslip: true, recurrence: 'recurring', createdAt: new Date(), updatedAt: new Date(), ...h,
} as PayHead);

/** The released pay periods the seed runs: April of the FY up to the one before today's. */
export function seededPeriods(): string[] {
  const today = istToday();
  // Pays 26th to 25th: from the 26th the next month's period is running.
  const day = Number(today.slice(8, 10));
  const [y, m] = today.slice(0, 7).split('-').map(Number);
  const current = day >= 26 ? (m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`) : today.slice(0, 7);
  const out: string[] = [];
  let [cy, cm] = current.split('-').map(Number);
  for (let i = 0; i < 7; i += 1) {
    cm -= 1;
    if (cm === 0) { cm = 12; cy -= 1; }
    out.unshift(`${cy}-${String(cm).padStart(2, '0')}`);
  }
  return out;
}

export async function seedSlowRoutes(people = 100, days = 75): Promise<{ runIds: string[]; people: string[] }> {
  process.env.PAYROLL_FIELD_KEY = SCRATCH_FIELD_KEY;
  await seedSpeedOrg(people, days);
  const db = getDb();
  if (!/scratch/.test(db.databaseName)) throw new Error(`refusing to seed ${db.databaseName}`);
  const now = new Date();
  const today = istToday();
  const ids = (await users().find({ org: ORG, userId: /^speed-\d/ }, { projection: { _id: 0, userId: 1 } }).sort({ userId: 1 }).toArray()).map((u) => u.userId);

  // —— the company ——
  const webGames = ['quiz-night', 'word-hunt', 'odd-one-out', 'tile-up-web', 'meow', 'pairs'];
  await companies().updateOne({ id: ORG }, {
    $set: {
      features: { lifecycle: true },
      enabledTabs: ['games', 'connect'],
      enabledGames: ['tile-up', 'scribble', 'pool', ...webGames],
      payrollEmployee: { appEnabled: true, splitCutoffDay: 15, declarationDue: '11-30', proofsDue: '01-31', billsDue: '03-31', splitStepPaise: R(500), splitDue: '11-15', fbpBillsDueDay: 20 },
      profile: { registeredName: 'Speed Pvt Ltd', addressLine1: '1 Test Road', city: 'Pune', state: 'Maharashtra', pincode: '411001' },
    },
  });
  await users().updateOne({ userId: HR }, { $set: { dashboardAdmin: true, designation: 'HR lead', managerUserId: undefined } });

  // —— people as Convrse's look: designations, documents, inline photos on older accounts, a few exits ——
  const photo = `data:image/jpeg;base64,${filler(120, 'QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVo=')}`;
  await Promise.all(ids.map((userId, i) => users().updateOne({ userId }, {
    $set: {
      designation: ['Designer', 'Engineer', 'Account manager', 'Analyst'][i % 4],
      phone: `98${String(10_000_000 + i)}`,
      gender: i % 2 ? 'female' : 'male',
      ...(i % 7 === 0 ? { profilePhotoUrl: photo } : {}),
      ...(i % 9 === 1 ? { profilePhotoKey: `connect/people/${userId}.jpg` } : {}),
      documents: Array.from({ length: i % 3 }, (_, k) => ({ id: `doc-${i}-${k}`, name: `Document ${k}.pdf`, type: 'pdf', url: `https://example.test/${userId}/${k}.pdf`, uploadedAt: now, size: 120_000 })),
      ...(i % 25 === 24 ? { exit: { kind: 'resigned', lastWorkingDay: addDays(today, 20 + i), recordedAt: now, noticeFrom: addDays(today, -10), recordedByUserId: HR } } : {}),
      // Fields the lists never show but whole records carry.
      helpIntake: { topics: ['stress'], needs: ['talk'], goal: filler(4, 'intake '), languages: ['en'], ageRange: '25-34', gender: 'any', answeredAt: now },
    },
  })));

  // —— payroll ——
  await payHeads().insertMany([
    head({ code: 'BASIC', name: 'Basic', category: 'earning', componentType: 'basic', calculation: { mode: 'percentage', percent: 50, base: 'ctc' }, taxable: true }),
    head({ code: 'HRA', name: 'House Rent Allowance', category: 'earning', componentType: 'hra', calculation: { mode: 'percentage', percent: 40, base: 'basic' }, taxable: true }),
    head({ code: 'FIXED_ALLOWANCE', name: 'Fixed Allowance', category: 'earning', componentType: 'fixed_allowance', calculation: { mode: 'flat_amount' }, taxable: true }),
    head({ code: 'FUEL', name: 'Fuel Reimbursement', payslipName: 'Fuel & vehicle', category: 'reimbursement', calculation: { mode: 'flat_amount' }, maxClaimablePaise: R(3000) }),
    head({ code: 'INTERNET', name: 'Internet Reimbursement', payslipName: 'Internet', category: 'reimbursement', calculation: { mode: 'flat_amount' }, maxClaimablePaise: R(1000) }),
    head({ code: 'MEAL', name: 'Meal Card', category: 'earning', calculation: { mode: 'flat_per_month', amountPaise: R(2200) }, fbp: true }),
  ]);
  await salaryTemplates().insertMany([
    {
      org: ORG, name: 'Flexible', code: 'FLEX', active: true, createdAt: now, updatedAt: now, balancingComponentCode: 'FIXED_ALLOWANCE', flexiblePoolPaise: R(4000),
      components: [
        { payHeadCode: 'BASIC', calculation: { mode: 'percentage', percent: 50, base: 'ctc' } },
        { payHeadCode: 'HRA', calculation: { mode: 'percentage', percent: 40, base: 'basic' } },
        { payHeadCode: 'FIXED_ALLOWANCE', calculation: { mode: 'flat_amount' } },
        { payHeadCode: 'FUEL', calculation: { mode: 'flat_amount' } },
        { payHeadCode: 'INTERNET', calculation: { mode: 'flat_amount' } },
        { payHeadCode: 'MEAL', calculation: { mode: 'flat_per_month', amountPaise: R(2200) } },
      ],
    },
    {
      org: ORG, name: 'Plain', code: 'PLAIN', active: true, createdAt: now, updatedAt: now, balancingComponentCode: 'FIXED_ALLOWANCE',
      components: [{ payHeadCode: 'BASIC', calculation: { mode: 'percentage', percent: 50, base: 'ctc' } }, { payHeadCode: 'FIXED_ALLOWANCE', calculation: { mode: 'flat_amount' } }],
    },
  ] as never[]);
  await salaryStructures().insertMany([HR, ...ids].map((userId, i) => ({
    org: ORG, userId, salaryTemplateCode: i % 3 ? 'FLEX' : 'PLAIN', annualCtcPaise: R(6_00_000 + (i % 20) * 60_000),
    ...(i % 3 ? { componentValues: { FUEL: R(2000), INTERNET: R(1000) } } : {}), status: 'active', createdAt: now, updatedAt: now,
  })) as never[]);
  await tdsConfigs().insertMany(TDS_SEED.map((c) => ({ ...c, createdAt: now, updatedAt: now })));
  await statutoryConfigs().insertMany(STATUTORY_SEED.map((c) => ({ ...structuredClone(c), createdAt: now, updatedAt: now, updatedByUserId: null })));
  await statutorySettings().insertOne({ org: ORG, tds: { enabled: true, defaultRegime: 'new' }, updatedAt: now } as never);
  await payrollPeriods().insertOne({ org: ORG, period: 'default', startDay: 26, updatedAt: now } as never);
  await employeePaymentDetails().insertMany([HR, ...ids].map((userId, i) => ({
    org: ORG, userId, payMode: i % 11 ? 'bank_transfer' : 'cash', bankName: 'Test Bank', ifsc: `TEST0${String(1000 + i)}`,
    accountNumber: encryptField(`5000${String(10_000_000 + i)}`), accountLast4: String(1000 + i).slice(-4),
    pan: encryptField(`ABCDE${String(1000 + i)}F`), panLast4: `${String(1000 + i).slice(-3)}F`, updatedAt: now, updatedByUserId: HR,
  })) as never[]);
  const fy = Number(seededPeriods()[0].slice(0, 4)) - (Number(seededPeriods()[0].slice(5, 7)) < 4 ? 1 : 0);
  await flexibleSplits().insertMany(ids.filter((_, i) => i % 3 && i % 4 === 0).map((userId) => ({
    org: ORG, userId, fy: `${fy}-${String((fy + 1) % 100).padStart(2, '0')}`, effectiveFrom: `${fy}-04`, amounts: { FUEL: R(3000), INTERNET: R(1000) },
    acknowledged: true, billsAcknowledgedAt: now, submittedAt: now,
  })) as never[]);
  const runIds: string[] = [];
  for (const period of seededPeriods()) {
    const run = await createRun(HR, { period });
    await submitRun(HR, run.run.id);
    runIds.push(run.run.id);
  }

  // —— feedback history: every person, six cycles ——
  await feedbackRecords().insertMany(ids.flatMap((userId, i) => seededPeriods().slice(-6).map((period) => ({
    employeeUserId: userId, managerUserId: i < 5 ? HR : ids[i % 5], period, status: 'sent', overallScore: 3 + (i % 3),
    parameters: [{ parameterId: 'p1', name: 'Quality', score: 4, note: 'Steady work this cycle.' }, { parameterId: 'p2', name: 'Delivery', score: 3, note: '' }],
    updatedAt: now, sentAt: now,
  }))) as never[]);

  // —— feed posts with long comment threads, and inboxes of a hundred about them ——
  const posts = Array.from({ length: 40 }, (_, i) => ({
    id: `post-${i}`, org: ORG, authorUserId: ids[i % ids.length], type: 'text', text: `Post ${i}`, createdAt: new Date(now.getTime() - i * 3_600_000),
    likedBy: ids.slice(0, 30), comments: Array.from({ length: 40 }, (_, k) => ({ id: `c-${i}-${k}`, userId: ids[k % ids.length], name: ids[k % ids.length], text: filler(1, 'nice one '), createdAt: now })),
  }));
  await connectPosts().insertMany(posts as never[]);
  await notifications().insertMany(ids.slice(0, 10).flatMap((userId) => Array.from({ length: 120 }, (_, k) => ({
    id: `n-${userId}-${k}`, userId, org: ORG, scenario: k % 5 ? 'post_like' : 'post_comment', title: `Someone liked post ${k % 40}`, body: filler(1, 'a notification body '),
    data: { postId: `post-${k % 45}` }, createdAt: new Date(now.getTime() - k * 600_000), ...(k % 3 ? { readAt: now } : {}),
  }))) as never[]);

  // —— the games: web games carry their whole page; the Games home page keeps its previous version ——
  await gameCatalog().insertMany(webGames.map((key, i) => ({
    key, name: key, tagline: `Play ${key}`, kind: 'web', order: 10 + i, active: true, html: `<!doctype html><title>${key}</title>${filler(300, `<p>${key}</p>`)}`,
    thumbnail: `data:image/png;base64,${filler(6, 'iVBORw0KGgo=')}`, createdAt: now, updatedAt: now,
  })) as never[]);
  await appPages().insertOne({
    key: 'games-home', version: 12, html: `<!doctype html>${filler(140, '<div>games</div>')}`, enabledOrgs: [ORG, 'otherco'],
    previous: { version: 11, html: `<!doctype html>${filler(140, '<div>older</div>')}` }, updatedAt: now,
  } as never);
  console.log(`seeded slow routes: ${ids.length} people, ${runIds.length} released runs, ${webGames.length} web games`);
  return { runIds, people: ids };
}

/** Random bytes as an inline picture, for checks that need a photo of a given size. */
export const inlinePhotoOf = (kb: number) => `data:image/jpeg;base64,${randomBytes(Math.ceil(kb * 768)).toString('base64')}`;
