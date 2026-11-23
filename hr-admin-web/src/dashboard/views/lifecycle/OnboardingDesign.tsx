// Setup › Employee lifecycle › Onboarding templates › one template: the Final designs' editor
// ("2 · Dashboard setup", Main.dc.html; notes d1, d2). Four accordions: Pre-boarding (offer to
// joining day), Onboarding (the tabs the employee has in the app), Probation, and The team's part
// (closed at first); the Employee preview; forms and acknowledgements. Reads and writes the
// template's design view only (GET / PUT /admin/lifecycle/templates/:id/design,
// docs/lifecycle/FINAL-DESIGNS.md §4.1): edits stay here until "Save template".
import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { useStore } from '../../store';
import { PageActions, ListPending, SkeletonLines } from '../../ui';
import { SEG, btn, btnClass, segBtn } from '../../ds';
import { IconEye } from '../../icons';
import { setLeaveGuard, usePageHead } from '../../pageHead';
import { htmlToPdfBlob } from '../../pdf';
import { getTemplateDesign, listLetterTemplates, saveTemplateDesign, uploadTemplateMedia } from '../../../services/lifecycle';
import { getOffices } from '../../../services/hrms';
import type { OfficeDTO } from '../../../services/hrms';
import type {
  CheckinAnswerType, DesignAccess, DesignCheckin, DesignMedia, DesignMeeting, DesignQuestion, DesignStage, DesignTask, DesignTeamTask, DesignWatchItem,
  FormAnswerType, JoinerTaskType, LetterTemplateDTO, MeetWith, TeamRole, TemplateDesign, TemplatePreview, TourLesson,
} from '../../../services/lifecycle';
import { Modal } from './shared';
import { areaStyle, errText, inputStyle, longDay, todayKey } from './format';
import { LETTER_CSS, LETTER_TITLE, labelledBody, letterDocument } from './letterDoc';
import { useCompanyName } from './hooks';
import { Block, Glyph, GroupHead, InfoNote, InfoToggle, ItemRow, MediaPlayer, NameDropdown, Overlay, RadioPills, RemoveButton, SidePanel, SOFT_SEG, softSegBtn, TileFace, TileStrip } from './designParts';
import {
  BACKGROUNDS, GLYPH, MEETS_LABEL, MEET_LABEL, MEET_WITH, ROLE_LABEL, STAGES, TOUR, addBtn, checkinWhen, chip, clock, pickFile, rowLine, smallBtn, stageName,
  stageOrBefore, tourName, whoChip,
} from './designWords';
import '../people.css';

type Cat = 'meet' | 'tasks' | 'feedback' | 'tour' | 'watch' | 'access';
type TCat = 'manager' | 'buddy' | 'hr' | 'it' | 'lead';
type AddKind = 'do' | 'review' | 'ack' | 'other' | 'form' | 'meet' | 'access' | 'team';
type StoryList = 'pre' | 'watch' | 'training';

const CATS: Array<[Cat, string]> = [['meet', 'Meetings'], ['tasks', 'Tasks'], ['feedback', 'Check-ins'], ['tour', 'Sowaka tour'], ['watch', 'Watch list'], ['access', 'Devices and accesses']];
const TCATS: Array<[TCat, string]> = [['manager', 'Manager'], ['buddy', 'Buddy'], ['hr', 'HR'], ['it', 'IT & admin'], ['lead', 'Leadership']];
const TASK_GROUPS: Array<[JoinerTaskType, string]> = [['do', 'Do in Sowaka'], ['review', 'Review'], ['ack', 'Read and acknowledge'], ['sign', 'Sign'], ['other', 'More tasks'], ['form', 'Fill in a form']];
const TASK_GLYPH: Record<JoinerTaskType, string> = { do: GLYPH.task, review: GLYPH.review, ack: GLYPH.ack, sign: GLYPH.sign, other: GLYPH.task, form: GLYPH.form };
/** "+ Add a point" / "+ Add a question": the canvas's grey chip with blue words. */
const ADD_LINE: CSSProperties = { justifySelf: 'start', height: 34, padding: '0 12px', borderRadius: 10, border: 0, background: 'var(--surface-2)', color: 'var(--accent)', fontSize: 12, fontWeight: 700 };
/** "9:30 am", "9.30", "14:00", "9 AM" → "HH:mm"; null when it isn't a time. */
const parseTime = (raw: string): string | null => {
  const m = raw.trim().toLowerCase().match(/^(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm)?$/);
  if (!m) return null;
  let h = Number(m[1]); const min = Number(m[2] ?? '0');
  if (min > 59 || h > 23 || (m[3] && (h < 1 || h > 12))) return null;
  if (m[3] === 'pm' && h < 12) h += 12;
  if (m[3] === 'am' && h === 12) h = 0;
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
};
/** "09:30" → "9:30 AM" (the canvas writes the reporting time as text). */
const ampm = (t?: string) => {
  const hm = t ? parseTime(t) : null;
  if (!hm) return t ?? '';
  const [h, m] = hm.split(':').map(Number);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
};
/** A pasted link as the server keeps it ("https://…"; "forms.example.com/x" gets the https://); null when it isn't a web address. */
const webLink = (raw: string): string | null => {
  const text = raw.trim();
  try {
    const url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(text) ? text : `https://${text}`);
    return url.protocol === 'https:' && /^[^\s.]+(\.[^\s.]+)+$/.test(url.hostname) ? url.toString() : null;
  } catch { return null; }
};
const CHECKIN_TYPES: Array<[CheckinAnswerType, string]> = [['rating', 'Rating 1 to 5'], ['yes_no', 'Yes or no'], ['short', 'Short answer'], ['long', 'Long answer'], ['choice', 'Choice']];
const FORM_TYPES: Array<[FormAnswerType, string]> = [['short', 'Short answer'], ['long', 'Long answer'], ['choice', 'Choice'], ['date', 'Date'], ['file', 'File']];

/** A "Choice" question's options, typed comma-separated (the one thing that answer type needs). */
function ChoiceOptions({ n, options, onChange }: { n: number; options?: string[]; onChange: (options: string[]) => void }) {
  return <input aria-label={`Question ${n} choices`} value={(options ?? []).join(',')} maxLength={800} placeholder="Choices, separated by commas" onChange={(e) => onChange(e.target.value.split(','))} style={inputStyle} />;
}
/** A question as saved: a choice keeps its non-empty options, other types none. */
const savedQuestion = <T extends string>(q: DesignQuestion<T>): DesignQuestion<T> => {
  const { options, ...rest } = q;
  const kept = (options ?? []).map((o) => o.trim()).filter(Boolean);
  return { ...rest, text: q.text.trim(), ...(q.type === 'choice' && kept.length ? { options: kept } : {}) };
};
const NAME: Record<string, [string, string]> = {
  help: ['Task', 'e.g. Take them for lunch on Day 1'], meet: ['What it’s about', 'e.g. Office walkthrough'], do: ['Task', 'e.g. Apply for your first leave'],
  review: ['What they review', 'e.g. Your leave balance'], other: ['Task', 'e.g. Fill in the joining form'], form: ['Form name', 'e.g. Uniform size'],
  ack: ['Document name', 'e.g. Code of conduct'], access: ['Device or access', 'e.g. Attendance biometric'],
};
const KIND_WORDS: Record<string, string> = { help: 'a task', meet: 'a meeting', do: 'a task', review: 'something to review', other: 'a task', form: 'a form', ack: 'a document', access: 'a device or access' };
const PICK_KINDS: Array<[AddKind, string, string, string, string, string]> = [
  ['do', 'Do in Sowaka', 'Opens a screen in the app, like punch-in or the profile', GLYPH.task, 'var(--t-sky)', 'var(--t-sky-i)'],
  ['review', 'Review', 'They check a page, like their shift, and tap “Looks good”', GLYPH.review, 'var(--t-lilac)', 'var(--t-lilac-i)'],
  ['ack', 'Read and acknowledge', 'They read a policy or PDF and tap “I’ve read this”', GLYPH.ack, 'var(--t-mint)', 'var(--t-mint-i)'],
  ['other', 'More tasks', 'Anything else. Paste a link if it lives somewhere else.', GLYPH.task, 'var(--t-butter)', 'var(--t-butter-i)'],
];
const ACCEPT: Record<DesignMedia['type'], string> = { video: 'video/mp4,video/quicktime', image: 'image/jpeg,image/png', pdf: 'application/pdf', text: '' };

interface AddState {
  kind: AddKind | null; pickFrom: boolean; role?: TeamRole; name: string; link: string; meetWith: MeetWith; accessRole: 'it' | 'hr'; stage: DesignStage;
  agenda: string[]; fields: Array<{ text: string; type: FormAnswerType; options?: string[] }>; file?: { fileId: string; name: string; letterTemplateId?: string }; busy?: boolean; docPick?: boolean;
}
interface MeetEdit { index: number; title: string; meetWith: MeetWith; stage: DesignStage; agenda: string[]; info: boolean }
interface CiEdit { index: number | null; title: string; stage: DesignStage; questions: Array<DesignQuestion<CheckinAnswerType>>; info: boolean }
interface StoryEdit { list: StoryList; index: number | null; title: string; stage: DesignStage; media: DesignMedia; busy?: boolean }
interface TeamEdit { kind: 'team' | 'access'; index: number; title: string; stage: DesignStage; how: string; info: boolean; who: string }
interface DocsDrawer { index: number; sel: string; pick: string[] }
type TeamItem = { kind: 'team'; index: number; title: string; stage: DesignStage; role: TeamRole } | { kind: 'access'; index: number; title: string; stage: DesignStage; role: 'it' | 'hr' };

/** In the order of the stages (stable), as the editor lists them. */
const byStage = <T extends { stage: DesignStage }>(list: T[]): T[] => list.map((x, n) => [x, n] as const)
  .sort((a, b) => STAGES.indexOf(a[0].stage) - STAGES.indexOf(b[0].stage) || a[1] - b[1]).map(([x]) => x);

let seq = 0;
/** A row made here and not saved yet (the server gives it its id on save). */
const newId = () => `new:${Date.now().toString(36)}${(seq++).toString(36)}`;
const unsaved = (id?: string) => !id || id.startsWith('new:');
const noNewId = <T extends { id?: string }>(x: T): T => (unsaved(x.id) ? { ...x, id: undefined } : x);

/** The whole document for "Save template": read-only fields out, new rows without ids. */
function forSave(d: TemplateDesign) {
  const rest: Partial<TemplateDesign> & Omit<TemplateDesign, 'templateId' | 'name' | 'isDefault'> = { ...d };
  for (const k of ['templateId', 'name', 'isDefault', 'updatedAt', 'updatedByName'] as const) delete rest[k];
  return {
    ...rest,
    preboarding: { ...rest.preboarding, videos: rest.preboarding.videos.map(noNewId) },
    meetings: rest.meetings.map(noNewId), tasks: rest.tasks.map(noNewId), checkins: rest.checkins.map(noNewId),
    watch: rest.watch.map(noNewId), trainings: rest.trainings.map(noNewId), accesses: rest.accesses.map(noNewId),
    team: { ...rest.team, tasks: rest.team.tasks.map((t) => (unsaved(t.id) ? { ...t, id: undefined, key: undefined } : t)) },
  };
}

