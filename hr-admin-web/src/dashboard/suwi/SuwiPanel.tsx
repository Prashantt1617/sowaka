// Ask Suwi: the side panel on every dashboard page. HR asks in plain words;
// the answer shows what Suwi checked, buttons to the records, and any change
// it prepared as a "What will happen" card that only Confirm carries out.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { useStore } from '../store';
import type { View } from '../theme';
import { IconClose } from '../icons';
import { ApiError } from '../../services/http';
import { askSuwi, cancelSuwiAction, confirmSuwiAction, undoSuwiAction, type SuwiAnswer, type SuwiHistoryTurn, type SuwiProposal } from '../../services/suwi';
import { Markdown } from './markdown';
import './suwi.css';

/** The sky orb: a small sky with a cloud drifting across it. */
export function SuwiOrb({ size = 28 }: { size?: number }) {
  return <span aria-hidden className={size <= 22 ? 'sora-orb sm' : size >= 40 ? 'sora-orb lg' : 'sora-orb'} style={{ width: size, height: size }}><i /></span>;
}

type Msg = { role: 'user'; text: string } | { role: 'assistant'; answer: SuwiAnswer; error?: boolean };

/** Prompts that fit the page HR is on. */
const PROMPTS: Partial<Record<View, string[]>> = {
  overview: ['What needs my attention today?', 'Who is absent or on leave today?', 'What is waiting on HR the longest?'],
  leave: ['Which leave requests are waiting the longest?', 'Who is on leave in the next 7 days?', 'How much leave does someone have left?'],
  overtime: ['Which overtime requests are pending?', 'Who claimed overtime more than twice this month?'],
  attendance: ['Who has missed punches this week?', 'Who was late 3 or more times this month?'],
  attendancereport: ['Who was late 3 or more times this month?', 'Who was absent most in September?', 'Which department has the most missed punches?'],
  employees: ['Who joined this month?', 'Who has no reporting manager?', 'How many people are in each department?'],
  peopletasks: ['Who still needs a shift template?', 'What employee details are missing?'],
  shifttypes: ['Who is not on any shift template?', 'Move someone to a different shift'],
  shiftbulk: ['Who is on the Default shift?', 'Put the sales team on the Late Shift'],
  reimbursements: ['Which claims are pending?', 'Which claims are waiting more than 7 days?'],
  orgchart: ['Who reports to whom in Engineering?', 'Who has no manager?'],
};
const DEFAULT_PROMPTS = ['What needs my attention today?', 'Who was late 3 or more times this month?', 'What can you help with?'];

