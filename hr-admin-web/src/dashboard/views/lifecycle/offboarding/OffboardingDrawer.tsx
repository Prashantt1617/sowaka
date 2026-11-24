// The exit drawer (O1d, 460 px): the six-step track, what it waits on, the resignation's reason and
// note, the clearance by team (IT, Admin and Finance tick their own), the handover, the tasks, the
// details, and HR's actions for the step: accept with the last day, change the last day or release
// early, open the settlement, close; Remind whoever holds an open step (once a day each); make the
// relieving letter in Documents; view their handover files and letters. Reason and note are the
// manager's and HR's; exit interview answers never show here. IT, Admin and Finance staff see only
// their own items and no money.
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { LoadError, SkeletonLines } from '../../../ui';
import { PersonAvatar } from '../../../PersonAvatar';
import { DrawerShell, CloseButton } from '../../../drawers/shell';
import { useStore } from '../../../store';
import {
  acceptResignation, changeLastDay, closeExit, getOffboardingDetail, openHandoverFile, sendNudge, setAppPage, setClearance, taskDone,
} from '../../../../services/lifecycleOffboarding';
import type { BoardCard, DrawerDTO } from '../../../../services/lifecycleOffboarding';
import { listLetters } from '../../../../services/lifecycle';
import type { LetterView } from '../../../../services/lifecycle';
import { DOCS_OPEN_KEY } from '../format';
import { FilePreview } from '../shared';
import { LockIcon, OwnerChip, TEAM_LABEL, addDays, dueText, firstName, inrPaise, istKey, longDay, ownerRoleLabel, todayKey } from './parts';

const HR_TICKS = new Set(['relieving_letter', 'epfo_exit', 'gratuity', 'kt_session', 'thank_you_note', 'delete_face_data', 'final_settlement']);

