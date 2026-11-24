// Setup › Employee lifecycle › Templates (S2), and one template. An onboarding
// template opens the Final designs' editor (OnboardingDesign.tsx: pre-boarding,
// onboarding, probation, the team's part). An offboarding template (S4) sets the
// tasks every leaver gets, by phase: who does each one, when it is due (from Tl,
// the last working day), whether it is a must-do, and whether it is on. The
// Recommended panel holds our suggestions, off until HR adds one. One template
// per kind is the default; changes apply to journeys that start after saving.
import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useStore } from '../../store';
import { canOpen } from '../../access';
import { ListPending, LoadError, SkeletonLines, StatusTabs } from '../../ui';
import { downloadCsv } from '../../export';
import { LIFECYCLE_TEMPLATES_KIND_KEY } from '../../setupGroups';
import { createTemplate, deleteTemplate, getTemplate, getTemplateJourneys, isNotAvailable, listTemplates, updateTemplate } from '../../../services/lifecycle';
import type { DueAnchor, DueRule, ExitTypeKey, LifecycleKind, LifecyclePhase, LifecycleTemplate, OwnerRole, TemplateJourney, TemplateListItem, TemplateTask } from '../../../services/lifecycle';
import { OnboardingDesign } from './OnboardingDesign';
import { ConfirmDialog, Field, Modal, NotSwitchedOn, Pick, Switch } from './shared';
import { OWNER_LABEL, PHASES, errText, readHandoff, inputStyle, linkBtn, longDay, phaseTitle, ruleText, sectionLabel } from './format';
import '../people.css';

const KINDS: LifecycleKind[] = ['onboarding', 'offboarding'];
const KIND_LABEL: Record<LifecycleKind, string> = { onboarding: 'Onboarding', offboarding: 'Offboarding' };
const LEAD: Record<LifecycleKind, ReactNode> = {
  onboarding: <>Templates set the tasks every joiner gets, from the offer to confirmation. Anyone not assigned to one follows the <strong style={{ fontWeight: 500, color: 'var(--ink-2)' }}>default</strong>.</>,
  offboarding: <>Every exit gets these tasks, dated from the last working day (Tl). Anyone not given another template follows the <strong style={{ fontWeight: 500, color: 'var(--ink-2)' }}>default</strong>.</>,
};
/** Who can do an offboarding task. */
const OWNERS: OwnerRole[] = ['employee', 'manager', 'manager_employee', 'hr', 'hr_manager', 'it', 'admin', 'finance', 'automatic'];
const EXIT_TYPES: [ExitTypeKey, string][] = [['resignation', 'Resignation'], ['retirement', 'Retirement'], ['end_of_contract', 'End of contract'], ['termination', 'Termination'], ['absconding', 'Absconding']];

