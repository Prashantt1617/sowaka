// People › Employees › Pre-boarding › a candidate (`#preboarding/<journeyId>`): the
// Employee profile page (same header, tabs, section cards and documents list, from
// profileParts), filled from what the candidate entered on the joining portal and what
// the onboarding board knows. The Employee profile's tabs but Calendar and Requests
// (nothing to show before joining): Profile, Performance, Salary details (the offer's
// pay, with payroll access), Org chart, Activity (the joiner panel's Journey) and Exit
// ("Not joining", the joiner panel's close). The Profile tab splits the portal's answers
// into the Employee profile's categories (Basic details, Documents, Payment and tax IDs)
// and the candidate's own (Personal details, Contact and address, Emergency contact,
// Education, Work experience). Each category shows where its portal section stands
// (To do / Done / Approved by NAME on DATE); HR approves a complete one, which locks it
// for the candidate (Unlock hands it back), and edits its answers. Every uploaded document
// can be sent back for a re-upload with a note (the joiner panel's own call), and one
// waiting for HR approved. Its own address, so the onboarding board's panel opens it in a new tab.
import { useCallback, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { useStore } from '../../store';
import { canOpen, canSeePay, SALARY_DETAILS } from '../../access';
import { usePageHead } from '../../pageHead';
import { LoadError, Pill, SkeletonLines, StatusTabs } from '../../ui';
import { ApiError } from '../../../services/http';
import { createPreboardingAppAccess, getJourney, getPreboardingProfile, isNotAvailable, reviewDocument, savePreboardingBasic, savePreboardingSection, setPreboardingSectionApproved } from '../../../services/lifecycle';
import type {
  PreboardingAddress, PreboardingBasic, PreboardingBasicInput, PreboardingDocument, PreboardingJob, PreboardingOptions, PreboardingProfile as Profile, PreboardingSection,
  PreboardingSectionInput, PreboardingSectionKey, PreboardingSectionValues,
} from '../../../services/lifecycle';
import { Modal, NoteDialog, NotSwitchedOn } from './shared';
import { dayOf, errText, firstName, longDay, shortDay } from './format';
import { pctColour, pctOf } from './boardModel';
import { candidateStatus, docStatus, rememberPreboardingList } from './preboardingLinks';
import { BasicDetailsGrid, DocumentList, Fact, Grid, LockedField, ProfileHeader, Row, Section, SkeletonGrid } from '../profileParts';
import { EMP_TYPE_VALUE, nameParts, showDate } from '../profileWords';
import type { ProfileDocItem } from '../profileParts';
import { Field, Select, TypeOrPick, grid2, grid3, inputStyle } from '../AddEmployeeWizard';
import { PdBank, PdEdit, PdFile, PdLayers, PdPin, PdUser } from '../pdIcons';
import type { ProfileTab } from '../EmployeeProfile';
import { ActivityTab, NotJoiningTab, OrgChartTab, PerformanceTab, SalaryTab } from './PreboardingTabs';
import type { JourneyLoad } from './PreboardingTabs';
import '../people.css';

type Tone = { bg: string; fg: string };
const STATE: Record<'todo' | 'done' | 'approved', { label: string; tone: Tone }> = {
  todo: { label: 'To do', tone: { bg: 'var(--attn-bg)', fg: 'var(--attn)' } },
  done: { label: 'Done', tone: { bg: 'var(--accent-soft)', fg: 'var(--accent-ink)' } },
  approved: { label: 'Approved', tone: { bg: 'var(--ok-bg)', fg: 'var(--ok)' } },
};
/** The pre-boarding profile's tabs: the Employee profile's, without Calendar and Requests. */
type Tab = Exclude<ProfileTab, 'calendar' | 'requests'>;
const TAB_LABELS: Record<Tab, string> = { profile: 'Profile', performance: 'Performance', salary: 'Salary details', orgchart: 'Org chart', activity: 'Activity', exit: 'Exit' };

/** A card on the Profile tab: its title and icon, the portal sections it shows, and its rows in order. */
type CardKey = 'personal' | 'contact' | 'emergency' | 'education' | 'experience' | 'payment';
interface Category {
  key: CardKey;
  title: string;
  icon: ReactNode;
  sections: PreboardingSection[];
  rows: Array<{ label: string; value: string }>;
  /** Always draws its rows ('—' for a blank one), as the Employee profile's Payment and tax IDs does. */
  fixed?: boolean;
  /** Names the sections' documents (once, where a section is split over two cards). */
  docsNote?: boolean;
}
const EDUCATION_LABELS = new Set(['Highest qualification', 'College or university', 'Year of passing']);
const PAYMENT_LABELS = new Set(['Bank', 'Account number', 'IFSC', 'Account holder', 'PF', 'PAN', 'Aadhaar']);

/** The portal's six sections, as the Profile tab's categories (the server's rows, split and ordered). */
function categoriesOf(sections: PreboardingSection[]): Category[] {
  const sec = (k: PreboardingSectionKey) => sections.find((x) => x.key === k);
  const one = (k: PreboardingSectionKey) => { const x = sec(k); return x ? [x] : []; };
  const rows = (k: PreboardingSectionKey, keep: (label: string) => boolean = () => true) => (sec(k)?.fields ?? []).filter((f) => keep(f.label));
  const bank = rows('bank');
  const ids = rows('ids');
  const val = (list: Array<{ label: string; value: string }>, label: string) => list.find((f) => f.label === label)?.value ?? '';
  const pf = val(bank, 'PF');
  const out: Category[] = [
    { key: 'personal', title: 'Personal details', icon: <PdUser />, sections: one('personal'), rows: rows('personal'), docsNote: true },
    { key: 'contact', title: 'Contact and address', icon: <PdPin />, sections: one('contact'), rows: rows('contact'), docsNote: true },
    { key: 'emergency', title: 'Emergency contact', icon: <PdUser />, sections: one('emergency'), rows: rows('emergency'), docsNote: true },
    { key: 'education', title: 'Education', icon: <PdLayers />, sections: one('education'), rows: rows('education', (l) => EDUCATION_LABELS.has(l)), docsNote: true },
    { key: 'experience', title: 'Work experience', icon: <PdLayers />, sections: one('education'), rows: rows('education', (l) => !EDUCATION_LABELS.has(l)) },
    {
      // The Employee profile's card, its rows in its order; the candidate's Aadhaar beside the PAN.
      key: 'payment', title: 'Payment and tax IDs', icon: <PdBank />, sections: [...one('bank'), ...one('ids')], fixed: true, docsNote: true,
      rows: [
        { label: 'Bank', value: val(bank, 'Bank') }, { label: 'Account number', value: val(bank, 'Account number') }, { label: 'IFSC', value: val(bank, 'IFSC') },
        { label: 'Account holder', value: val(bank, 'Account holder') }, { label: 'PAN', value: val(ids, 'PAN') }, { label: 'Aadhaar', value: val(ids, 'Aadhaar') },
        { label: 'UAN', value: pf.startsWith('UAN ') ? pf.slice(4) : pf },
        ...[...bank, ...ids].filter((f) => !PAYMENT_LABELS.has(f.label)),
      ],
    },
  ];
  return out.filter((c) => c.sections.length > 0);
}

/** The portal's choices, until the server sends its own (`options`). */
const OPTIONS: PreboardingOptions = {
  genders: ['Male', 'Female', 'Other'],
  marital: ['Single', 'Married', 'Divorced', 'Widowed', 'Prefer not to say'],
  qualifications: ['Class 10', 'Class 12', 'Diploma', 'Graduate', 'Postgraduate', 'Doctorate', 'Other'],
  relations: ['Parent', 'Partner', 'Sibling', 'Friend'],
};

export function PreboardingProfile() {
  const s = useStore();
  const { flash, user } = s;
  const journeyId = s.viewParam;
  const [data, setData] = useState<Profile | null>(null);
  const [error, setError] = useState<{ text: string; off?: boolean } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState('');
  // What is open for editing: 'basic', or a card and the section it edits ('payment:ids').
  const [editing, setEditing] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('profile');
  const [journey, setJourney] = useState<JourneyLoad>({ state: 'loading' });
  const [reupload, setReupload] = useState<PreboardingDocument | null>(null);
  const [granting, setGranting] = useState(false);
  // Candidates' documents and answers are HR's (People › Employees or full access); the onboarding tab alone sees where each one is.
  const seesDocuments = canOpen(user, 'employees');
  // As the Employee profile: what someone earns is its own access. The offer, tasks and closing are the onboarding board's.
  const seesSalary = canOpen(user, SALARY_DETAILS);
  const seesBoard = canOpen(user, 'onboarding');

  const back = useCallback(() => { rememberPreboardingList(); s.setView('employees'); }, [s]);
  // As the Employee profile: the page head says Employees, the page's own link goes back.
  usePageHead({ title: 'Employees', eyebrow: 'People' });

  useEffect(() => {
    if (!journeyId) return undefined;
    let live = true;
    setError(null);
    // Another candidate in the same tab (Back, Forward): never show the last one's details while theirs load.
    setData((d) => (d && d.journeyId !== journeyId ? null : d));
    getPreboardingProfile(journeyId)
      .then((d) => { if (live) setData(d); })
      .catch((e: unknown) => {
        if (!live) return;
        if (isNotAvailable(e)) setError({ text: '', off: true });
        else if (e instanceof ApiError && e.status === 404) setError({ text: 'This candidate could not be found. They may have been removed, or the link is from another company.' });
        else if (e instanceof ApiError && e.status === 403) setError({ text: 'You do not have access to this candidate’s profile.' });
        else setError({ text: errText(e, 'Could not load this profile') });
      });
    return () => { live = false; };
  }, [journeyId, attempt]);
  // The onboarding board's detail (the joiner panel's call): the offer, tasks, documents and letters the other tabs show.
  useEffect(() => {
    if (!journeyId) return undefined;
    if (!seesBoard) { setJourney({ state: 'none' }); return undefined; }
    let live = true;
    setJourney((j) => (j.state === 'ready' && j.data.journey.id === journeyId ? j : { state: 'loading' }));
    getJourney(journeyId)
      .then((d) => { if (live) setJourney({ state: 'ready', data: d }); })
      .catch((e: unknown) => { if (live) setJourney({ state: 'error', text: errText(e, 'Could not load the onboarding details'), retry: () => setAttempt((n) => n + 1) }); });
    return () => { live = false; };
  }, [journeyId, attempt, seesBoard]);
  // Another candidate: no form left open from the last one, and their profile first.
  useEffect(() => { setEditing(null); setTab('profile'); }, [journeyId]);

  const top = (
    <div className="pd-prof-top">
      <button type="button" onClick={back} className="pd-btn ghost sm" style={{ marginLeft: -12 }}>← Back to the Pre-boarding list</button>
    </div>
  );

  if (!journeyId) {
    return (
      <section className="pd-card" style={{ padding: 28, textAlign: 'center', color: 'var(--ink-2)', fontSize: 13, display: 'grid', gap: 14, justifyItems: 'center' }}>
        <span>No candidate is picked. Open one from the Pre-boarding list on Employees.</span>
        <button type="button" className="pd-btn" onClick={back}>Open the Pre-boarding list</button>
      </section>
    );
  }
  if (error?.off) return <NotSwitchedOn />;
  if (!data) {
    return (
      <div className="pd-prof" style={{ animation: 'fade .3s ease both' }}>
        {top}
        {error
          ? <section className="pd-card"><LoadError text={error.text} onRetry={() => setAttempt((n) => n + 1)} /></section>
          : (
            <div className="pd-psecs">
              <section className="pd-card" style={{ padding: 20 }}><SkeletonLines lines={4} /></section>
              <section className="pd-card pd-psec"><SkeletonGrid rows={3} /></section>
              <section className="pd-card pd-psec"><SkeletonGrid rows={3} /></section>
            </div>
          )}
      </div>
    );
  }

  const { candidate } = data;
  const first = firstName(candidate.name);
  const status = candidateStatus(String(candidate.status));
  const pct = pctOf(data);
  const approvedCount = data.sections.filter((x) => x.approved).length;
  // HR edits the answers once the server can take them (it sends the form's choices with them).
  const canEdit = seesDocuments && Boolean(data.options);
  const options = { ...OPTIONS, ...(data.options ?? {}) };

  const approve = async (section: PreboardingSection, on: boolean) => {
    setBusy(`sec:${section.key}`);
    try {
      setData(await setPreboardingSectionApproved(data.journeyId, section.key, on));
      flash(on ? `${section.title} approved and locked` : `${section.title} unlocked. ${first} can edit it again.`);
    } catch (e) {
      flash(errText(e, on ? 'Could not approve this section' : 'Could not unlock this section'), 'error');
    } finally { setBusy(''); }
  };
  const approveDoc = async (doc: PreboardingDocument) => {
    setBusy(`doc:${doc.id}`);
    try {
      await reviewDocument(doc.id, 'approve');
      flash(`${doc.label} approved`);
      setAttempt((n) => n + 1);
    } catch (e) {
      flash(errText(e, 'Could not approve the document'), 'error');
    } finally { setBusy(''); }
  };
  // Throws on a refusal, so the form shows the server's message.
  const save = async <K extends PreboardingSectionKey>(section: PreboardingSection, body: PreboardingSectionInput[K]) => {
    setData(await savePreboardingSection(data.journeyId, section.key as K, body));
    setEditing(null);
    flash(`${section.title} saved`);
  };

  const docGroups = data.sections.map((sec) => ({
    key: sec.key,
    title: sec.title,
    list: sec.documents.map((d): ProfileDocItem => ({
      id: d.id,
      title: d.label,
      sub: `${d.required ? 'Required' : 'Optional'}${d.files.length ? ' · uploaded on the joining portal' : ''}`,
      status: docStatus(d.status) ?? docStatus('todo'),
      files: seesDocuments ? d.files : null,
      extra: <DocumentReview doc={d} canReview={seesDocuments} busy={busy === `doc:${d.id}`} disabled={Boolean(busy)}
        onApprove={() => void approveDoc(d)} onReupload={() => setReupload(d)} />,
    })),
  }));
  const documentCount = docGroups.reduce((n, g) => n + g.list.length, 0);

  // Basic details: the card the Employee profile opens with, from `basic` and the candidate's own answers.
  const basic = data.basic;
  const answers = <K extends PreboardingSectionKey>(key: K) => (data.sections.find((x) => x.key === key)?.values ?? {}) as Partial<PreboardingSectionValues[K]>;
  const personal = answers('personal');
  const mobile = answers('contact').mobile || candidate.phone || '';
  const joining = basic?.tj ?? candidate.tj ?? '';
  const canEditBasic = seesDocuments && Boolean(basic);
  const canGrant = user?.canEditEmployees === true && Boolean(basic) && !basic?.appAccess;
  const saveBasic = async (body: PreboardingBasicInput) => {
    setData(await savePreboardingBasic(data.journeyId, body));
    setEditing(null);
    flash('Basic details saved');
  };

  const tabs: Tab[] = ['profile', 'performance', ...(seesSalary ? ['salary' as const] : []), 'orgchart', 'activity', ...(seesBoard ? ['exit' as const] : [])];
  const categories = categoriesOf(data.sections);
  const card = (c: Category) => {
    const open = editing?.startsWith(`${c.key}:`) ? c.sections.find((x) => editing === `${c.key}:${x.key}`) : undefined;
    return (
      <CategoryCard key={c.key} category={c} first={first} busy={busy} canEdit={canEdit} editing={open?.key ?? null}
        onEdit={(sec) => setEditing(`${c.key}:${sec.key}`)}
        onApprove={(sec) => void approve(sec, true)} onUnlock={(sec) => void approve(sec, false)}>
        {open && <SectionEditor section={open} options={options} onCancel={() => setEditing(null)} save={(body) => save(open, body)} />}
      </CategoryCard>
    );
  };

  return (
    <div className="pd-prof" style={{ animation: 'fade .3s ease both' }}>
      {top}

      {/* Identity header */}
      <ProfileHeader name={candidate.name} sub={[candidate.designation || 'Role not set', candidate.department, 'Pre-boarding'].filter(Boolean).join(' · ')}
        pills={<Pill label={status} tone={{ bg: 'var(--accent-soft)', fg: 'var(--accent-ink)' }} />}>
        <Fact label="Personal email" value={candidate.personalEmail || '—'} />
        <Fact label="Phone" value={candidate.phone || '—'} />
        <Fact label="Date of joining" value={candidate.tj ? longDay(candidate.tj) : 'Not set'} />
        <Fact label="Status" value={status} />
        <Fact label="Profile" value={
          <span style={{ display: 'grid', gap: 6 }}>
            <span>{data.done} of {data.total} sections done</span>
            <span style={{ height: 6, borderRadius: 99, background: 'var(--line)', overflow: 'hidden', maxWidth: 200 }}>
              <i style={{ display: 'block', height: '100%', width: `${pct}%`, borderRadius: 99, background: pctColour(pct) }} />
            </span>
          </span>
        } />
        <Fact label="Approved" value={`${approvedCount} of ${data.sections.length} sections`} />
      </ProfileHeader>

      {/* The Employee profile's tabs, but Calendar and Requests: nothing to show before joining. */}
      <div className="pd-ptabs">
        <StatusTabs<Tab> options={tabs} active={tab} onSelect={setTab} labels={TAB_LABELS} />
      </div>

      {tab === 'profile' && (
        <div className="pd-psecs">
          {basic && (
            <div data-focus="details">
              <Section title="Basic details" icon={<PdUser />} action={editing === 'basic' ? undefined : (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                  {canEditBasic && <button type="button" onClick={() => setEditing('basic')} className="pd-sec-act"><PdEdit /> Edit</button>}
                  {basic.appAccess
                    ? <span className="pd-subnote" style={{ fontSize: 12.5 }}>App access created on {showDate(dayOf(basic.appAccess.createdAt))}</span>
                    : canGrant && <button type="button" className="pd-btn sm primary" onClick={() => setGranting(true)}>Generate app access</button>}
                </span>
              )}>
                {editing === 'basic'
                  ? <BasicEditor name={candidate.name} basic={basic} joining={joining} mobile={mobile} personal={personal} onCancel={() => setEditing(null)} save={saveBasic} />
                  : <BasicDetailsGrid d={{
                    name: candidate.name, employeeId: basic.employeeId ?? '', joining: joining ? showDate(joining) : '', workEmail: basic.workEmail ?? '',
                    designation: basic.designation ?? candidate.designation ?? '', department: basic.department ?? candidate.department ?? '',
                    workLocation: basic.workLocation ?? '', employeeType: typeWord(basic.employeeType), mobile,
                    gender: personal.gender ?? '', dob: personal.dob ? showDate(personal.dob) : '', manager: basic.reportingManager?.name ?? '',
                  }} />}
              </Section>
            </div>
          )}
          {data.sections.length === 0 && (
            <section className="pd-card" style={{ padding: 28, textAlign: 'center', color: 'var(--ink-3)', fontSize: 13 }}>
              {first} has not started the Employee profile on the joining portal yet.
            </section>
          )}
          {categories.filter((c) => c.key !== 'payment').map(card)}
          {/* Then the Employee profile's own order: Documents, then Payment and tax IDs. */}
          {documentCount > 0 && (
            <Section title="Documents" icon={<PdFile />}>
              {!seesDocuments && <div className="pd-note" style={{ marginBottom: 8 }}>Only HR opens candidates’ documents and ID proofs. You see where each one is.</div>}
              <DocumentList groups={docGroups} />
            </Section>
          )}
          {categories.filter((c) => c.key === 'payment').map(card)}
        </div>
      )}
      {tab === 'performance' && <PerformanceTab load={journey} />}
      {tab === 'salary' && seesSalary && <SalaryTab load={journey} journeyId={data.journeyId} seesPay={canSeePay(user)} />}
      {tab === 'orgchart' && <OrgChartTab profile={data} load={journey} />}
      {tab === 'activity' && <ActivityTab load={journey} onChanged={() => setAttempt((n) => n + 1)} />}
      {tab === 'exit' && seesBoard && <NotJoiningTab profile={data} load={journey} first={first} onChanged={() => setAttempt((n) => n + 1)} />}

      {granting && basic && (
        <AppAccessDialog first={first} basic={basic} onClose={() => setGranting(false)}
          onCreate={async (body) => { setData(await createPreboardingAppAccess(data.journeyId, body)); setGranting(false); flash(`App access created for ${first}`); }} />
      )}
      {reupload && (
        <NoteDialog title={`Ask ${first} to re-upload ${reupload.label}`} sub={`${first} sees your note first, at the top of Up next.`} label="What to fix" required
          placeholder="e.g. The scan is cut off at the bottom. Please upload the full page." confirm="Ask to re-upload" tone="danger"
          onClose={() => setReupload(null)}
          onConfirm={async (note) => { await reviewDocument(reupload.id, 'send_back', note); flash(`${first} was asked to re-upload ${reupload.label}`); setReupload(null); setAttempt((n) => n + 1); }} />
      )}
    </div>
  );
}

/** A section's state and its actions: the pill, Edit, then Approve section (once done) or Unlock. */
function SectionControls({ section: sec, first, busy, canEdit, editing, onEdit, onApprove, onUnlock }: {
  section: PreboardingSection; first: string; busy: string; canEdit: boolean; editing: boolean;
  onEdit: () => void; onApprove: () => void; onUnlock: () => void;
}) {
  const st = STATE[sec.approved ? 'approved' : sec.done ? 'done' : 'todo'];
  const working = busy === `sec:${sec.key}`;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
      <Pill label={st.label} tone={st.tone} fontSize={11} padding="2px 9px" />
      {canEdit && !editing && <button type="button" onClick={onEdit} className="pd-sec-act" disabled={Boolean(busy)}><PdEdit /> Edit</button>}
      {!editing && (sec.approved
        ? <button type="button" className="pd-btn sm" disabled={Boolean(busy)} onClick={onUnlock}>{working ? 'Unlocking…' : 'Unlock'}</button>
        : <button type="button" className="pd-btn sm primary" disabled={!sec.done || Boolean(busy)} title={sec.done ? undefined : `${first} has not finished this section yet`} onClick={onApprove}>{working ? 'Approving…' : 'Approve section'}</button>)}
    </span>
  );
}