export function OffboardingDrawer({ card, tabLabel, columnLabel, onClose, onChanged, onOpenSettlement }: {
  card: BoardCard; tabLabel: string; columnLabel: string; onClose: () => void; onChanged: () => void; onOpenSettlement: (userId: string) => void;
}) {
  const s = useStore();
  const [data, setData] = useState<DrawerDTO | null>(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState('');
  const [dialog, setDialog] = useState<'' | 'accept' | 'change' | 'early' | 'move' | 'docs'>('');

  useEffect(() => {
    let live = true;
    setError('');
    getOffboardingDetail(card.userId).then((d) => { if (live) setData(d); }).catch((e) => { if (live) setError(e instanceof Error ? e.message : 'Could not load this exit'); });
    return () => { live = false; };
  }, [card.userId, attempt]);

  const run = async (what: string, work: () => Promise<DrawerDTO | unknown>, done?: string) => {
    setBusy(what);
    try {
      const out = await work();
      if (out && typeof out === 'object' && 'card' in (out as DrawerDTO)) setData(out as DrawerDTO);
      else setAttempt((n) => n + 1);
      if (done) s.flash(done);
      onChanged();
      return true;
    } catch (e) {
      s.flash(e instanceof Error ? e.message : 'Could not save', 'error');
      return false;
    } finally {
      setBusy('');
    }
  };

  const today = todayKey();
  const d = data;
  const hr = d?.viewer.kind === 'hr';
  const r = d?.resignation;
  const pending = !!r && (r.status === 'with_manager' || r.status === 'with_hr');
  const exit = d?.exit;
  const left = !!exit?.accessEndedAt;
  const column = d?.card.column ?? card.column;
  const name = firstName(card.name);
  const relievingOpen = !!d?.tasks.some((t) => t.systemKey === 'relieving_letter' && t.status !== 'done' && t.status !== 'skipped' && t.status !== 'cancelled');
  /** Documents, on the Relieving letter, with this person picked. */
  const generateRelieving = () => {
    try { sessionStorage.setItem(DOCS_OPEN_KEY, JSON.stringify({ kind: 'relieving', userId: card.userId })); } catch { /* Documents opens on its own first choice */ }
    onClose();
    s.setView('lifecycle_documents');
  };

  return (
    <DrawerShell width={460} onClose={onClose}>
      <div className="ob-dr-top"><span>{tabLabel} · {columnLabel}</span><CloseButton onClose={onClose} /></div>
      <div className="ob-dr-body" role="dialog" aria-label={card.name}>
        <div className="ob-dr-id">
          <PersonAvatar name={card.name} userId={card.userId} size={64} font={22} />
          <div style={{ minWidth: 0 }}>
            <h2>{card.name}</h2>
            <div className="sub">{[card.designation, card.department].filter(Boolean).join(' · ')}</div>
            {d && <div className="st">{d.statusLabel}</div>}
          </div>
        </div>
        {error && <LoadError compact text={error} onRetry={() => setAttempt((n) => n + 1)} />}
        {!d && !error && <SkeletonLines lines={6} />}
        {d && (
          <>
            <div className="ob-track" aria-label="Where it stands">
              {d.track.steps.map((label, i) => (
                <div key={label} className={i < d.track.current ? 'done' : i === d.track.current ? 'cur' : ''}><i />{label}</div>
              ))}
            </div>

            <section className="ob-sec">
              <h4>Waiting on</h4>
              {d.waitingOn.length === 0 && <div className="ob-row"><OwnerChip owner={{ role: 'automatic' }} /><span className="t">Nothing waiting</span><span className="d">—</span></div>}
              {d.waitingOn.map((w, i) => (
                <div key={i} className="ob-row"><OwnerChip owner={w.owner} /><span className="t">{w.task}</span><span className={`d${w.late ? ' late' : ''}`}>{dueText(w.due, today, w.late)}</span></div>
              ))}
            </section>

            {hr && d.nudges.length > 0 && (
              <section className="ob-sec" aria-label="Reminders">
                <h4>Nudge</h4>
                {d.nudges.map((n) => (
                  <div key={n.item} className="ob-row">
                    <span className="t">{n.what}<small>{n.sentToday ? `Reminded today · again tomorrow` : n.late ? 'Late' : 'A push, once a day'}{['IT', 'Admin', 'Finance'].includes(n.to) ? ' · and an email to the team' : ''}</small></span>
                    <button type="button" className="pd-btn sm" disabled={!!busy || n.sentToday}
                      onClick={() => void run(`nudge-${n.item}`, () => sendNudge(card.userId, n.item), `${n.to} is reminded`)}>
                      {busy === `nudge-${n.item}` ? 'Sending…' : n.sentToday ? 'Reminded' : n.label}
                    </button>
                  </div>
                ))}
              </section>
            )}

            {d.clearance.length > 0 && (
              <section className="ob-sec">
                <h4>Clearance</h4>
                {d.clearance.map((c) => (
                  <div key={c.key} className="ob-row">
                    <input type="checkbox" aria-label={`${c.label} done`} checked={c.done} disabled={!c.canTick || !!busy}
                      onChange={(e) => void run(`clear-${c.key}`, () => setClearance(card.userId, { key: c.key, done: e.target.checked }), e.target.checked ? `${c.label}: done` : undefined)}
                      style={{ width: 16, height: 16, accentColor: 'var(--accent)', flex: 'none' }} />
                    <span className="ob-owner" style={{ background: 'var(--surface-2)', color: 'var(--ink-2)' }}>{TEAM_LABEL[c.team]}</span>
                    <span className="t">{c.label}{c.done && c.doneAt ? <small>{[c.doneByName, longDay(istKey(c.doneAt))].filter(Boolean).join(' · ')}</small> : null}</span>
                    {c.team === 'finance' && c.canTick && !c.done
                      ? <AmountInput value={c.amountPaise} onSave={(paise) => void run('amount', () => setClearance(card.userId, { key: c.key, done: false, amountPaise: paise }), paise ? 'Amount open saved' : 'Nothing open')} />
                      : <span className="d" style={{ color: c.done ? 'var(--ok)' : c.amountPaise ? 'var(--warn)' : undefined }}>{c.done ? 'Done' : c.amountPaise ? `${inrPaise(c.amountPaise)} open` : 'Pending'}</span>}
                  </div>
                ))}
              </section>
            )}

            {hr && d.handover.items.length > 0 && (
              <section className="ob-sec">
                <h4>Handover · {d.handover.items.filter((h) => h.upload).length} of {d.handover.items.length} uploaded</h4>
                {d.handover.note && <div style={{ fontSize: 12.5, color: 'var(--ink-2)', marginBottom: 6 }}>“{d.handover.note}”</div>}
                {d.handover.items.map((h) => (
                  <div key={h.id} className="ob-row">
                    <span className="t">{h.title}{h.upload ? <small>{h.upload.name ?? (h.upload.kind === 'link' ? 'Link' : 'File')} · {longDay(istKey(h.upload.at))}</small> : <small>Waiting for {name}</small>}</span>
                    {h.upload?.kind === 'link' && h.upload.url && <a className="pd-lnk" href={h.upload.url} target="_blank" rel="noreferrer noopener">Open</a>}
                    {h.upload?.kind === 'file' && <button type="button" className="pd-lnk" onClick={() => void openHandoverFile(card.userId, h.id).catch((e) => s.flash(e instanceof Error ? e.message : 'Could not open', 'error'))}>Open</button>}
                  </div>
                ))}
              </section>
            )}

            {d.tasks.length > 0 && (
              <section className="ob-sec">
                <h4>Tasks · {d.tasks.filter((t) => t.status === 'done').length} of {d.tasks.filter((t) => t.status !== 'cancelled' && t.status !== 'skipped').length} done</h4>
                {/* Steps that never applied (an HR-started exit has no resignation to send or accept) are left out. */}
                {d.tasks.filter((t) => t.status !== 'cancelled' && !(t.status === 'skipped' && t.phase === 'resignation' && t.doneByName === 'Automatic')).map((t) => {
                  const due = t.dueAt ? istKey(t.dueAt) : null;
                  const skipped = t.status === 'skipped';
                  const tickable = hr && !!t.systemKey && HR_TICKS.has(t.systemKey) && t.status !== 'done' && !skipped && t.systemKey !== 'final_settlement';
                  const owner = t.ownerName ?? ownerRoleLabel(t.ownerRole);
                  const by = t.doneByName && t.doneByName !== owner ? `done by ${t.doneByName}` : t.status === 'done' ? 'done' : '';
                  return (
                    <div key={t.id} className="ob-row">
                      <span style={{ width: 16, flex: 'none', color: t.status === 'done' ? 'var(--ok)' : 'var(--ink-4)' }} aria-label={t.status === 'done' ? 'Done' : skipped ? 'Skipped' : 'To do'}>{t.status === 'done' ? '✓' : skipped ? '–' : '○'}</span>
                      <span className="t" style={skipped ? { color: 'var(--ink-3)' } : undefined}>{t.title}<small>{[owner, skipped ? t.note || 'Skipped' : t.status === 'done' ? by : t.dueLabel].filter(Boolean).join(' · ')}</small></span>
                      {tickable
                        ? <button type="button" className="pd-btn sm" disabled={!!busy} onClick={() => void run(`task-${t.systemKey}`, () => taskDone(card.userId, t.systemKey!), `${t.title}: done`)}>Mark done</button>
                        : <span className={`d${t.late ? ' late' : ''}`}>{t.status === 'done' ? 'Done' : skipped ? 'Skipped' : due ? dueText(due, today, t.late) : '—'}</span>}
                    </div>
                  );
                })}
              </section>
            )}

            <section className="ob-sec">
              <h4>Details</h4>
              <dl className="ob-dl">{d.details.map((x) => <FragmentRow key={x.label} label={x.label} value={x.value} />)}</dl>
            </section>

            {hr && exit && !left && (
              <div className="ob-row">
                <AppPageSwitch on={d.appPage} busy={!!busy}
                  onChange={(on) => void run('page', () => setAppPage(card.userId, on), on ? 'The Off-boarding page is on in their app' : 'The Off-boarding page is off')} />
                <span className="t">Off-boarding page in {name}'s app<small>Their last day, tasks{d.interview?.applies ? ' and exit interview' : ''}. Off by default for a termination or an absconding.</small></span>
              </div>
            )}

            <div className="ob-privacy"><LockIcon /><span>The reason and note are seen by the manager and HR. Exit interview answers are anonymised; nobody sees them against a name.</span></div>
          </>
        )}
      </div>
      {d && hr && (
        <div className="ob-dr-foot">
          <button type="button" className="pd-btn" onClick={() => s.openProfile(card.userId, exit ? 'exit' : undefined)}>Open profile</button>
          {exit && <button type="button" className="pd-btn" onClick={() => setDialog('docs')}>View documents</button>}
          {exit && relievingOpen && <button type="button" id="ob-relieving" className="pd-btn" onClick={generateRelieving}>Generate relieving letter</button>}
          {pending && (
            <>
              <button type="button" className="pd-btn" onClick={() => setDialog('change')}>Change last day</button>
              <button type="button" className="pd-btn" onClick={() => setDialog('early')}>Release early</button>
              <button type="button" id="ob-accept" className="pd-btn primary" onClick={() => setDialog('accept')}>{r?.manager?.action === 'change_day' || r?.manager?.action === 'release_early' ? 'Confirm last day' : 'Accept resignation'}</button>
            </>
          )}
          {exit && !left && column !== 'last_day' && <button type="button" className="pd-btn" onClick={() => setDialog('move')}>Change last day</button>}
          {(column === 'last_day' || column === 'last_week') && d.viewer.seesPay && <button type="button" className="pd-btn primary" onClick={() => onOpenSettlement(card.userId)}>Prepare settlement</button>}
          {column === 'settlement_due' && d.viewer.seesPay && <button type="button" id="ob-open-settlement" className="pd-btn primary" onClick={() => onOpenSettlement(card.userId)}>Open settlement</button>}
          {column === 'settlement_sent' && d.viewer.seesPay && <button type="button" className="pd-btn" onClick={() => onOpenSettlement(card.userId)}>Open settlement</button>}
          {column === 'settlement_sent' && card.journeyId && <button type="button" className="pd-btn primary" disabled={!!busy} onClick={() => void run('close', () => closeExit(card.userId), `${name}'s exit is closed`)}>Close exit</button>}
        </div>
      )}
      {dialog === 'docs' && d && <DocumentsDialog d={d} onClose={() => setDialog('')} />}
      {dialog && dialog !== 'docs' && d && (dialog === 'move'
        ? <LastDayDialog d={d} onClose={() => setDialog('')} onDone={(out) => { setDialog(''); setData(out); onChanged(); }} />
        : <AcceptDialog d={d} mode={dialog} onClose={() => setDialog('')} onDone={() => { setDialog(''); setAttempt((n) => n + 1); onChanged(); }} />)}
    </DrawerShell>
  );
}

function FragmentRow({ label, value }: { label: string; value: string }) {
  return <><dt>{label}</dt><dd>{value}</dd></>;
}

function AppPageSwitch({ on, busy, onChange }: { on: boolean; busy: boolean; onChange: (v: boolean) => void }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label="Off-boarding page in the app" disabled={busy} onClick={() => onChange(!on)}
      style={{ width: 38, height: 22, borderRadius: 99, border: 'none', padding: 2, cursor: 'pointer', display: 'flex', flexShrink: 0, background: on ? 'var(--accent)' : 'var(--line-2)', justifyContent: on ? 'flex-end' : 'flex-start' }}>
      <span style={{ width: 18, height: 18, borderRadius: '50%', background: '#fff', boxShadow: '0 1px 2px rgba(0,0,0,.2)' }} />
    </button>
  );
}

