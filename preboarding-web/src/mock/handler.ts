/**
 * Dev-only mock backend for VITE_MOCK=1. Fictional fixture data covering every portal
 * state, so the screens can be reviewed before the backend is merged. Never bundled in
 * production (client.ts imports it behind import.meta.env.DEV).
 *
 * Pick a state with ?mock=<scenario> on any signed-in page (kept for the tab):
 *   tasks_open · offer_updated · letter_ready · pass_unlocked · joined · moved_to_app · not_joining
 * Offer links: /o/demo · /o/demo-v2 · /o/accepted · /o/finalised · /o/declined · /o/expired · /o/replaced · /o/not-joining
 * Sign in with any email; password "wrong" shows the error, "locked" the 15-minute lock.
 */
import { ApiError } from '../api/client';
import type {
  AboutYou,
  CandidateDocumentView,
  MeetItem,
  OfferState,
  PathKey,
  PathState,
  PortalHome,
  PortalLetter,
  PortalOfferView,
  PortalPass,
  TaskView,
} from '../api/types';
import { addDays, fmtWeekdayYear, fmtShort, today } from '../lib/format';
import { makePdf, type PdfLine } from './pdf';

export const SCENARIOS = ['tasks_open', 'offer_updated', 'letter_ready', 'pass_unlocked', 'joined', 'moved_to_app', 'not_joining'] as const;
export type Scenario = (typeof SCENARIOS)[number];
export const OFFER_TOKENS = ['demo', 'demo-v2', 'accepted', 'finalised', 'declined', 'expired', 'replaced', 'not-joining'] as const;

const KEY = 'mock.scenario';
export function scenario(): Scenario {
  const fromUrl = new URLSearchParams(window.location.search).get('mock') as Scenario | null;
  if (fromUrl && (SCENARIOS as readonly string[]).includes(fromUrl)) {
    try {
      sessionStorage.setItem(KEY, fromUrl);
    } catch {
      /* ignore */
    }
    if (fromUrl !== current) resetDb(fromUrl);
    return fromUrl;
  }
  try {
    const s = sessionStorage.getItem(KEY) as Scenario | null;
    if (s && (SCENARIOS as readonly string[]).includes(s)) {
      if (s !== current) resetDb(s);
      return s;
    }
  } catch {
    /* ignore */
  }
  if (current !== 'tasks_open') resetDb('tasks_open');
  return 'tasks_open';
}

// ── Fixture people (fictional) ────────────────────────────────────────────
const COMPANY = { name: 'Lumen Labs' };
const HR = { name: 'Priya S.', email: 'people@lumenlabs.example' };
const CANDIDATE = 'Kabir Mehta';
const MANAGER = 'Neha R.';

function tjFor(s: Scenario): string {
  if (s === 'pass_unlocked') return addDays(today(), 7);
  if (s === 'joined' || s === 'moved_to_app') return addDays(today(), -2);
  return addDays(today(), 12);
}

// ── Mutable mock DB (reset per scenario) ──────────────────────────────────
interface Db {
  scenario: Scenario;
  tj: string;
  documents: CandidateDocumentView[];
  about: AboutYou;
  meet: MeetItem[];
  letters: PortalLetter[];
  offers: Record<string, OfferState>;
}
let current: Scenario | null = null;
let db: Db;

function docs(all: 'mixed' | 'approved'): CandidateDocumentView[] {
  const d = (id: string, docKey: string, label: string, status: CandidateDocumentView['status'], extra: Partial<CandidateDocumentView> = {}): CandidateDocumentView => ({
    id,
    docKey,
    label,
    required: true,
    status: all === 'approved' ? 'approved' : status,
    files: status === 'todo' && all !== 'approved' ? [] : [{ id: `${id}-f1`, name: `${docKey}.pdf`, contentType: 'application/pdf', size: 412_000 }],
    reviewedAt: status === 'approved' || all === 'approved' ? addDays(today(), -2) : undefined,
    uploadedAt: status === 'todo' ? undefined : addDays(today(), -1),
    dueAt: addDays(db?.tj ?? tjFor('tasks_open'), -5),
    ...(all === 'approved' ? {} : extra),
  });
  return [
    d('d1', 'id_proof', 'ID proof (PAN and Aadhaar)', 'sent_back', { hrNote: 'Your Aadhaar photo is cut off. Please upload both sides.' }),
    d('d2', 'address_proof', 'Address proof', 'todo'),
    d('d3', 'education', 'Education', 'todo'),
    d('d4', 'payslips', 'Last 3 payslips', 'in_review'),
    d('d5', 'relieving_letter', 'Relieving letter', 'approved'),
    d('d6', 'photo', 'Passport photo', 'approved'),
  ];
}

