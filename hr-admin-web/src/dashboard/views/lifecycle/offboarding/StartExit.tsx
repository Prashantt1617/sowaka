// Start an exit (O2): for exits HR starts (a resignation that came by email, retirement, end of
// contract, termination, absconding). It records the exit as People › Exits does (the same rules
// from Exit settings, the same successor for a team) and starts the offboarding journey from the
// template, dated from the last working day. The app page is off by default for a termination or
// an absconding. Resignations sent from the app start on their own.
import { useEffect, useMemo, useState } from 'react';
import { Card, PageActions } from '../../../ui';
import { usePageHead } from '../../../pageHead';
import { btn, btnClass } from '../../../ds';
import { useStore } from '../../../store';
import { api } from '../../../../services/http';
import { startExit } from '../../../../services/lifecycleOffboarding';
import type { ExitType, NoticeHandling } from '../../../../services/lifecycleOffboarding';
import { OwnerChip, addDays, firstName, longDay, todayKey } from './parts';
import type { OwnerRole } from '../../../../services/lifecycleOffboarding';

const TYPES: { key: ExitType; label: string; note: string; notice: NoticeHandling; page: boolean; pageNote: string; interview: boolean }[] = [
  { key: 'resignation', label: 'Resignation', note: 'Resignation by email or letter, entered for the employee.', notice: 'served', page: true, pageNote: 'They see their last day, tasks and exit interview, the same as an app resignation.', interview: true },
  { key: 'retirement', label: 'Retirement', note: 'Retiring on reaching the retirement age in their contract.', notice: 'not_applicable', page: true, pageNote: 'They see their last day, tasks and exit interview.', interview: true },
  { key: 'end_of_contract', label: 'End of contract', note: 'A fixed-term contract or internship that ends on its date.', notice: 'not_applicable', page: true, pageNote: 'They see their last day and tasks.', interview: false },
  { key: 'termination', label: 'Termination', note: 'The company ends employment. Keep the reason in the internal note; it never shows in the app.', notice: 'paid_in_lieu', page: false, pageNote: 'Off by default: HR tells the employee first, then turns this on.', interview: false },
  { key: 'absconding', label: 'Absconding', note: 'Not reachable and absent without notice. Follow your policy before you start this.', notice: 'recovered', page: false, pageNote: 'Off: the employee is not reachable.', interview: false },
];
const NOTICE_LABEL: Record<NoticeHandling, string> = {
  served: 'Served in full', not_applicable: 'Not applicable', waived: 'Waived by the company', recovered: 'Shortfall recovered from settlement', paid_in_lieu: 'Paid in lieu of notice',
};
type Template = { id: string; name: string; isDefault: boolean; active?: boolean };

