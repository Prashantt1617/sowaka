/**
 * Checks Suwi's employee-lifecycle tools (24 Nov): the onboarding and offboarding boards as answers;
 * prepare_offer (create, revise, send; sending without the offer letter PDF is refused with a pointer
 * to the page), prepare_joiner_step (documents, letters, accepted, joined), prepare_probation (check-in,
 * confirm, extend), prepare_offboarding_step (accept a resignation, move the last day, release early,
 * clearance, close) and prepare_lifecycle_template (add, rename, remove, with Undo). Nothing changes
 * before Confirm; Confirm runs the dashboard's own services; a company without the lifecycle gets a
 * plain answer. On a scratch database only:
 *   MONGODB_URI="mongodb://127.0.0.1:27133/?replicaSet=rs0" npm run suwi-lifecycle:check
 */
// The portal-signing seed (letters signed before joining), as the lifecycle checks use.
process.env.LIFECYCLE_ONBOARDING_SEED ??= 'legacy';

let passed = 0;
let failed = 0;
function ok(label: string, condition: unknown, detail?: unknown) {
  if (condition) { passed += 1; console.log(`  ok   ${label}`); }
  else { failed += 1; console.log(`  FAIL ${label}${detail === undefined ? '' : ` — ${JSON.stringify(detail)?.slice(0, 900)}`}`); }
}
async function refusal(work: () => Promise<unknown>): Promise<string> {
  try { await work(); return '(no refusal)'; } catch (e) { return (e as Error).message; }
}
const PDF = (text = 'letter') => Buffer.from(`%PDF-1.4\n% ${text}\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n`);