function resetDb(s: Scenario) {
  current = s;
  const tj = tjFor(s);
  db = { scenario: s, tj, documents: [], about: {}, meet: [], letters: [], offers: {} };
  const after = s !== 'tasks_open' && s !== 'offer_updated';
  db.documents = docs(after ? 'approved' : 'mixed');
  db.about = {
    phone: '+919812345612',
    editableUntil: addDays(tj, -1),
    ...(after || s === 'offer_updated'
      ? { emergencyContact: { name: 'Meera Mehta', relation: 'Parent', phone: '+919876500011' }, pf: { firstJob: false, uan: '100012345678' } }
      : {}),
  };
  const seen = after;
  db.meet = [
    {
      id: 'm1',
      kind: 'manager_note',
      title: 'Why we picked you',
      subtitle: 'A note from your manager',
      text: 'We picked you because your portfolio made us rethink our own onboarding. Your first month is about meeting people, not shipping.',
      authorName: MANAGER,
      authorRole: 'Design lead',
      seen,
    },
    { id: 'm2', kind: 'video', tag: 'How we work', title: 'Our 3 core values', subtitle: '30-second video', videoUrl: '/mock-video.mp4', seen },
    {
      id: 'm3',
      kind: 'card',
      tag: 'Your role',
      title: 'Your role, explained',
      subtitle: 'Your job description in 4 cards',
      text: 'You’ll design the joining journey for our clients’ new hires.\n\nYou’ll work with research, product and engineering every week.\n\nYour first project is the Day-1 pass.\n\nBy month 3 you own one product area end to end.',
      seen,
    },
    {
      id: 'm4',
      kind: 'card',
      tag: 'Policies',
      title: 'Company policies',
      subtitle: '12 short reads. You’ll confirm them in week 1',
      text: 'Leave, travel, IT use, code of conduct and more — each one is a two-minute read.',
      seen,
    },
  ];
  const lState: PortalLetter['state'] = s === 'letter_ready' ? 'ready' : s === 'pass_unlocked' || s === 'joined' ? 'signed' : 'locked';
  db.letters = [
    { id: 'l1', kind: 'appointment', state: lState, pdfUrl: '/portal/letters/l1/pdf' },
    { id: 'l2', kind: 'nda', state: lState, pdfUrl: '/portal/letters/l2/pdf' },
  ];
}

// ── Read models ───────────────────────────────────────────────────────────
function task(id: string, systemKey: TaskView['systemKey'], title: string, status: TaskView['status'], extra: Partial<TaskView> = {}): TaskView {
  return {
    id,
    systemKey,
    phase: 'pre_boarding',
    title,
    ownerRole: 'employee',
    kind: 'form',
    surface: 'portal',
    mustDo: true,
    status,
    late: false,
    ...extra,
  };
}

const PATHS: Record<Exclude<Scenario, 'moved_to_app' | 'not_joining' | 'joined'>, PathState[]> = {
  tasks_open: ['done', 'current', 'todo', 'todo', 'locked', 'locked'],
  offer_updated: ['current', 'done', 'done', 'todo', 'locked', 'locked'],
  letter_ready: ['done', 'done', 'done', 'done', 'current', 'locked'],
  pass_unlocked: ['done', 'done', 'done', 'done', 'done', 'current'],
};
const PATH_KEYS: Array<[PathKey, string]> = [
  ['offer', 'Offer'],
  ['docs', 'Docs'],
  ['about', 'About'],
  ['meet', 'Meet'],
  ['letter', 'Letter'],
  ['pass', 'Pass'],
];