const docsLine = (sec: PreboardingSection) =>
  sec.documents.map((d) => `${d.label} (${(docStatus(d.status) ?? docStatus('todo'))!.label.toLowerCase()})`).join(', ');

/**
 * One category as the Employee profile draws it: icon, title and actions, then its rows (or the edit form
 * of the section being edited). A card over one portal section has that section's state and actions in its
 * header; one over several (Payment and tax IDs: bank and IDs) lists each section with its own.
 */
function CategoryCard({ category: c, first, busy, canEdit, editing, onEdit, onApprove, onUnlock, children }: {
  category: Category; first: string; busy: string; canEdit: boolean; editing: PreboardingSectionKey | null;
  onEdit: (s: PreboardingSection) => void; onApprove: (s: PreboardingSection) => void; onUnlock: (s: PreboardingSection) => void; children: ReactNode;
}) {
  const single = c.sections.length === 1 ? c.sections[0] : null;
  const controls = (sec: PreboardingSection) => (
    <SectionControls section={sec} first={first} busy={busy} canEdit={canEdit} editing={editing !== null}
      onEdit={() => onEdit(sec)} onApprove={() => onApprove(sec)} onUnlock={() => onUnlock(sec)} />
  );
  const rows = c.rows.filter((r) => c.fixed || r.value.trim());
  return (
    <div data-focus={c.key}>
      <Section title={c.title} icon={c.icon} action={single ? controls(single) : undefined} labelId={`pb-sec-${c.key}`}>
        {single?.approved && (
          <div className="pd-note" style={{ marginBottom: 10 }}>
            <span>Approved by <b>{single.approved.byName}</b> on {shortDay(single.approved.at)}. {first} can no longer edit this section on the portal or the app.</span>
          </div>
        )}
        {!single && (
          <div style={{ display: 'grid', gap: 8, marginBottom: 12 }}>
            {c.sections.map((sec) => (
              <div key={sec.key} style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', padding: '8px 12px', border: '1px solid var(--line)', borderRadius: 12 }}>
                <span style={{ flex: 1, minWidth: 160, display: 'grid', gap: 2 }}>
                  <span style={{ fontSize: 13, fontWeight: 500 }}>{sec.title}</span>
                  {sec.approved && <span className="pd-subnote">Approved by {sec.approved.byName} on {shortDay(sec.approved.at)}. {first} can no longer edit it.</span>}
                </span>
                {controls(sec)}
              </div>
            ))}
          </div>
        )}
        {editing ? children : rows.length > 0 ? (
          <Grid>
            {rows.map((f, i) => <Row key={`${f.label}-${i}`} label={f.label} value={f.value || '—'} />)}
          </Grid>
        ) : <div style={{ fontSize: 13, color: 'var(--ink-3)', padding: '6px 0' }}>Nothing filled in yet.</div>}
        {!editing && c.sections.map((sec) => sec.editedByHr && (
          <div key={`e-${sec.key}`} className="pd-subnote" style={{ marginTop: 8 }}>{single ? 'Changed' : `${sec.title}: changed`} by {sec.editedByHr.byName} on {shortDay(sec.editedByHr.at)}.</div>
        ))}
        {!editing && c.docsNote && c.sections.map((sec) => sec.documents.length > 0 && (
          <div key={`d-${sec.key}`} className="pd-subnote" style={{ marginTop: 8 }}>
            {single ? 'Its documents' : `${sec.title} documents`}, under Documents: {docsLine(sec)}.
          </div>
        ))}
      </Section>
    </div>
  );
}