function AmountInput({ value, onSave }: { value?: number; onSave: (paise: number | null) => void }) {
  const [text, setText] = useState(value ? String(Math.round(value / 100)) : '');
  const save = () => {
    const n = text.trim() === '' ? null : Math.round(Number(text.replace(/[^0-9.]/g, '')) * 100);
    if ((n ?? 0) !== (value ?? 0)) onSave(n || null);
  };
  return (
    <input className="pd-inp" inputMode="numeric" aria-label="Amount open (₹)" placeholder="₹ open" value={text} onChange={(e) => setText(e.target.value)} onBlur={save}
      onKeyDown={(e) => { if (e.key === 'Enter') save(); }} style={{ width: 96, height: 32 }} />
  );
}

/** Portalled to the page body, so it opens in the middle of the window whatever the drawer's transform. */
function Modal({ title, sub, children, foot, onClose }: { title: string; sub?: string; children: React.ReactNode; foot: React.ReactNode; onClose: () => void }) {
  return createPortal(
    <div onClick={onClose} className="pd-scrim" style={{ zIndex: 90, background: 'rgba(20, 16, 50, 0.38)' }}>
      <div onClick={(e) => e.stopPropagation()} className="pd-modal" role="dialog" aria-label={title} style={{ width: 'min(520px, 100%)', maxHeight: 'calc(100vh - 40px)', display: 'flex', flexDirection: 'column' }}>
        <div className="pd-md-h"><div><h3>{title}</h3>{sub && <div className="pd-md-sub">{sub}</div>}</div></div>
        <div className="pd-md-b">{children}</div>
        <div className="pd-md-f">{foot}</div>
      </div>
    </div>,
    document.body,
  );
}