function me(): PortalHome {
  const s = db.scenario;
  const tj = db.tj;
  const base = {
    candidateName: CANDIDATE,
    company: COMPANY,
    hrContact: HR,
    tj,
    daysToGo: Math.max(0, Math.round((new Date(`${tj}T00:00:00`).getTime() - new Date(`${today()}T00:00:00`).getTime()) / 86_400_000)),
    designation: 'Product designer',
    reportingTime: '09:30',
    batch: { count: 6, names: ['Nisha P.', 'Farhan A.', 'Ritu J.', 'Dev K.', 'Sana M.', 'Omar L.'] },
  };
  if (s === 'moved_to_app' || s === 'not_joining')
    return {
      ...base,
      status: s === 'moved_to_app' ? 'moved_to_app' : 'not_joining',
      view: 'closed',
      plant: { stage: 1, water: 3, leaves: 0, droop: false },
      path: [],
      tasks: [],
    };
  const docsDone = db.documents.every((d) => d.status === 'approved' || d.status === 'in_review');
  const tasks: TaskView[] = [
    task('t1', 'accept_offer', 'Accept your offer', s === 'offer_updated' ? 'todo' : 'done'),
    task('t2', 'upload_documents', 'Upload your documents', docsDone ? 'done' : 'todo', { dueAt: addDays(tj, -5), kind: 'upload', helper: 'HR needs a clearer copy · 2 min' }),
    task('t3', 'about_you', 'About you', db.about.pf ? 'done' : 'todo', { dueAt: addDays(tj, -3), helper: '2 quick steps' }),
    task('t4', 'meet_us', 'Meet the team', db.meet.every((m) => m.seen) ? 'done' : 'todo', { kind: 'reel' }),
    task('t5', 'sign_letters', 'Sign your appointment letter', db.letters.every((l) => l.state === 'signed') ? 'done' : db.letters[0].state === 'locked' ? 'locked' : 'todo', {
      kind: 'sign',
      dueAt: addDays(tj, -2),
      helper: 'Open each PDF, then sign',
    }),
    task('t6', 'day1_pass', 'Check your Day-1 pass', s === 'pass_unlocked' ? 'todo' : 'locked', { opensAt: addDays(tj, -7), helper: 'Where to go, when, and who to meet' }),
  ];
  if (s === 'tasks_open') {
    const sent = db.documents.find((d) => d.status === 'sent_back');
    if (sent) tasks.splice(2, 0, task('t2b', 'upload_documents', `Re-upload your ${sent.label.split(' (')[0]}`, 'sent_back', { note: sent.hrNote }));
  }
  if (s === 'joined') {
    const wk = (id: string, title: string, helper: string, status: TaskView['status']): TaskView => ({ ...task(id, undefined, title, status, { helper }), phase: 'first_week', surface: 'app' });
    return {
      ...base,
      status: 'joined',
      view: 'joined',
      daysToGo: 0,
      plant: { stage: 1, water: 3, leaves: 0, droop: false },
      path: [],
      tasks: [
        wk('w1', 'Acknowledge policies', '20 min · Compliance', 'done'),
        wk('w2', 'Meet your buddy', '15 min · Day 2', 'todo'),
        wk('w3', 'Choose your tax regime', '5 min · Payroll', 'todo'),
        wk('w4', 'Introduce yourself', 'In the app · 2 min', 'todo'),
      ],
      workEmail: 'kabir.mehta@lumenlabs.example',
      portalOpenUntil: addDays(tj, 7),
    };
  }
  const states = PATHS[s];
  const path = PATH_KEYS.map(([key, label], i) => ({ key, label, state: states[i] }));
  const upNext =
    s === 'tasks_open'
      ? db.documents.some((d) => d.status === 'sent_back')
        ? { key: 'docs' as const, title: 'Re-upload your ID proof', helper: 'HR needs a clearer copy · 2 min', due: addDays(tj, -5) }
        : { key: 'about' as const, title: 'Tell us about you', helper: '2 quick steps', due: addDays(tj, -3) }
      : s === 'offer_updated'
        ? { key: 'offer' as const, title: 'Review your updated offer', helper: 'Joining date and salary changed' }
        : s === 'letter_ready'
          ? { key: 'letter' as const, title: 'Sign your appointment letter', helper: 'Open each PDF, then sign', due: addDays(tj, -2) }
          : { key: 'pass' as const, title: 'Check your Day-1 pass', helper: 'Where to go, when, and who to meet' };
  return {
    ...base,
    status: s === 'letter_ready' || s === 'pass_unlocked' ? 'docs_approved' : 'active',
    view: s,
    plant: { stage: 0, water: s === 'tasks_open' ? 0 : s === 'offer_updated' ? 1 : s === 'letter_ready' ? 2 : 3, leaves: 0, droop: false },
    path,
    upNext,
    tasks,
    banner: s === 'offer_updated' ? { kind: 'offer_updated', changedFields: ['tj', 'ctc'] } : undefined,
  };
}