export function SuwiPanel() {
  const s = useStore();
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const panelRef = useRef<HTMLElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const open = s.suwiOpen;

  // Each time the panel opens: the opening sequence (a colour wash with
  // pulsing dots, the greeting, then the conversation fading up), unless the
  // system asks for less motion. The field takes focus once it is back.
  useLayoutEffect(() => {
    const el = panelRef.current;
    if (!open || !el) return;
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!still) {
      el.classList.remove('intro');
      void el.offsetWidth; // restart the animations even when reopened mid-sequence
      el.classList.add('intro');
    }
    const introT = window.setTimeout(() => el.classList.remove('intro'), 2100);
    const focusT = window.setTimeout(() => inputRef.current?.focus(), still ? 60 : 1900);
    return () => { window.clearTimeout(introT); window.clearTimeout(focusT); };
  }, [open]);
  useEffect(() => { bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight, behavior: 'smooth' }); }, [msgs, busy]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: globalThis.KeyboardEvent) => { if (e.key === 'Escape') s.setSuwiOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, s]);

  const ask = async (q: string) => {
    const question = q.trim();
    if (!question || busy) return;
    setDraft('');
    const history: SuwiHistoryTurn[] = msgs.flatMap((m): SuwiHistoryTurn[] => (m.role === 'user' ? [{ role: 'user', text: m.text }] : m.error ? [] : [{ role: 'assistant', text: m.answer.text }]));
    setMsgs((m) => [...m, { role: 'user', text: question }]);
    setBusy(true);
    try {
      const answer = await askSuwi(question, s.view, history);
      setMsgs((m) => [...m, { role: 'assistant', answer }]);
    } catch (e) {
      const text = e instanceof ApiError ? e.message : 'Suwi could not answer just now. Try again in a moment.';
      setMsgs((m) => [...m, { role: 'assistant', error: true, answer: { text, checked: [], links: [], proposals: [], costUsd: 0 } }]);
    } finally {
      setBusy(false);
    }
  };
  // A question handed over from elsewhere (Suwi's notices): ask it as soon as the panel is open.
  const pending = s.suwiAsk;
  useEffect(() => {
    if (!open || !pending || busy) return;
    s.clearSuwiAsk();
    void ask(pending);
  }, [open, pending, busy]); // eslint-disable-line react-hooks/exhaustive-deps
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void ask(draft); } };
  const updateProposal = (p: SuwiProposal) => setMsgs((m) => m.map((x) => (x.role === 'assistant' ? { ...x, answer: { ...x.answer, proposals: x.answer.proposals.map((q) => (q.id === p.id ? p : q)) } } : x)));
  const openLink = (l: { view?: string; userId?: string; tab?: string }) => {
    if (l.userId) s.openProfile(l.userId, l.tab);
    else if (l.view) s.setView(l.view as View);
  };
  const prompts = PROMPTS[s.view] ?? DEFAULT_PROMPTS;
  const first = (s.user?.name ?? '').trim().split(/\s+/)[0] || 'there';

  // Always in the page, hidden while closed, so opening and closing can dissolve.
  return (
    <aside ref={panelRef} className={open ? 'sora on' : 'sora'} role="dialog" aria-label="Ask Suwi" aria-hidden={!open} inert={!open}>
      <div className="suwi-veil" aria-hidden><div className="suwi-dots" /></div>
      <div className="suwi-greet" aria-hidden><b>Hi {first}!</b><span>What would you like to know about your people?</span></div>
      <div className="suwi-c">
        <div className="sora-h">
          <SuwiOrb />
          <div style={{ minWidth: 0 }}>
            <h3>Suwi</h3>
            <small>Answers from your company's data · only what you can see</small>
          </div>
          <div className="sora-hx">
            {msgs.length > 0 && <button type="button" onClick={() => setMsgs([])} title="Start over" className="suwi-btn">Clear</button>}
            <button type="button" onClick={() => s.setSuwiOpen(false)} aria-label="Close" className="suwi-btn icon"><IconClose size={15} stroke="currentColor" /></button>
          </div>
        </div>

        <div ref={bodyRef} className="sora-b scry">
          {msgs.length === 0 && (
            <div className="sora-hello">
              <SuwiOrb size={56} />
              <h4>Hi {first}, I'm Suwi.</h4>
              <p>I look across requests, attendance, people, payroll and claims, and I only act after you confirm.</p>
            </div>
          )}
          {msgs.map((m, i) => (m.role === 'user' ? (
            <div key={i} className="sm me"><p>{m.text}</p></div>
          ) : (
            <div key={i} className="sm sora-a">
              <SuwiOrb size={20} />
              <div className="sm-col">
                <div className={m.error ? 'sm-b err' : 'sm-b'}>
                  <Markdown text={m.answer.text} onPerson={(id) => s.openProfile(id)} />
                  {m.answer.links.length > 0 && (
                    <div className="sora-acts">
                      {m.answer.links.map((l) => <button key={l.label} type="button" onClick={() => openLink(l)} className="suwi-btn">{l.label} ›</button>)}
                    </div>
                  )}
                  {m.answer.checked.length > 0 && (
                    <details className="sora-why">
                      <summary>What I checked</summary>
                      <ul>{m.answer.checked.map((c) => <li key={c}>{c}</li>)}</ul>
                    </details>
                  )}
                </div>
                {m.answer.proposals.map((p) => <ProposalCard key={p.id} p={p} onChange={updateProposal} />)}
              </div>
            </div>
          )))}
          {busy && (
            <div className="suwi-typing" role="status">
              <SuwiOrb size={20} />
              <span className="suwi-typing-b"><span className="suwi-typing-d" aria-hidden><span /><span /><span /></span>Looking that up…</span>
            </div>
          )}
        </div>

        <div className="sora-f">
          {!busy && (
            <div className="sora-chips">
              {prompts.map((p) => <button key={p} type="button" onClick={() => void ask(p)} className="sora-chip">{p}</button>)}
            </div>
          )}
          <div className="sora-in">
            <textarea ref={inputRef} value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={onKey} rows={1} placeholder="Ask Suwi about your people…" aria-label="Ask Suwi" disabled={busy} />
            <button type="button" onClick={() => void ask(draft)} disabled={busy || !draft.trim()} aria-label="Send" className="sora-send">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M5 12h14M13 6l6 6-6 6" /></svg>
            </button>
          </div>
          <p className="sora-ft">Suwi never changes anything without your confirmation. Answers can be wrong: check the records it links to.</p>
        </div>
      </div>
    </aside>
  );
}