/** Under a document: HR's note when it went back, and approve (waiting for HR) or ask for a re-upload (only once a file is in). */
function DocumentReview({ doc, canReview, busy, disabled, onApprove, onReupload }: {
  doc: PreboardingDocument; canReview: boolean; busy: boolean; disabled: boolean; onApprove: () => void; onReupload: () => void;
}) {
  const note = doc.hrNote && doc.status === 'sent_back'
    ? <div style={{ fontSize: 12.5, color: 'var(--warn)', overflowWrap: 'anywhere' }}>Your note: {doc.hrNote}</div>
    : null;
  // Nothing to re-upload until they have uploaded something: only a document with HR or approved.
  const asks = canReview && (doc.status === 'in_review' || doc.status === 'approved') && doc.files.length > 0;
  if (!note && !asks) return null;
  return (
    <>
      {note}
      {asks && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {doc.status === 'in_review' && <button type="button" className="pd-btn sm primary" onClick={onApprove} disabled={disabled}>{busy ? 'Approving…' : 'Approve'}</button>}
          <button type="button" className="pd-btn sm" onClick={onReupload} disabled={disabled}>Ask to re-upload</button>
        </div>
      )}
    </>
  );
}

// —— Editing a section ———————————————————————————————————————————————————
// Each form starts from the section's `values` and sends the same shape back. The account
// number, Aadhaar and PAN come as their last four: their boxes start empty, and empty keeps them.