function offerView(token: string, session = false): PortalOfferView {
  const v2 = token === 'demo-v2' || session;
  const state: OfferState =
    db.offers[token] ??
    (({ demo: 'offer', 'demo-v2': 'offer', accepted: 'accepted', finalised: 'finalised', declined: 'declined', expired: 'expired', replaced: 'replaced', 'not-joining': 'not_joining' } as Record<string, OfferState>)[
      token
    ] ?? 'offer');
  const tj = v2 ? addDays(db.tj, 7) : db.tj;
  return {
    state,
    company: COMPANY,
    candidateName: CANDIDATE,
    version: v2 ? 2 : 1,
    changedFields: v2 ? ['tj', 'ctc'] : undefined,
    fields: {
      designation: 'Product Designer',
      department: 'Design',
      location: 'Bengaluru · Hybrid',
      ctc: v2 ? 1_450_000 : 1_400_000,
      tj,
      managerName: MANAGER,
      managerDesignation: 'Design lead',
      probationMonths: 6,
      noticeDays: 60,
      validTill: addDays(today(), v2 ? 11 : 4),
      employeeType: 'full_time',
    },
    validTill: token === 'expired' ? addDays(today(), -3) : addDays(today(), v2 ? 11 : 4),
    pdfUrl: `/portal/offer/${token}/pdf`,
    hrContact: HR,
    companyVideoUrl: '/mock-video.mp4',
    loginEmailMasked: 'ka***@gmail.example',
    acceptedAt: state === 'accepted' || state === 'finalised' ? addDays(today(), -1) : undefined,
    finalisedAt: state === 'finalised' ? today() : undefined,
  };
}

// ── PDFs ──────────────────────────────────────────────────────────────────
function offerPdf(v: PortalOfferView): ArrayBuffer {
  const v2 = v.version > 1;
  const first = v.candidateName.split(' ')[0];
  const lakh = (n: number) => `Rs ${(n / 100000).toFixed(1)} L`;
  const p1: PdfLine[] = [
    { text: fmtWeekdayYear(today()), size: 10, gap: 10 },
    { text: 'Offer of employment', size: 18, bold: true, gap: 12 },
    { text: `Dear ${first},`, gap: 6 },
    { text: `We are pleased to offer you the role of ${v.fields.designation} in our ${v.fields.department} team. This letter sets out the main terms of your offer.`, gap: 14 },
    { text: `Role: ${v.fields.designation}` },
    { text: `Joining date: ${fmtWeekdayYear(v.fields.tj)}`, mark: v2 },
    { text: `Yearly salary (CTC): ${lakh(v.fields.ctc)}`, mark: v2 },
    { text: `Reports to: ${v.fields.managerName}, ${v.fields.managerDesignation}` },
    { text: `Location: ${v.fields.location}` },
    { text: `Probation: ${v.fields.probationMonths} months`, gap: 14 },
    { text: `Your responsibilities, the salary breakup and our policies are on pages 2 and 3. This offer is valid until ${fmtWeekdayYear(v.validTill)}.`, mark: false, gap: 8 },
    { text: 'We look forward to having you with us.', gap: 12 },
    { text: 'Warm regards,' },
    { text: `${HR.name} People team`, bold: true },
  ];
  const p2: PdfLine[] = [
    { text: 'Your responsibilities', size: 15, bold: true, gap: 10 },
    { text: 'Design the joining journey for our clients and their new hires, from the offer email to the end of probation.' },
    { text: 'Work with research, product and engineering every week, and present your work at the Friday review.' },
    { text: 'Keep the design system up to date with the patterns you add.', gap: 14 },
    { text: 'Salary breakup (yearly)', size: 15, bold: true, gap: 10 },
    { text: `Basic: ${lakh(v.fields.ctc * 0.4)}` },
    { text: `House rent allowance: ${lakh(v.fields.ctc * 0.2)}` },
    { text: `Special allowance: ${lakh(v.fields.ctc * 0.32)}` },
    { text: `Employer PF and gratuity: ${lakh(v.fields.ctc * 0.08)}` },
  ];
  const p3: PdfLine[] = [
    { text: 'Our policies', size: 15, bold: true, gap: 10 },
    { text: `Notice period: ${v.fields.noticeDays} days after confirmation.` },
    { text: 'Leave: 18 days of paid leave a year, credited monthly, plus public holidays.' },
    { text: 'Hybrid work: three days a week in the office.' },
    { text: 'You will confirm the full policies in your first week.', gap: 20 },
    { text: 'Accepting this offer tells us you agree to these terms. Your appointment letter follows once your documents are approved.' },
  ];
  return makePdf([p1, p2, p3], COMPANY.name);
}