export function StartExit({ onBack, onStarted }: { onBack: () => void; onStarted: (userId: string) => void }) {
  const s = useStore();
  const [userId, setUserId] = useState('');
  const [type, setType] = useState<ExitType>('resignation');
  const meta = TYPES.find((t) => t.key === type)!;
  const [lastDay, setLastDay] = useState('');
  const [notice, setNotice] = useState<NoticeHandling>(meta.notice);
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
  // A new type starts from its own defaults.
  useEffect(() => { setNotice(meta.notice); setPage(meta.page); }, [type]); // eslint-disable-line react-hooks/exhaustive-deps

  const people = useMemo(() => s.emps.filter((e) => !e.exit).sort((a, b) => a.name.localeCompare(b.name)), [s.emps]);
  const emp = s.emps.find((e) => e.id === userId);
  useEffect(() => { setManager(emp?.managerId && emp.managerId !== emp.id ? emp.managerId : ''); setSuccessor(''); }, [userId]); // eslint-disable-line react-hooks/exhaustive-deps
  const team = emp ? s.emps.filter((e) => e.managerId === emp.id && e.id !== emp.id && !e.exit?.left) : [];
  const others = s.emps.filter((e) => e.id !== userId && !e.exit?.left).sort((a, b) => a.name.localeCompare(b.name));
  const ready = !!emp && !!lastDay && (team.length === 0 || !!successor);
  const name = emp ? firstName(emp.name) : 'they';
  const templateName = templates.find((t) => t.id === templateId)?.name ?? templates.find((t) => t.isDefault)?.name ?? 'Standard';

  const start = async () => {
    if (!emp) return;
    setBusy(true);
    try {
      await startExit(emp.id, {
        exitType: type, lastWorkingDay: lastDay, noticeHandling: notice, ...(templateId ? { templateId } : {}), ...(manager ? { managerUserId: manager } : {}),
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
  usePageHead({ title: 'Start an exit', eyebrow: 'Employee lifecycle · Offboarding', onBack, backLabel: 'Back to offboarding' });
  const plan: { when: string; what: string; owner: OwnerRole }[] = [
    { when: 'On start', what: 'Handover checklist', owner: 'manager' },
    { when: 'On start', what: 'IT, Admin and Finance told', owner: 'automatic' },
    ...(meta.interview && page ? [{ when: 'Tl − 5', what: 'Exit interview opens', owner: 'automatic' as const }] : []),
    { when: 'Tl', what: 'Laptop, ID and access returned', owner: 'it' },
    { when: 'Tl + 1', what: 'App account closes', owner: 'automatic' },
    { when: 'Tl + 2 working days', what: 'Settlement PDF emailed', owner: 'hr' },
    { when: 'Tl + 30', what: 'Gratuity, if eligible', owner: 'finance' },
  ];

  return (
    <div style={{ animation: 'fade .3s ease both' }}>
      <PageActions>
        <button type="button" onClick={onBack} className={btnClass()} style={btn()}>Cancel</button>
        <button type="button" id="ob-start-exit" disabled={!ready || busy} onClick={() => void start()} className={btnClass('primary')} style={btn('primary')}>{busy ? 'Starting…' : 'Start exit'}</button>
      </PageActions>
      <p className="pd-lead" style={{ marginBottom: 16 }}>For exits HR starts: retirement, end of contract, termination, or a resignation that came by email. Resignations sent from the app start on their own.</p>
      <div className="ob-two">
        <Card padded>
          <div className="ob-form">
            <label className="f">Employee
              <span className="pd-pick">
                <select className="pd-inp" value={userId} onChange={(e) => setUserId(e.target.value)} style={{ width: '100%' }}>
                  <option value="">Pick an employee</option>
                  {people.map((e) => <option key={e.id} value={e.id}>{[e.name, e.role, e.team, e.employeeId !== '—' ? e.employeeId : ''].filter(Boolean).join(' · ')}</option>)}
                </select>
              </span>
            </label>
            <div className="f" style={{ display: 'grid', gap: 8, fontSize: 13, fontWeight: 600 }}>Exit type
              <div className="pd-seg" role="radiogroup" aria-label="Exit type">
                {TYPES.map((t) => <button key={t.key} type="button" role="radio" aria-checked={type === t.key} className={type === t.key ? 'on' : ''} onClick={() => setType(t.key)}>{t.label}</button>)}
              </div>
              <span className="hint">{meta.note}</span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
              <label className="f">Last working day
                <input type="date" className="pd-inp" value={lastDay} onChange={(e) => setLastDay(e.target.value)} />
                {lastDay && lastDay < todayKey() && <span className="hint" style={{ color: 'var(--warn)' }}>Already past: {name}'s app turns off as you start this.</span>}
              </label>
              <label className="f">Notice
                <span className="pd-pick">
                  <select className="pd-inp" value={notice} onChange={(e) => setNotice(e.target.value as NoticeHandling)} style={{ width: '100%' }}>
                    {[meta.notice, ...(['waived', 'recovered', 'paid_in_lieu'] as NoticeHandling[]).filter((n) => n !== meta.notice)].map((n) => <option key={n} value={n}>{NOTICE_LABEL[n]}</option>)}
                  </select>
                </span>
              </label>
            </div>
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
            {team.length > 0 && (
              <label className="f">{name} leads {team.length} {team.length === 1 ? 'person' : 'people'}. Who will they report to?
                <span className="pd-pick">
                  <select className="pd-inp" value={successor} onChange={(e) => setSuccessor(e.target.value)} style={{ width: '100%' }}>
                    <option value="">Pick a manager</option>
                    {others.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
                  </select>
                </span>
                <span className="hint">They move the day after the last day (at once when the app turns off now).</span>
              </label>
            )}
            <label className="f">Internal note · HR only
              <textarea className="pd-inp" rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder={type === 'resignation' ? `Resignation received by email on ${longDay(todayKey())}.` : ''} />
            </label>
            <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', fontSize: 13 }}>
              <input type="checkbox" checked={tellManager} onChange={(e) => setTellManager(e.target.checked)} style={{ marginTop: 3 }} />
              <span><b style={{ fontWeight: 600 }}>Tell the manager now</b><span className="hint" style={{ display: 'block' }}>They get the handover checklist to fill in.</span></span>
            </label>
            <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', fontSize: 13 }}>
              <input type="checkbox" checked={page} onChange={(e) => setPage(e.target.checked)} style={{ marginTop: 3 }} />
              <span><b style={{ fontWeight: 600 }}>Show the Off-boarding page in the employee's app</b><span className="hint" style={{ display: 'block' }}>{meta.pageNote}</span></span>
            </label>
          </div>
        </Card>
        <Card padded>
          <div className="pd-card-h"><h3>What happens next</h3></div>
          <div className="hint" style={{ fontSize: 12.5, color: 'var(--ink-3)', marginBottom: 10 }}>From the {templateName} offboarding template, dated from the last working day{lastDay ? ` (${longDay(lastDay)})` : ''}.</div>
          <div className="ob-plan">
            {plan.map((p) => (
              <div key={p.what}><b>{p.when === 'Tl' && lastDay ? longDay(lastDay) : p.when === 'Tl + 30' && lastDay ? longDay(addDays(lastDay, 30)) : p.when}</b><span>{p.what}</span><OwnerChip owner={{ role: p.owner }} /></div>
            ))}
          </div>
          <div className="pd-note" style={{ marginTop: 14, fontSize: 12.5 }}>Final wages are due within 2 working days of the last day, gratuity within 30 days. Whether salary is held during notice comes from Payroll › Exit settings.</div>
        </Card>
      </div>
    </div>
  );
}