type EditorProps<K extends PreboardingSectionKey> = {
  values: Partial<PreboardingSectionValues[K]>;
  options: PreboardingOptions;
  save: (body: PreboardingSectionInput[K]) => Promise<void>;
  onCancel: () => void;
};

function SectionEditor({ section, options, save, onCancel }: {
  section: PreboardingSection; options: PreboardingOptions; save: (body: PreboardingSectionInput[PreboardingSectionKey]) => Promise<void>; onCancel: () => void;
}) {
  // Each form reads its own section's shape (the server answers `values` per section key).
  const values = (section.values ?? {}) as never;
  const common = { options, onCancel, save: save as never };
  switch (section.key) {
    case 'personal': return <PersonalEditor values={values} {...common} />;
    case 'contact': return <ContactEditor values={values} {...common} />;
    case 'emergency': return <EmergencyEditor values={values} {...common} />;
    case 'bank': return <BankEditor values={values} {...common} />;
    case 'education': return <EducationEditor values={values} {...common} />;
    case 'ids': return <IdsEditor values={values} {...common} />;
    default: return null;
  }
}

/** The form's frame, as the Employee profile's Basic details editor: fields, any refusal, Cancel and Save. */
function EditorShell({ onSave, onCancel, children }: { onSave: () => Promise<void>; onCancel: () => void; children: ReactNode }) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const go = async () => {
    setSaving(true);
    setError('');
    try { await onSave(); } catch (e) { setError(errText(e, 'Could not save the changes')); setSaving(false); }
  };
  return (
    <form style={{ paddingTop: 8 }} onSubmit={(e) => { e.preventDefault(); void go(); }}>
      {children}
      {error && <div role="alert" style={{ fontSize: 12.5, color: 'var(--bad)', marginBottom: 12 }}>{error}</div>}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button type="button" disabled={saving} onClick={onCancel} className="pd-btn">Cancel</button>
        <button type="submit" disabled={saving} className="pd-btn primary">{saving ? 'Saving…' : 'Save'}</button>
      </div>
    </form>
  );
}