function letterPdf(id: string): ArrayBuffer {
  if (id === 'l2')
    return makePdf(
      [
        [
          { text: 'Non-disclosure agreement', size: 18, bold: true, gap: 12 },
          { text: 'This agreement covers how you will handle confidential information you receive while working with us, during and after your employment.', gap: 10 },
          { text: '1. What is confidential', bold: true },
          { text: 'Client data, product plans, source code, designs, prices and anything marked confidential.' },
        ],
        [
          { text: '2. Your obligations', bold: true },
          { text: 'Use confidential information only for your work, keep it safe, and return it when you leave.', gap: 20 },
          { text: 'Signature: ____________________' },
        ],
      ],
      COMPANY.name,
    );
  const page = (title: string, body: string): PdfLine[] => [
    { text: title, size: 15, bold: true, gap: 10 },
    { text: body },
  ];
  return makePdf(
    [
      [
        { text: 'Appointment letter', size: 18, bold: true, gap: 12 },
        { text: 'Dear Kabir,', gap: 6 },
        {
          text: `Further to your acceptance of our offer, we are pleased to appoint you as Product Designer in the Design team, with effect from ${fmtWeekdayYear(db.tj)}. The terms of your employment are set out in this letter and its annexures.`,
        },
      ],
      page('Annexure A · Pay', 'Your yearly CTC and its breakup are as in your accepted offer.'),
      page('Annexure B · Probation', 'Your probation is 6 months, with a check-in every month.'),
      page('Annexure C · Signatures', 'Signed for Lumen Labs. Employee signature: ____________________'),
    ],
    COMPANY.name,
  );
}

