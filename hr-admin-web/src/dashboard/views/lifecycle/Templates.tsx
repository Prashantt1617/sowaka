// Setup › Employee lifecycle › Templates (S2), and one template (S3 for
// onboarding, S4 for offboarding). A template sets the tasks every joiner or
// leaver gets, by phase: who does each one, when it is due (from Tj, the
// joining day, or Tl, the last working day), whether it is a must-do, and
// whether it is on. The Recommended panel holds our suggestions, off until HR
// adds one. One template per kind is the default; changes apply to journeys
// that start after saving.
import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useStore } from '../../store';
import { canOpen } from '../../access';
import { ListPending, StatusTabs } from '../../ui';
import { downloadCsv } from '../../export';
import { LIFECYCLE_TEMPLATES_KIND_KEY } from '../../setupGroups';
import { createTemplate, deleteTemplate, getTemplate, isNotAvailable, listTemplates, updateTemplate } from '../../../services/lifecycle';
import type { DueAnchor, DueRule, ExitTypeKey, LifecycleKind, LifecyclePhase, LifecycleTemplate, OwnerRole, TemplateListItem, TemplateTask } from '../../../services/lifecycle';
import { ConfirmDialog, Field, Modal, NotSwitchedOn, OwnerChip, Pick, Switch } from './shared';
import { OWNER_LABEL, PHASES, errText, readHandoff, inputStyle, linkBtn, phaseTitle, ruleText, sectionLabel } from './format';
import '../people.css';