const str = (v: unknown) => (typeof v === 'string' ? v : '');
const opt = (v: string) => (v.trim() ? v.trim() : undefined);
/** Leaves out the keys whose value is undefined, so blank optional answers are not sent. */
function clean<T extends object>(o: T): T {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;
}
/** The current value stays a choice even when it is not one of the offered ones. */
const withCurrent = (list: string[], current: string) => (current && !list.includes(current) ? [current, ...list] : list);

function Text({ value, onChange, placeholder, type = 'text', inputMode, maxLength }: {
  value: string; onChange: (v: string) => void; placeholder?: string; type?: string; inputMode?: 'numeric' | 'tel' | 'text'; maxLength?: number;
}) {
  return <input type={type} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} inputMode={inputMode} maxLength={maxLength} style={inputStyle} />;
}

function Check({ checked, onChange, children }: { checked: boolean; onChange: (v: boolean) => void; children: ReactNode }) {
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, fontWeight: 400, color: 'var(--ink-2)', cursor: 'pointer', marginBottom: 16 }}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} style={{ width: 16, height: 16, accentColor: 'var(--accent)' }} />
      <span>{children}</span>
    </label>
  );
}

function PersonalEditor({ values: v, options, save, onCancel }: EditorProps<'personal'>) {
  const [f, setF] = useState({ fullName: str(v.fullName), dob: str(v.dob), gender: str(v.gender), maritalStatus: str(v.maritalStatus), nationality: str(v.nationality) });
  const set = (k: keyof typeof f) => (value: string) => setF((x) => ({ ...x, [k]: value }));
  return (
    <EditorShell onCancel={onCancel} onSave={() => save(clean({ fullName: f.fullName.trim(), dob: f.dob, gender: f.gender, maritalStatus: opt(f.maritalStatus), nationality: opt(f.nationality) }))}>
      <div style={grid2}>
        <Field label="Full name" required><Text value={f.fullName} onChange={set('fullName')} placeholder="As on the ID" /></Field>
        <Field label="Date of birth" required><Text type="date" value={f.dob} onChange={set('dob')} /></Field>
      </div>
      <div style={grid3}>
        <Field label="Gender" required><Select value={f.gender} onChange={set('gender')} placeholder="Select gender" options={withCurrent(options.genders, f.gender)} /></Field>
        <Field label="Marital status"><Select value={f.maritalStatus} onChange={set('maritalStatus')} placeholder="Select status" options={withCurrent(options.marital, f.maritalStatus)} /></Field>
        <Field label="Nationality"><Text value={f.nationality} onChange={set('nationality')} placeholder="Indian" /></Field>
      </div>
    </EditorShell>
  );
}