/** A prepared change: what will happen, Why?, and the only button that saves it. */
function ProposalCard({ p, onChange }: { p: SuwiProposal; onChange: (p: SuwiProposal) => void }) {
  const s = useStore();
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [why, setWhy] = useState<number | null>(null);
  const run = async (fn: () => Promise<SuwiProposal>) => {
    setBusy(true);
    try { onChange(await fn()); } catch (e) { s.flash(e instanceof ApiError ? e.message : 'Could not do that', 'error'); } finally { setBusy(false); }
  };
  const tone = p.status === 'done' ? 'var(--ok)' : p.status === 'failed' ? 'var(--bad)' : 'var(--hi)';
  return (
    <div className="suwi-prop">
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span className="suwi-prop-k" style={{ color: tone }}>{p.status === 'pending' ? 'What will happen' : p.status === 'done' ? 'Done' : p.status === 'undone' ? 'Undone' : p.status === 'failed' ? 'Failed' : p.status}</span>
        <span style={{ flex: 1 }} />
        {p.effectiveFrom && p.status === 'pending' && <span style={{ fontSize: 11.5, color: 'var(--ink-3)' }}>from {p.effectiveFrom}</span>}
      </div>
      <div className="suwi-prop-t">{p.title}</div>
      <div className="suwi-prop-s">{p.summary}</div>
      {p.status === 'pending' && p.lines.length > 0 && (
        <ul>
          {p.lines.map((l, i) => (
            <li key={i} style={{ color: l.tone === 'warn' ? 'var(--warn)' : 'var(--ink)' }}>
              {l.text}{l.why && <> <button type="button" onClick={() => setWhy(why === i ? null : i)} aria-expanded={why === i} className="suwi-whyb">Why?</button></>}
              {why === i && l.why && <div className="suwi-prop-why">{l.why}</div>}
            </li>
          ))}
        </ul>
      )}
      {p.message && p.status !== 'pending' && <div style={{ color: tone }}>{p.message}</div>}
      {p.status === 'pending' && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginTop: 2 }}>
          {p.typeToConfirm && <input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={`Type ${p.typeToConfirm} to confirm`} aria-label="Type to confirm" />}
          <button type="button" disabled={busy || (Boolean(p.typeToConfirm) && typed.trim().toLowerCase() !== p.typeToConfirm!.toLowerCase())} onClick={() => void run(() => confirmSuwiAction(p.id, typed))} className="suwi-btn primary">{busy ? 'Working…' : 'Confirm'}</button>
          <button type="button" disabled={busy} onClick={() => void run(async () => { await cancelSuwiAction(p.id); return { ...p, status: 'cancelled' }; })} className="suwi-btn">Cancel</button>
          <span className="sora-cf" style={{ width: '100%', fontSize: 11.5 }}><SuwiOrb size={16} />Prepared by Suwi · you confirm. Recorded in Suwi's activity as "via Suwi".</span>
        </div>
      )}
      {p.status === 'done' && p.undoable && <div><button type="button" disabled={busy} onClick={() => void run(() => undoSuwiAction(p.id))} className="suwi-btn">{busy ? 'Working…' : 'Undo'}</button></div>}
    </div>
  );
}