// ── Router ────────────────────────────────────────────────────────────────
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function handleMock(method: string, path: string, body: unknown, auth: string | null): Promise<unknown> {
  scenario();
  await wait(120);
  const p = path.split('?')[0];
  let m: RegExpMatchArray | null;

  // offer link
  if ((m = p.match(/^\/portal\/offer\/([^/]+)$/)) && method === 'GET') {
    if (!(OFFER_TOKENS as readonly string[]).includes(m[1])) throw new ApiError(404, 'Not found');
    return offerView(m[1]);
  }
  if ((m = p.match(/^\/portal\/offer\/([^/]+)\/pdf$/))) return offerPdf(offerView(m[1]));
  if ((m = p.match(/^\/portal\/offer\/([^/]+)\/accept$/))) {
    db.offers[m[1]] = 'accepted';
    return offerView(m[1]);
  }

  // account
  if (p === '/portal/auth/sign-in') {
    const { password } = body as { email: string; password: string };
    if (password === 'wrong') throw new ApiError(401, 'That email and password don’t match. 4 tries left.');
    if (password === 'locked') throw new ApiError(403, 'Too many wrong tries. Try again in 15 minutes, or reset your password.');
    return { token: 'mock-session' };
  }
  if (p === '/portal/auth/forgot' || p === '/portal/auth/reset') return { ok: true };

  if (!auth) throw new ApiError(401, 'Please sign in');

  if (p === '/portal/me') return me();
  if (p === '/portal/me/offer') return { ...offerView('session', true), state: db.offers.session ?? (db.scenario === 'offer_updated' ? 'offer' : 'finalised') };
  if (p === '/portal/me/offer/pdf') return offerPdf(offerView('session', true));
  if (p === '/portal/me/offer/accept') {
    db.offers.session = 'accepted';
    return { ...offerView('session', true), state: 'accepted' };
  }

  if (p === '/portal/documents') return { documents: db.documents };
  if ((m = p.match(/^\/portal\/documents\/([^/]+)\/upload$/))) {
    const form = body as FormData;
    const files = form.getAll('files') as File[];
    db.documents = db.documents.map((d) =>
      d.id === m![1]
        ? {
            ...d,
            status: 'in_review',
            hrNote: undefined,
            uploadedAt: today(),
            files: files.map((f, i) => ({ id: `${d.id}-u${Date.now()}-${i}`, name: f.name, contentType: f.type, size: f.size })),
          }
        : d,
    );
    return { documents: db.documents };
  }
  if ((m = p.match(/^\/portal\/documents\/([^/]+)\/files\/([^/]+)$/)) && method === 'DELETE') {
    db.documents = db.documents.map((d) => {
      if (d.id !== m![1]) return d;
      const files = d.files.filter((f) => f.id !== m![2]);
      return { ...d, files, status: files.length === 0 ? 'todo' : d.status };
    });
    return { documents: db.documents };
  }

  if (p === '/portal/about') {
    if (method === 'PUT') db.about = { ...db.about, ...(body as AboutYou), savedAt: new Date().toISOString() };
    return db.about;
  }

  if (p === '/portal/meet') return { items: db.meet };
  if (p === '/portal/meet/seen') {
    const { itemId } = body as { itemId: string };
    db.meet = db.meet.map((x) => (x.id === itemId ? { ...x, seen: true } : x));
    return { ok: true };
  }

  if (p === '/portal/letters') return { letters: db.letters };
  if ((m = p.match(/^\/portal\/letters\/([^/]+)\/opened$/))) {
    db.letters = db.letters.map((l) => (l.id === m![1] && l.state === 'ready' ? { ...l, state: 'opened' } : l));
    return { ok: true };
  }
  if ((m = p.match(/^\/portal\/letters\/([^/]+)\/sign$/))) {
    const l = db.letters.find((x) => x.id === m![1]);
    if (!l || l.state === 'locked' || l.state === 'ready') throw new ApiError(409, 'Open the PDF before signing.');
    db.letters = db.letters.map((x) => (x.id === m![1] ? { ...x, state: 'signed' } : x));
    return { ok: true };
  }
  if ((m = p.match(/^\/portal\/letters\/([^/]+)\/pdf$/))) return letterPdf(m[1]);

  if (p === '/portal/pass') {
    if (db.scenario !== 'pass_unlocked' && db.scenario !== 'joined') throw new ApiError(403, `Your Day-1 pass opens on ${fmtShort(addDays(db.tj, -7))}`);
    const pass: PortalPass = {
      date: db.tj,
      reportingTime: '09:30',
      place: 'Floor 4, Lumen Labs, 100 Feet Road, Indiranagar, Bengaluru',
      askFor: { name: HR.name, phone: '+91 80000 00000' },
      hrContact: { name: HR.name, email: HR.email },
      bring: ['Original ID and certificates, for a quick check'],
      agenda: [
        { time: '09:30', title: 'Welcome and induction', with: 'With HR · Floor 4' },
        { time: '11:00', title: 'Meet your manager', with: `${MANAGER} · Room 4B` },
        { time: '14:00', title: 'Company vision and culture', with: 'With the founders' },
        { time: '16:00', title: 'Meet your team', with: 'Design team' },
      ],
      managerName: MANAGER,
      buddyName: 'Arjun K.',
      candidateName: CANDIDATE,
      designation: 'Product Designer',
      department: 'Design',
    };
    return pass;
  }

  if (p === '/portal/date-request') {
    const b = body as { requestedTj: string; reason: string; note?: string };
    return { request: { id: 'r1', ...b, status: 'pending', createdAt: new Date().toISOString() } };
  }
  if (p === '/portal/activity') return { ok: true };

  throw new ApiError(404, `Mock: no handler for ${method} ${p}`);
}