const visibleTasks = (tasks: TemplateTask[]) => tasks.filter((t) => !t.recommended || t.recommended.added);
const taskCount = (t: LifecycleTemplate) => visibleTasks(t.tasks).filter((x) => x.enabled).length;
const newId = () => `t_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;

export function LifecycleTemplates() {
  const [kind, setKind] = useState<LifecycleKind>(() => {
    const k = readHandoff(LIFECYCLE_TEMPLATES_KIND_KEY) as LifecycleKind | null;
    return k && KINDS.includes(k) ? k : 'onboarding';
  });
  const [lists, setLists] = useState<Partial<Record<LifecycleKind, TemplateListItem[]>>>({});
  const [error, setError] = useState('');
  const [off, setOff] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [editing, setEditing] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    let live = true;
    setError('');
    Promise.all(KINDS.map((k) => listTemplates(k)))
      .then(([on, offb]) => { if (live) setLists({ onboarding: on, offboarding: offb }); })
      .catch((e) => { if (!live) return; if (isNotAvailable(e)) setOff(true); else setError(errText(e, 'Could not load the templates')); });
    return () => { live = false; };
  }, [attempt]);

  if (off) return <NotSwitchedOn />;
  const rows = lists[kind];
  const reload = () => setAttempt((n) => n + 1);

  if (editing) {
    // Onboarding: the Final designs' editor (the older task-table editor is offboarding's only).
    if (kind === 'onboarding') return <OnboardingDesign key={editing} id={editing} onBack={() => { setEditing(null); reload(); }} />;
    return <TemplateEditor key={editing} id={editing} siblings={rows ?? []} onBack={() => { setEditing(null); reload(); }} onOpen={(id) => { setEditing(id); reload(); }} />;
  }

  const exportTemplate = (t: LifecycleTemplate) => downloadCsv<TemplateTask>(`${t.kind}-template-${t.name.replace(/\s+/g, '-').toLowerCase()}`, [
    { header: 'Phase', value: (x) => phaseTitle(x.phase) },
    { header: 'Task', value: (x) => x.title },
    { header: 'Helper', value: (x) => x.helper ?? '' },
    { header: 'Done by', value: (x) => OWNER_LABEL[x.ownerRole] },
    { header: 'Opens', value: (x) => ruleText(x.opensRule) },
    { header: 'Due', value: (x) => ruleText(x.dueRule, x.dueLabel) },
    { header: 'Must-do', value: (x) => (x.mustDo ? 'Yes' : 'No') },
    { header: 'On', value: (x) => (x.enabled ? 'Yes' : 'No') },
  ], visibleTasks(t.tasks).slice().sort((a, b) => a.order - b.order));

  return (
    <div style={{ animation: 'fade .3s ease both' }}>
      <div className="pd-head">
        <p className="pd-lead">{LEAD[kind]}</p>
        <button type="button" className="pd-btn primary" onClick={() => setCreating(true)} disabled={!rows}>+ Create New</button>
      </div>
      <div style={{ marginBottom: 16 }}>
        <StatusTabs<LifecycleKind> options={KINDS} active={kind} onSelect={setKind} labels={KIND_LABEL} counts={{ onboarding: lists.onboarding?.length, offboarding: lists.offboarding?.length }} />
      </div>
      <section className="pd-card">
        <div className="pd-tbl-wrap">
          <table className="pd-t" style={{ minWidth: 720 }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left' }}>Template</th>
                <th style={{ textAlign: 'left', width: 140 }}>{kind === 'onboarding' ? 'Probation' : 'Final settlement'}</th>
                <th style={{ textAlign: 'left', width: 240 }}>Tasks</th>
                <th style={{ textAlign: 'left', width: 170 }}>{kind === 'onboarding' ? 'Joiners using it' : 'Exits using it'}</th>
                <th style={{ width: 100 }} />
              </tr>
            </thead>
            <tbody>
              {rows?.map((t) => (
                <tr key={t.id} className="pd-click" onClick={() => setEditing(t.id)}>
                  <td>
                    <span className="pd-who">
                      <span className="txt">
                        <b style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                          {t.name}
                          {t.isDefault && <span style={defaultPill}>Default</span>}
                          {!t.active && <span style={inactivePill}>Inactive</span>}
                        </b>
                        {t.group && <span className="sub">{t.group}</span>}
                      </span>
                    </span>
                  </td>
                  <td>{kind === 'onboarding' ? (t.settings.probationMonths ? `${t.settings.probationMonths} months` : '—') : (typeof t.settings.settlementWorkingDays === 'number' ? `${t.settings.settlementWorkingDays} working days after` : '—')}</td>
                  <td>
                    <span style={{ fontWeight: 500 }}>{taskCount(t)}</span> tasks
                    {t.recommendedNotAdded > 0 && <div style={{ fontSize: 11.5, color: 'var(--ink-3)' }}>{t.recommendedNotAdded} recommended not added</div>}
                  </td>
                  <td><span style={{ fontWeight: 500, color: t.journeysUsing ? 'var(--ink)' : 'var(--ink-3)' }}>{t.journeysUsing}</span> <span style={{ color: 'var(--ink-3)' }}>{kind === 'onboarding' ? (t.journeysUsing === 1 ? 'joiner' : 'joiners') : (t.journeysUsing === 1 ? 'exit' : 'exits')}</span></td>
                  <td style={{ textAlign: 'right' }}>
                    <button type="button" className="pd-btn sm" onClick={(e) => { e.stopPropagation(); exportTemplate(t); }}>Export</button>
                  </td>
                </tr>
              ))}
              {rows && rows.length === 0 && (
                <tr><td colSpan={5} className="pd-empty">No {kind} templates yet. Create one and make it the default; everyone follows it until given another.</td></tr>
              )}
              {!rows && (
                <tr><td colSpan={5} style={{ padding: 0 }}><ListPending state={error ? 'error' : 'loading'} errorText={error} onRetry={reload} rows={3} cols={4} avatar={false} rowHeight={56} /></td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
      {creating && rows && <CreateTemplateDialog kind={kind} templates={rows} onClose={() => setCreating(false)} onCreated={(id) => { setCreating(false); setEditing(id); }} />}
    </div>
  );
}

function CreateTemplateDialog({ kind, templates, onClose, onCreated }: { kind: LifecycleKind; templates: TemplateListItem[]; onClose: () => void; onCreated: (id: string) => void }) {
  const [name, setName] = useState('');
  const [group, setGroup] = useState('');
  const [copyFrom, setCopyFrom] = useState(templates.find((t) => t.isDefault)?.id ?? templates[0]?.id ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const go = async () => {
    if (!name.trim()) { setError('Give the template a name'); return; }
    setBusy(true); setError('');
    try {
      const t = await createTemplate({ kind, name: name.trim(), group: group.trim() || undefined, copyFromId: copyFrom || undefined });
      onCreated(t.id);
    } catch (e) { setError(errText(e, 'Could not create the template')); setBusy(false); }
  };
  return (
    <Modal title={`New ${kind} template`} sub={kind === 'onboarding' ? 'It starts as a copy.' : 'It starts as a copy, with our recommended tasks ready to add.'} onClose={onClose} busy={busy} width={480}
      footer={<><button type="button" className="pd-btn" onClick={onClose} disabled={busy}>Cancel</button><button type="button" className="pd-btn primary" onClick={() => void go()} disabled={busy}>{busy ? 'Creating…' : 'Create'}</button></>}>
      <Field label="Template name" required error={error}>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder={kind === 'onboarding' ? 'e.g. Faculty' : 'e.g. Interns'} style={inputStyle} autoFocus />
      </Field>
      <Field label="Who it is for" hint="Optional, e.g. Full-time staff">
        <input value={group} onChange={(e) => setGroup(e.target.value)} style={inputStyle} />
      </Field>
      <Field label="Start from">
        <Pick value={copyFrom} onChange={setCopyFrom}>
          <option value="">Our standard tasks</option>
          {templates.map((t) => <option key={t.id} value={t.id}>A copy of {t.name}{t.isDefault ? ' (default)' : ''}</option>)}
        </Pick>
      </Field>
    </Modal>
  );
}

// —— Leavers on a template (S4's Leavers tab) ————————————————————————————

const JOURNEY_STATUS: Record<string, string> = {
  draft: 'Offer not sent', offer_sent: 'Offer sent', accepted: 'Accepted', finalised: 'Finalised', active: 'On the portal', docs_approved: 'Documents approved',
  joined: 'Joined', moved_to_app: 'On the app', confirmed: 'Confirmed', declined: 'Declined', expired: 'Expired', not_joining: 'Not joining',
};
const COLUMN_NAME: Record<string, string> = {
  offer_sent: 'Offer sent', accepted: 'Accepted', documents: 'Documents', letters: 'Letters to sign', ready_to_join: 'Ready to join',
  day1: 'Day 1', week1_tasks: 'Week-1 tasks', day7_survey: 'Day-7 survey', week_done: 'Week done',
  month1: 'Month 1', months_2_5: 'Months 2–5', final_month: 'Final month', confirmed: 'Confirmed',
};

/**
 * Who follows this template. Each journey keeps the tasks the template had
 * when it started (a snapshot), so nobody is moved from here: the list opens
 * the Offboarding board.
 */
function TemplatePeople({ id }: { id: string }) {
  const { setView } = useStore();
  const [rows, setRows] = useState<TemplateJourney[] | null>(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let live = true;
    setError('');
    getTemplateJourneys(id).then((r) => { if (live) setRows(r); }).catch((e) => { if (live) setError(errText(e, 'Could not load who follows this template')); });
    return () => { live = false; };
  }, [id, attempt]);
  return (
    <section className="pd-card">
      <p className="pd-lead" style={{ marginTop: 0 }}>
        Everyone leaving on this template now. Each one keeps the tasks the template had when they started, so changes you save apply to people who start after that, and nobody moves to another template part-way.
      </p>
      {error ? <LoadError text={error} onRetry={() => setAttempt((n) => n + 1)} />
        : !rows ? <SkeletonLines lines={5} />
          : rows.length === 0 ? <div className="pd-empty">No leavers on this template right now.</div>
            : (
              <div className="pd-list">
                {rows.map((r) => (
                  <div key={r.journeyId} className="pd-li">
                    <span className="grow">
                      <b>{r.name}</b>
                      <span className="s">{[
                        [r.designation, r.department].filter(Boolean).join(' · '),
                        r.column ? COLUMN_NAME[r.column] ?? r.column : JOURNEY_STATUS[r.status] ?? r.status,
                        r.tj ? `joins ${longDay(r.tj)}` : r.tl ? `last day ${longDay(r.tl)}` : '',
                      ].filter(Boolean).join(' · ')}</span>
                    </span>
                    <button type="button" className="pd-btn sm" onClick={() => setView('offboarding')}>Open board</button>
                  </div>
                ))}
              </div>
            )}
    </section>
  );
}

// —— The editor ——————————————————————————————————————————————————————————

function TemplateEditor({ id, siblings, onBack, onOpen }: { id: string; siblings: TemplateListItem[]; onBack: () => void; onOpen: (id: string) => void }) {
  const { flash, setView, user } = useStore();
  const [saved, setSaved] = useState<LifecycleTemplate | null>(null);
  const [draft, setDraft] = useState<LifecycleTemplate | null>(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState('');
  const [openTask, setOpenTask] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [nameError, setNameError] = useState('');
  const [tab, setTab] = useState<'template' | 'joiners'>('template');
  const [renaming, setRenaming] = useState(false);

  useEffect(() => {
    let live = true;
    setError('');
    getTemplate(id).then((t) => { if (live) { setSaved(t); setDraft(structuredClone(t)); } }).catch((e) => { if (live) setError(errText(e, 'Could not load the template')); });
    return () => { live = false; };
  }, [id, attempt]);

  const dirty = useMemo(() => Boolean(saved && draft && JSON.stringify(saved) !== JSON.stringify(draft)), [saved, draft]);
  const usage = siblings.find((s) => s.id === id)?.journeysUsing ?? 0;

  if (!draft || !saved) {
    return (
      <div>
        <button type="button" onClick={onBack} className="pd-btn ghost sm" style={{ marginLeft: -12, marginBottom: 16 }}>← All templates</button>
        <section className="pd-card"><ListPending state={error ? 'error' : 'loading'} errorText={error} onRetry={() => setAttempt((n) => n + 1)} rows={6} cols={3} avatar={false} /></section>
      </div>
    );
  }

  const t = draft;
  const setT = (patch: Partial<LifecycleTemplate>) => setDraft((d) => (d ? { ...d, ...patch } : d));
  const setSettings = (patch: Partial<LifecycleTemplate['settings']>) => setT({ settings: { ...t.settings, ...patch } });
  const setTask = (taskId: string, patch: Partial<TemplateTask>) => setT({ tasks: t.tasks.map((x) => (x.id === taskId ? { ...x, ...patch } : x)) });
  const phases = PHASES[t.kind];
  const inPhase = (p: LifecyclePhase) => visibleTasks(t.tasks).filter((x) => x.phase === p).sort((a, b) => a.order - b.order);
  const recommended = t.tasks.filter((x) => x.recommended && !x.recommended.added);
  const nextOrder = (p: LifecyclePhase) => Math.max(0, ...t.tasks.filter((x) => x.phase === p).map((x) => x.order)) + 1;

  const move = (task: TemplateTask, by: -1 | 1) => {
    const list = inPhase(task.phase);
    const i = list.findIndex((x) => x.id === task.id);
    const j = i + by;
    if (j < 0 || j >= list.length) return;
    const other = list[j];
    setT({ tasks: t.tasks.map((x) => (x.id === task.id ? { ...x, order: other.order } : x.id === other.id ? { ...x, order: task.order } : x)) });
  };
  const addTask = (p: LifecyclePhase) => {
    const anchor: DueAnchor = 'tl';
    const task: TemplateTask = {
      id: newId(), phase: p, title: '', ownerRole: 'hr', kind: 'ack', surface: 'dashboard', mustDo: false, enabled: true,
      order: nextOrder(p), dueRule: { anchor, offset: 0, unit: 'days' }, opensRule: null,
    };
    setT({ tasks: [...t.tasks, task] });
    setOpenTask(task.id);
  };
  const addRecommended = (task: TemplateTask) => {
    setTask(task.id, { recommended: { why: task.recommended?.why ?? '', added: true }, enabled: true, order: nextOrder(task.phase) });
    flash(`${task.title} added to ${phaseTitle(task.phase)}`);
  };

  const save = async (extra?: Partial<LifecycleTemplate>) => {
    if (!t.name.trim()) { setNameError('Give the template a name'); window.scrollTo({ top: 0, behavior: 'smooth' }); return false; }
    const untitled = visibleTasks(t.tasks).find((x) => !x.title.trim());
    if (untitled) { setOpenTask(untitled.id); flash('Every task needs a name', 'error'); return false; }
    setNameError('');
    setBusy('save');
    try {
      // Orders numbered again 1, 2, 3… within each phase, as they are shown.
      const ordered: TemplateTask[] = [];
      for (const p of phases) inPhase(p.key).forEach((x, i) => ordered.push({ ...x, title: x.title.trim(), order: i + 1 }));
      const rest = t.tasks.filter((x) => !ordered.some((o) => o.id === x.id));
      const next = await updateTemplate(id, { name: t.name.trim(), group: t.group?.trim() || undefined, active: t.active, settings: t.settings, tasks: [...ordered, ...rest], ...extra });
      setSaved(next); setDraft(structuredClone(next));
      flash(`${next.name} saved. Changes apply to people who ${t.kind === 'onboarding' ? 'join' : 'leave'} after this`);
      return true;
    } catch (e) { flash(errText(e, 'Could not save the template'), 'error'); return false; } finally { setBusy(''); }
  };
  const makeDefault = async () => {
    if (dirty) { await save({ isDefault: true }); return; }
    setBusy('default');
    try { const next = await updateTemplate(id, { isDefault: true }); setSaved(next); setDraft(structuredClone(next)); flash(`${next.name} is now the default ${t.kind} template`); } catch (e) { flash(errText(e), 'error'); } finally { setBusy(''); }
  };
  const duplicate = async () => {
    if (dirty && !window.confirm('Duplicate the saved template? Your unsaved changes stay here and are not copied.')) return;
    setBusy('dup');
    try { const copy = await createTemplate({ kind: t.kind, name: `${saved.name} (copy)`, group: saved.group, copyFromId: id }); flash(`${copy.name} created`); onOpen(copy.id); } catch (e) { flash(errText(e), 'error'); } finally { setBusy(''); }
  };
  const back = () => { if (!dirty || window.confirm('Leave without saving your changes?')) onBack(); };

  // The offboarding template, as the design canvas draws it (24 Nov 2026, HR: "use this as offboarding
  // everywhere"): a header with one action, the rules folded into one line, and the journey as five steps,
  // each opening to its tasks (who, when, a lock for must-dos, a switch for the rest), what happens on its
  // own, and our suggestions as one-tap chips. Clicking a task's name edits it.
  const s = t.settings;
  const rulesLine = `Settled in ${s.settlementWorkingDays ?? 2} working ${s.settlementWorkingDays === 1 ? 'day' : 'days'} · access ends ${(s.accountCloses ?? 'tl_plus_1') === 'tl_plus_1' ? 'the day after' : 'on the last day'}`;
  const toggleStage = (k: string) => setCollapsed((c) => { const n = new Set(c); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const STEP_NAME: Partial<Record<LifecyclePhase, string>> = { resignation: 'They resign', when_accepted: 'Resignation accepted', notice_period: 'Notice period', last_day: 'Last day', after_exit: 'After they leave' };
  return (
    <div className="pd-form ob-tpl" style={{ maxWidth: 1060, display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Header: one title, one action */}
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 16, padding: '8px 4px' }}>
        <button type="button" onClick={back} aria-label="Back to templates" style={circleBtn}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden><path d="M15 6l-6 6 6 6" /></svg>
        </button>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: '1 1 260px', minWidth: 0 }}>
          <span style={{ fontSize: 13, color: 'var(--ink-3)' }}>Offboarding template</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <h1 style={{ margin: 0, fontSize: 26, fontWeight: 600, overflowWrap: 'anywhere' }}>{t.name || 'Untitled'}</h1>
            {saved.isDefault && <span style={{ fontSize: 12, fontWeight: 500, padding: '4px 10px', borderRadius: 999, background: 'var(--accent-soft)', color: 'var(--accent-ink)' }}>Default</span>}
            {!t.active && <span style={inactivePill}>Off</span>}
          </div>
        </div>
        <div role="tablist" aria-label="Template or leavers" style={{ display: 'flex', background: 'var(--surface)', borderRadius: 999, padding: 4 }}>
          {(['template', 'joiners'] as const).map((k) => (
            <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
              style={{ border: 0, borderRadius: 999, padding: '10px 18px', background: tab === k ? 'var(--ink)' : 'transparent', color: tab === k ? 'var(--surface)' : 'var(--ink)', font: 'inherit', fontSize: 14, cursor: 'pointer' }}>
              {k === 'template' ? 'Template' : <>Leavers <span style={{ color: tab === k ? 'inherit' : 'var(--ink-3)' }}>{usage}</span></>}
            </button>
          ))}
        </div>
        <MoreMenu items={[
          { label: 'Rename', onClick: () => setRenaming(true) },
          ...(saved.isDefault ? [] : [{ label: 'Make default', onClick: () => void makeDefault(), disabled: !t.active }]),
          { label: 'Duplicate', onClick: () => void duplicate() },
          { label: t.active ? 'Turn off' : 'Turn on', onClick: () => setT({ active: !t.active }), disabled: saved.isDefault },
          ...(saved.isDefault ? [] : [{ label: 'Delete', onClick: () => setConfirmDelete(true), danger: true }]),
        ]} busy={Boolean(busy)} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button type="button" onClick={() => void save()} disabled={Boolean(busy) || !dirty}
            style={{ border: 0, borderRadius: 999, padding: '12px 24px', background: dirty ? 'var(--brand, #B23500)' : 'var(--line-2)', color: dirty ? '#fff' : 'var(--ink-3)', font: 'inherit', fontSize: 15, fontWeight: 500, cursor: dirty ? 'pointer' : 'default' }}>
            {busy === 'save' ? 'Saving…' : dirty ? 'Save' : 'Saved'}
          </button>
          <Tip label="Who the changes apply to" right>Changes apply to exits that start after you save.{usage > 0 ? ` The ${usage} ${usage === 1 ? 'person' : 'people'} leaving now keep the tasks they started with.` : ''}</Tip>
        </div>
      </div>

      {tab === 'joiners' && <section className="pd-card"><TemplatePeople id={id} /></section>}

      {tab === 'template' && (<>
        {/* Rules: glimpse first */}
        <section style={card}>
          <button type="button" onClick={() => toggleStage('__rules')} aria-expanded={!collapsed.has('__rules') ? false : true}
            style={{ width: '100%', border: 0, background: 'transparent', padding: '22px 28px', display: 'flex', alignItems: 'center', gap: 16, textAlign: 'left', color: 'var(--ink)', font: 'inherit', cursor: 'pointer' }}>
            <span style={{ fontSize: 17, fontWeight: 600, flex: '0 0 auto' }}>Rules</span>
            <span style={{ fontSize: 14, color: 'var(--ink-3)', flex: '1 1 auto', minWidth: 0 }}>{rulesLine}</span>
            <Chevron open={collapsed.has('__rules')} />
          </button>
          {collapsed.has('__rules') && (
            <div style={{ padding: '4px 28px 28px', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 20 }}>
              <RuleSelect label="Final settlement" value={String(s.settlementWorkingDays ?? 2)} onChange={(v) => setSettings({ settlementWorkingDays: Number(v) })}
                options={[...new Set([2, 5, 7, 10, s.settlementWorkingDays ?? 2])].sort((x, y) => x - y).map((n) => [String(n), `${n} working ${n === 1 ? 'day' : 'days'} after`])} />
              <RuleSelect label="Gratuity" value={String(s.gratuityDays ?? 30)} onChange={(v) => setSettings({ gratuityDays: Number(v) })}
                options={[...new Set([30, 45, 60, s.gratuityDays ?? 30])].sort((x, y) => x - y).map((n) => [String(n), `${n} days after`])} />
              <RuleSelect label="App access ends" value={s.accountCloses ?? 'tl_plus_1'} onChange={(v) => setSettings({ accountCloses: v as 'tl_plus_1' | 'tl_end_of_shift' })}
                options={[['tl_plus_1', 'The day after the last day'], ['tl_end_of_shift', 'On the last day']]} />
              <RuleSelect label="Exit interview opens" value={String(s.exitInterviewOpensDays ?? 5)} onChange={(v) => setSettings({ exitInterviewOpensDays: Number(v) })}
                options={[...new Set([0, 5, 7, s.exitInterviewOpensDays ?? 5])].sort((x, y) => x - y).map((n) => [String(n), n === 0 ? 'On the last day' : `${n} days before the last day`])} />
              <div style={{ gridColumn: '1 / -1', display: 'flex', flexDirection: 'column', gap: 12, paddingTop: 12, borderTop: '1px solid var(--line)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--ink-3)' }}>
                  Leaver sees the off-boarding page in the app for
                  <Tip label="About the off-boarding page">The page with their last day, before-you-go tasks and exit interview. It stays off for termination and absconding unless ticked.</Tip>
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 20, fontSize: 15 }}>
                  {EXIT_TYPES.map(([k, label]) => {
                    const list = s.appPageFor ?? ['resignation', 'retirement', 'end_of_contract'];
                    return (
                      <label key={k} style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                        <input type="checkbox" checked={list.includes(k)} style={{ width: 18, height: 18, accentColor: 'var(--ink)' }}
                          onChange={(e) => setSettings({ appPageFor: e.target.checked ? [...new Set([...list, k])] : list.filter((x) => x !== k) })} /> {label}
                      </label>
                    );
                  })}
                </div>
                <div style={{ fontSize: 13, color: 'var(--ink-3)' }}>
                  Salary hold on notice: {canOpen(user, 'exitsettings') ? <button type="button" style={linkBtn} onClick={() => { if (!dirty || window.confirm('Leave without saving your changes?')) setView('exitsettings'); }}>Payroll › Exit settings</button> : 'Payroll › Exit settings'}
                </div>
              </div>
            </div>
          )}
        </section>

        {/* The journey */}
        <section style={{ ...card, padding: '24px 28px 12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingBottom: 8 }}>
            <h2 style={{ margin: 0, fontSize: 17, fontWeight: 600 }}>When someone leaves</h2>
            <Tip label="How dates work">Every date counts from the last working day. If the last day moves (another day agreed, or an early release), every task moves with it.</Tip>
          </div>
          {phases.map((p, i) => {
            const all = inPhase(p.key);
            const people = all.filter((x) => x.ownerRole !== 'automatic');
            const autos = all.filter((x) => x.ownerRole === 'automatic');
            const on = people.filter((x) => x.enabled).length;
            const isOpen = collapsed.has(p.key);
            const autoOpen = collapsed.has(`auto:${p.key}`);
            const sugs = recommended.filter((r) => r.phase === p.key);
            return (
              <div key={p.key} style={{ borderTop: '1px solid var(--line)' }}>
                <button type="button" onClick={() => toggleStage(p.key)} aria-expanded={isOpen}
                  style={{ width: '100%', border: 0, background: 'transparent', padding: '18px 0', display: 'flex', alignItems: 'center', gap: 16, textAlign: 'left', color: 'var(--ink)', font: 'inherit', cursor: 'pointer' }}>
                  <span style={{ width: 32, height: 32, borderRadius: '50%', background: 'var(--surface-2)', fontSize: 14, fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', flex: '0 0 auto' }}>{i + 1}</span>
                  <span style={{ fontSize: 16, fontWeight: 500, flex: '1 1 auto' }}>{STEP_NAME[p.key] ?? p.title}</span>
                  <span style={{ fontSize: 14, color: 'var(--ink-3)' }}>{on === people.length ? `${people.length} ${people.length === 1 ? 'task' : 'tasks'}` : `${on} of ${people.length} on`}</span>
                  <Chevron open={isOpen} />
                </button>
                {isOpen && (
                  <div style={{ padding: '0 0 16px 48px', display: 'flex', flexDirection: 'column' }}>
                    <div style={{ display: 'grid', gridTemplateColumns: STEP_COLS, gap: 12, padding: '0 12px 8px', fontSize: 12, color: 'var(--ink-3)' }}>
                      <span>Task</span><span>Who</span><span>When</span><span />
                    </div>
                    {people.length === 0 && <div style={{ padding: '8px 12px', fontSize: 14, color: 'var(--ink-3)' }}>No tasks here yet.</div>}
                    {people.map((task, n) => (
                      <div key={task.id}>
                        <div className="ob-row" style={{ display: 'grid', gridTemplateColumns: STEP_COLS, gap: 12, alignItems: 'center', padding: 12, borderRadius: 12, opacity: task.enabled ? 1 : 0.45, fontSize: 15 }}>
                          <span style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                            <button type="button" onClick={() => setOpenTask(openTask === task.id ? null : task.id)} title="Edit this task"
                              style={{ border: 0, background: 'none', padding: 0, font: 'inherit', fontSize: 15, color: 'var(--ink)', cursor: 'pointer', textAlign: 'left', overflowWrap: 'anywhere' }}>
                              {task.title || <span style={{ color: 'var(--ink-3)' }}>New task</span>}
                            </button>
                            {task.helper && <Tip label="More about this task">{task.helper}</Tip>}
                          </span>
                          <span style={{ color: 'var(--ink-3)' }}>{OWNER_LABEL[task.ownerRole]}</span>
                          <span style={{ color: 'var(--ink-3)' }}>{ruleText(task.dueRule, task.dueLabel)}</span>
                          <span style={{ justifySelf: 'end' }}>
                            {task.mustDo ? (
                              <Tip label="Must-do, always on" right icon={<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></svg>}>Must-do. Every exit needs this, so it stays on.</Tip>
                            ) : (
                              <Switch on={task.enabled} onChange={(v) => setTask(task.id, { enabled: v })} label={`${task.enabled ? 'Turn off' : 'Turn on'} ${task.title || 'this task'}`} />
                            )}
                          </span>
                        </div>
                        {openTask === task.id && (
                          <TaskEditor task={task} first={n === 0} last={n === people.length - 1}
                            onChange={(patch) => setTask(task.id, patch)} onMove={(by) => move(task, by)}
                            onRemove={() => { if (task.recommended) setTask(task.id, { recommended: { ...task.recommended, added: false } }); else setT({ tasks: t.tasks.filter((x) => x.id !== task.id) }); setOpenTask(null); }}
                            onDone={() => setOpenTask(null)} />
                        )}
                      </div>
                    ))}
                    {autos.length > 0 && (
                      <>
                        <button type="button" onClick={() => toggleStage(`auto:${p.key}`)} aria-expanded={autoOpen}
                          style={{ alignSelf: 'flex-start', border: 0, background: 'transparent', padding: 12, fontSize: 14, color: 'var(--ink-3)', display: 'flex', alignItems: 'center', gap: 6, font: 'inherit', cursor: 'pointer' }}>
                          {autos.length === 1 ? '1 thing happens on its own' : `${autos.length} things happen on their own`}
                          <Chevron open={autoOpen} size={14} />
                        </button>
                        {autoOpen && autos.map((a) => (
                          <div key={a.id} style={{ display: 'grid', gridTemplateColumns: STEP_COLS, gap: 12, padding: '8px 12px', fontSize: 14, color: 'var(--ink-3)', alignItems: 'center' }}>
                            <span>{a.title}</span><span>Automatic</span><span>{ruleText(a.dueRule, a.dueLabel)}</span>
                            <span style={{ justifySelf: 'end' }}>{!a.mustDo && <Switch on={a.enabled} onChange={(v) => setTask(a.id, { enabled: v })} label={`${a.enabled ? 'Turn off' : 'Turn on'} ${a.title}`} />}</span>
                          </div>
                        ))}
                      </>
                    )}
                    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, padding: '8px 12px 0' }}>
                      <button type="button" onClick={() => addTask(p.key)} style={{ border: '1px solid var(--line-2)', background: 'var(--surface)', borderRadius: 999, padding: '10px 16px', fontSize: 14, color: 'var(--ink)', font: 'inherit', cursor: 'pointer' }}>+ Add task</button>
                      {sugs.map((r) => (
                        <button key={r.id} type="button" onClick={() => addRecommended(r)} title={r.recommended?.why || undefined}
                          style={{ border: '1px dashed var(--line-2)', background: 'transparent', borderRadius: 999, padding: '10px 16px', fontSize: 14, color: 'var(--ink-3)', font: 'inherit', cursor: 'pointer' }}>+ {r.title}</button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </section>
      </>)}

      {renaming && (
        <Modal title="Rename template" width={440} onClose={() => setRenaming(false)}
          footer={<button type="button" className="pd-btn primary" onClick={() => { if (t.name.trim()) setRenaming(false); else setNameError('Give the template a name'); }}>Done</button>}>
          <div style={{ display: 'grid', gap: 12 }}>
            <Field label="Template name" required error={nameError}><input value={t.name} onChange={(e) => setT({ name: e.target.value })} style={inputStyle} autoFocus /></Field>
            <Field label="Who it is for" hint="Optional"><input value={t.group ?? ''} onChange={(e) => setT({ group: e.target.value })} placeholder="e.g. Full-time staff" style={inputStyle} /></Field>
            <div style={{ fontSize: 12.5, color: 'var(--ink-3)' }}>Then Save on the page.</div>
          </div>
        </Modal>
      )}

      {confirmDelete && (
        <ConfirmDialog title={`Delete ${saved.name}?`} confirm="Delete"
          body={usage > 0 ? `${usage} ${usage === 1 ? 'exit is' : 'exits are'} on this template, so it may not be deleted. Turn it off instead, so nobody new gets it.` : 'Nobody is on this template. It goes for good.'}
          onClose={() => setConfirmDelete(false)}
          onConfirm={async () => { await deleteTemplate(id); flash(`${saved.name} deleted`); setConfirmDelete(false); onBack(); }} />
      )}
    </div>
  );
}

const STEP_COLS = 'minmax(0, 1fr) minmax(110px, 160px) minmax(130px, 200px) 56px';
const card = { background: 'var(--surface)', borderRadius: 24, overflow: 'visible' } as const;
const circleBtn = { width: 44, height: 44, borderRadius: '50%', border: 0, background: 'var(--surface)', color: 'var(--ink)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flex: '0 0 auto' } as const;

function Chevron({ open, size = 18 }: { open: boolean; size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden style={{ transform: `rotate(${open ? 180 : 0}deg)`, transition: 'transform .15s', flex: '0 0 auto', color: 'var(--ink-3)' }}><path d="M6 9l6 6 6-6" /></svg>;
}

/** An "i" (or an icon) that shows a short explanation on hover or focus. */
function Tip({ label, children, right, icon }: { label: string; children: ReactNode; right?: boolean; icon?: ReactNode }) {
  const [shown, setShown] = useState(false);
  return (
    <span style={{ position: 'relative', display: 'inline-flex', verticalAlign: 'middle' }} onMouseEnter={() => setShown(true)} onMouseLeave={() => setShown(false)}>
      <button type="button" aria-label={label} onFocus={() => setShown(true)} onBlur={() => setShown(false)}
        style={icon ? { width: 44, height: 26, border: 0, background: 'transparent', color: 'var(--ink-4)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'help' }
          : { width: 24, height: 24, borderRadius: '50%', border: '1px solid var(--line-2)', background: 'transparent', color: 'var(--ink-3)', fontSize: 12, fontWeight: 600, cursor: 'help', font: 'inherit', padding: 0 }}>
        {icon ?? 'i'}
      </button>
      {shown && (
        <span role="tooltip" style={{ position: 'absolute', top: 30, ...(right ? { right: -10 } : { left: -10 }), width: 270, background: 'var(--ink)', color: 'var(--surface)', fontSize: 13, lineHeight: 1.5, padding: '10px 12px', borderRadius: 10, zIndex: 20, fontWeight: 400, textAlign: 'left' }}>{children}</span>
      )}
    </span>
  );
}

function RuleSelect({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: [string, string][] }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 13, color: 'var(--ink-3)' }}>{label}
      <select value={value} onChange={(e) => onChange(e.target.value)}
        style={{ height: 48, border: '1px solid var(--line-2)', borderRadius: 12, padding: '0 14px', fontSize: 15, color: 'var(--ink)', background: 'var(--surface)', font: 'inherit' }}>
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </label>
  );
}

/** The "…" button: rename, make default, duplicate, on/off, delete. */
function MoreMenu({ items, busy }: { items: { label: string; onClick: () => void; disabled?: boolean; danger?: boolean }[]; busy: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <span style={{ position: 'relative' }}>
      <button type="button" aria-label="More: rename, duplicate, default" aria-expanded={open} onClick={() => setOpen(!open)} disabled={busy} style={circleBtn}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden><circle cx="5" cy="12" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle cx="19" cy="12" r="1.8" /></svg>
      </button>
      {open && (
        <>
          <span onClick={() => setOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 20 }} />
          <span role="menu" style={{ position: 'absolute', top: 50, right: 0, zIndex: 21, minWidth: 180, background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 14, boxShadow: 'var(--shadow-lg)', padding: 6, display: 'flex', flexDirection: 'column' }}>
            {items.map((it) => (
              <button key={it.label} type="button" role="menuitem" disabled={it.disabled} onClick={() => { setOpen(false); it.onClick(); }}
                style={{ border: 0, background: 'transparent', textAlign: 'left', padding: '10px 12px', borderRadius: 10, font: 'inherit', fontSize: 14, color: it.danger ? 'var(--bad)' : 'var(--ink)', cursor: it.disabled ? 'default' : 'pointer', opacity: it.disabled ? 0.45 : 1 }}>
                {it.label}
              </button>
            ))}
          </span>
        </>
      )}
    </span>
  );
}

function TaskEditor({ task, first, last, onChange, onMove, onRemove, onDone }: {
  task: TemplateTask; first: boolean; last: boolean;
  onChange: (p: Partial<TemplateTask>) => void; onMove: (by: -1 | 1) => void; onRemove: () => void; onDone: () => void;
}) {
  const system = Boolean(task.systemKey);
  const surfaceFor = (o: OwnerRole): TemplateTask['surface'] => (o === 'employee' || o === 'manager' || o === 'manager_employee' ? 'app' : o === 'automatic' ? 'backend' : 'dashboard');
  // A meeting: its agenda.
  const isMeeting = task.kind === 'meeting' || task.kind === 'checkin';
  const agendaText = task.agenda?.join('\n') ?? '';
  return (
    <div style={{ background: 'var(--surface-2)', borderRadius: 14, padding: 16, margin: '0 0 12px', display: 'grid', gap: 14 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
        <Field label="Task" required><input value={task.title} onChange={(e) => onChange({ title: e.target.value })} style={inputStyle} autoFocus={!task.title} /></Field>
        <Field label="Helper text" hint="One line under the task"><input value={task.helper ?? ''} onChange={(e) => onChange({ helper: e.target.value })} style={inputStyle} /></Field>
        <Field label="Done by" hint={system ? 'Set by the product for this task' : undefined}>
          <Pick value={task.ownerRole} disabled={system} onChange={(v) => onChange({ ownerRole: v as OwnerRole, surface: surfaceFor(v as OwnerRole) })}>
            {OWNERS.map((o) => <option key={o} value={o}>{OWNER_LABEL[o]}</option>)}
          </Pick>
        </Field>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 12 }}>
        <RuleEditor label="Due" value={task.dueRule ?? null} onChange={(r) => onChange({ dueRule: r, dueLabel: r ? undefined : task.dueLabel })} />
        <RuleEditor label="Opens" value={task.opensRule ?? null} onChange={(r) => onChange({ opensRule: r })} noneLabel="As soon as the journey starts" />
      </div>
      {!task.dueRule && (
        <Field label="Due, in words" hint="Shown instead of a date, e.g. “Manager sets” or “Each upload”">
          <input value={task.dueLabel ?? ''} onChange={(e) => onChange({ dueLabel: e.target.value || undefined })} style={inputStyle} />
        </Field>
      )}
      {isMeeting && (
        <Field label="Agenda" hint="One point per line, shown on the meeting in the app, each with a notes box. Empty: the standard agenda">
          <textarea
            rows={4}
            value={agendaText}
            onChange={(e) => {
              onChange({ agenda: e.target.value.split('\n') });
            }}
            onBlur={() => {
              const clean = agendaText.split('\n').map((l) => l.trim()).filter(Boolean).slice(0, 8);
              onChange({ agenda: clean.length ? clean : undefined });
            }}
            aria-label="Agenda, one point per line"
            style={{ ...inputStyle, height: 'auto', minHeight: 96, padding: '8px 10px', fontFamily: 'inherit', resize: 'vertical' }}
          />
        </Field>
      )}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
        <label style={checkRow}><input type="checkbox" checked={task.mustDo} onChange={(e) => onChange({ mustDo: e.target.checked })} style={checkBox} /> Must-do <span style={{ fontWeight: 400, fontSize: 12, color: 'var(--ink-3)' }}>· can’t be skipped</span></label>
        <span style={{ flex: 1 }} />
        <button type="button" className="pd-btn sm" onClick={() => onMove(-1)} disabled={first} aria-label="Move up">↑</button>
        <button type="button" className="pd-btn sm" onClick={() => onMove(1)} disabled={last} aria-label="Move down">↓</button>
        {(!system || task.recommended) && <button type="button" className="pd-btn sm" style={{ color: 'var(--bad)' }} onClick={onRemove}>{task.recommended ? 'Back to Recommended' : 'Remove task'}</button>}
        <button type="button" className="pd-btn sm primary" onClick={onDone}>Done</button>
      </div>
      {system && !task.recommended && <div style={{ fontSize: 12, color: 'var(--ink-3)' }}>A screen in the product completes this task, so it stays in the template. Turn it off with the switch if your team does not need it.</div>}
    </div>
  );
}

/** A due or opens rule: what it counts from, how many days before or after, and in which probation month. */
function RuleEditor({ label, value, onChange, noneLabel = 'No date' }: { label: string; value: DueRule | null; onChange: (r: DueRule | null) => void; noneLabel?: string }) {
  const anchors: [DueAnchor, string][] = [['tl', 'Last working day (Tl)'], ['exit_accepted', 'Exit accepted']];
  const r = value;
  const n = r?.offset ?? 0;
  const set = (patch: Partial<DueRule>) => r && onChange({ ...r, ...patch });
  const monthAnchor = r?.anchor === 'month_start' || r?.anchor === 'month_end';
  const monthMode = !r?.month || r.month === 'each' ? 'each' : r.month === 'last' ? 'last' : 'some';
  const [months, setMonths] = useState(Array.isArray(r?.month) ? r!.month.join(', ') : typeof r?.month === 'number' ? String(r.month) : '');
  const signed = r ? (r.anchor === 'tj' || r.anchor === 'tl' || r.anchor === 'offer_sent' || monthAnchor) : false;
  return (
    <fieldset style={{ border: '1px solid var(--line)', borderRadius: 12, padding: '10px 12px 12px', margin: 0, minWidth: 0, background: 'var(--surface)' }}>
      <legend style={{ ...sectionLabel, padding: '0 4px' }}>{label} · <span style={{ textTransform: 'none', letterSpacing: 0, color: 'var(--ink)', fontWeight: 500 }}>{r ? ruleText(r) : noneLabel}</span></legend>
      <div style={{ display: 'grid', gap: 8 }}>
        <Pick value={r?.anchor ?? ''} ariaLabel={`${label}: counted from`} onChange={(v) => onChange(v ? { anchor: v as DueAnchor, offset: r?.offset ?? 0, unit: r?.unit ?? 'days', ...(v === 'month_start' || v === 'month_end' ? { month: 'each' as const } : {}) } : null)}>
          <option value="">{noneLabel}</option>
          {anchors.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </Pick>
        {r && (
          <div style={{ display: 'grid', gridTemplateColumns: signed ? '74px minmax(0, 1fr) minmax(0, 1fr)' : '74px minmax(0, 1fr)', gap: 8 }}>
            <input type="number" min={0} value={Math.abs(n)} aria-label="How many" onChange={(e) => { const v = Math.max(0, Number(e.target.value) || 0); set({ offset: n < 0 ? -v : v }); }} style={inputStyle} />
            <Pick value={r.unit ?? 'days'} ariaLabel="Days or working days" onChange={(v) => set({ unit: v as 'days' | 'working_days' })}>
              <option value="days">days</option>
              <option value="working_days">working days</option>
            </Pick>
            {signed && (
              <Pick value={n < 0 ? 'before' : 'after'} ariaLabel="Before or after" onChange={(v) => set({ offset: v === 'before' ? -Math.abs(n) : Math.abs(n) })}>
                <option value="before">before</option>
                <option value="after">after</option>
              </Pick>
            )}
          </div>
        )}
        {r && monthAnchor && (
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 8 }}>
            <Pick value={monthMode} ariaLabel="Which month" onChange={(v) => set({ month: v === 'each' ? 'each' : v === 'last' ? 'last' : (months.split(/[,\s]+/).map(Number).filter((x) => x > 0)) })}>
              <option value="each">Each month</option>
              <option value="last">The last month</option>
              <option value="some">These months</option>
            </Pick>
            {monthMode === 'some' && (
              <input value={months} placeholder="e.g. 3, 6" aria-label="Months" style={inputStyle}
                onChange={(e) => { setMonths(e.target.value); const list = e.target.value.split(/[,\s]+/).map(Number).filter((x) => Number.isInteger(x) && x > 0 && x <= 12); set({ month: list.length === 1 ? list[0] : list }); }} />
            )}
          </div>
        )}
      </div>
    </fieldset>
  );
}

const checkRow = { display: 'flex', alignItems: 'center', gap: 8, fontSize: 13.5, fontWeight: 500, color: 'var(--ink)', cursor: 'pointer' } as const;
const checkBox = { width: 16, height: 16, accentColor: 'var(--accent)' } as const;
const defaultPill = { display: 'inline-flex', alignItems: 'center', fontSize: 11.5, fontWeight: 500, lineHeight: 1.5, color: '#fff', background: 'var(--p-blue)', borderRadius: 99, padding: '3px 10px' } as const;
const inactivePill = { display: 'inline-flex', fontSize: 11.5, fontWeight: 500, lineHeight: 1.5, color: 'var(--ink-2)', background: 'var(--mute-bg)', borderRadius: 99, padding: '3px 10px' } as const;