const sectionTone: Record<'pre' | 'onb' | 'prob' | 'team', [string, string, string]> = {
  pre: ['var(--t-butter)', 'var(--t-butter-i)', GLYPH.mail], onb: ['var(--t-sky)', 'var(--t-sky-i)', GLYPH.task],
  prob: ['var(--t-mint)', 'var(--t-mint-i)', GLYPH.clock], team: ['var(--t-lilac)', 'var(--t-lilac-i)', GLYPH.team],
};

function SectionHead({ tone, title, sub, open, onToggle }: { tone: keyof typeof sectionTone; title: string; sub: string; open: boolean; onToggle: () => void }) {
  const [bg, fg, d] = sectionTone[tone];
  return (
    <button type="button" onClick={onToggle} aria-expanded={open}
      style={{ width: '100%', border: 0, background: 'transparent', padding: '16px 20px', display: 'flex', alignItems: 'center', gap: 14, fontFamily: 'inherit', textAlign: 'left', cursor: 'pointer', color: 'var(--ink)' }}>
      <span style={{ width: 40, height: 40, borderRadius: 12, background: bg, color: fg, display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}><Glyph d={d} size={20} width={1.9} /></span>
      <span style={{ flex: 1, minWidth: 0, display: 'grid', gap: 3 }}>
        <span style={{ fontSize: 16, fontWeight: 600, letterSpacing: '-.01em' }}>{title}</span>
        <span style={{ fontSize: 12.5, color: 'var(--ink-3)', lineHeight: 1.45 }}>{sub}</span>
      </span>
      <Glyph d={GLYPH.down} size={18} color="var(--ink-3)" width={2.2} style={{ transform: open ? 'rotate(180deg)' : undefined, transition: 'transform .15s' }} />
    </button>
  );
}

function Tabs<T extends string>({ label, tabs, active, onPick, counts, warn }: { label: string; tabs: Array<[T, string]>; active: T; onPick: (t: T) => void; counts: Record<T, string>; warn?: T | null }) {
  return (
    <div role="tablist" aria-label={label} style={{ ...SEG, borderRadius: 16 }}>
      {tabs.map(([k, t]) => {
        const on = k === active;
        const isWarn = warn === k;
        return (
          <button key={k} type="button" role="tab" aria-selected={on} onClick={() => onPick(k)} style={segBtn(on)}>
            {t}
            <span style={{ minWidth: 20, height: 20, padding: '0 6px', boxSizing: 'border-box', borderRadius: 999, fontSize: 11, fontWeight: 600, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              background: isWarn ? 'var(--warn-bg)' : on ? 'rgba(255,255,255,.18)' : 'var(--surface)', color: isWarn ? 'var(--warn)' : on ? 'inherit' : 'var(--ink-2)' }}>{counts[k]}</span>
          </button>
        );
      })}
    </div>
  );
}

const card: CSSProperties = { padding: 0, overflow: 'visible' };
const body: CSSProperties = { borderTop: rowLine, padding: '4px 20px 8px' };
const smallAction = 'pd-btn sm';
const whoCol: CSSProperties = { width: 136, flex: 'none', display: 'flex' };
const whenCol: CSSProperties = { width: 120, flex: 'none', display: 'flex' };

/** A Google Maps link to an office's point (Time Office). */
const officeMap = (o: Pick<OfficeDTO, 'latitude' | 'longitude'>) => `https://www.google.com/maps/search/?api=1&query=${o.latitude},${o.longitude}`;

export function OnboardingDesign({ id, onBack }: { id: string; onBack: () => void }) {
  const { flash, setView, emps } = useStore();
  const company = useCompanyName();
  const [saved, setSaved] = useState<TemplateDesign | null>(null);
  const [d, setD] = useState<TemplateDesign | null>(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [saving, setSaving] = useState(false);
  const [letters, setLetters] = useState<LetterTemplateDTO[] | null>(null);
  const [preOpen, setPreOpen] = useState(false);
  const [onbOpen, setOnbOpen] = useState(false);
  const [probOpen, setProbOpen] = useState(false);
  const [teamOpen, setTeamOpen] = useState(false);
  const [cat, setCat] = useState<Cat>('tasks');
  const [tcat, setTcat] = useState<TCat>('manager');
  const [groups, setGroups] = useState<Record<string, boolean>>({});
  const [wlOpen, setWlOpen] = useState(false);
  const [profileInfo, setProfileInfo] = useState(false);
  const [panel, setPanel] = useState<null | 'offer' | 'report'>(null);
  // A watch-list video, image or PDF opened from its tile's Preview.
  const [previewing, setPreviewing] = useState<{ title: string; media: DesignMedia } | null>(null);
  const [rep, setRep] = useState<TemplateDesign['preboarding']['reporting'] | null>(null);
  const [repTime, setRepTime] = useState('');
  // The company's offices (Time Office), so the reporting place can be one of them with its map.
  const [offices, setOffices] = useState<OfficeDTO[] | null>(null);
  useEffect(() => {
    if (panel !== 'report' || offices) return;
    getOffices().then(setOffices).catch(() => setOffices([]));
  }, [panel, offices]);
  const [drawer, setDrawer] = useState<DocsDrawer | null>(null);
  const [meet, setMeet] = useState<MeetEdit | null>(null);
  const [ci, setCi] = useState<CiEdit | null>(null);
  const [story, setStory] = useState<StoryEdit | null>(null);
  const [add, setAdd] = useState<AddState | null>(null);
  const [probBox, setProbBox] = useState(false);
  const [tt, setTt] = useState<TeamEdit | null>(null);
  const [preview, setPreview] = useState(false);
  const [pvStage, setPvStage] = useState<DesignStage>('d1');
  const [pv, setPv] = useState<TemplatePreview | null>(null);
  const pvError = '';

  useEffect(() => {
    let live = true;
    setError('');
    getTemplateDesign(id).then((t) => { if (live) { setSaved(t); setD(structuredClone(t)); } }).catch((e) => { if (live) setError(errText(e, 'Could not load the template')); });
    return () => { live = false; };
  }, [id, attempt]);
  useEffect(() => { listLetterTemplates().then(setLetters).catch(() => setLetters([])); }, []);
  // The preview follows the editor as it is now, saved or not (canvas: switch to 3 months and the phone shows Month 1–3).
  useEffect(() => { if (preview && d) setPv(previewOf(d, pvStage)); }, [preview, pvStage, d]);

  const dirty = useMemo(() => Boolean(saved && d && JSON.stringify(saved) !== JSON.stringify(d)), [saved, d]);
  // Its own back arrow and links ask once; the sidebar (any other page change) and a reload ask through the guard.
  const leaving = useRef(false);
  const leave = (go: () => void) => { if (!dirty || window.confirm('Leave without saving your changes?')) { leaving.current = true; go(); leaving.current = false; } };
  useEffect(() => {
    if (!dirty) return undefined;
    setLeaveGuard(() => leaving.current || window.confirm('Leave without saving your changes?'));
    const onUnload = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', onUnload);
    return () => { setLeaveGuard(null); window.removeEventListener('beforeunload', onUnload); };
  }, [dirty]);
  usePageHead({ title: d?.name ?? 'Onboarding template', eyebrow: 'Setup / Employee lifecycle / Onboarding templates', onBack: () => leave(onBack), backLabel: 'All templates', tag: saved?.isDefault ? 'Default' : undefined });

  const people = useMemo(() => emps.filter((e) => !e.exit?.left).map((e) => ({ id: e.id, name: e.name, dept: `${e.team} ${e.role}` })).sort((a, b) => a.name.localeCompare(b.name)), [emps]);
  // The canvas lists HR people for the HR tasks and IT/admin people for IT's; everyone when the company has none on record.
  const teamOf = (re: RegExp, current?: string) => {
    const mine = people.filter((p) => re.test(p.dept) || p.id === current);
    return (mine.some((p) => p.id !== current) ? mine : people).map(({ id, name }) => ({ id, name }));
  };

  if (!d) {
    return <section className="pd-card"><ListPending state={error ? 'error' : 'loading'} errorText={error} onRetry={() => setAttempt((n) => n + 1)} rows={6} cols={3} avatar={false} /></section>;
  }

  const months = d.probation.months;
  const sn = (s: DesignStage) => stageName(s, months);
  const up = (fn: (x: TemplateDesign) => TemplateDesign) => setD((x) => (x ? fn(x) : x));
  const removed = (t: string) => flash(`Removed “${t}”`);
  const toggleGroup = (key: string) => setGroups((g) => ({ ...g, [key]: !g[key] }));

  const save = async () => {
    setSaving(true);
    try {
      const next = await saveTemplateDesign(id, forSave(d));
      setSaved(next); setD(structuredClone(next));
      flash('Saved. New joiners get this from now on.');
    } catch (e) { flash(errText(e, 'Could not save the template'), 'error'); } finally { setSaving(false); }
  };

  // —— Lookups ——
  const letterList = letters ?? [];
  const offerTemplate = letterList.filter((l) => l.kind === 'offer').sort((a, b) => Number(b.isDefault) - Number(a.isDefault))[0];
  const appointmentTemplate = letterList.filter((l) => l.kind === 'appointment').sort((a, b) => Number(b.isDefault) - Number(a.isDefault))[0];
  const signDocs = [
    { id: 'appointment', t: 'Appointment letter', m: 'Made from the accepted offer', body: appointmentTemplate?.body ?? '' },
    ...letterList.filter((l) => l.kind === 'nda').map((l) => ({ id: l.id, t: l.name, m: 'From Document templates', body: l.body })),
  ];
  const docName = (docId: string) => signDocs.find((x) => x.id === docId)?.t;
  const toUpload = [...d.watch, ...d.trainings].filter((w) => w.media.type !== 'text' && !w.media.fileId).length;

  // —— Pre-boarding ——
  const pr = d.preboarding.rows;
  const setRow = (key: keyof typeof pr, on: boolean) => up((x) => ({ ...x, preboarding: { ...x.preboarding, rows: { ...x.preboarding.rows, [key]: on } } }));
  const preRows: Array<{ key: keyof typeof pr; node: (last: boolean) => ReactNode }> = [];
  const titleBtn = (t: string, onClick: () => void) => (
    <button type="button" onClick={onClick} style={{ flex: 1, minWidth: 0, border: 0, background: 'transparent', padding: 0, fontFamily: 'inherit', textAlign: 'left', cursor: 'pointer', color: 'var(--ink)', fontSize: 13.5, fontWeight: 500 }}>{t}</button>
  );
  if (pr.offerLetter) preRows.push({ key: 'offerLetter', node: (last) => (
    <ItemRow icon={GLYPH.ack} title="Offer letter" titleNode={titleBtn('Offer letter', () => setPanel('offer'))} last={last} onRemove={() => { setRow('offerLetter', false); removed('Offer letter'); }}>
      <button type="button" onClick={() => setPanel('offer')} aria-label="Open Offer letter" style={{ width: 28, height: 28, border: 0, background: 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', padding: 0 }}><Glyph d={GLYPH.chevron} size={16} color="var(--ink-3)" /></button>
    </ItemRow>
  ) });
  if (pr.joiningDetails) preRows.push({ key: 'joiningDetails', node: (last) => (
    <ItemRow icon={GLYPH.meet} title="Joining and reporting details" titleNode={titleBtn('Joining and reporting details', () => { setRep({ ...d.preboarding.reporting }); setRepTime(ampm(d.preboarding.reporting.time)); setPanel('report'); })} last={last}
      onRemove={() => { setRow('joiningDetails', false); removed('Joining and reporting details'); }}>
      <button type="button" className={smallAction} onClick={() => { setRep({ ...d.preboarding.reporting }); setRepTime(ampm(d.preboarding.reporting.time)); setPanel('report'); }}>Edit</button>
    </ItemRow>
  ) });
  if (pr.profile) preRows.push({ key: 'profile', node: (last) => (
    <ItemRow icon={GLYPH.profile} title="Employee profile" last={last} onRemove={() => { setRow('profile', false); removed('Employee profile'); }}
      titleNode={(
        <span style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 8, position: 'relative' }}>
          <span style={{ fontSize: 13.5, fontWeight: 500 }}>Employee profile</span>
          <InfoToggle label="About Employee profile" open={profileInfo} onToggle={() => setProfileInfo(!profileInfo)} />
          {profileInfo && <InfoNote floating>Opens as soon as the offer is accepted. The employee or HR can fill it in. There’s no due date: it doesn’t have to be done before the joining day, and it stays open in the app after joining.</InfoNote>}
        </span>
      )} />
  ) });
  if (pr.watch) preRows.push({ key: 'watch', node: (last) => (
    <ItemRow icon={GLYPH.video} title="Watch list" titleNode={titleBtn('Watch list', () => setWlOpen(!wlOpen))} last={last && !wlOpen} onRemove={() => { setRow('watch', false); setWlOpen(false); removed('Watch list'); }}>
      <button type="button" className={smallAction} onClick={() => setWlOpen(!wlOpen)}>Edit</button>
    </ItemRow>
  ) });

  // —— Onboarding tabs ——
  const counts: Record<Cat, string> = {
    meet: String(d.meetings.length), tasks: String(d.tasks.length), feedback: String(d.checkins.length), tour: String(d.tour.length),
    watch: toUpload ? `${toUpload} to upload` : String(d.watch.length + d.trainings.length), access: String(d.accesses.length),
  };
  const removeAt = <K extends 'meetings' | 'tasks' | 'checkins' | 'accesses'>(key: K, i: number, t: string) => { up((x) => ({ ...x, [key]: (x[key] as unknown[]).filter((_, n) => n !== i) })); removed(t); };
  const openMeet = (i: number) => { const m = d.meetings[i]; setMeet({ index: i, title: m.title, meetWith: m.meetWith, stage: m.stage, agenda: [...m.agenda], info: false }); };
  const openCi = (i: number | null) => {
    if (i === null) { setCi({ index: null, title: '', stage: 'm1', questions: [{ text: '', type: 'long' }], info: false }); return; }
    const c = d.checkins[i];
    setCi({ index: i, title: c.title, stage: c.stage, questions: c.questions.map((q) => ({ ...q })), info: false });
  };
  const openStory = (list: StoryList, index: number | null) => {
    const items = list === 'pre' ? d.preboarding.videos : list === 'watch' ? d.watch : d.trainings;
    if (index === null) { setStory({ list, index: null, title: '', stage: list === 'pre' ? 'pre' : list === 'training' ? 'w1' : 'd1', media: { type: 'video' } }); return; }
    const it = items[index];
    setStory({ list, index, title: it.title, stage: it.stage, media: { ...it.media } });
  };
  const newAdd = (kind: AddKind | null, extra: Partial<AddState> = {}): AddState => ({
    kind, pickFrom: kind === null, name: '', link: '', meetWith: 'hr', accessRole: 'it', stage: kind === 'access' ? 'w1' : 'd1', agenda: ['', '', ''], fields: [{ text: '', type: 'short' }], ...extra,
  });

  const lastFlags = <T,>(list: T[]) => list.map((x, i) => [x, i === list.length - 1] as const);
  const groupBlock = <T,>(key: string, title: string, items: T[], render: (item: T, last: boolean) => ReactNode, isLastGroup: boolean) => {
    if (!items.length) return null;
    const open = Boolean(groups[key]);
    return (
      <div key={key}>
        <GroupHead title={title} count={items.length} open={open} onToggle={() => toggleGroup(key)} last={isLastGroup && !open} />
        {open && items.map((it, i) => render(it, isLastGroup && i === items.length - 1))}
      </div>
    );
  };

  const meetRows = () => {
    const list = byStage(d.meetings.map((m, i) => ({ m, i, stage: m.stage }))).filter((x) => !x.m.everyMonth);
    const used = STAGES.filter((s) => list.some((x) => x.m.stage === s));
    return used.map((s, gi) => groupBlock(`meet:${s}`, stageOrBefore(s, months), list.filter((x) => x.m.stage === s), ({ m, i }, last) => (
      <ItemRow key={m.id ?? i} icon={GLYPH.meet} title={m.title} onOpen={() => openMeet(i)} indent last={last} onRemove={() => removeAt('meetings', i, m.title)}>
        <span style={whoCol}><span style={whoChip(m.meetWith)}>{MEET_LABEL[m.meetWith]}</span></span>
        <button type="button" className={smallAction} style={smallBtn} onClick={() => openMeet(i)}>Agenda</button>
      </ItemRow>
    ), gi === used.length - 1));
  };
  const taskRows = () => {
    const list = byStage(d.tasks.map((t, i) => ({ t, i, stage: t.stage })));
    const used = TASK_GROUPS.filter(([k]) => list.some((x) => x.t.type === k));
    return used.map(([k, h], gi) => groupBlock(`tasks:${k}`, h, list.filter((x) => x.t.type === k), ({ t, i }, last) => (
      <ItemRow key={t.id ?? i} icon={TASK_GLYPH[t.type]} title={t.title} indent last={last} onRemove={() => removeAt('tasks', i, t.title)}
        titleNode={t.type === 'sign' ? (
          <button type="button" aria-label="Choose documents to sign" onClick={() => setDrawer({ index: i, sel: t.signDocs?.[0] ?? 'appointment', pick: [...(t.signDocs ?? [])] })}
            style={{ flex: 1, minWidth: 0, border: 0, background: 'transparent', padding: 0, display: 'flex', flexDirection: 'column', gap: 6, fontFamily: 'inherit', textAlign: 'left', cursor: 'pointer', color: 'var(--ink)' }}>
            <span style={{ fontSize: 13.5, fontWeight: 500 }}>{t.title}</span>
            <span style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {(t.signDocs ?? []).map((x) => docName(x)).filter(Boolean).map((n) => (
                <span key={n} style={{ height: 26, padding: '0 10px', borderRadius: 8, background: 'var(--surface-2)', border: rowLine, fontSize: 12, fontWeight: 500, display: 'flex', alignItems: 'center', gap: 6 }}><Glyph d={GLYPH.doc} size={13} />{n}</span>
              ))}
            </span>
          </button>
        ) : undefined}>
        <span style={whenCol}><span style={chip}>{sn(t.stage)}</span></span>
      </ItemRow>
    ), gi === used.length - 1));
  };
  const keyMeetings = d.meetings.map((m, i) => ({ m, i })).filter((x) => x.m.everyMonth);

  const catBody = (): ReactNode => {
    if (cat === 'watch') {
      return (
        <div style={{ padding: '0 20px 6px' }}>
          <div style={{ paddingTop: 16, fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>Watch list</div>
          <TileStrip items={byStage(d.watch.map((w, index) => ({ ...w, index })))} addLabel="Add to watch list" onAdd={() => openStory('watch', null)} onOpen={(i) => openStory('watch', i)} whenOf={sn} onPreview={(i) => setPreviewing(d.watch[i])} />
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>Trainings</div>
          <TileStrip items={byStage(d.trainings.map((w, index) => ({ ...w, index })))} addLabel="Add a training" onAdd={() => openStory('training', null)} onOpen={(i) => openStory('training', i)} whenOf={sn} onPreview={(i) => setPreviewing(d.trainings[i])} />
        </div>
      );
    }
    let rows: ReactNode = null;
    if (cat === 'meet') rows = meetRows();
    if (cat === 'tasks') rows = taskRows();
    if (cat === 'feedback') rows = lastFlags(byStage(d.checkins.map((c, i) => ({ c, i, stage: c.stage })))).map(([{ c, i }, last]) => (
      <ItemRow key={c.id ?? i} icon={GLYPH.survey} title={c.title} onOpen={() => openCi(i)} last={last} onRemove={() => removeAt('checkins', i, c.title)}>
        <span style={whenCol}><span style={chip}>{checkinWhen(c.stage, months)}</span></span>
        <button type="button" className={smallAction} style={smallBtn} onClick={() => openCi(i)}>Questions</button>
      </ItemRow>
    ));
    if (cat === 'tour') rows = lastFlags(TOUR.filter(([k]) => d.tour.includes(k))).map(([[k, t, when], last]) => (
      <ItemRow key={k} icon={GLYPH.tour} title={t} last={last} onRemove={() => { up((x) => ({ ...x, tour: x.tour.filter((l) => l !== k) })); removed(t); }}>
        <span style={whenCol}><span style={chip}>{when}</span></span>
      </ItemRow>
    ));
    if (cat === 'access') rows = lastFlags(d.accesses).map(([a, last], i) => (
      <ItemRow key={a.id ?? i} icon={GLYPH.access} title={a.title} last={last} onRemove={() => removeAt('accesses', i, a.title)}>
        <span style={whoCol}><span style={whoChip(a.role)}>{ROLE_LABEL[a.role]}</span></span>
        <span style={whenCol}><span style={chip}>By end of Week 1</span></span>
      </ItemRow>
    ));
    return <div style={{ padding: '6px 20px 8px' }}>{rows}</div>;
  };
  const catAdd = () => {
    if (cat === 'meet') setAdd(newAdd('meet'));
    else if (cat === 'tasks') setAdd(newAdd(null));
    else if (cat === 'feedback') openCi(null);
    else if (cat === 'access') setAdd(newAdd('access'));
  };

  // —— The team's part ——
  const teamItems = (tab: TCat): TeamItem[] => {
    const roles: TeamRole[] = tab === 'lead' ? ['senior', 'head_of_department'] : [tab];
    const list: TeamItem[] = d.team.tasks.map((t, i) => ({ kind: 'team' as const, index: i, title: t.title, stage: t.stage, role: t.role })).filter((x) => roles.includes(x.role));
    if (tab === 'hr' || tab === 'it') list.push(...d.accesses.map((a, i) => ({ kind: 'access' as const, index: i, title: a.title, stage: 'w1' as DesignStage, role: a.role })).filter((x) => x.role === tab));
    return list.sort((a, b) => STAGES.indexOf(a.stage) - STAGES.indexOf(b.stage));
  };
  const tcounts = Object.fromEntries(TCATS.map(([k]) => [k, String(teamItems(k).length)])) as Record<TCat, string>;
  const items = teamItems(tcat);
  const usedStages = STAGES.filter((s) => items.some((x) => x.stage === s));
  const openTt = (x: TeamItem) => setTt({ kind: x.kind, index: x.index, title: x.title, stage: x.stage, how: x.kind === 'team' ? d.team.tasks[x.index].how ?? '' : '', info: false, who: tcat === 'lead' ? 'Leadership' : TCATS.find(([k]) => k === tcat)![1] });
  const removeTeamItem = (x: TeamItem) => {
    if (x.kind === 'team') up((v) => ({ ...v, team: { ...v.team, tasks: v.team.tasks.filter((_, n) => n !== x.index) } }));
    else up((v) => ({ ...v, accesses: v.accesses.filter((_, n) => n !== x.index) }));
    removed(x.title);
  };
  const assignees = d.team.assignees;
  const setAssignee = (key: 'hrUserId' | 'itUserId' | 'seniorUserId', v: string) => up((x) => ({ ...x, team: { ...x.team, assignees: { ...x.team.assignees, [key]: v || undefined } } }));
  const whoRow = (): ReactNode => {
    if (tcat === 'manager') return <><span style={{ flex: 1, fontSize: 13, fontWeight: 500, color: 'var(--ink-2)' }}>Who is the manager</span><span style={{ fontSize: 13, fontWeight: 500 }}>From each joiner’s offer</span></>;
    if (tcat === 'buddy') return <><span style={{ flex: 1, fontSize: 13, fontWeight: 500, color: 'var(--ink-2)' }}>Who is the buddy</span><span style={{ fontSize: 13, fontWeight: 500 }}>Picked by the manager</span></>;
    const [key, label, opts, ph] = tcat === 'hr' ? ['hrUserId', 'Who does the HR tasks', teamOf(/\b(hr|human resources?|people|payroll)\b/i, assignees.hrUserId), 'Choose someone'] as const
      : tcat === 'it' ? ['itUserId', 'Who does the IT & admin tasks', teamOf(/\b(it|admin|administration|information technology|systems?)\b/i, assignees.itUserId), 'Choose someone'] as const
        : ['seniorUserId', 'Who counts as someone senior', [{ id: '', name: 'Head of department' }, ...people.map(({ id, name }) => ({ id, name }))], ''] as const;
    return <><span style={{ flex: 1, fontSize: 13, fontWeight: 500, color: 'var(--ink-2)' }}>{label}</span><NameDropdown label={label} value={assignees[key] ?? ''} options={opts} placeholder={ph} onPick={(v) => setAssignee(key, v)} /></>;
  };

  return (
    <div style={{ display: 'grid', gap: 14, maxWidth: 1180 }}>
      <PageActions>
        <button type="button" className={btnClass()} style={btn()} onClick={() => setPreview(true)}><IconEye size={16} stroke="currentColor" />Employee preview</button>
        <button type="button" className={btnClass()} style={btn()} onClick={() => void save()} disabled={saving}>{saving ? 'Saving…' : 'Save template'}</button>
      </PageActions>

      {/* Pre-boarding */}
      <section className="pd-card" style={card}>
        <SectionHead tone="pre" title="Pre-boarding" sub="From the offer to the joining day. The employee opens it from a link, then in the app until their app access is created." open={preOpen} onToggle={() => setPreOpen(!preOpen)} />
        {preOpen && (
          <div style={body}>
            {preRows.map((r, i) => <div key={r.key}>{r.node(i === preRows.length - 1)}</div>)}
            {wlOpen && pr.watch && (
              <div style={{ marginLeft: 44 }}>
                <TileStrip items={d.preboarding.videos} addLabel="Add to watch list" onAdd={() => openStory('pre', null)} onOpen={(i) => openStory('pre', i)} onPreview={(i) => setPreviewing(d.preboarding.videos[i])} />
              </div>
            )}
          </div>
        )}
      </section>

      {/* Onboarding */}
      <section className="pd-card" style={card}>
        <SectionHead tone="onb" title="Onboarding" sub="From the joining day to the end of probation, in the app." open={onbOpen} onToggle={() => setOnbOpen(!onbOpen)} />
        {onbOpen && (
          <div style={{ borderTop: rowLine }}>
            <div style={{ padding: '14px 20px 0' }}>
              <Tabs label="Categories" tabs={CATS} active={cat} onPick={setCat} counts={counts} warn={toUpload ? 'watch' : null} />
            </div>
            {catBody()}
            {cat === 'meet' && keyMeetings.map(({ m, i }) => (
              <div key={m.id ?? i} style={{ padding: '4px 20px 12px' }}>
                <div style={{ position: 'relative', border: '1.5px solid var(--ink)', borderRadius: 16, padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 14 }}>
                  <span style={{ width: 40, height: 40, borderRadius: 12, background: 'var(--t-peach)', color: 'var(--t-peach-i)', display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}><Glyph d={GLYPH.target} size={20} /></span>
                  <span style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 15, fontWeight: 600 }}>{m.title}</span>
                    <span style={{ ...chip, height: 22, borderRadius: 999, background: 'var(--t-peach)', color: 'var(--t-peach-i)' }}>Most important</span>
                  </span>
                  <span style={whoCol}><span style={whoChip(m.meetWith)}>{MEET_LABEL[m.meetWith]}</span></span>
                  <span style={whenCol}><span style={chip}>Every month</span></span>
                  <button type="button" onClick={() => openMeet(i)} aria-label={`Open ${m.title}`} style={{ position: 'absolute', inset: 0, zIndex: 1, border: 0, background: 'transparent', padding: 0, cursor: 'pointer', borderRadius: 16 }} />
                  <button type="button" className={smallAction} style={smallBtn} onClick={() => openMeet(i)}>Agenda</button>
                  <RemoveButton label={m.title} onClick={() => removeAt('meetings', i, m.title)} />
                </div>
              </div>
            ))}
            {cat !== 'watch' && cat !== 'tour' && (
              <div style={{ padding: '12px 20px 16px', borderTop: rowLine }}><button type="button" style={addBtn} onClick={catAdd}>+ Add</button></div>
            )}
          </div>
        )}
      </section>

      {/* Probation */}
      <section className="pd-card" style={card}>
        <SectionHead tone="prob" title="Probation" sub="How long it lasts, and the template they’re on until they’re confirmed." open={probOpen} onToggle={() => setProbOpen(!probOpen)} />
        {probOpen && (
          <div style={body}>
            <div style={{ minHeight: 60, padding: '10px 0', borderBottom: rowLine, display: 'flex', alignItems: 'center', gap: 12 }}>
              <span style={{ flex: 1, fontSize: 13.5, fontWeight: 500 }}>Length</span>
              <RadioPills<'3' | '6'> label="Probation length" look="seg" options={[['3', '3 months'], ['6', '6 months']]} value={String(months) as '3' | '6'} onPick={(v) => up((x) => ({ ...x, probation: { ...x.probation, months: v === '3' ? 3 : 6 } }))} />
            </div>
            <div style={{ minHeight: 60, padding: '10px 0', display: 'flex', alignItems: 'center', gap: 12 }}>
              <span style={{ flex: 1, fontSize: 13.5, fontWeight: 500 }}>Probation template</span>
              <button type="button" className={smallAction} onClick={() => setProbBox(true)}>Edit</button>
            </div>
          </div>
        )}
      </section>

      {/* The team's part */}
      <section className="pd-card" style={card}>
        <SectionHead tone="team" title="The team’s part" sub="What the manager, buddy, HR and IT do. They see it in Teams › Joiners." open={teamOpen} onToggle={() => setTeamOpen(!teamOpen)} />
        {teamOpen && (
          <div style={{ borderTop: rowLine }}>
            <div style={{ padding: '6px 20px 8px', borderBottom: rowLine }}>
              <div style={{ minHeight: 56, display: 'flex', alignItems: 'center', gap: 12 }}>
                <span style={{ flex: 1, fontSize: 13.5, fontWeight: 500 }}>Remind teammates when a task is late</span>
                <button type="button" role="switch" aria-checked={d.team.remindLate} aria-label="Remind teammates when a task is late" onClick={() => up((x) => ({ ...x, team: { ...x.team, remindLate: !x.team.remindLate } }))}
                  style={{ width: 44, height: 26, borderRadius: 999, border: 0, padding: 3, cursor: 'pointer', display: 'flex', flex: 'none', background: d.team.remindLate ? 'var(--accent)' : 'var(--line-2)', justifyContent: d.team.remindLate ? 'flex-end' : 'flex-start', transition: 'background .15s' }}>
                  <span style={{ width: 20, height: 20, borderRadius: '50%', background: '#fff', boxShadow: '0 1px 3px rgba(0,0,0,.2)' }} />
                </button>
              </div>
            </div>
            <div style={{ padding: '14px 20px 0' }}><Tabs label="Team" tabs={TCATS} active={tcat} onPick={setTcat} counts={tcounts} /></div>
            <div style={{ margin: '10px 20px 0', minHeight: 56, padding: '0 14px', borderRadius: 14, background: 'var(--surface-2)', display: 'flex', alignItems: 'center', gap: 12, position: 'relative' }}>{whoRow()}</div>
            <div style={{ padding: '6px 20px 8px' }}>
              {usedStages.map((s, gi) => groupBlock(`team:${tcat}:${s}`, stageOrBefore(s, months), items.filter((x) => x.stage === s), (x, last) => (
                <ItemRow key={`${x.kind}:${x.index}`} icon={x.kind === 'access' ? GLYPH.access : x.role === 'buddy' ? GLYPH.help : GLYPH.task} title={x.title} onOpen={() => openTt(x)} openLabel={`Edit ${x.title}`} indent last={last} chevron
                  onRemove={() => removeTeamItem(x)}>
                  {tcat === 'lead' && <span style={whoCol}><span style={whoChip(x.role)}>{ROLE_LABEL[x.role]}</span></span>}
                </ItemRow>
              ), gi === usedStages.length - 1))}
            </div>
            <div style={{ padding: '12px 20px 16px', borderTop: rowLine }}>
              <button type="button" style={addBtn} onClick={() => setAdd(newAdd('team', { role: tcat === 'lead' ? 'senior' : tcat, stage: 'd1' }))}>+ Add</button>
            </div>
          </div>
        )}
      </section>

      {panel === 'offer' && (
        <SidePanel title="Offer letter" sub="This is what the employee sees in pre-boarding. Their details fill in from the offer you create." width={680} onClose={() => setPanel(null)}
          footer={<>
            <span style={{ flex: 1, fontSize: 12.5, color: 'var(--ink-2)', lineHeight: 1.5 }}>To change the wording, edit it in <b style={{ fontWeight: 600 }}>Setup › Employee lifecycle › Document templates</b>.</span>
            <button type="button" className="pd-btn" onClick={() => leave(() => { setPanel(null); setView('lifecycle_letter_templates'); })}>Open Document templates</button>
          </>}>
          {offerTemplate ? <LetterPreview company={company} title={LETTER_TITLE.offer} bodyHtml={labelledBody(offerTemplate.body, { companyName: company, company })} /> : !letters ? <SkeletonLines lines={8} /> : null}
          <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>Highlighted words come from the offer created for each joiner.</span>
        </SidePanel>
      )}

      {previewing && (
        <Modal title={previewing.title} width={560} onClose={() => setPreviewing(null)}
          footer={<button type="button" className="pd-btn" onClick={() => setPreviewing(null)}>Close</button>}>
          <MediaPlayer key={previewing.media.fileId} media={previewing.media} w="100%" h="min(70vh, 620px)" autoLoad />
        </Modal>
      )}

      {panel === 'report' && rep && (
        <SidePanel title="Joining and reporting details" sub="Set these once. Every joiner on this template sees them; the joining date comes from each joiner’s offer." width={560} onClose={() => { setPanel(null); setRep(null); }}
          footer={<>
            <button type="button" className="pd-btn" onClick={() => { setPanel(null); setRep(null); }}>Cancel</button>
            <button type="button" className="pd-btn primary" onClick={() => {
              const time = repTime.trim() ? parseTime(repTime) : undefined;
              if (time === null) { flash('Write the reporting time like 9:30 AM', 'error'); return; }
              if (rep.mapLink && !/^https:\/\/\S+$/i.test(rep.mapLink)) { flash('The maps link is a web address starting with https://', 'error'); return; }
              up((x) => ({ ...x, preboarding: { ...x.preboarding, reporting: { ...rep, time } } })); setPanel(null); setRep(null); flash('Reporting details saved');
            }}>Save details</button>
          </>}>
          <label style={fieldLabel}><span>Reporting time</span><input value={repTime} maxLength={12} onChange={(e) => setRepTime(e.target.value)} placeholder="e.g. 9:30 AM" style={inputStyle} /></label>
          <label style={fieldLabel}><span>Office</span>
            <select value={offices?.find((o) => rep.mapLink === officeMap(o))?.id ?? ''} disabled={!offices?.length} style={inputStyle}
              onChange={(e) => {
                const o = offices?.find((x) => x.id === e.target.value);
                if (!o) { setRep({ ...rep, mapLink: undefined }); return; }
                const here = `${o.name}${o.city ? `, ${o.city}` : ''}`;
                setRep({ ...rep, place: rep.place?.trim() ? rep.place : here, mapLink: officeMap(o) });
              }}>
              <option value="">{offices === null ? 'Loading offices…' : offices.length ? 'Somewhere else' : 'No offices set up in Time Office'}</option>
              {offices?.map((o) => <option key={o.id} value={o.id}>{o.name}{o.city ? `, ${o.city}` : ''}</option>)}
            </select>
            <span style={{ fontSize: 11.5, color: 'var(--ink-3)' }}>Pick one of your offices to add its map. The employee gets directions on their Day-1 pass.</span>
          </label>
          <label style={fieldLabel}><span>Where to report</span><input value={rep.place ?? ''} maxLength={200} onChange={(e) => setRep({ ...rep, place: e.target.value })} placeholder="e.g. Reception, Pune office, 2nd floor" style={inputStyle} /></label>
          <label style={fieldLabel}><span>Maps link (optional)</span>
            <input value={rep.mapLink ?? ''} maxLength={500} inputMode="url" onChange={(e) => setRep({ ...rep, mapLink: e.target.value.trim() || undefined })} placeholder="e.g. https://maps.app.goo.gl/…" style={inputStyle} />
            <span style={{ fontSize: 11.5, color: 'var(--ink-3)' }}>
              {rep.mapLink ? <a href={rep.mapLink} target="_blank" rel="noopener noreferrer">Check the link</a> : 'Paste a Google Maps link, or pick an office above. Without one, directions search for the place.'}
            </span>
          </label>
          <label style={fieldLabel}><span>What to bring</span><input value={rep.bring ?? ''} maxLength={300} onChange={(e) => setRep({ ...rep, bring: e.target.value })} placeholder="e.g. Original ID, address proof, two photos" style={inputStyle} /></label>
          <label style={fieldLabel}><span>Anything else</span><input value={rep.notes ?? ''} maxLength={300} onChange={(e) => setRep({ ...rep, notes: e.target.value })} placeholder="e.g. Business casual. Parking at Gate 2." style={inputStyle} /></label>
          <Block label="Who meets them">
            <RadioPills<'hr' | 'manager' | 'buddy'> label="Who meets them" look="who" options={[['hr', 'HR'], ['manager', 'Manager'], ['buddy', 'Buddy']]} value={rep.meets} onPick={(v) => setRep({ ...rep, meets: v })} />
            <span style={{ fontSize: 11.5, color: 'var(--ink-3)' }}>The employee sees their name, photo and phone number.</span>
          </Block>
        </SidePanel>
      )}

      {drawer && (() => {
        const shown = signDocs.find((x) => x.id === drawer.sel) ?? signDocs[0];
        const n = drawer.pick.length;
        return (
          <SidePanel title="Documents to sign" sub="Pick what the employee signs in the app on Day 1. They come from Document templates and fill in their details." width={820} onClose={() => setDrawer(null)}
            footer={<>
              <span style={{ flex: 1, fontSize: 12.5, color: 'var(--ink-2)' }}>{n ? `${n} ${n === 1 ? 'document' : 'documents'} for the employee to sign` : 'Nothing selected yet'}</span>
              <button type="button" className="pd-btn" onClick={() => setDrawer(null)}>Cancel</button>
              <button type="button" className="pd-btn primary" onClick={() => {
                up((x) => ({ ...x, tasks: x.tasks.map((t, i) => (i === drawer.index ? { ...t, signDocs: [...drawer.pick] } : t)) }));
                setDrawer(null); flash(`${n} ${n === 1 ? 'document' : 'documents'} to sign`);
              }}>Done</button>
            </>}>
            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(220px, 280px) minmax(0, 1fr)', gap: 18, alignItems: 'start' }}>
              <div style={{ display: 'grid', gap: 8 }}>
                {signDocs.map((x) => {
                  const on = drawer.pick.includes(x.id);
                  const seen = drawer.sel === x.id;
                  return (
                    <div key={x.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 12, border: seen ? '1.5px solid var(--accent)' : rowLine, background: seen ? 'var(--accent-soft)' : 'var(--surface)' }}>
                      <button type="button" role="checkbox" aria-checked={on} aria-label={`Include ${x.t}`}
                        onClick={() => setDrawer({ ...drawer, sel: x.id, pick: on ? drawer.pick.filter((p) => p !== x.id) : [...drawer.pick, x.id] })}
                        style={{ width: 20, height: 20, borderRadius: 6, border: on ? 0 : '2px solid var(--line-2)', background: on ? 'var(--accent)' : 'var(--surface)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', padding: 0, flex: 'none' }}>
                        {on && <Glyph d="M5 12.5l4.5 4.5L19 6.5" size={13} color="#fff" width={2.6} />}
                      </button>
                      <button type="button" onClick={() => setDrawer({ ...drawer, sel: x.id })} style={{ flex: 1, minWidth: 0, border: 0, background: 'transparent', padding: 0, fontFamily: 'inherit', textAlign: 'left', cursor: 'pointer', color: 'var(--ink)', display: 'grid', gap: 2 }}>
                        <span style={{ fontSize: 13.5, fontWeight: 500 }}>{x.t}</span>
                        <span style={{ fontSize: 11.5, color: 'var(--ink-3)' }}>{x.m}</span>
                      </button>
                    </div>
                  );
                })}
                <button type="button" className="pd-btn ghost sm" style={ADD_LINE} onClick={() => leave(() => { setDrawer(null); setView('lifecycle_letter_templates'); })}>Manage in Document templates →</button>
              </div>
              <div style={{ display: 'grid', gap: 10, minWidth: 0 }}>
                <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: '.08em', color: 'var(--ink-3)' }}>PREVIEW · {shown.t.toUpperCase()}</span>
                <LetterPreview company={company} title={shown.t} bodyHtml={labelledBody(shown.body, { companyName: company, company })} signature />
                <span style={{ fontSize: 12, color: 'var(--ink-3)', lineHeight: 1.5 }}>Highlighted words fill in from the employee’s details. They sign in the app by drawing or typing their name.</span>
              </div>
            </div>
          </SidePanel>
        );
      })()}

      {meet && (
        <SidePanel title="Meeting" width={560} onClose={() => setMeet(null)}
          footer={<>
            <button type="button" className="pd-btn" onClick={() => setMeet(null)}>Cancel</button>
            <button type="button" className="pd-btn primary" onClick={() => {
              const agenda = meet.agenda.map((a) => a.trim()).filter(Boolean);
              const title = meet.title.trim();
              up((x) => ({ ...x, meetings: x.meetings.map((m, i) => (i === meet.index ? { ...m, title: title || m.title, meetWith: meet.meetWith, stage: meet.stage, agenda } : m)) }));
              setMeet(null); flash(`Saved “${title || 'meeting'}”`);
            }}>Save</button>
          </>}>
          <label style={fieldLabel}><span>Title</span><input value={meet.title} maxLength={120} onChange={(e) => setMeet({ ...meet, title: e.target.value })} style={inputStyle} /></label>
          <Block label="Meets with"><RadioPills<MeetWith> label="Meets with" options={MEET_WITH.map((w) => [w, MEET_LABEL[w]])} value={meet.meetWith} onPick={(v) => setMeet({ ...meet, meetWith: v })} /></Block>
          <Block label="When"><RadioPills<DesignStage> label="When" options={STAGES.filter((s) => s !== 'pre').map((s) => [s, sn(s)])} value={meet.stage} onPick={(v) => setMeet({ ...meet, stage: v })} /></Block>
          <Block label="Agenda" aside={<InfoToggle label="About the agenda" open={meet.info} onToggle={() => setMeet({ ...meet, info: !meet.info })} />}>
            {meet.info && <InfoNote>Both people see the agenda. In the app, the employee writes the meeting notes against each point.</InfoNote>}
            {meet.agenda.map((a, j) => (
              <div key={j} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ width: 20, fontSize: 12, color: 'var(--ink-3)', textAlign: 'right', flex: 'none' }}>{j + 1}</span>
                <input aria-label={`Agenda point ${j + 1}`} value={a} maxLength={160} placeholder="An agenda point" onChange={(e) => setMeet({ ...meet, agenda: meet.agenda.map((x, n) => (n === j ? e.target.value : x)) })} style={inputStyle} />
                <RemoveButton label={`point ${j + 1}`} cross onClick={() => setMeet({ ...meet, agenda: meet.agenda.filter((_, n) => n !== j) })} />
              </div>
            ))}
            {meet.agenda.length < 12 && <button type="button" className="pd-btn ghost sm" style={ADD_LINE} onClick={() => setMeet({ ...meet, agenda: [...meet.agenda, ''] })}>+ Add a point</button>}
          </Block>
        </SidePanel>
      )}

      {ci && (
        <SidePanel title={ci.index === null ? 'New check-in' : 'Check-in'} width={600} onClose={() => setCi(null)}
          footer={<>
            <button type="button" className="pd-btn" onClick={() => setCi(null)}>Cancel</button>
            <button type="button" className="pd-btn primary" onClick={() => {
              const questions = ci.questions.filter((q) => q.text.trim()).map(savedQuestion);
              const title = ci.title.trim() || `${sn(ci.stage)} check-in`;
              if (ci.index === null) up((x) => ({ ...x, checkins: [...x.checkins, { id: newId(), title, stage: ci.stage, questions } as DesignCheckin] }));
              else up((x) => ({ ...x, checkins: x.checkins.map((c, i) => (i === ci.index ? { ...c, title, stage: ci.stage, questions } : c)) }));
              setCi(null); flash(`Saved “${title}”`);
            }}>Save</button>
          </>}>
          <label style={fieldLabel}><span>Title</span><input value={ci.title} maxLength={120} placeholder="e.g. Week 1 check-in" onChange={(e) => setCi({ ...ci, title: e.target.value })} style={inputStyle} /></label>
          <Block label="When"><RadioPills<DesignStage> label="When" options={STAGES.filter((s) => s !== 'pre').map((s) => [s, checkinWhen(s, months)])} value={ci.stage} onPick={(v) => setCi({ ...ci, stage: v })} /></Block>
          <Block label="Questions" aside={<InfoToggle label="About the questions" open={ci.info} onToggle={() => setCi({ ...ci, info: !ci.info })} />}>
            {ci.info && <InfoNote>The employee answers these in the app. Answers go to HR and their manager. Tap an answer type to change it.</InfoNote>}
            {ci.questions.map((q, j) => (
              <div key={j} style={{ display: 'grid', gap: 6 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ width: 20, fontSize: 12, color: 'var(--ink-3)', textAlign: 'right', flex: 'none' }}>{j + 1}</span>
                <input aria-label={`Question ${j + 1}`} value={q.text} maxLength={200} placeholder="A question" onChange={(e) => setCi({ ...ci, questions: ci.questions.map((x, n) => (n === j ? { ...x, text: e.target.value } : x)) })} style={inputStyle} />
                <button type="button" className="pd-btn sm" aria-label={`Answer type: ${CHECKIN_TYPES.find(([k]) => k === q.type)?.[1]}`} style={{ flex: 'none', width: 124, height: 40, justifyContent: 'center' }}
                  onClick={() => setCi({ ...ci, questions: ci.questions.map((x, n) => (n === j ? { ...x, type: CHECKIN_TYPES[(CHECKIN_TYPES.findIndex(([k]) => k === x.type) + 1) % CHECKIN_TYPES.length][0] } : x)) })}>
                  {CHECKIN_TYPES.find(([k]) => k === q.type)?.[1]}
                </button>
                <RemoveButton label={`question ${j + 1}`} cross onClick={() => setCi({ ...ci, questions: ci.questions.filter((_, n) => n !== j) })} />
              </div>
              {q.type === 'choice' && (
                <div style={{ paddingLeft: 28 }}>
                  <ChoiceOptions n={j + 1} options={q.options} onChange={(options) => setCi({ ...ci, questions: ci.questions.map((x, n) => (n === j ? { ...x, options } : x)) })} />
                </div>
              )}
              </div>
            ))}
            {ci.questions.length < 20 && <button type="button" className="pd-btn ghost sm" style={ADD_LINE} onClick={() => setCi({ ...ci, questions: [...ci.questions, { text: '', type: 'long' }] })}>+ Add a question</button>}
          </Block>
        </SidePanel>
      )}

      {tt && (
        <SidePanel title={`${tt.who} task`} width={520} onClose={() => setTt(null)}
          footer={<>
            <button type="button" className="pd-btn" onClick={() => setTt(null)}>Cancel</button>
            <button type="button" className="pd-btn primary" onClick={() => {
              const title = tt.title.trim();
              if (!title) return;
              if (tt.kind === 'team') up((x) => ({ ...x, team: { ...x.team, tasks: x.team.tasks.map((t, i) => (i === tt.index ? { ...t, title, stage: tt.stage, how: tt.how.trim() || undefined } : t)) } }));
              else up((x) => ({ ...x, accesses: x.accesses.map((a, i) => (i === tt.index ? { ...a, title } : a)) }));
              setTt(null); flash(`Saved “${title}”`);
            }}>Save</button>
          </>}>
          <label style={fieldLabel}><span>Task</span><input value={tt.title} maxLength={120} onChange={(e) => setTt({ ...tt, title: e.target.value })} style={inputStyle} /></label>
          <Block label="When">
            {tt.kind === 'team'
              ? <RadioPills<DesignStage> label="When" options={STAGES.map((s) => [s, stageOrBefore(s, months)])} value={tt.stage} onPick={(v) => setTt({ ...tt, stage: v })} />
              : <RadioPills<DesignStage> label="When" options={[['w1', 'By end of Week 1']]} value="w1" onPick={() => undefined} />}
          </Block>
          {tt.kind === 'team' && (
            <Block label="How to do it (optional)" aside={<InfoToggle label="About how to do it" open={tt.info} onToggle={() => setTt({ ...tt, info: !tt.info })} />}>
              {tt.info && <InfoNote>One line on where or how. The teammate sees it behind an (i) on this task in their app.</InfoNote>}
              <textarea value={tt.how} maxLength={140} onChange={(e) => setTt({ ...tt, how: e.target.value })} placeholder="e.g. The kit is in the HR cupboard, second floor" style={areaStyle} />
            </Block>
          )}
        </SidePanel>
      )}

      {probBox && (
        <Modal title="Probation template" width={420} onClose={() => setProbBox(false)}
          footer={<button type="button" className="pd-btn primary" onClick={() => leave(() => { setProbBox(false); setView('shifttypes'); })}>Go to Shift templates</button>}>
          <span style={{ fontSize: 13, color: 'var(--ink-2)' }}>The probation template is set up in Shift templates.</span>
        </Modal>
      )}

      {story && <StoryDialog story={story} templateId={id} months={months} onChange={setStory} onClose={() => setStory(null)}
        onRemove={() => {
          const s = story;
          const key = s.list === 'pre' ? null : s.list === 'watch' ? 'watch' : 'trainings';
          if (key) up((x) => ({ ...x, [key]: x[key].filter((_, n) => n !== s.index) }));
          else up((x) => ({ ...x, preboarding: { ...x.preboarding, videos: x.preboarding.videos.filter((_, n) => n !== s.index) } }));
          setStory(null); removed(s.title);
        }}
        onSave={(item) => {
          const s = story;
          const put = (list: DesignWatchItem[]) => (s.index === null ? [...list, { ...item, id: newId() }] : list.map((w, n) => (n === s.index ? { ...w, ...item } : w)));
          if (s.list === 'pre') up((x) => ({ ...x, preboarding: { ...x.preboarding, videos: put(x.preboarding.videos) } }));
          else if (s.list === 'watch') up((x) => ({ ...x, watch: put(x.watch) }));
          else up((x) => ({ ...x, trainings: put(x.trainings) }));
          setStory(null); flash(s.index === null ? `Added “${item.title}”` : `Saved “${item.title}”`);
        }}
        onError={(m) => flash(m, 'error')} />}

      {add && <AddDialog add={add} months={months} templateId={id} letters={letterList} company={company} onChange={setAdd} onClose={() => setAdd(null)} onError={(m) => flash(m, 'error')}
        onAdd={(created) => {
          if (created.meeting) up((x) => ({ ...x, meetings: [...x.meetings, created.meeting!] }));
          if (created.task) up((x) => ({ ...x, tasks: [...x.tasks, created.task!] }));
          if (created.access) up((x) => ({ ...x, accesses: [...x.accesses, created.access!] }));
          if (created.team) up((x) => ({ ...x, team: { ...x.team, tasks: [...x.team.tasks, created.team!] } }));
          setAdd(null); flash(`Added “${created.title}”`);
        }} />}

      {preview && (
        <Overlay label="Employee preview" onClose={() => setPreview(false)}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div role="tablist" aria-label="Preview stage" style={{ ...SEG, background: 'var(--surface)' }}>
              {STAGES.map((s) => <button key={s} type="button" role="tab" aria-selected={s === pvStage} onClick={() => setPvStage(s)} style={segBtn(s === pvStage)}>{sn(s)}</button>)}
            </div>
            <button type="button" onClick={() => setPreview(false)} aria-label="Close preview" className="ds-icon-btn" style={{ width: 38, height: 38, borderRadius: '50%', border: 0, background: 'var(--surface)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}><Glyph d="M6 6l12 12M18 6L6 18" size={16} color="var(--ink)" /></button>
          </div>
          <Phone preview={pv} error={pvError} />
        </Overlay>
      )}
    </div>
  );
}