(async () => {
  const db = await import('../config/db');
  const { env } = await import('../config/env');
  if (!/^mongodb:\/\/(127\.0\.0\.1|localhost)[:/]/.test(env.mongoUri)) throw new Error(`refusing to run against ${env.mongoUri || '(no MONGODB_URI)'}`);
  await db.connectDb();
  if (!/^suwi_lifecycle_scratch$/.test(db.getDb().databaseName)) throw new Error(`refusing to run against ${db.getDb().databaseName}`);
  await db.getDb().dropDatabase();
  await db.connectDb();

  const { confirmProposal, getProposal, undoProposal } = await import('../suwi/proposals');
  await import('../suwi/registry');
  const { contextFor, SUWI_AREAS, toolByName } = await import('../suwi/tools');
  const rules = await import('../services/lifecycle/dueRules');
  const engine = await import('../services/lifecycle/engine');
  const offersSvc = await import('../services/lifecycle/offers');
  const docsSvc = await import('../services/lifecycle/documents');
  const lettersSvc = await import('../services/lifecycle/letters');
  const { resign } = await import('../services/lifecycle/resignations');
  const { ensureDefaultTemplates } = await import('../services/lifecycle/templates');

  const ORG = 'acme';
  const now = new Date();
  const TODAY = rules.todayKey(now);
  const day = (n: number) => rules.addDaysKey(TODAY, n);
  /** The first Monday–Friday on or after n days from today (the company has no shifts: Sat–Sun are off). */
  const weekday = (n: number) => { let d = day(n); while ([0, 6].includes(new Date(`${d}T00:00:00Z`).getUTCDay())) d = rules.addDaysKey(d, 1); return d; };

  await db.companies().insertMany([
    { id: ORG, name: 'Acme Studio', features: { lifecycle: true, exits: true }, exitNoticeDays: 60, profile: { displayName: 'Acme Studio' } },
    { id: 'nolc', name: 'No Lifecycle Co', features: { exits: true } },
  ] as never[]);
  const person = (userId: string, name: string, extra: Record<string, unknown> = {}) => ({
    userId, name, email: `${userId}@acme.test`, org: ORG, lifecycleStatus: 'active', role: 'employee', joiningDate: new Date('2023-01-01T00:00:00Z'), managerUserId: 'mgr', ...extra,
  });
  await db.users().insertMany([
    person('hr', 'Hema HR', { dashboardAccess: true, dashboardAdmin: true, managerUserId: undefined, employeeId: 'H1' }),
    person('mgr', 'Neha Rao', { role: 'manager', designation: 'Design lead', employeeId: 'M1', managerUserId: 'hr' }),
    person('mgr2', 'Mohan Iyer', { role: 'manager', employeeId: 'M2', managerUserId: 'hr' }),
    person('simran', 'Simran Kaur', { employeeId: 'E10', designation: '3D Artist', department: 'Design' }),
    person('lata', 'Lata Lead', { employeeId: 'E11', role: 'manager' }),
    person('lal', 'Lal Report', { employeeId: 'E12', managerUserId: 'lata' }),
    person('other', 'Om Outsider', { org: 'nolc', dashboardAccess: true, dashboardAdmin: true, managerUserId: undefined }),
  ] as never[]);
  await ensureDefaultTemplates(ORG);

  const levels = Object.fromEntries(SUWI_AREAS.map((a) => [a.key, 'act'])) as never;
  const ctx = contextFor((await db.users().findOne({ userId: 'hr' }))!, levels, TODAY);
  const tool = (name: string) => { const t = toolByName(name); if (!t) throw new Error(`${name} is not registered`); return t; };
  const NAMES = ['lifecycle_onboarding_board', 'prepare_offer', 'prepare_joiner_step', 'prepare_probation', 'lifecycle_offboarding_board', 'prepare_offboarding_step', 'lifecycle_templates', 'prepare_lifecycle_template'];
  for (const n of NAMES) ok(`${n} is registered`, Boolean(toolByName(n)));
  const card = (id: string) => getProposal('hr', ORG, id);
  const HR = { userId: 'hr', name: 'Hema HR', org: ORG, seesPay: true };
  const journeyOf = async (name: string) => (await db.journeys().findOne({ org: ORG, 'candidate.name': name }))!;

  // ─── the switch ────────────────────────────────────────────────────────────
  console.log('Lifecycle off: a plain answer, nothing prepared');
  const otherCtx = contextFor((await db.users().findOne({ userId: 'other' }))!, levels, TODAY);
  for (const n of NAMES) {
    const out = await tool(n).run(otherCtx, { action: 'create', candidate: 'X', joiners: ['X'], person: 'X', kind: 'offboarding' });
    ok(`${n} says the lifecycle is off`, (out.data as { available?: boolean }).available === false && !out.proposalId, out.data);
  }

  // ─── offers ────────────────────────────────────────────────────────────────
  console.log('Offers: create a draft, refuse to send without the PDF, send, revise');
  const tj = weekday(14);
  ok('no manager: Suwi asks for it', /reporting manager/.test(await refusal(() => tool('prepare_offer').run(ctx, { action: 'create', candidate: 'Ishaan Verma', personalEmail: 'ishaan@example.com', designation: '3D Visualiser', ctc: 720000, joiningDate: tj }))));
  ok('lakhs typed as rupees are refused', /lakhs/.test(await refusal(() => tool('prepare_offer').run(ctx, { action: 'create', candidate: 'Ishaan Verma', personalEmail: 'ishaan@example.com', designation: '3D Visualiser', ctc: 7.2, joiningDate: tj, manager: 'Neha' }))));
  const made = await tool('prepare_offer').run(ctx, { action: 'create', candidate: 'Ishaan Verma', personalEmail: 'ishaan@example.com', designation: '3D Visualiser', ctc: 720000, joiningDate: tj, manager: 'Neha' });
  const madeCard = await card(made.proposalId!);
  ok('the create card states role, pay in rupees, joining day and manager', /3D Visualiser/.test(madeCard.summary) && /₹7,20,000/.test(madeCard.summary) && madeCard.lines.some((l) => /Neha Rao/.test(l.text)), madeCard);
  ok('…and that the PDF comes from the Onboarding page before sending', madeCard.lines.some((l) => /offer letter PDF/.test(l.text) && /Onboarding/.test(l.text)), madeCard.lines);
  ok('nothing is made before Confirm', !(await db.journeys().findOne({ 'candidate.name': 'Ishaan Verma' })));
  await confirmProposal('hr', ORG, made.proposalId!);
  const ishaan = await journeyOf('Ishaan Verma');
  const ishaanOffer = await offersSvc.offerView(ishaan.id);
  ok('Confirm makes the draft offer through the service', ishaan.status === 'draft' && ishaanOffer?.fields.ctc === 720000 && ishaanOffer.fields.tj === tj && ishaanOffer.fields.managerUserId === 'mgr', ishaanOffer);

  const noPdf = await tool('prepare_offer').run(ctx, { action: 'send', candidate: 'Ishaan' });
  ok('send without the PDF: no card, says "Upload the offer letter PDF first" and points to Onboarding',
    !noPdf.proposalId && (noPdf.data as { blocked?: string }).blocked === 'Upload the offer letter PDF first' && noPdf.links?.some((l) => l.view === 'onboarding'), noPdf);
  await offersSvc.uploadOfferPdf(HR, ishaan.id, { originalname: 'Offer letter.pdf', buffer: PDF('offer') });
  const send = await tool('prepare_offer').run(ctx, { action: 'send', candidate: 'Ishaan' });
  ok('with the PDF, the send card names the email address', /ishaan@example\.com/.test((await card(send.proposalId!)).summary));
  ok('still a draft before Confirm', (await offersSvc.offerView(ishaan.id))?.status === 'draft');
  await confirmProposal('hr', ORG, send.proposalId!);
  ok('Confirm sends it (offer sent, journey offer_sent)', (await offersSvc.offerView(ishaan.id))?.status === 'sent' && (await journeyOf('Ishaan Verma')).status === 'offer_sent');

  const rev = await tool('prepare_offer').run(ctx, { action: 'revise', candidate: 'Ishaan', ctc: 780000 });
  const revCard = await card(rev.proposalId!);
  ok('the revise card shows the CTC before and after', revCard.preview?.rows.some((r) => r.current === '₹7,20,000 a year' && r.next === '₹7,80,000 a year') === true, revCard.preview);
  ok('a sent offer\'s revision is a new version, so no Undo', revCard.undoable === false);
  await confirmProposal('hr', ORG, rev.proposalId!);
  const v2 = await offersSvc.offerView(ishaan.id);
  ok('Confirm makes version 2 as a draft with the new CTC', v2?.version === 2 && v2.status === 'draft' && v2.fields.ctc === 780000, v2);

  // ─── the pre-boarding board ────────────────────────────────────────────────
  console.log('The pre-boarding board');
  const aarav = (await offersSvc.createOffer(HR, { candidate: { name: 'Aarav Shah', personalEmail: 'aarav@example.com' }, fields: { designation: 'Animator', ctc: 600000, tj: weekday(21), managerUserId: 'mgr' } })).journeyId;
  await offersSvc.uploadOfferPdf(HR, aarav, { originalname: 'Offer.pdf', buffer: PDF('aarav') });
  await offersSvc.sendOffer(HR, aarav, {});
  await db.offers().updateOne({ journeyId: aarav }, { $set: { 'versions.0.sentAt': new Date(Date.now() - 5 * 86_400_000) } });
  const waiting = await tool('lifecycle_onboarding_board').run(ctx, { column: 'offer_sent' });
  const waitingNames = (waiting.data as { joiners: Array<{ name: string }> }).joiners.map((j) => j.name).sort();
  ok('"Who has an offer waiting?" lists Aarav and Ishaan', JSON.stringify(waitingNames) === JSON.stringify(['Aarav Shah', 'Ishaan Verma']), waiting.data);
  ok('…without any pay on the board', !JSON.stringify(waiting).includes('600000') && !JSON.stringify(waiting).includes('780000'));
  const late3 = await tool('lifecycle_onboarding_board').run(ctx, { notAnsweredAfterDays: 3 });
  ok('"Not answered after 3 days" is Aarav only (sent 5 days ago)', JSON.stringify((late3.data as { joiners: Array<{ name: string }> }).joiners.map((j) => j.name)) === '["Aarav Shah"]', late3.data);

  // ─── pre-boarding steps ────────────────────────────────────────────────────
  console.log('Pre-boarding: accepted, documents, letters, joined');
  const acc = await tool('prepare_joiner_step').run(ctx, { action: 'mark_accepted', joiners: ['Aarav'] });
  ok('one card for Aarav', (await card(acc.proposalId!)).preview?.rows.length === 1);
  await confirmProposal('hr', ORG, acc.proposalId!);
  ok('Confirm records the yes (finalised, portal account made)', (await db.journeys().findOne({ id: aarav }))?.status === 'finalised' && Boolean(await db.candidateAccounts().findOne({ journeyId: aarav })));

  const tanya = (await offersSvc.createOffer(HR, { candidate: { name: 'Tanya Bose', personalEmail: 'tanya@example.com' }, fields: { designation: 'Modeller', department: 'Design', location: 'Pune', ctc: 650000, tj: weekday(10), managerUserId: 'mgr' } })).journeyId;
  await offersSvc.uploadOfferPdf(HR, tanya, { originalname: 'Offer.pdf', buffer: PDF('tanya') });
  await offersSvc.sendOffer(HR, tanya, {});
  await offersSvc.finaliseOffer(HR, tanya);
  const tanyaJ = (await db.journeys().findOne({ id: tanya }))!;
  const docs = await docsSvc.journeyDocumentsView(tanya);
  for (const d of docs.filter((x) => x.required)) await docsSvc.uploadDocumentFiles(tanyaJ, d.id, [{ originalname: `${d.label}.pdf`, buffer: PDF(d.label) }]);
  const nothing = await tool('prepare_joiner_step').run(ctx, { action: 'approve_documents', joiners: ['Aarav'] });
  ok('nothing uploaded: no card, says what is still to upload', !nothing.proposalId && /Nothing uploaded/.test(JSON.stringify(nothing.data)), nothing.data);
  ok('send back needs a reason', /reason/.test(await refusal(() => tool('prepare_joiner_step').run(ctx, { action: 'send_back_documents', joiners: ['Tanya'], documents: ['PAN'] }))));
  const appr = await tool('prepare_joiner_step').run(ctx, { action: 'approve_documents', joiners: ['Tanya'], sendLetters: true });
  const apprCard = await card(appr.proposalId!);
  ok('the approve card lists her uploaded documents and says the letters need their PDFs', /PAN card/.test(apprCard.preview!.rows[0].current) && apprCard.lines.some((l) => /Documents page/.test(l.text)), apprCard);
  ok('nothing approved before Confirm', (await db.candidateDocuments().countDocuments({ journeyId: tanya, status: 'approved' })) === 0);
  await confirmProposal('hr', ORG, appr.proposalId!);
  ok('Confirm approves every required document (docs_approved)', (await db.candidateDocuments().countDocuments({ journeyId: tanya, required: true, status: { $ne: 'approved' } })) === 0 && (await db.journeys().findOne({ id: tanya }))?.status === 'docs_approved');
  const drafted = await lettersSvc.listLetters(ORG, { journeyId: tanya });
  ok('…and the appointment letter and NDA are drafted', ['appointment', 'nda'].every((k) => drafted.some((l) => l.kind === k)), drafted.map((l) => l.kind));
  const noLetterPdf = await tool('prepare_joiner_step').run(ctx, { action: 'send_letters', joiners: ['Tanya'] });
  ok('send letters without their PDFs: no card, "Generate the PDF first"', !noLetterPdf.proposalId && /Generate the PDF first/.test(JSON.stringify(noLetterPdf.data)), noLetterPdf.data);
  for (const l of drafted) await lettersSvc.uploadLetterPdf(HR, l.id, { originalname: `${l.kind}.pdf`, buffer: PDF(l.kind) });
  const gap = await tool('prepare_joiner_step').run(ctx, { action: 'send_letters', joiners: ['Tanya'] });
  const gapCard = gap.proposalId ? await card(gap.proposalId) : null;
  ok('a letter missing a merge field is left out and the card names the field (NDA: Company address)',
    gapCard?.preview?.rows[0].current === 'Appointment letter' && gapCard.lines.some((l) => /NDA is missing details \(Company address\)/.test(l.text)), gapCard ?? gap.data);
  await db.companies().updateOne({ id: ORG }, { $set: { 'profile.addressLine1': '12 Lake Road', 'profile.city': 'Pune' } });
  await lettersSvc.regenerateAppointmentLetters(tanya);
  for (const l of await lettersSvc.listLetters(ORG, { journeyId: tanya })) await lettersSvc.uploadLetterPdf(HR, l.id, { originalname: `${l.kind}.pdf`, buffer: PDF(l.kind) });
  const sendL = await tool('prepare_joiner_step').run(ctx, { action: 'send_letters', joiners: ['Tanya'] });
  await confirmProposal('hr', ORG, sendL.proposalId!);
  const sentLetters = await lettersSvc.listLetters(ORG, { journeyId: tanya });
  ok('Confirm emails both letters to her personal email', sentLetters.filter((l) => l.email?.sentAt && l.email.to === 'tanya@example.com').length === 2, sentLetters.map((l) => l.email));
  const back = await tool('prepare_joiner_step').run(ctx, { action: 'send_back_documents', joiners: ['Tanya'], documents: ['PAN'], reason: 'The photo is blurred' });
  await confirmProposal('hr', ORG, back.proposalId!);
  ok('send back: the PAN card goes back with the reason', (await db.candidateDocuments().findOne({ journeyId: tanya, label: 'PAN card' }))?.status === 'sent_back' && (await db.candidateDocuments().findOne({ journeyId: tanya, label: 'PAN card' }))?.hrNote === 'The photo is blurred');

  const kabir = (await offersSvc.createOffer(HR, { candidate: { name: 'Kabir Mehta', personalEmail: 'kabir@example.com' }, fields: { designation: 'Rigger', ctc: 640000, tj: weekday(5), managerUserId: 'mgr' } })).journeyId;
  await offersSvc.uploadOfferPdf(HR, kabir, { originalname: 'Offer.pdf', buffer: PDF('kabir') });
  await offersSvc.sendOffer(HR, kabir, {});
  await offersSvc.finaliseOffer(HR, kabir);
  const early = await tool('prepare_joiner_step').run(ctx, { action: 'mark_joined', joiners: ['Kabir'], workEmail: 'kabir@acme.test' });
  ok('before the joining day: no card, says when it opens', !early.proposalId && /opens on the joining day/.test(JSON.stringify(early.data)), early.data);
  await engine.moveTj(kabir, TODAY);
  const noEmail = await tool('prepare_joiner_step').run(ctx, { action: 'mark_joined', joiners: ['Kabir'] });
  ok('no work email anywhere: asks for one', !noEmail.proposalId && /work email/.test(JSON.stringify(noEmail.data)), noEmail.data);
  const join = await tool('prepare_joiner_step').run(ctx, { action: 'mark_joined', joiners: ['Kabir'], workEmail: 'kabir@acme.test', employeeId: 'E20' });
  ok('no account before Confirm', !(await db.users().findOne({ email: 'kabir@acme.test' })));
  const joined = await confirmProposal('hr', ORG, join.proposalId!);
  const kabirUser = await db.users().findOne({ email: 'kabir@acme.test' });
  ok('Confirm marks him joined: the employee record exists', Boolean(kabirUser) && (await db.journeys().findOne({ id: kabir }))?.userId === kabirUser?.userId && kabirUser?.employeeId === 'E20', joined.message);

  // ─── probation ─────────────────────────────────────────────────────────────
  console.log('Probation: who is due, check-in, confirm, extend');
  const joinAt = async (name: string, userId: string, tjDay: string) => {
    const j = await engine.createOnboardingJourney(ORG, 'hr', { candidate: { name, personalEmail: `${userId}@example.com` }, tj: tjDay, managerUserId: 'mgr', designation: 'Analyst', department: 'Design' });
    for (const s of ['offer_sent', 'accepted', 'finalised', 'active', 'docs_approved'] as const) await engine.setJourneyStatus(j.id, s);
    await engine.completeTask(j.id, 'sign_letters');
    await db.users().insertOne(person(userId, name, { employeeId: `E-${userId}`, joiningDate: new Date(`${tjDay}T00:00:00Z`) }) as never);
    await engine.onJoined(j.id, userId);
    return engine.loadJourney(j.id);
  };
  const finalTj = rules.addDaysKey(rules.addMonthsKey(TODAY, -5), -3);
  const dev = await joinAt('Dev Malhotra', 'dev', finalTj);
  const ritika = await joinAt('Ritika Jain', 'ritika', finalTj);
  await joinAt('Isha New', 'isha', day(-2));
  const meera = await joinAt('Meera Pillai', 'meera', rules.addDaysKey(rules.addMonthsKey(TODAY, -1), 3));
  const due = await tool('lifecycle_onboarding_board').run(ctx, { tab: 'probation', dueOnly: true });
  ok('"Who is due for confirmation?" is Dev and Ritika', JSON.stringify((due.data as { joiners: Array<{ name: string }> }).joiners.map((j) => j.name).sort()) === '["Dev Malhotra","Ritika Jain"]', due.data);
  const conf = await tool('prepare_probation').run(ctx, { action: 'confirm', joiners: ['Dev', 'Isha'] });
  const confCard = await card(conf.proposalId!);
  ok('one card: Dev in, Isha left out because the decision is not open', confCard.preview?.rows.length === 1 && confCard.preview.skipped.some((s) => s.who === 'Isha New' && /opens in the final month/.test(s.reason)), confCard.preview);
  ok('not confirmed before Confirm', (await engine.loadJourney(dev.id)).status !== 'confirmed');
  await confirmProposal('hr', ORG, conf.proposalId!);
  ok('Confirm confirms Dev', (await engine.loadJourney(dev.id)).status === 'confirmed');
  ok('extend needs 1–6 months', /1 to 6/.test(await refusal(() => tool('prepare_probation').run(ctx, { action: 'extend', joiners: ['Ritika'], extendMonths: 9 }))));
  const ext = await tool('prepare_probation').run(ctx, { action: 'extend', joiners: ['Ritika'], extendMonths: 2 });
  await confirmProposal('hr', ORG, ext.proposalId!);
  const rd = (await engine.loadJourney(ritika.id)).probation;
  ok('Confirm extends Ritika by 2 months', rd?.decision?.outcome === 'extend' && rd.decision.extendMonths === 2 && rd.extendedBy === 2, rd);
  const chk = await tool('prepare_probation').run(ctx, { action: 'checkin', joiners: ['Meera'], note: 'Settling in well' });
  const chkCard = await card(chk.proposalId!);
  ok('the check-in card is undoable', chkCard.undoable === true && chkCard.preview?.rows.length === 1, chkCard);
  const checkinTask = async () => (await engine.tasksOf(meera.id)).find((t) => t.systemKey === 'monthly_checkin' && t.month === 1)!;
  ok('the month-1 check-in is open before Confirm', ['todo', 'in_review', 'sent_back'].includes((await checkinTask()).status), (await checkinTask()).status);
  await confirmProposal('hr', ORG, chk.proposalId!);
  ok('Confirm marks it done with the note', (await checkinTask()).status === 'done' && (await checkinTask()).note === 'Settling in well');
  await undoProposal('hr', ORG, chk.proposalId!);
  ok('Undo opens it again', (await checkinTask()).status === 'todo');

  // ─── offboarding ───────────────────────────────────────────────────────────
  console.log('Offboarding: the board, accept, last day, clearance, close');
  await resign('simran', { reason: 'Higher studies' }, now);
  const board1 = await tool('lifecycle_offboarding_board').run(ctx, {});
  const sRow = (board1.data as { people: Array<{ name: string; nextStep: string; stage: string }> }).people.find((p) => p.name === 'Simran Kaur');
  ok('"Who is leaving?" lists Simran with her next step', Boolean(sRow?.nextStep) && Boolean(sRow?.stage), board1.data);
  const resignation = (await db.resignations().findOne({ userId: 'simran' }))!;
  ok('her notice is from her offer letter (none: 60 days)', resignation.noticeDays === 60);
  const tooLate = await refusal(() => tool('prepare_offboarding_step').run(ctx, { action: 'release_early', person: 'Simran', lastDay: rules.addDaysKey(resignation.lastDayByNotice, 3) }));
  ok('an early release after the notice ends is refused', /early release is before/.test(tooLate), tooLate);
  const lastDay = day(30);
  const acc2 = await tool('prepare_offboarding_step').run(ctx, { action: 'accept_resignation', person: 'Simran', lastDay });
  const accCard = await card(acc2.proposalId!);
  ok('the accept card: notice 60 days from the offer letter, an early release with no notice pay and nothing recovered',
    accCard.lines.some((l) => /60 days from their offer letter/.test(l.text) && /no notice pay and nothing recovered/.test(l.text)), accCard.lines);
  ok('no exit before Confirm', !(await db.users().findOne({ userId: 'simran' }))?.exit);
  await confirmProposal('hr', ORG, acc2.proposalId!);
  const simran = await db.users().findOne({ userId: 'simran' });
  ok('Confirm accepts it: exit recorded with the last day, no notice pay or recovery', simran?.exit?.lastWorkingDay === lastDay && simran.exit.rules?.noticePay === 'none' && simran.exit.rules?.noticeRecovery === 'none' && (await db.resignations().findOne({ id: resignation.id }))?.status === 'accepted', simran?.exit);

  const moved = day(40);
  const mv = await tool('prepare_offboarding_step').run(ctx, { action: 'change_last_day', person: 'Simran', lastDay: moved });
  const mvCard = await card(mv.proposalId!);
  ok('the move card shows the old and new day, with Undo', Boolean(mvCard.preview?.rows[0]) && mvCard.preview!.rows[0].current !== mvCard.preview!.rows[0].next && mvCard.undoable === true, mvCard.preview);
  await confirmProposal('hr', ORG, mv.proposalId!);
  ok('Confirm moves her last day', (await db.users().findOne({ userId: 'simran' }))?.exit?.lastWorkingDay === moved);
  await undoProposal('hr', ORG, mv.proposalId!);
  ok('Undo moves it back', (await db.users().findOne({ userId: 'simran' }))?.exit?.lastWorkingDay === lastDay);

  const board2 = await tool('lifecycle_offboarding_board').run(ctx, { name: 'Simran' });
  const open2 = (board2.data as { people: Array<{ clearanceOpen: string[] }> }).people[0]?.clearanceOpen ?? [];
  ok('the board lists her open clearance items', open2.some((x) => /Laptop/.test(x)), board2.data);
  const tick = await tool('prepare_offboarding_step').run(ctx, { action: 'tick_clearance', person: 'Simran', items: ['laptop', 'ID card'] });
  ok('one card for both items', (await card(tick.proposalId!)).preview?.rows.length === 2, (await card(tick.proposalId!)).preview);
  await confirmProposal('hr', ORG, tick.proposalId!);
  const doneOf = async (key: string) => (await db.users().findOne({ userId: 'simran' }))?.exit?.clearance?.find((c) => c.key === key)?.done;
  ok('Confirm ticks the laptop and ID card', (await doneOf('laptop')) === true && (await doneOf('id_card')) === true);
  await undoProposal('hr', ORG, tick.proposalId!);
  ok('Undo opens them again', (await doneOf('laptop')) === false && (await doneOf('id_card')) === false);
  const close = await tool('prepare_offboarding_step').run(ctx, { action: 'close_exit', person: 'Simran' });
  ok('close before the settlement is emailed: no card, says so', !close.proposalId && /settlement/.test(JSON.stringify(close.data)) && close.links?.some((l) => l.view === 'offboarding'), close.data);

  await resign('lata', { reason: 'Relocation' }, now);
  const lead = await tool('prepare_offboarding_step').run(ctx, { action: 'accept_resignation', person: 'Lata' });
  ok('a team lead: asks who their reports move to', !lead.proposalId && (lead.data as { needs?: string }).needs === 'newManager', lead.data);
  const lead2 = await tool('prepare_offboarding_step').run(ctx, { action: 'accept_resignation', person: 'Lata', newManager: 'Mohan' });
  await confirmProposal('hr', ORG, lead2.proposalId!);
  const lata = await db.users().findOne({ userId: 'lata' });
  ok('with newManager: accepted on the last day by notice', lata?.exit?.lastWorkingDay === (await db.resignations().findOne({ userId: 'lata' }))?.lastDayByNotice && lata?.exit?.newManagerUserId === 'mgr2', lata?.exit);

  // ─── templates ─────────────────────────────────────────────────────────────
  console.log('Templates: add, rename, remove, Undo');
  const tpl = async () => (await db.lifecycleTemplates().findOne({ org: ORG, kind: 'offboarding', isDefault: true }))!;
  const steps = await tool('lifecycle_templates').run(ctx, { kind: 'offboarding' });
  ok('the offboarding template\'s steps are listed', ((steps.data as { steps: unknown[] }).steps.length) === (await tpl()).tasks.length);
  const add = await tool('prepare_lifecycle_template').run(ctx, { action: 'add', kind: 'offboarding', title: 'Return laptop to IT', owner: 'it', dueFrom: 'last_day', dueDays: -2 });
  const addCard = await card(add.proposalId!);
  ok('the add card says when it is due', /2 days before the last day/.test(addCard.summary), addCard.summary);
  const count = (await tpl()).tasks.length;
  ok('nothing added before Confirm', !(await tpl()).tasks.some((t) => t.title === 'Return laptop to IT'));
  await confirmProposal('hr', ORG, add.proposalId!);
  const added = (await tpl()).tasks.find((t) => t.title === 'Return laptop to IT');
  ok('Confirm adds it, owned by IT, due 2 days before the last day', added?.ownerRole === 'it' && added.dueRule?.anchor === 'tl' && added.dueRule.offset === -2 && (await tpl()).tasks.length === count + 1, added);
  await undoProposal('hr', ORG, add.proposalId!);
  ok('Undo puts the template back', (await tpl()).tasks.length === count && !(await tpl()).tasks.some((t) => t.title === 'Return laptop to IT'));
  const firstCustom = (await tpl()).tasks.find((t) => !t.mustDo && t.systemKey)!;
  const ren = await tool('prepare_lifecycle_template').run(ctx, { action: 'rename', kind: 'offboarding', step: firstCustom.title, title: 'Renamed by Suwi' });
  await confirmProposal('hr', ORG, ren.proposalId!);
  ok('rename', (await tpl()).tasks.find((t) => t.id === firstCustom.id)?.title === 'Renamed by Suwi');
  const rm = await tool('prepare_lifecycle_template').run(ctx, { action: 'remove', kind: 'offboarding', step: 'Renamed by Suwi' });
  await confirmProposal('hr', ORG, rm.proposalId!);
  ok('removing a built-in step switches it off', (await tpl()).tasks.find((t) => t.id === firstCustom.id)?.enabled === false);
  const must = (await tpl()).tasks.find((t) => t.mustDo)!;
  ok('a must-do step cannot be removed', /must-do/.test(await refusal(() => tool('prepare_lifecycle_template').run(ctx, { action: 'remove', kind: 'offboarding', step: must.title }))));

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });

export {};