const blankAddress = (a?: Partial<PreboardingAddress> | null): PreboardingAddress => ({ line: str(a?.line), city: str(a?.city), state: str(a?.state), pin: str(a?.pin) });
const trimAddress = (a: PreboardingAddress): PreboardingAddress => ({ line: a.line.trim(), city: a.city.trim(), state: a.state.trim(), pin: a.pin.trim() });

function AddressFields({ what, value, onChange }: { what: string; value: PreboardingAddress; onChange: (a: PreboardingAddress) => void }) {
  const set = (k: keyof PreboardingAddress) => (v: string) => onChange({ ...value, [k]: v });
  return (
    <>
      <Field label={`${what}: house, building and street`} required><Text value={value.line} onChange={set('line')} /></Field>
      <div style={grid3}>
        <Field label="City" required><Text value={value.city} onChange={set('city')} /></Field>
        <Field label="State" required><Text value={value.state} onChange={set('state')} /></Field>
        <Field label="PIN code" required><Text value={value.pin} onChange={(x) => set('pin')(x.replace(/\D/g, ''))} inputMode="numeric" maxLength={6} placeholder="6 digits" /></Field>
      </div>
    </>
  );
}

function ContactEditor({ values: v, save, onCancel }: EditorProps<'contact'>) {
  const [mobile, setMobile] = useState(str(v.mobile));
  const [current, setCurrent] = useState(blankAddress(v.current));
  const [same, setSame] = useState(v.permanentSame !== false);
  const [permanent, setPermanent] = useState(blankAddress(v.permanent));
  return (
    <EditorShell onCancel={onCancel} onSave={() => save({ mobile: mobile.trim(), current: trimAddress(current), permanentSame: same, ...(same ? {} : { permanent: trimAddress(permanent) }) })}>
      <div style={grid2}>
        <Field label="Mobile number" required><Text value={mobile} onChange={setMobile} inputMode="tel" placeholder="+91 98765 43210" /></Field>
        <div />
      </div>
      <AddressFields what="Current address" value={current} onChange={setCurrent} />
      <Check checked={same} onChange={setSame}>The permanent address is the same as the current one.</Check>
      {!same && <AddressFields what="Permanent address" value={permanent} onChange={setPermanent} />}
    </EditorShell>
  );
}

function EmergencyEditor({ values: v, options, save, onCancel }: EditorProps<'emergency'>) {
  const c = v.emergencyContact;
  const [f, setF] = useState({ name: str(c?.name), relation: str(c?.relation), phone: str(c?.phone), altPhone: str(c?.altPhone) });
  const set = (k: keyof typeof f) => (value: string) => setF((x) => ({ ...x, [k]: value }));
  return (
    <EditorShell onCancel={onCancel} onSave={() => save({ emergencyContact: clean({ name: f.name.trim(), relation: f.relation, phone: f.phone.trim(), altPhone: opt(f.altPhone) }) })}>
      <div style={grid2}>
        <Field label="Name" required><Text value={f.name} onChange={set('name')} /></Field>
        <Field label="Relationship" required><Select value={f.relation} onChange={set('relation')} placeholder="Select relationship" options={withCurrent(options.relations, f.relation)} /></Field>
      </div>
      <div style={grid2}>
        <Field label="Mobile number" required><Text value={f.phone} onChange={set('phone')} inputMode="tel" placeholder="+91 98765 43210" /></Field>
        <Field label="Other number"><Text value={f.altPhone} onChange={set('altPhone')} inputMode="tel" /></Field>
      </div>
    </EditorShell>
  );
}