const fieldLabel: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 6, fontSize: 11.5, color: 'var(--ink-2)' };

/** A Document template as a page: the company and today, the title, the body with its fields highlighted; the two signatures for a document to sign. */
function LetterPreview({ company, title, bodyHtml, signature }: { company: string; title: string; bodyHtml: string; signature?: boolean }) {
  return (
    <div style={{ background: '#fff', color: '#141416', border: rowLine, borderRadius: 14, padding: '22px 24px' }}>
      <style>{LETTER_CSS}</style>
      <div className="lf-page">
        <div className="lf-head"><div className="lf-brand"><div className="lf-co"><b>{company}</b></div></div><div className="lf-ref">{longDay(todayKey())}</div></div>
        <h1 className="lf-title">{title}</h1>
        <div className="lf-body" dangerouslySetInnerHTML={{ __html: bodyHtml }} />
        {signature && (
          <div style={{ display: 'flex', gap: 16, marginTop: 18 }}>
            <span style={{ flex: 1, borderTop: '1px solid #DADADF', paddingTop: 8, fontSize: 11.5, color: '#4E4E56' }}>For {company}</span>
            <span style={{ flex: 1, display: 'grid', gap: 4 }}>
              <span style={{ height: 40, borderRadius: 8, border: '1.5px dashed #9EC5DA', background: '#F5FAFD', color: '#0571A6', fontSize: 11.5, fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>Employee signs here</span>
              <span style={{ fontSize: 11.5, color: '#4E4E56' }}>Employee</span>
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

// —— Add (Tasks' kinds, a meeting, a device or access, a teammate task) ——————————————————————

interface Created { title: string; meeting?: DesignMeeting; task?: DesignTask; access?: DesignAccess; team?: DesignTeamTask }

function AddDialog({ add, months, templateId, letters, company, onChange, onClose, onAdd, onError }: {
  add: AddState; months: 3 | 6; templateId: string; letters: LetterTemplateDTO[]; company: string;
  onChange: (a: AddState) => void; onClose: () => void; onAdd: (c: Created) => void; onError: (m: string) => void;
}) {
  const set = (patch: Partial<AddState>) => onChange({ ...add, ...patch });
  if (!add.kind) {
    return (
      <Modal title="Add to Tasks" width={600} onClose={onClose}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          {PICK_KINDS.map(([k, t, m, glyph, bg, fg]) => (
            <button key={k} type="button" onClick={() => set({ kind: k })}
              style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 8, padding: 14, borderRadius: 14, border: rowLine, background: 'var(--surface)', fontFamily: 'inherit', textAlign: 'left', cursor: 'pointer', color: 'var(--ink)' }}>
              <span style={{ width: 36, height: 36, borderRadius: 10, background: bg, color: fg, display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}><Glyph d={glyph} size={18} /></span>
              <span style={{ fontSize: 14, fontWeight: 700 }}>{t}</span>
              <span style={{ fontSize: 12, color: 'var(--ink-3)', lineHeight: 1.4 }}>{m}</span>
            </button>
          ))}
        </div>
      </Modal>
    );
  }
  const k = add.kind;
  const nameKey = k === 'team' ? (add.role === 'buddy' ? 'help' : 'do') : k;
  const [nameLabel, namePh] = NAME[nameKey];
  const isMeet = k === 'meet';
  const isAccess = k === 'access';
  const stages: Array<[DesignStage, string]> = isAccess ? [['w1', 'By end of Week 1']]
    : k === 'team' ? STAGES.map((s) => [s, stageOrBefore(s, months)]) : STAGES.filter((s) => s !== 'pre').map((s) => [s, stageName(s, months)]);

  const uploadPdf = async () => {
    const file = await pickFile('application/pdf');
    if (!file) return;
    set({ busy: true });
    try { const f = await uploadTemplateMedia(templateId, file, file.name); onChange({ ...add, busy: false, docPick: false, file: { fileId: f.id, name: f.name } }); } catch (e) { onError(errText(e, 'Could not upload the PDF')); set({ busy: false }); }
  };
  /** A Document template as the PDF they read (made here, as the dashboard makes every letter's PDF). */
  const fromDocument = async (t: LetterTemplateDTO) => {
    set({ busy: true });
    try {
      const values = { companyName: company, company };
      const blob = await htmlToPdfBlob(letterDocument(t.body, values, { company, title: t.name }), `${t.name}.pdf`);
      const f = await uploadTemplateMedia(templateId, blob, `${t.name}.pdf`);
      onChange({ ...add, busy: false, docPick: false, file: { fileId: f.id, name: t.name, letterTemplateId: t.id }, name: add.name || t.name });
    } catch (e) { onError(errText(e, 'Could not use that document')); set({ busy: false }); }
  };

  const ok = () => {
    const title = add.name.trim() || namePh.replace(/^e\.g\. /, '');
    if (isMeet) { onAdd({ title, meeting: { id: newId(), title, meetWith: add.meetWith, stage: add.stage, agenda: add.agenda.map((a) => a.trim()).filter(Boolean) } }); return; }
    if (isAccess) { onAdd({ title, access: { id: newId(), title, role: add.accessRole } }); return; }
    if (k === 'team') { onAdd({ title, team: { id: newId(), title, role: add.role ?? 'manager', stage: add.stage } }); return; }
    const task: DesignTask = { id: newId(), title, type: k as JoinerTaskType, stage: add.stage };
    if (k === 'other' && add.link.trim()) {
      const link = webLink(add.link);
      if (!link) { onError('Write the link like https://forms.example.com'); return; }
      task.link = link;
    }
    if (k === 'ack' && add.file) { task.fileId = add.file.fileId; if (add.file.letterTemplateId) task.letterTemplateId = add.file.letterTemplateId; }
    if (k === 'form') task.questions = add.fields.filter((f) => f.text.trim()).map(savedQuestion);
    onAdd({ title, task });
  };

  return (
    <Modal title={`Add ${KIND_WORDS[nameKey]}`} width={600} onClose={onClose} busy={add.busy}
      footer={<>
        <button type="button" className="pd-btn" onClick={() => (add.pickFrom ? set({ kind: null }) : onClose())} disabled={add.busy}>{add.pickFrom ? 'Back' : 'Cancel'}</button>
        <button type="button" className="pd-btn primary" onClick={ok} disabled={add.busy}>Add</button>
      </>}>
      <div style={{ display: 'grid', gap: 18 }}>
        <label style={fieldLabel}><span>{nameLabel}</span><input value={add.name} maxLength={120} onChange={(e) => set({ name: e.target.value })} placeholder={namePh} style={inputStyle} autoFocus /></label>
        {k === 'other' && <label style={fieldLabel}><span>Link (optional)</span><input value={add.link} onChange={(e) => set({ link: e.target.value })} placeholder="https://" style={inputStyle} /></label>}
        {isMeet && <Block label="Who they meet"><RadioPills<MeetWith> label="Who they meet" look="who" options={MEET_WITH.map((w) => [w, MEET_LABEL[w]])} value={add.meetWith} onPick={(v) => set({ meetWith: v })} /></Block>}
        {isAccess && <Block label="Who sets it up"><RadioPills<'it' | 'hr'> label="Who sets it up" look="who" options={[['it', 'IT & admin'], ['hr', 'HR']]} value={add.accessRole} onPick={(v) => set({ accessRole: v })} /></Block>}
        {isMeet && (
          <Block label="Agenda · what they’ll talk about">
            {add.agenda.map((a, j) => (
              <input key={j} aria-label={`Agenda point ${j + 1}`} value={a} maxLength={160} onChange={(e) => set({ agenda: add.agenda.map((x, n) => (n === j ? e.target.value : x)) })}
                placeholder={['How the first week will look', 'Who to ask for what', 'Anything you’re unsure about'][j] ?? 'Another point'} style={inputStyle} />
            ))}
            <span style={{ fontSize: 11.5, color: 'var(--ink-3)' }}>Both people see the agenda and can take notes against each point.</span>
          </Block>
        )}
        {k === 'ack' && (
          <div style={{ display: 'grid', gap: 8 }}>
            <div style={{ border: add.file ? '1.5px solid var(--ok)' : '1.5px dashed var(--line-2)', background: add.file ? 'var(--ok-bg)' : 'var(--surface-2)', borderRadius: 14, padding: '14px 16px', display: 'grid', gap: 4 }}>
              <button type="button" onClick={() => void uploadPdf()} disabled={add.busy} style={{ border: 0, background: 'transparent', padding: 0, fontFamily: 'inherit', textAlign: 'left', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, color: add.file ? 'var(--ok)' : 'var(--accent-ink)', fontSize: 13.5, fontWeight: 600 }}>
                <Glyph d={GLYPH.upload} size={16} />{add.busy ? 'Uploading…' : add.file ? `${add.file.name} · added` : 'Choose a PDF'}
              </button>
              {add.file
                ? <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>Tap to replace it</span>
                : <button type="button" onClick={() => set({ docPick: !add.docPick })} aria-expanded={Boolean(add.docPick)} style={{ border: 0, background: 'transparent', padding: 0, fontFamily: 'inherit', textAlign: 'left', cursor: 'pointer', fontSize: 12, color: 'var(--ink-3)' }}>Or pick one from Document templates</button>}
            </div>
            {add.docPick && !add.file && (
              <div role="listbox" aria-label="Document templates" style={{ display: 'grid', gap: 4 }}>
                {letters.map((t) => (
                  <button key={t.id} type="button" role="option" aria-selected={false} disabled={add.busy} onClick={() => void fromDocument(t)}
                    style={{ minHeight: 40, border: rowLine, borderRadius: 10, background: 'var(--surface)', padding: '0 12px', fontFamily: 'inherit', textAlign: 'left', cursor: 'pointer', fontSize: 13, color: 'var(--ink)' }}>{t.name}</button>
                ))}
              </div>
            )}
          </div>
        )}
        {k === 'form' && (
          <Block label="Questions">
            {add.fields.map((f, j) => (
              <div key={j} style={{ display: 'grid', gap: 6 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input aria-label={`Question ${j + 1}`} value={f.text} maxLength={200} placeholder="Question" onChange={(e) => set({ fields: add.fields.map((x, n) => (n === j ? { ...x, text: e.target.value } : x)) })} style={inputStyle} />
                <button type="button" className="pd-btn sm" style={{ flex: 'none' }}
                  onClick={() => set({ fields: add.fields.map((x, n) => (n === j ? { ...x, type: FORM_TYPES[(FORM_TYPES.findIndex(([t]) => t === x.type) + 1) % FORM_TYPES.length][0] } : x)) })}>
                  {FORM_TYPES.find(([t]) => t === f.type)?.[1]} ▾
                </button>
              </div>
              {f.type === 'choice' && <ChoiceOptions n={j + 1} options={f.options} onChange={(options) => set({ fields: add.fields.map((x, n) => (n === j ? { ...x, options } : x)) })} />}
              </div>
            ))}
            {add.fields.length < 20 && <button type="button" className="pd-btn ghost sm" style={ADD_LINE} onClick={() => set({ fields: [...add.fields, { text: '', type: 'short' }] })}>+ Add a question</button>}
            <span style={{ fontSize: 11.5, color: 'var(--ink-3)' }}>Answer types: short answer, long answer, choice, date or file. Answers are saved to the joiner’s profile.</span>
          </Block>
        )}
        <Block label="When"><RadioPills<DesignStage> label="When" options={stages} value={add.stage} onPick={(v) => set({ stage: v })} /></Block>
      </div>
    </Modal>
  );
}

// —— A watch-list item, a pre-boarding video or a training ————————————————————————————

function StoryDialog({ story, templateId, months, onChange, onClose, onRemove, onSave, onError }: {
  story: StoryEdit; templateId: string; months: 3 | 6; onChange: (s: StoryEdit) => void; onClose: () => void; onRemove: () => void;
  onSave: (item: { title: string; stage: DesignStage; media: DesignMedia }) => void; onError: (m: string) => void;
}) {
  const training = story.list === 'training';
  const m = story.media;
  const set = (patch: Partial<StoryEdit>) => onChange({ ...story, ...patch });
  const setMedia = (patch: Partial<DesignMedia>) => onChange({ ...story, media: { ...m, ...patch } });
  const types: Array<[DesignMedia['type'], string, string]> = training ? [['video', 'Video', GLYPH.video], ['pdf', 'Document', GLYPH.doc]] : [['video', 'Video', GLYPH.video], ['image', 'Image', GLYPH.image], ['text', 'Text', GLYPH.text]];
  const title = training ? (story.index !== null ? 'Edit training' : 'Add a training') : (story.index !== null ? 'Edit watch list item' : 'Add to watch list');
  const fileLabel = m.type === 'image' ? 'Image' : m.type === 'pdf' ? 'Document' : 'Video';
  const uploadText = m.type === 'image' ? 'Upload an image' : m.type === 'pdf' ? 'Upload a PDF' : 'Upload a video';
  const emptyText = m.type === 'image' ? 'Your image shows here' : m.type === 'pdf' ? 'Your document shows here' : 'Your video shows here';
  const upload = async () => {
    const file = await pickFile(ACCEPT[m.type]);
    if (!file) return;
    set({ busy: true });
    try {
      const f = await uploadTemplateMedia(templateId, file, file.name);
      onChange({ ...story, busy: false, media: { type: m.type, fileId: f.id, name: f.name, ...(f.minutes ? { minutes: f.minutes } : {}) } });
    } catch (e) { onError(errText(e, 'Could not upload the file')); set({ busy: false }); }
  };
  const save = () => {
    const name = story.title.trim() || (m.type === 'text' ? (m.text ?? '').trim().split(/\s+/).slice(0, 4).join(' ') || 'A note from us' : 'Untitled');
    onSave({ title: name, stage: story.stage, media: m });
  };
  return (
    <Modal title={title} width={680} onClose={onClose} busy={story.busy}
      footer={<>
        {story.index !== null && <button type="button" style={{ height: 44, padding: '0 12px', borderRadius: 12, border: 0, background: 'transparent', color: 'var(--ink-2)', fontFamily: 'inherit', fontSize: 13, fontWeight: 600, cursor: 'pointer' }} onClick={onRemove} disabled={story.busy}>Remove</button>}
        <span style={{ flex: 1 }} />
        <button type="button" className="pd-btn" onClick={onClose} disabled={story.busy}>Cancel</button>
        <button type="button" className="pd-btn primary" onClick={save} disabled={story.busy}>{story.index !== null ? 'Save' : 'Add'}</button>
      </>}>
      <div style={{ display: 'flex', gap: 22, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        {m.fileId && m.type !== 'text'
          ? <MediaPlayer key={m.fileId} media={m} w={168} h={280} emptyText={emptyText} />
          : <TileFace media={m} w={168} h={280} emptyText={emptyText} textShown={m.text || 'Your text shows here'} preview />}
        <div style={{ flex: 1, minWidth: 260, display: 'grid', gap: 16 }}>
          <div role="radiogroup" aria-label="Type" style={SOFT_SEG}>
            {types.map(([k, t, glyph]) => (
              <button key={k} type="button" role="radio" aria-checked={m.type === k} style={softSegBtn(m.type === k)}
                onClick={() => onChange({ ...story, media: k === 'text' ? { type: 'text', text: m.text, bg: m.bg ?? 'rust' } : m.type === k ? m : { type: k } })}>
                <Glyph d={glyph} size={14} />{t}
              </button>
            ))}
          </div>
          <label style={fieldLabel}><span>Title</span><input value={story.title} maxLength={120} onChange={(e) => set({ title: e.target.value })} placeholder="e.g. Welcome from HR" style={inputStyle} /></label>
          {m.type !== 'text' && (
            <Block label={fileLabel}>
              {m.fileId
                ? <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', border: rowLine, borderRadius: 12 }}><span style={{ flex: 1, minWidth: 0, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.name ?? fileLabel}</span><button type="button" className="pd-btn sm" onClick={() => onChange({ ...story, media: { type: m.type } })}>Replace</button></div>
                : <button type="button" onClick={() => void upload()} disabled={story.busy}
                    style={{ height: 72, borderRadius: 12, border: '1.5px dashed var(--line-2)', background: 'var(--surface-2)', color: 'var(--accent)', fontFamily: 'inherit', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>{story.busy ? 'Uploading…' : uploadText}</button>}
            </Block>
          )}
          {m.type === 'text' && <>
            <label style={fieldLabel}><span>Text</span><textarea value={m.text ?? ''} maxLength={160} onChange={(e) => setMedia({ text: e.target.value })} placeholder="Write a short message" style={areaStyle} /></label>
            <Block label="Background">
              <div role="radiogroup" aria-label="Background" style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                {BACKGROUNDS.map(([k, n, bg]) => (
                  <button key={k} type="button" role="radio" aria-checked={m.bg === k} aria-label={n} onClick={() => setMedia({ bg: k })}
                    style={{ width: 30, height: 30, borderRadius: '50%', border: 0, background: bg, cursor: 'pointer', boxShadow: m.bg === k ? '0 0 0 2px var(--surface), 0 0 0 4px var(--ink)' : 'none' }} />
                ))}
              </div>
            </Block>
          </>}
          {story.stage !== 'pre' && (
            <Block label="Shows from"><RadioPills<DesignStage> label="Shows from" options={(['d1', 'w1', 'm1'] as DesignStage[]).map((s) => [s, stageName(s, months)])} value={story.stage} onPick={(v) => set({ stage: v })} /></Block>
          )}
        </div>
      </div>
    </Modal>
  );
}

// —— Employee preview: the phone ————————————————————————————————————————————————————————

function Phone({ preview, error }: { preview: TemplatePreview | null; error: string }) {
  type Tile = { t: string; big: string; small: string; tone: 'plain' | 'tour' | 'watch'; wide?: boolean };
  const tiles: Tile[] = [];
  if (preview?.stage === 'pre') {
    if (preview.joining) tiles.push({ t: 'Joining details', big: `Joining day${preview.joining.time ? `, ${clock(preview.joining.time)}` : ''}`, small: preview.joining.place ? `${preview.joining.place} · ${MEETS_LABEL[preview.joining.meets]} meets you` : 'Reporting details: set up by HR', tone: 'plain', wide: true });
    if (preview.offerLetter) tiles.push({ t: 'Offer letter', big: 'Role from the offer', small: 'Opens as a PDF', tone: 'plain' });
    if (preview.profile) tiles.push({ t: 'Your profile', big: 'Fill in your details', small: `${preview.profile.sections} sections`, tone: 'plain' });
    if (preview.watch) tiles.push({ t: 'Watch list', big: preview.watch.first, small: `${preview.watch.ready} of ${preview.watch.total} ready`, tone: 'watch', wide: true });
  } else if (preview) {
    if (preview.meetings.count) tiles.push({ t: 'Meetings', big: `${preview.meetings.count} ${preview.meetings.count === 1 ? 'person' : 'people'}`, small: preview.meetings.who.map((w) => MEET_LABEL[w]).join(', '), tone: 'plain' });
    if (preview.tasks.count) tiles.push({ t: 'Tasks', big: preview.tasks.first ?? '', small: `${preview.tasks.count} to do`, tone: 'plain' });
    if (preview.tour?.first) tiles.push({ t: 'Sowaka tour', big: tourName(preview.tour.first as TourLesson), small: 'A lesson a day', tone: 'tour' });
    if (preview.watch) tiles.push({ t: 'Watch list', big: preview.watch.first, small: `${preview.watch.ready} of ${preview.watch.total} ready`, tone: 'watch' });
    if (preview.devices) tiles.push({ t: 'Devices and accesses', big: `${preview.devices.count} to set up`, small: 'Due by end of Week 1', tone: 'plain', wide: true });
    tiles.push({ t: 'Profile', big: 'Keep it up to date', small: 'Open all through', tone: 'plain', wide: true });
  }
  const toneStyle = (tone: Tile['tone']): CSSProperties => (tone === 'tour' ? { background: 'linear-gradient(135deg, #CC4A12 0%, #B23500 50%, #872800 100%)', color: '#fff', border: 0 }
    : tone === 'watch' ? { background: '#0571A6', color: '#fff', border: 0 } : { background: '#fff', color: '#16181D', border: '1px solid #E2E3E8' });
  return (
    <div style={{ width: 360, height: 700, maxHeight: 'calc(100vh - 120px)', boxSizing: 'border-box', background: '#fff', color: '#16181D', border: '10px solid #16181D', borderRadius: 44, padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 12, overflow: 'hidden', boxShadow: '0 24px 60px rgba(22,24,29,0.35)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0 6px', fontSize: 11, fontWeight: 600 }}><span>9:41</span><span style={{ width: 90, height: 22, borderRadius: 999, background: '#16181D' }} /><span>5G</span></div>
      {error ? <div style={{ fontSize: 12.5, color: '#B42318', padding: 8 }}>{error}</div> : !preview ? <SkeletonLines lines={6} /> : (
        <>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '2px 4px' }}>
            <span style={{ fontSize: 15, fontWeight: 700 }}>{preview.header}</span>
            <span style={{ height: 26, padding: '0 10px', borderRadius: 999, background: '#0571A6', color: '#fff', fontSize: 11, fontWeight: 600, display: 'flex', alignItems: 'center' }}>{preview.stageLabel}</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 8 }}>
            {tiles.map((x) => (
              <div key={x.t} style={{ ...toneStyle(x.tone), borderRadius: 16, padding: 12, minHeight: 86, boxSizing: 'border-box', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', gap: 6, gridColumn: x.wide ? '1 / -1' : 'auto' }}>
                <span style={{ fontSize: 11, fontWeight: 600 }}>{x.t}</span>
                <span style={{ display: 'grid', gap: 2 }}><span style={{ fontSize: 13, fontWeight: 600, lineHeight: 1.25 }}>{x.big}</span><span style={{ fontSize: 10, opacity: 0.8 }}>{x.small}</span></span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/** What the phone shows at a stage (the same rules as GET /admin/lifecycle/templates/:id/preview), from the editor's copy. */
function previewOf(view: TemplateDesign, stage: DesignStage): TemplatePreview {
  const months = view.probation.months;
  const order = STAGES.indexOf(stage);
  const ready = (list: TemplateDesign['watch']) => list.filter((w) => !!w.media.fileId || w.media.type === 'text').length;
  if (stage === 'pre') {
    const v = view.preboarding.videos;
    return {
      stage, header: 'Welcome', stageLabel: stageName(stage, months),
      joining: view.preboarding.rows.joiningDetails ? { ...view.preboarding.reporting } : null,
      offerLetter: view.preboarding.rows.offerLetter,
      profile: view.preboarding.rows.profile ? { sections: 7 } : null,
      watch: view.preboarding.rows.watch && v.length ? { first: v[0].title, ready: ready(v), total: v.length } : null,
    };
  }
  const watchAll = view.watch.filter((w) => STAGES.indexOf(w.stage) <= order);
  const meetings = view.meetings.filter((m) => m.stage === stage);
  const tasks = view.tasks.filter((x) => x.stage === stage);
  const early = stage === 'd1' || stage === 'w1';
  return {
    stage, header: 'Onboarding', stageLabel: stageName(stage, months),
    meetings: { count: meetings.length, who: meetings.map((m) => m.meetWith).slice(0, 3) },
    tasks: { first: tasks[0]?.title, count: tasks.length },
    tour: early && view.tour.length ? { first: stage === 'd1' ? 'punch' : view.tour.find((l) => l !== 'punch') ?? null } : null,
    watch: order <= STAGES.indexOf('m1') && watchAll.length ? { first: watchAll[0].title, ready: ready(watchAll), total: watchAll.length } : null,
    devices: early && view.accesses.length ? { count: view.accesses.length } : null,
    profile: true,
  };
}