/** Accept the resignation and confirm the last day; Change last day and Release early set another day first. */
function AcceptDialog({ d, mode, onClose, onDone }: { d: DrawerDTO; mode: 'accept' | 'change' | 'early'; onClose: () => void; onDone: () => void }) {
  const s = useStore();
  const r = d.resignation!;
  const name = firstName(d.person.name);
  const team = s.emps.filter((e) => e.managerId === d.person.userId && e.id !== d.person.userId && !e.exit?.left);
  const others = s.emps.filter((e) => e.id !== d.person.userId && !e.exit?.left).sort((a, b) => a.name.localeCompare(b.name));
  const [day, setDay] = useState(mode === 'early' ? '' : r.manager?.date ?? r.lastDayByNotice);
  const [note, setNote] = useState('');
  const [successor, setSuccessor] = useState('');
  const [busy, setBusy] = useState(false);
  const early = !!day && day < r.lastDayByNotice;
  const sent = istKey(r.submittedAt);
  const ok = !!day && day >= sent && (team.length === 0 || !!successor) && (mode !== 'early' || early);
  const title = mode === 'early' ? `Release ${name} early` : mode === 'change' ? 'Agree another last day' : r.manager?.action && r.manager.action !== 'accept' ? 'Confirm the last day' : 'Accept the resignation';
  const save = async () => {
    setBusy(true);
    try {
      await acceptResignation(r.id, { lastWorkingDay: day, ...(note.trim() ? { note: note.trim() } : {}), ...(successor ? { newManagerUserId: successor } : {}) });
      s.flash(`${d.person.name}'s resignation is accepted. Last day ${longDay(day)}.`);
      onDone();
    } catch (e) {
      s.flash(e instanceof Error ? e.message : 'Could not accept', 'error');
      setBusy(false);
    }
  };
  return (
    <Modal title={title} sub={`Suggested last day ${longDay(r.lastDayByNotice)}.${r.manager?.date ? ` ${r.manager.byName} asked for ${longDay(r.manager.date)}.` : ''}`} onClose={onClose}
      foot={<><button type="button" className="pd-btn" onClick={onClose}>Cancel</button><button type="button" className="pd-btn primary" disabled={!ok || busy} onClick={() => void save()}>{busy ? 'Saving…' : 'Accept and confirm'}</button></>}>
      <label style={{ display: 'grid', gap: 6, fontWeight: 600, color: 'var(--ink)' }}>Last working day
        <input type="date" className="pd-inp" value={day} min={sent} max={mode === 'early' ? addDays(r.lastDayByNotice, -1) : undefined} onChange={(e) => setDay(e.target.value)} />
      </label>
      {team.length > 0 && (
        <label style={{ display: 'grid', gap: 6, fontWeight: 600, color: 'var(--ink)' }}>{name} leads {team.length} {team.length === 1 ? 'person' : 'people'}. Who will they report to?
          <span className="pd-pick">
            <select className="pd-inp" value={successor} onChange={(e) => setSuccessor(e.target.value)}>
              <option value="">Pick a manager</option>
              {others.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
          </span>
          <span style={{ fontWeight: 400, fontSize: 12.5, color: 'var(--ink-3)' }}>They move the day after {name}'s last day.</span>
        </label>
      )}
      <label style={{ display: 'grid', gap: 6, fontWeight: 600, color: 'var(--ink)' }}>Note (only HR sees it)
        <textarea className="pd-inp" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
      </label>
      <div style={{ color: 'var(--ink-3)', fontSize: 12.5 }}>{name} gets the Off-boarding page; {r.managerName ? firstName(r.managerName) : 'the manager'} is asked for the handover checklist; IT, Admin and Finance get their clearance items.</div>
    </Modal>
  );
}

/** Another last day once the exit is accepted: every Tl-based task moves with it. */
function LastDayDialog({ d, onClose, onDone }: { d: DrawerDTO; onClose: () => void; onDone: (out: DrawerDTO) => void }) {
  const s = useStore();
  const e = d.exit!;
  const name = firstName(d.person.name);
  const [day, setDay] = useState(e.lastWorkingDay);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      const out = await changeLastDay(d.person.userId, { lastWorkingDay: day, });
      s.flash(`${name}'s last day is now ${longDay(day)}`);
      onDone(out);
    } catch (err) {
      s.flash(err instanceof Error ? err.message : 'Could not save', 'error');
      setBusy(false);
    }
  };
  return (
    <Modal title="Change the last day" sub={`Now ${longDay(e.lastWorkingDay)}. Every due date dated from the last day moves with it.`} onClose={onClose}
      foot={<><button type="button" className="pd-btn" onClick={onClose}>Cancel</button><button type="button" className="pd-btn primary" disabled={!day || day === e.lastWorkingDay || busy} onClick={() => void save()}>{busy ? 'Saving…' : 'Save last day'}</button></>}>
      <label style={{ display: 'grid', gap: 6, fontWeight: 600, color: 'var(--ink)' }}>Last working day
        <input type="date" className="pd-inp" value={day} min={e.noticeFrom ?? undefined} onChange={(ev) => setDay(ev.target.value)} />
      </label>
    </Modal>
  );
}