function BankEditor({ values: v, save, onCancel }: EditorProps<'bank'>) {
  const [f, setF] = useState({ holderName: str(v.holderName), accountNumber: '', ifsc: str(v.ifsc), bankName: str(v.bankName), uan: str(v.pf?.uan) });
  const [firstJob, setFirstJob] = useState(v.pf?.firstJob === true);
  const set = (k: keyof typeof f) => (value: string) => setF((x) => ({ ...x, [k]: value }));
  const last4 = str(v.accountLast4);
  return (
    <EditorShell onCancel={onCancel} onSave={() => save(clean({
      holderName: f.holderName.trim(), accountNumber: opt(f.accountNumber.replace(/\s+/g, '')), ifsc: f.ifsc.trim().toUpperCase(), bankName: opt(f.bankName),
      pf: clean({ firstJob, uan: firstJob ? undefined : opt(f.uan) }),
    }))}>
      <div style={grid2}>
        <Field label="Account holder" required><Text value={f.holderName} onChange={set('holderName')} /></Field>
        <Field label="Account number" required={!last4}>
          <Text value={f.accountNumber} onChange={(x) => set('accountNumber')(x.replace(/[^\d\s]/g, ''))} inputMode="numeric" placeholder={last4 ? `•••• ${last4} · leave blank to keep` : '6 to 20 digits'} />
        </Field>
      </div>
      <div style={grid2}>
        <Field label="IFSC" required><Text value={f.ifsc} onChange={(x) => set('ifsc')(x.toUpperCase())} maxLength={11} placeholder="e.g. HDFC0001234" /></Field>
        <Field label="Bank name"><Text value={f.bankName} onChange={set('bankName')} placeholder="e.g. HDFC Bank" /></Field>
      </div>
      <Check checked={firstJob} onChange={setFirstJob}>First job: no PF account (UAN) yet.</Check>
      {!firstJob && (
        <div style={grid2}>
          <Field label="UAN"><Text value={f.uan} onChange={(x) => set('uan')(x.replace(/\D/g, ''))} inputMode="numeric" maxLength={12} placeholder="12 digits" /></Field>
          <div />
        </div>
      )}
    </EditorShell>
  );
}

const blankJob = (): PreboardingJob => ({ company: '', role: '', from: '', to: '' });

function EducationEditor({ values: v, options, save, onCancel }: EditorProps<'education'>) {
  const [f, setF] = useState({ qualification: str(v.qualification), institution: str(v.institution), year: str(v.year) });
  const [firstJob, setFirstJob] = useState(v.firstJob === true);
  const [jobs, setJobs] = useState<PreboardingJob[]>(() => {
    const list = (v.jobs ?? []).map((j) => ({ company: str(j.company), role: str(j.role), from: str(j.from), to: str(j.to) }));
    return list.length ? list : [blankJob()];
  });
  const set = (k: keyof typeof f) => (value: string) => setF((x) => ({ ...x, [k]: value }));
  const setJob = (i: number, k: keyof PreboardingJob) => (value: string) => setJobs((all) => all.map((j, n) => (n === i ? { ...j, [k]: value } : j)));
  return (
    <EditorShell onCancel={onCancel} onSave={() => save({
      qualification: f.qualification, institution: f.institution.trim(), year: f.year.trim(), firstJob,
      jobs: firstJob ? [] : jobs.map((j) => clean({ company: j.company.trim(), role: j.role.trim(), from: j.from, to: opt(j.to ?? '') })),
    })}>
      <div style={grid3}>
        <Field label="Highest qualification" required><Select value={f.qualification} onChange={set('qualification')} placeholder="Select qualification" options={withCurrent(options.qualifications, f.qualification)} /></Field>
        <Field label="College or university" required><Text value={f.institution} onChange={set('institution')} /></Field>
        <Field label="Year of passing" required><Text value={f.year} onChange={(x) => set('year')(x.replace(/\D/g, ''))} inputMode="numeric" maxLength={4} placeholder="e.g. 2020" /></Field>
      </div>
      <Check checked={firstJob} onChange={setFirstJob}>This is their first job.</Check>
      {!firstJob && (
        <div style={{ display: 'grid', gap: 4, marginBottom: 12 }}>
          {jobs.map((j, i) => (
            <div key={i} style={{ border: '1px solid var(--line)', borderRadius: 14, padding: '12px 14px 0' }}>
              <div style={{ display: 'flex', alignItems: 'center', marginBottom: 10 }}>
                <span className="pd-eyebrow" style={{ flex: 1, color: 'var(--ink-3)' }}>{i === 0 ? 'Last job' : `Job ${i + 1}`}</span>
                {jobs.length > 1 && <button type="button" className="pd-sec-act" style={{ color: 'var(--bad)' }} onClick={() => setJobs((all) => all.filter((_, n) => n !== i))}>Remove</button>}
              </div>
              <div style={grid2}>
                <Field label="Company" required><Text value={j.company} onChange={setJob(i, 'company')} /></Field>
                <Field label="Role" required><Text value={j.role} onChange={setJob(i, 'role')} /></Field>
              </div>
              <div style={grid2}>
                <Field label="From" required><Text type="month" value={j.from} onChange={setJob(i, 'from')} /></Field>
                <Field label="To (blank if still there)"><Text type="month" value={j.to ?? ''} onChange={setJob(i, 'to')} /></Field>
              </div>
            </div>
          ))}
          {jobs.length < 5 && (
            <div><button type="button" className="pd-sec-act" onClick={() => setJobs((all) => [...all, blankJob()])}>+ Add a job</button></div>
          )}
        </div>
      )}
    </EditorShell>
  );
}

function IdsEditor({ values: v, save, onCancel }: EditorProps<'ids'>) {
  const [aadhaar, setAadhaar] = useState('');
  const [pan, setPan] = useState('');
  const aLast4 = str(v.aadhaarLast4);
  const pLast4 = str(v.panLast4);
  return (
    <EditorShell onCancel={onCancel} onSave={() => save(clean({ aadhaar: opt(aadhaar.replace(/\s+/g, '')), pan: opt(pan.toUpperCase()) }))}>
      <div style={grid2}>
        <Field label="Aadhaar number" required={!aLast4}>
          <Text value={aadhaar} onChange={(x) => setAadhaar(x.replace(/[^\d\s]/g, ''))} inputMode="numeric" maxLength={14} placeholder={aLast4 ? `•••• •••• ${aLast4} · leave blank to keep` : '12 digits'} />
        </Field>
        <Field label="PAN" required={!pLast4}>
          <Text value={pan} onChange={(x) => setPan(x.toUpperCase())} maxLength={10} placeholder={pLast4 ? `••••••${pLast4} · leave blank to keep` : 'ABCDE1234F'} />
        </Field>
      </div>
    </EditorShell>
  );
}

// —— Basic details and app access ————————————————————————————————————————

