// Start an exit (O2): for exits HR starts (a resignation that came by email, retirement, end of
// contract, termination, absconding). It records the exit as People › Exits does (the same rules
// from Exit settings, the same successor for a team) and starts the offboarding journey from the
// template, dated from the last working day. The app page is off by default for a termination or
// an absconding. Resignations sent from the app start on their own.
import { useEffect, useMemo, useState } from 'react';
// Its own styles: the form is also used on a profile's Exit tab, where the board's stylesheet isn't loaded.
import './offboarding.css';
import { Card, PageActions } from '../../../ui';
import { usePageHead } from '../../../pageHead';
import { btn, btnClass } from '../../../ds';
import { useStore } from '../../../store';
import { api } from '../../../../services/http';
import { startExit } from '../../../../services/lifecycleOffboarding';
import type { ExitType, NoticeHandling } from '../../../../services/lifecycleOffboarding';
import { firstName, longDay, todayKey } from './parts';
import { getTemplate } from '../../../../services/lifecycle';
import type { LifecycleTemplate } from '../../../../services/lifecycle';

const TYPES: { key: ExitType; label: string; note: string; notice: NoticeHandling; page: boolean; pageNote: string; interview: boolean }[] = [
  { key: 'resignation', label: 'Resignation', note: 'Resignation by email or letter, entered for the employee.', notice: 'served', page: true, pageNote: 'They see their last day, tasks and exit interview, the same as an app resignation.', interview: true },
  { key: 'retirement', label: 'Retirement', note: 'Retiring on reaching the retirement age in their contract.', notice: 'not_applicable', page: true, pageNote: 'They see their last day, tasks and exit interview.', interview: true },
  { key: 'end_of_contract', label: 'End of contract', note: 'A fixed-term contract or internship that ends on its date.', notice: 'not_applicable', page: true, pageNote: 'They see their last day and tasks.', interview: false },
  { key: 'termination', label: 'Termination', note: 'The company ends employment. Keep the reason in the internal note; it never shows in the app.', notice: 'paid_in_lieu', page: false, pageNote: 'Off by default: HR tells the employee first, then turns this on.', interview: false },
  { key: 'absconding', label: 'Absconding', note: 'Not reachable and absent without telling anyone. Follow your policy before you start this.', notice: 'recovered', page: false, pageNote: 'Off: the employee is not reachable.', interview: false },
];
type Template = { id: string; name: string; isDefault: boolean; active?: boolean };

/**
 * `presetUserId`: started from that employee's profile (People › Employees › Exit), so the employee is
 * fixed and the page is a card inside the profile, not a page of its own.
 */