const LETTER_NAME: Record<string, string> = { offer: 'Offer letter', appointment: 'Appointment letter', nda: 'NDA', confirmation: 'Confirmation letter', extension: 'Probation extension letter', relieving: 'Relieving letter' };

/** Their handover uploads and letters, each opened through the authorised file endpoints. */
function DocumentsDialog({ d, onClose }: { d: DrawerDTO; onClose: () => void }) {
  const s = useStore();
  const [letters, setLetters] = useState<LetterView[] | null>(null);
  const [error, setError] = useState('');
  const [open, setOpen] = useState<{ fileId: string; name: string } | null>(null);
  useEffect(() => {
    let live = true;
    listLetters({ userId: d.person.userId }).then((l) => { if (live) setLetters(l); }).catch((e) => { if (live) { setLetters([]); setError(e instanceof Error ? e.message : 'Could not load the letters'); } });
    return () => { live = false; };
  }, [d.person.userId]);
  const files = d.handover.items.filter((h) => h.upload);
  const name = firstName(d.person.name);
  // A file opens in its own dialog in place of this one, and Close comes back here.
  if (open) return <FilePreview fileId={open.fileId} name={open.name} onClose={() => setOpen(null)} />;
  return (
    <>
      <Modal title={`Documents · ${d.person.name}`} sub="Handover files and letters. Files open through the dashboard, never a public link." onClose={onClose}
        foot={<button type="button" className="pd-btn" onClick={onClose}>Close</button>}>
        <section className="ob-sec">
          <h4>Handover · {files.length} of {d.handover.items.length} uploaded</h4>
          {files.length === 0 && <div className="ob-empty">{d.handover.items.length ? `Nothing uploaded by ${name} yet.` : 'No handover checklist yet.'}</div>}
          {files.map((h) => (
            <div key={h.id} className="ob-row">
              <span className="t">{h.title}<small>{h.upload!.name ?? (h.upload!.kind === 'link' ? 'Link' : 'File')} · {longDay(istKey(h.upload!.at))}</small></span>
              {h.upload!.kind === 'link' && h.upload!.url
                ? <a className="pd-lnk" href={h.upload!.url} target="_blank" rel="noreferrer noopener">Open</a>
                : <button type="button" className="pd-lnk" onClick={() => void openHandoverFile(d.person.userId, h.id).catch((e) => s.flash(e instanceof Error ? e.message : 'Could not open', 'error'))}>Open</button>}
            </div>
          ))}
        </section>
        <section className="ob-sec">
          <h4>Letters</h4>
          {!letters && <SkeletonLines lines={2} />}
          {error && <div style={{ color: 'var(--bad)', fontSize: 12.5 }}>{error}</div>}
          {letters && letters.length === 0 && !error && <div className="ob-empty">No letters made for {name} yet.</div>}
          {letters?.map((l) => {
            const fileId = l.signedPdfFileId ?? l.pdfFileId;
            const label = LETTER_NAME[l.kind] ?? l.kind;
            return (
              <div key={l.id} className="ob-row">
                <span className="t">{label}<small>{[l.refNo, l.state === 'signed' ? 'Signed' : l.sentAt ? `Sent ${longDay(istKey(l.sentAt))}` : 'Not sent'].filter(Boolean).join(' · ')}</small></span>
                {fileId ? <button type="button" className="pd-lnk" onClick={() => setOpen({ fileId, name: `${label}.pdf` })}>Open</button> : <span className="d">No PDF yet</span>}
              </div>
            );
          })}
        </section>
      </Modal>
    </>
  );
}