/** 'full_time' → 'Full-time', as the Employee profile words it. */
const typeWord = (v?: string) => (v ? Object.keys(EMP_TYPE_VALUE).find((k) => EMP_TYPE_VALUE[k] === v) ?? v : '');

/**
 * Basic details, edited as on the Employee profile. The name, mobile, gender and date of birth are
 * the candidate's answers: locked here, changed in their own sections. Only what changed is sent.
 */
function BasicEditor({ name, basic, joining, mobile, personal, save, onCancel }: {
  name: string; basic: PreboardingBasic; joining: string; mobile: string; personal: Partial<PreboardingSectionValues['personal']>;
  save: (body: PreboardingBasicInput) => Promise<void>; onCancel: () => void;
}) {
  const { emps } = useStore();
  const before = {
    employeeId: basic.employeeId ?? '', workEmail: basic.workEmail ?? '', designation: basic.designation ?? '', department: basic.department ?? '',
    workLocation: basic.workLocation ?? '', employeeType: basic.employeeType ?? '', tj: joining,
  };
  const [f, setF] = useState(before);
  const set = (k: keyof typeof f) => (value: string) => setF((x) => ({ ...x, [k]: value }));
  const { first, middle, last } = nameParts(name);
  const uniq = (values: string[]) => [...new Set(values.map((v) => v.trim()).filter((v) => v && v !== '—'))].sort();
  const elsewhere = (where: string) => `Change it under ${where}`;
  const submit = async () => {
    const changes: PreboardingBasicInput = {};
    for (const k of Object.keys(before) as Array<keyof typeof before>) {
      const value = k === 'employeeId' ? f[k].trim().toUpperCase() : k === 'workEmail' ? f[k].trim().toLowerCase() : f[k].trim();
      if (value !== before[k]) changes[k] = value;
    }
    if (Object.keys(changes).length === 0) { onCancel(); return; }
    await save(changes);
  };
  return (
    <EditorShell onCancel={onCancel} onSave={submit}>
      <div style={grid3}>
        <LockedField label="First name" value={first} title={elsewhere('Personal details')} />
        <LockedField label="Middle name" value={middle} title={elsewhere('Personal details')} />
        <LockedField label="Last name" value={last} title={elsewhere('Personal details')} />
      </div>
      <div style={grid2}>
        <Field label="Employee ID"><Text value={f.employeeId} onChange={(x) => set('employeeId')(x.toUpperCase())} /></Field>
        <Field label="Date of joining"><Text type="date" value={f.tj} onChange={set('tj')} /></Field>
      </div>
      <div style={grid2}>
        <Field label="Work email"><Text type="email" value={f.workEmail} onChange={set('workEmail')} placeholder="name@company.com" /></Field>
        <LockedField label="Mobile number" value={mobile} title={elsewhere('Contact and address')} />
      </div>
      <div style={grid2}>
        <Field label="Designation">
          <TypeOrPick id="pb-basic-designation" value={f.designation} onChange={set('designation')} placeholder="Type or pick a designation" options={uniq(emps.map((e) => e.role))} />
        </Field>
        <Field label="Department">
          <TypeOrPick id="pb-basic-department" value={f.department} onChange={set('department')} placeholder="Type or pick a department" options={uniq(emps.map((e) => e.team))} />
        </Field>
      </div>
      <div style={grid2}>
        <Field label="Work location">
          <TypeOrPick id="pb-basic-location" value={f.workLocation} onChange={set('workLocation')} placeholder="Type or pick a location" options={uniq(emps.map((e) => e.location))} />
        </Field>
        <Field label="Employee type">
          <Select value={typeWord(f.employeeType)} onChange={(v) => set('employeeType')(EMP_TYPE_VALUE[v] ?? '')} placeholder="Select type" options={Object.keys(EMP_TYPE_VALUE)} />
        </Field>
      </div>
      <div style={grid2}>
        <LockedField label="Gender" value={personal.gender ?? ''} title={elsewhere('Personal details')} />
        <LockedField label="Date of birth" value={personal.dob ? showDate(personal.dob) : ''} title={elsewhere('Personal details')} />
      </div>
    </EditorShell>
  );
}

/** Creates the candidate's app account with the card's Employee ID and work email, both shown (and changeable) first. */
function AppAccessDialog({ first, basic, onClose, onCreate }: {
  first: string; basic: PreboardingBasic; onClose: () => void; onCreate: (body: { employeeId: string; workEmail: string }) => Promise<void>;
}) {
  const [employeeId, setEmployeeId] = useState(basic.employeeId ?? '');
  const [workEmail, setWorkEmail] = useState(basic.workEmail ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const go = async () => {
    const id = employeeId.trim().toUpperCase();
    const email = workEmail.trim().toLowerCase();
    if (!id || !email) { setError(!id ? 'Add the Employee ID first' : 'Add the work email first'); return; }
    setBusy(true); setError('');
    try { await onCreate({ employeeId: id, workEmail: email }); } catch (e) { setError(errText(e, 'Could not create the app access')); setBusy(false); }
  };
  return (
    <Modal title={`Generate app access for ${first}`} sub={`${first} signs in to the app with this work email; punches are matched by the Employee ID.`} onClose={onClose} busy={busy} width={480}
      footer={<>
        <button type="button" className="pd-btn" onClick={onClose} disabled={busy}>Cancel</button>
        <button type="button" className="pd-btn primary" onClick={() => void go()} disabled={busy}>{busy ? 'Creating…' : 'Generate app access'}</button>
      </>}>
      <Field label="Employee ID" required>
        <input value={employeeId} onChange={(e) => setEmployeeId(e.target.value.toUpperCase())} autoFocus={!employeeId} style={inputStyle} />
      </Field>
      <Field label="Work email" required>
        <input type="email" value={workEmail} onChange={(e) => setWorkEmail(e.target.value)} autoFocus={Boolean(employeeId) && !workEmail} placeholder="name@company.com" style={inputStyle} />
      </Field>
      {error && <div role="alert" style={{ fontSize: 12.5, color: 'var(--bad)' }}>{error}</div>}
    </Modal>
  );
}