const KINDS: LifecycleKind[] = ['onboarding', 'offboarding'];
const KIND_LABEL: Record<LifecycleKind, string> = { onboarding: 'Onboarding', offboarding: 'Offboarding' };
const LEAD: Record<LifecycleKind, ReactNode> = {
  onboarding: <>Templates set the tasks every joiner gets, from the offer to confirmation. Anyone not assigned to one follows the <strong style={{ fontWeight: 500, color: 'var(--ink-2)' }}>default</strong>.</>,
  offboarding: <>Every exit gets these tasks, dated from the last working day (Tl). Anyone not given another template follows the <strong style={{ fontWeight: 500, color: 'var(--ink-2)' }}>default</strong>.</>,
};
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
                <th style={{ textAlign: 'left', width: 140 }}>{kind === 'onboarding' ? 'Probation' : 'Notice period'}</th>
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
                  <td>{kind === 'onboarding' ? (t.settings.probationMonths ? `${t.settings.probationMonths} months` : '—') : (t.settings.noticeDays ? `${t.settings.noticeDays} days` : '—')}</td>
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
    <Modal title={`New ${kind} template`} sub="It starts as a copy, with our recommended tasks ready to add." onClose={onClose} busy={busy} width={480}
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
    const anchor: DueAnchor = t.kind === 'onboarding' ? 'tj' : 'tl';
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

  return (
    <div className="pd-form" style={{ maxWidth: 1180 }}>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 20, gap: 8, flexWrap: 'wrap' }}>
        <button type="button" onClick={back} className="pd-btn ghost sm" style={{ marginLeft: -12 }}>← All templates</button>
        <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600, minWidth: 0, overflowWrap: 'anywhere' }}>{KIND_LABEL[t.kind]} template · {saved.name}</h2>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          {saved.isDefault ? <span style={defaultPill}>Default</span> : <button type="button" className="pd-btn" onClick={() => void makeDefault()} disabled={Boolean(busy) || !t.active} title={t.active ? undefined : 'Turn the template on first'}>Make default</button>}
          <button type="button" className="pd-btn" onClick={() => void duplicate()} disabled={Boolean(busy)}>Duplicate</button>
          {!saved.isDefault && <button type="button" className="pd-btn" onClick={() => setConfirmDelete(true)} disabled={Boolean(busy)} style={{ color: 'var(--bad)' }}>Delete</button>}
          <button type="button" className="pd-btn primary" onClick={() => void save()} disabled={Boolean(busy) || !dirty}>{busy === 'save' ? 'Saving…' : dirty ? 'Save template' : 'Saved'}</button>
        </div>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 20, alignItems: 'flex-start' }}>
        <div style={{ flex: '1 1 600px', minWidth: 0, display: 'grid', gap: 16 }}>
          <section className="pd-card">
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14 }}>
              <Field label="Template name" required error={nameError}>
                <input value={t.name} onChange={(e) => setT({ name: e.target.value })} style={inputStyle} />
              </Field>
              <Field label="Who it is for" hint="Optional">
                <input value={t.group ?? ''} onChange={(e) => setT({ group: e.target.value })} placeholder="e.g. Full-time staff" style={inputStyle} />
              </Field>
              {t.kind === 'onboarding' ? <>
                <Field label="Probation">
                  <Pick value={String(t.settings.probationMonths ?? 6)} onChange={(v) => setSettings({ probationMonths: Number(v) as 3 | 6 })}>
                    <option value="6">6 months</option>
                    <option value="3">3 months</option>
                  </Pick>
                </Field>
                <Field label="Portal open until">
                  <Pick value={t.settings.portalOpenUntil ?? 'week_1'} onChange={(v) => setSettings({ portalOpenUntil: v as 'week_1' | 'month_1' })}>
                    <option value="week_1">End of week 1</option>
                    <option value="month_1">End of month 1</option>
                  </Pick>
                </Field>
              </> : <>
                <Field label="Notice period">
                  <Pick value={String(t.settings.noticeDays ?? 60)} onChange={(v) => setSettings({ noticeDays: Number(v) })}>
                    {[...new Set([30, 60, 90, t.settings.noticeDays ?? 60])].sort((a, b) => a - b).map((n) => <option key={n} value={n}>{n} days</option>)}
                  </Pick>
                </Field>
                <Field label="Exit interview opens">
                  <Pick value={String(t.settings.exitInterviewOpensDays ?? 5)} onChange={(v) => setSettings({ exitInterviewOpensDays: Number(v) })}>
                    {[...new Set([5, 7, t.settings.exitInterviewOpensDays ?? 5])].sort((a, b) => a - b).map((n) => <option key={n} value={n}>{n} days before the last day</option>)}
                  </Pick>
                </Field>
                <Field label="App account closes">
                  <Pick value={t.settings.accountCloses ?? 'tl_plus_1'} onChange={(v) => setSettings({ accountCloses: v as 'tl_plus_1' | 'tl_end_of_shift' })}>
                    <option value="tl_plus_1">The day after the last day</option>
                    <option value="tl_end_of_shift">On the last day, end of shift</option>
                  </Pick>
                </Field>
                <Field label="Final settlement within" hint="Working days after the last day">
                  <input type="number" min={0} max={30} value={t.settings.settlementWorkingDays ?? 2} onChange={(e) => setSettings({ settlementWorkingDays: Math.max(0, Number(e.target.value) || 0) })} style={inputStyle} />
                </Field>
                <Field label="Gratuity within" hint="Days after the last day">
                  <input type="number" min={0} max={90} value={t.settings.gratuityDays ?? 30} onChange={(e) => setSettings({ gratuityDays: Math.max(0, Number(e.target.value) || 0) })} style={inputStyle} />
                </Field>
              </>}
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px 24px', marginTop: 14 }}>
              <label style={checkRow}><input type="checkbox" checked={t.active} onChange={(e) => setT({ active: e.target.checked })} style={checkBox} disabled={saved.isDefault} /> Active{saved.isDefault ? <span style={{ fontSize: 12, color: 'var(--ink-3)', fontWeight: 400 }}> · the default stays on</span> : null}</label>
              {t.kind === 'onboarding' && (
                <label style={checkRow}><input type="checkbox" checked={t.settings.signLettersOnDay1 === true} onChange={(e) => setSettings({ signLettersOnDay1: e.target.checked })} style={checkBox} /> Sign the appointment letter and NDA in the app on Day 1, not on the portal</label>
              )}
            </div>
            {t.kind === 'offboarding' && (
              <div style={{ marginTop: 14 }}>
                <div style={{ fontSize: 11.5, color: 'var(--ink-2)', marginBottom: 6 }}>The off-boarding page in the app, for these exits</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 20px' }}>
                  {EXIT_TYPES.map(([k, label]) => {
                    const list = t.settings.appPageFor ?? ['resignation', 'retirement', 'end_of_contract'];
                    return (
                      <label key={k} style={{ ...checkRow, fontWeight: 400 }}>
                        <input type="checkbox" checked={list.includes(k)} style={checkBox}
                          onChange={(e) => setSettings({ appPageFor: e.target.checked ? [...new Set([...list, k])] : list.filter((x) => x !== k) })} /> {label}
                      </label>
                    );
                  })}
                </div>
                <div style={{ fontSize: 12.5, color: 'var(--ink-3)', marginTop: 10 }}>
                  Salary hold on notice: {canOpen(user, 'exitsettings') ? <button type="button" style={linkBtn} onClick={() => { if (!dirty || window.confirm('Leave without saving your changes?')) setView('exitsettings'); }}>Payroll › Exit settings</button> : 'Payroll › Exit settings'}
                </div>
              </div>
            )}
            {usage > 0 && <div className="pd-note" style={{ marginTop: 14 }}>{usage} {t.kind === 'onboarding' ? (usage === 1 ? 'joiner is' : 'joiners are') : (usage === 1 ? 'exit is' : 'exits are')} on this template. They keep the tasks they started with; changes apply to {t.kind === 'onboarding' ? 'people who join' : 'exits that start'} after you save.</div>}
          </section>

          {phases.map((p, i) => {
            const list = inPhase(p.key);
            const on = list.filter((x) => x.enabled).length;
            const shut = collapsed.has(p.key);
            return (
              <section key={p.key} className="pd-card" style={{ padding: 0 }}>
                <button type="button" aria-expanded={!shut} onClick={() => setCollapsed((c) => { const n = new Set(c); if (n.has(p.key)) n.delete(p.key); else n.add(p.key); return n; })}
                  style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%', padding: '16px 20px', background: 'none', border: 0, cursor: 'pointer', font: 'inherit', color: 'inherit', textAlign: 'left' }}>
                  <span aria-hidden style={{ width: 28, height: 28, borderRadius: 9, background: 'var(--accent-soft)', color: 'var(--accent-ink)', display: 'grid', placeItems: 'center', fontSize: 13, fontWeight: 600, flexShrink: 0 }}>{i + 1}</span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: 'block', fontSize: 16, fontWeight: 600 }}>{p.title}</span>
                    <span style={{ display: 'block', fontSize: 12.5, color: 'var(--ink-3)' }}>{p.desc}</span>
                  </span>
                  <span style={{ fontSize: 12.5, color: 'var(--ink-3)', whiteSpace: 'nowrap' }}>{on} of {list.length} on</span>
                  <svg aria-hidden width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--ink-3)" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" style={{ transform: shut ? 'rotate(-90deg)' : undefined, transition: 'transform .15s' }}><path d="m6 9 6 6 6-6" /></svg>
                </button>
                {!shut && (
                  <div style={{ padding: '0 20px 16px' }}>
                    <div style={{ display: 'grid', gridTemplateColumns: TASK_COLS, gap: 12, background: 'var(--surface-2)', borderRadius: 12, padding: '8px 12px', fontSize: 12, color: 'var(--ink-3)' }}>
                      <span>Task</span><span>Done by</span><span>Due</span><span />
                    </div>
                    {list.length === 0 && <div className="pd-empty" style={{ padding: 20 }}>No tasks in this phase.</div>}
                    {list.map((task, n) => (
                      <TaskRow key={task.id} task={task} kind={t.kind} open={openTask === task.id} first={n === 0} last={n === list.length - 1}
                        onToggle={() => setOpenTask(openTask === task.id ? null : task.id)}
                        onChange={(patch) => setTask(task.id, patch)}
                        onMove={(by) => move(task, by)}
                        onRemove={() => {
                          if (task.recommended) setTask(task.id, { recommended: { ...task.recommended, added: false } });
                          else setT({ tasks: t.tasks.filter((x) => x.id !== task.id) });
                          setOpenTask(null);
                        }} />
                    ))}
                    <button type="button" className="pd-btn sm" style={{ marginTop: 12 }} onClick={() => addTask(p.key)}>+ Add a task</button>
                  </div>
                )}
              </section>
            );
          })}
        </div>

        <aside style={{ flex: '1 1 280px', maxWidth: 400, minWidth: 0, display: 'grid', gap: 16, position: 'sticky', top: 90 }}>
          <section className="pd-card">
            <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>Recommended</h3>
            <div style={{ fontSize: 12.5, color: 'var(--ink-3)', marginBottom: 10 }}>Not in this template yet</div>
            {recommended.length === 0 ? <div style={{ fontSize: 13, color: 'var(--ink-3)' }}>You’ve added all our suggestions.</div> : (
              <div style={{ display: 'grid', gap: 12 }}>
                {recommended.map((r) => (
                  <div key={r.id} style={{ borderTop: '1px solid var(--line)', paddingTop: 12, display: 'grid', gap: 6 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <b style={{ flex: 1, fontSize: 13.5, fontWeight: 500, overflowWrap: 'anywhere' }}>{r.title}</b>
                      <button type="button" className="pd-btn sm" onClick={() => addRecommended(r)}>Add</button>
                    </div>
                    {r.recommended?.why && <div style={{ fontSize: 12.5, color: 'var(--ink-2)', overflowWrap: 'anywhere' }}>{r.recommended.why}</div>}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <OwnerChip role={r.ownerRole} />
                      <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>{phaseTitle(r.phase)} · {ruleText(r.dueRule, r.dueLabel)}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
          {t.kind === 'offboarding' && (
            <section className="pd-card">
              <h3 style={{ margin: '0 0 6px', fontSize: 16, fontWeight: 600 }}>Exit interview</h3>
              <p style={{ margin: 0, fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.5 }}>5 questions: main reason, working here, working with their manager, would they come back, anything they’d change. Answers go to HR only and show in Exit insights, anonymised.</p>
            </section>
          )}
          <section className="pd-note" style={{ display: 'block' }}>
            <b style={{ display: 'block', marginBottom: 4 }}>How due dates work</b>
            {t.kind === 'onboarding'
              ? <>Tj is the joining day on the offer. “Tj − 5” means five days before it. If HR moves the joining date, every due date moves with it.<br /><br />Changes apply to people who join after you save. Joiners already in progress keep their current tasks.</>
              : <>Tl is the last working day. “Tl − 5” is five days before it. If the last day moves (another day agreed, or early release), every due date moves with it.<br /><br />Changes apply to exits that start after you save.</>}
          </section>
        </aside>
      </div>

      {confirmDelete && (
        <ConfirmDialog title={`Delete ${saved.name}?`} confirm="Delete"
          body={usage > 0 ? `${usage} ${t.kind === 'onboarding' ? 'joiners are' : 'exits are'} on this template, so it may not be deleted. Turn it off (Active) instead, so nobody new gets it.` : 'Nobody is on this template. It goes for good.'}
          onClose={() => setConfirmDelete(false)}
          onConfirm={async () => { await deleteTemplate(id); flash(`${saved.name} deleted`); setConfirmDelete(false); onBack(); }} />
      )}
    </div>
  );
}

const TASK_COLS = 'minmax(0, 1fr) minmax(110px, 170px) minmax(110px, 170px) 46px';

function TaskRow({ task, kind, open, first, last, onToggle, onChange, onMove, onRemove }: {
  task: TemplateTask; kind: LifecycleKind; open: boolean; first: boolean; last: boolean;
  onToggle: () => void; onChange: (p: Partial<TemplateTask>) => void; onMove: (by: -1 | 1) => void; onRemove: () => void;
}) {
  return (
    <div style={{ borderBottom: '1px solid var(--line)' }}>
      <div onClick={onToggle} role="button" tabIndex={0} aria-expanded={open} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggle(); } }}
        className="pd-row-hover" style={{ display: 'grid', gridTemplateColumns: TASK_COLS, gap: 12, alignItems: 'center', padding: '10px 12px', cursor: 'pointer', opacity: task.enabled ? 1 : 0.45 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 13.5, fontWeight: 500, display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center', overflowWrap: 'anywhere' }}>
            {task.title || <span style={{ color: 'var(--ink-3)', fontWeight: 400 }}>New task</span>}
            {task.recommended?.added && <span style={tagStyle('var(--accent-soft)', 'var(--accent-ink)')}>Added</span>}
            {task.mustDo && <span style={tagStyle('var(--warn-bg)', 'var(--p-orange)')}>Must-do</span>}
          </div>
          {task.helper && <div style={{ fontSize: 12, color: 'var(--ink-3)', overflowWrap: 'anywhere' }}>{task.helper}</div>}
        </div>
        <div><OwnerChip role={task.ownerRole} /></div>
        <div style={{ fontSize: 12.5, color: 'var(--ink-2)' }}>{ruleText(task.dueRule, task.dueLabel)}</div>
        <div onClick={(e) => e.stopPropagation()}><Switch on={task.enabled} onChange={(v) => onChange({ enabled: v })} label={`${task.enabled ? 'Turn off' : 'Turn on'} ${task.title || 'this task'}`} /></div>
      </div>
      {open && <TaskEditor task={task} kind={kind} first={first} last={last} onChange={onChange} onMove={onMove} onRemove={onRemove} onDone={onToggle} />}
    </div>
  );
}

function TaskEditor({ task, kind, first, last, onChange, onMove, onRemove, onDone }: {
  task: TemplateTask; kind: LifecycleKind; first: boolean; last: boolean;
  onChange: (p: Partial<TemplateTask>) => void; onMove: (by: -1 | 1) => void; onRemove: () => void; onDone: () => void;
}) {
  const system = Boolean(task.systemKey);
  const surfaceFor = (o: OwnerRole): TemplateTask['surface'] => (o === 'employee' ? (task.phase === 'pre_boarding' ? 'portal' : 'app') : o === 'manager' || o === 'manager_employee' ? 'app' : o === 'automatic' ? 'backend' : 'dashboard');
  const docs = task.documents ?? [];
  const showDocs = task.systemKey === 'upload_documents' || (task.kind === 'upload' && task.phase === 'pre_boarding');
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
        <RuleEditor label="Due" kind={kind} value={task.dueRule ?? null} onChange={(r) => onChange({ dueRule: r, dueLabel: r ? undefined : task.dueLabel })} />
        <RuleEditor label="Opens" kind={kind} value={task.opensRule ?? null} onChange={(r) => onChange({ opensRule: r })} noneLabel="As soon as the journey starts" />
      </div>
      {!task.dueRule && (
        <Field label="Due, in words" hint="Shown instead of a date, e.g. “Manager sets” or “Each upload”">
          <input value={task.dueLabel ?? ''} onChange={(e) => onChange({ dueLabel: e.target.value || undefined })} style={inputStyle} />
        </Field>
      )}
      {showDocs && (
        <div>
          <div style={{ fontSize: 11.5, color: 'var(--ink-2)', marginBottom: 6 }}>Documents the candidate uploads</div>
          <div style={{ display: 'grid', gap: 6 }}>
            {docs.map((d, i) => (
              <div key={d.key} style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto auto', gap: 8, alignItems: 'center' }}>
                <input value={d.label} onChange={(e) => onChange({ documents: docs.map((x, n) => (n === i ? { ...x, label: e.target.value } : x)) })} aria-label="Document" style={inputStyle} />
                <label style={{ ...checkRow, fontWeight: 400, fontSize: 13 }}><input type="checkbox" checked={d.required} style={checkBox} onChange={(e) => onChange({ documents: docs.map((x, n) => (n === i ? { ...x, required: e.target.checked } : x)) })} /> Required</label>
                <button type="button" className="pd-btn sm ghost" aria-label={`Remove ${d.label}`} onClick={() => onChange({ documents: docs.filter((_, n) => n !== i) })}>×</button>
              </div>
            ))}
            <div><button type="button" className="pd-btn sm" onClick={() => onChange({ documents: [...docs, { key: `doc_${Date.now().toString(36)}`, label: '', required: true }] })}>+ Add a document</button></div>
          </div>
        </div>
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
function RuleEditor({ label, kind, value, onChange, noneLabel = 'No date' }: { label: string; kind: LifecycleKind; value: DueRule | null; onChange: (r: DueRule | null) => void; noneLabel?: string }) {
  const anchors: [DueAnchor, string][] = kind === 'onboarding'
    ? [['tj', 'Joining day (Tj)'], ['offer_sent', 'Offer sent'], ['accepted', 'Offer accepted'], ['finalised', 'HR finalised'], ['month_start', 'Start of a probation month'], ['month_end', 'End of a probation month']]
    : [['tl', 'Last working day (Tl)'], ['exit_accepted', 'Exit accepted']];
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

const tagStyle = (bg: string, fg: string) => ({ fontSize: 10.5, fontWeight: 600, lineHeight: 1.5, padding: '1px 7px', borderRadius: 99, background: bg, color: fg });
const checkRow = { display: 'flex', alignItems: 'center', gap: 8, fontSize: 13.5, fontWeight: 500, color: 'var(--ink)', cursor: 'pointer' } as const;
const checkBox = { width: 16, height: 16, accentColor: 'var(--accent)' } as const;
const defaultPill = { display: 'inline-flex', alignItems: 'center', fontSize: 11.5, fontWeight: 500, lineHeight: 1.5, color: '#fff', background: 'var(--p-blue)', borderRadius: 99, padding: '3px 10px' } as const;
const inactivePill = { display: 'inline-flex', fontSize: 11.5, fontWeight: 500, lineHeight: 1.5, color: 'var(--ink-2)', background: 'var(--mute-bg)', borderRadius: 99, padding: '3px 10px' } as const;