export function StartExit({ onBack, onStarted, presetUserId }: { onBack: () => void; onStarted: (userId: string) => void; presetUserId?: string }) {
  const s = useStore();
  const [userId, setUserId] = useState(presetUserId ?? '');
  const [type, setType] = useState<ExitType>('resignation');
  const meta = TYPES.find((t) => t.key === type)!;
  const [lastDay, setLastDay] = useState('');
  const [templateId, setTemplateId] = useState('');
  const [templates, setTemplates] = useState<Template[]>([]);
  const [manager, setManager] = useState('');
  const [successor, setSuccessor] = useState('');
  const [note, setNote] = useState('');
  const [tellManager, setTellManager] = useState(true);
  const [page, setPage] = useState(meta.page);
  const [busy, setBusy] = useState(false);

  // Offboarding templates come from Setup › Employee lifecycle; without any, the Standard one is used.
  useEffect(() => {
    let live = true;
    api<{ templates: Template[] }>('/admin/lifecycle/templates?kind=offboarding')
      .then((r) => { if (live) setTemplates(r.templates.filter((t) => t.active !== false)); })
      .catch(() => undefined);
    return () => { live = false; };
  }, []);
  // The template this exit follows, whole (24 Nov 2026: Record exit follows the offboarding template): its
  // rules (notice, settlement, gratuity, which exits see the app page) and its tasks are what this page shows.
  const chosenId = templateId || templates.find((t) => t.isDefault)?.id || '';
  const [tpl, setTpl] = useState<LifecycleTemplate | null>(null);
  useEffect(() => {
    let live = true;
    if (!chosenId) { setTpl(null); return; }
    getTemplate(chosenId).then((t) => { if (live) setTpl(t); }).catch(() => { if (live) setTpl(null); });
    return () => { live = false; };
  }, [chosenId]);
  // A new type (or template) starts from its own defaults: the template says which exits see the app page.
  useEffect(() => {
    const pageFor = tpl?.settings.appPageFor;
    setPage(pageFor ? pageFor.includes(type) : meta.page);
  }, [type, tpl]); // eslint-disable-line react-hooks/exhaustive-deps

  const people = useMemo(() => s.emps.filter((e) => !e.exit).sort((a, b) => a.name.localeCompare(b.name)), [s.emps]);
  const emp = s.emps.find((e) => e.id === userId);
  useEffect(() => { setManager(emp?.managerId && emp.managerId !== emp.id ? emp.managerId : ''); setSuccessor(''); }, [userId]); // eslint-disable-line react-hooks/exhaustive-deps
  const team = emp ? s.emps.filter((e) => e.managerId === emp.id && e.id !== emp.id && !e.exit?.left) : [];
  const others = s.emps.filter((e) => e.id !== userId && !e.exit?.left).sort((a, b) => a.name.localeCompare(b.name));
  const ready = !!emp && !!lastDay && (team.length === 0 || !!successor);
  const name = emp ? firstName(emp.name) : 'they';

  const start = async () => {
    if (!emp) return;
    setBusy(true);
    try {
      await startExit(emp.id, {
        exitType: type, lastWorkingDay: lastDay, // No notice (24 Nov 2026, HR: "take notice off from everywhere"): nothing paid in lieu or recovered.
        noticeHandling: 'not_applicable', ...(templateId ? { templateId } : {}), ...(manager ? { managerUserId: manager } : {}),
        ...(note.trim() ? { hrNote: note.trim() } : {}), tellManagerNow: tellManager, showAppPage: page, ...(successor ? { newManagerUserId: successor } : {}),
      });
      s.flash(`${emp.name}'s exit is started. Last day ${longDay(lastDay)}.`);
      onStarted(emp.id);
    } catch (e) {
      s.flash(e instanceof Error ? e.message : 'Could not start the exit', 'error');
      setBusy(false);
    }
  };

  // HRExitStart: the page names itself, with the way back beside the title and Cancel / Start exit on the right.
  usePageHead(presetUserId ? null : { title: 'Start an exit', eyebrow: 'Employee lifecycle · Offboarding', onBack, backLabel: 'Back to offboarding' });
  // Template, manager, note and who is told sit under More options.
  const [more, setMore] = useState(false);
  const startBtn = <button type="button" id="ob-start-exit" disabled={!ready || busy} onClick={() => void start()} className={btnClass('primary')} style={btn('primary')}>{busy ? 'Starting…' : 'Start exit'}</button>;

  return (
    <div style={{ animation: 'fade .3s ease both' }}>
      {!presetUserId && (
        <PageActions>
          <button type="button" onClick={onBack} className={btnClass()} style={btn()}>Cancel</button>
          {startBtn}
        </PageActions>
      )}
      <div>
        <Card padded>
          {presetUserId && (
            // On a profile: the title and the action inside the card, together.
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 18 }}>
              <h3 style={{ margin: 0, fontSize: 17, fontWeight: 600, flex: 1 }}>Start {emp ? `${firstName(emp.name)}'s` : 'an'} exit</h3>
              {startBtn}
            </div>
          )}
          <div className="ob-form">
            {!presetUserId && (
              <label className="f">Employee
                <span className="pd-pick">
                  <select className="pd-inp" value={userId} onChange={(e) => setUserId(e.target.value)} style={{ width: '100%' }}>
                    <option value="">Pick an employee</option>
                    {people.map((e) => <option key={e.id} value={e.id}>{[e.name, e.role, e.team, e.employeeId !== '—' ? e.employeeId : ''].filter(Boolean).join(' · ')}</option>)}
                  </select>
                </span>
              </label>
            )}
            <div className="f" style={{ display: 'grid', gap: 8, fontSize: 13, fontWeight: 600 }}>Exit type
              <div className="pd-seg" role="radiogroup" aria-label="Exit type">
                {TYPES.map((t) => <button key={t.key} type="button" role="radio" aria-checked={type === t.key} className={type === t.key ? 'on' : ''} onClick={() => setType(t.key)}>{t.label}</button>)}
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 16 }}>
              <label className="f">Last working day
                <input type="date" className="pd-inp" value={lastDay} onChange={(e) => setLastDay(e.target.value)} style={{ width: '100%' }} />
                {lastDay && lastDay < todayKey() && <span className="hint" style={{ color: 'var(--warn)' }}>Already past: {name}'s app turns off as you start this.</span>}
              </label>
              {team.length > 0 && (
                <label className="f">Their {team.length} {team.length === 1 ? 'report moves' : 'reports move'} to
                  <span className="pd-pick">
                    <select className="pd-inp" value={successor} onChange={(e) => setSuccessor(e.target.value)} style={{ width: '100%' }}>
                      <option value="">Pick a manager</option>
                      {others.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
                    </select>
                  </span>
                  <span className="hint">{name} leads {team.length} {team.length === 1 ? 'person' : 'people'}; they move the day after the last day.</span>
                </label>
              )}
            </div>
            <button type="button" onClick={() => setMore(!more)} aria-expanded={more}
              style={{ alignSelf: 'flex-start', border: 0, background: 'none', padding: 0, font: 'inherit', fontSize: 13.5, color: 'var(--accent)', cursor: 'pointer' }}>
              {more ? 'Fewer options' : 'More options'} <span style={{ color: 'var(--ink-3)' }}>· template, manager, note, who is told</span>
            </button>
            {more && (
              <>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
                  <label className="f">Offboarding template
                    <span className="pd-pick">
                      <select className="pd-inp" value={templateId} onChange={(e) => setTemplateId(e.target.value)} style={{ width: '100%' }}>
                        <option value="">{templates.find((t) => t.isDefault)?.name ?? 'Standard'} (default)</option>
                        {templates.filter((t) => !t.isDefault).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                      </select>
                    </span>
                  </label>
                  <label className="f">Reporting manager
                    <span className="pd-pick">
                      <select className="pd-inp" value={manager} onChange={(e) => setManager(e.target.value)} style={{ width: '100%' }}>
                        <option value="">No manager</option>
                        {others.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
                      </select>
                    </span>
                  </label>
                </div>
                <label className="f">Internal note · HR only
                  <textarea className="pd-inp" rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder={type === 'resignation' ? `Resignation received by email on ${longDay(todayKey())}.` : ''} />
                </label>
                <label style={{ display: 'flex', gap: 10, alignItems: 'center', fontSize: 13 }}>
                  <input type="checkbox" checked={tellManager} onChange={(e) => setTellManager(e.target.checked)} /> Tell the manager now (they get the handover checklist)
                </label>
                <label style={{ display: 'flex', gap: 10, alignItems: 'center', fontSize: 13 }}>
                  <input type="checkbox" checked={page} onChange={(e) => setPage(e.target.checked)} /> Show the off-boarding page in {name}'s app
                </label>
              </>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}
