// Ask Suwi: the side panel on every dashboard page. HR asks in plain words;
// the answer shows what Suwi checked, buttons to the records, and any change
// it prepared as a "What will happen" card that only Confirm carries out.
import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent } from 'react';
import { useStore } from '../store';
import type { View } from '../theme';
import { ApiError } from '../../services/http';
import { askSuwi, cancelSuwiAction, confirmSuwiAction, undoSuwiAction, type SuwiAnswer, type SuwiHistoryTurn, type SuwiProposal } from '../../services/suwi';
import { Markdown } from './markdown';

export function SuwiOrb({ size = 26 }: { size?: number }) {
  return <span aria-hidden style={{ width: size, height: size, borderRadius: '50%', flexShrink: 0, display: 'inline-block', background: 'radial-gradient(circle at 32% 30%, #BFE4FF 0%, var(--brand) 48%, #6E62D6 100%)', boxShadow: '0 4px 14px -6px #6E62D6' }} />;
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
  const bodyRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const open = s.suwiOpen;

  useEffect(() => { if (open) inputRef.current?.focus(); }, [open]);
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
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void ask(draft); } };
  const updateProposal = (p: SuwiProposal) => setMsgs((m) => m.map((x) => (x.role === 'assistant' ? { ...x, answer: { ...x.answer, proposals: x.answer.proposals.map((q) => (q.id === p.id ? p : q)) } } : x)));
  const openLink = (l: { view?: string; userId?: string; tab?: string }) => {
    if (l.userId) s.openProfile(l.userId, l.tab);
    else if (l.view) s.setView(l.view as View);
  };
  const prompts = PROMPTS[s.view] ?? DEFAULT_PROMPTS;
  const first = (s.user?.name ?? '').trim().split(/\s+/)[0] || 'there';

  if (!open) return null;
  return (
    <aside className="ds-glass" role="dialog" aria-label="Ask Suwi" style={{ position: 'fixed', top: 16, right: 16, bottom: 16, width: 'min(430px, calc(100vw - 32px))', zIndex: 60, borderRadius: 'var(--r-lg)', boxShadow: 'var(--shadow-lg)', display: 'flex', flexDirection: 'column', overflow: 'hidden', animation: 'fade .2s ease both' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 14px 12px 18px', borderBottom: '1px solid var(--line)' }}>
        <SuwiOrb />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 600 }}>Suwi</div>
          <div style={{ fontSize: 12, color: 'var(--ink-3)' }}>Answers from your company's data · only what you can see</div>
        </div>
        {msgs.length > 0 && <button type="button" onClick={() => setMsgs([])} title="Start over" style={ghost}>Clear</button>}
        <button type="button" onClick={() => s.setSuwiOpen(false)} aria-label="Close" style={{ ...ghost, width: 34, padding: 0, fontSize: 18 }}>×</button>
      </div>

      <div ref={bodyRef} className="scry" style={{ flex: 1, overflowY: 'auto', padding: '16px 16px 8px', display: 'flex', flexDirection: 'column', gap: 12 }}>
        {msgs.length === 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', gap: 8, padding: '28px 8px 12px' }}>
            <SuwiOrb size={44} />
            <div style={{ fontSize: 17, fontWeight: 600, marginTop: 6 }}>Hi {first}, I'm Suwi.</div>
            <div style={{ fontSize: 13, color: 'var(--ink-2)', maxWidth: 300, lineHeight: 1.5 }}>I look across requests, attendance, people, payroll and claims, and I only act after you confirm.</div>
          </div>
        )}
        {msgs.map((m, i) => (m.role === 'user' ? (
          <div key={i} style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <div style={{ background: 'var(--accent-soft)', color: 'var(--ink)', border: '1px solid var(--accent-line)', padding: '9px 13px', borderRadius: '16px 16px 4px 16px', fontSize: 13.5, maxWidth: '86%', lineHeight: 1.45 }}>{m.text}</div>
          </div>
        ) : (
          <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
            <SuwiOrb size={22} />
            <div style={{ flex: 1, minWidth: 0, display: 'grid', gap: 8 }}>
              <div style={{ background: 'var(--surface)', border: `1px solid ${m.error ? 'var(--bad-line)' : 'var(--line)'}`, borderRadius: '4px 16px 16px 16px', padding: '10px 14px', fontSize: 13.5, color: m.error ? 'var(--bad)' : 'var(--ink)' }}>
                <Markdown text={m.answer.text} onPerson={(id) => s.openProfile(id)} />
                {m.answer.links.length > 0 && (
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
                    {m.answer.links.map((l) => <button key={l.label} type="button" onClick={() => openLink(l)} style={linkBtn}>{l.label} ›</button>)}
                  </div>
                )}
                {m.answer.checked.length > 0 && (
                  <details style={{ marginTop: 8 }}>
                    <summary style={{ cursor: 'pointer', fontSize: 12, color: 'var(--accent-ink)', fontWeight: 500 }}>What I checked</summary>
                    <ul style={{ margin: '4px 0 0', paddingLeft: 18, fontSize: 12, color: 'var(--ink-3)', display: 'grid', gap: 2 }}>{m.answer.checked.map((c) => <li key={c}>{c}</li>)}</ul>
                  </details>
                )}
              </div>
              {m.answer.proposals.map((p) => <ProposalCard key={p.id} p={p} onChange={updateProposal} />)}
            </div>
          </div>
        )))}
        {busy && (
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', color: 'var(--ink-3)', fontSize: 13 }}>
            <SuwiOrb size={22} /><span style={{ animation: 'pulse 1.2s ease-in-out infinite' }}>Looking that up…</span>
          </div>
        )}
      </div>

      <div style={{ padding: '8px 16px 14px', borderTop: '1px solid var(--line)', display: 'grid', gap: 8 }}>
        {!busy && (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {prompts.map((p) => <button key={p} type="button" onClick={() => void ask(p)} style={{ ...linkBtn, background: 'var(--surface)', border: '1px solid var(--accent-line)' }}>{p}</button>)}
          </div>
        )}
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', background: 'var(--surface)', border: '1px solid var(--line-2)', borderRadius: 18, padding: '6px 6px 6px 14px' }}>
          <textarea ref={inputRef} value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={onKey} rows={1} placeholder="Ask Suwi about your people…" aria-label="Ask Suwi" disabled={busy}
            style={{ flex: 1, border: 'none', outline: 'none', background: 'none', resize: 'none', font: 'inherit', fontSize: 13.5, color: 'var(--ink)', maxHeight: 96, padding: '8px 0' }} />
          <button type="button" onClick={() => void ask(draft)} disabled={busy || !draft.trim()} aria-label="Send" style={{ width: 36, height: 36, borderRadius: '50%', border: 'none', background: 'var(--accent)', color: 'var(--on-accent)', cursor: 'pointer', opacity: busy || !draft.trim() ? 0.45 : 1, fontSize: 16, flexShrink: 0 }}>→</button>
        </div>
        <div style={{ fontSize: 11.5, color: 'var(--ink-3)' }}>Suwi never changes anything without your confirmation. Answers can be wrong: check the records it links to.</div>
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
  const tone = p.status === 'done' ? 'var(--ok)' : p.status === 'failed' ? 'var(--bad)' : 'var(--accent-ink)';
  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--accent-line)', borderRadius: 16, padding: '12px 14px', display: 'grid', gap: 8, fontSize: 13 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: '.06em', textTransform: 'uppercase', color: tone }}>{p.status === 'pending' ? 'What will happen' : p.status === 'done' ? 'Done' : p.status === 'undone' ? 'Undone' : p.status === 'failed' ? 'Failed' : p.status}</span>
        <span style={{ flex: 1 }} />
        {p.effectiveFrom && p.status === 'pending' && <span style={{ fontSize: 11.5, color: 'var(--ink-3)' }}>from {p.effectiveFrom}</span>}
      </div>
      <div style={{ fontSize: 14.5, fontWeight: 600 }}>{p.title}</div>
      <div style={{ color: 'var(--ink-2)', lineHeight: 1.5 }}>{p.summary}</div>
      {p.status === 'pending' && p.lines.length > 0 && (
        <ul style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 4 }}>
          {p.lines.map((l, i) => (
            <li key={i} style={{ color: l.tone === 'warn' ? 'var(--warn)' : 'var(--ink)' }}>
              {l.text}{l.why && <> <button type="button" onClick={() => setWhy(why === i ? null : i)} style={{ ...linkBtn, padding: '0 6px', fontSize: 11.5 }}>Why?</button></>}
              {why === i && l.why && <div style={{ marginTop: 4, padding: '8px 10px', background: 'var(--surface-2)', borderRadius: 10, fontSize: 12.5, color: 'var(--ink-2)' }}>{l.why}</div>}
            </li>
          ))}
        </ul>
      )}
      {p.message && p.status !== 'pending' && <div style={{ color: tone }}>{p.message}</div>}
      {p.status === 'pending' && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginTop: 2 }}>
          {p.typeToConfirm && <input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={`Type ${p.typeToConfirm} to confirm`} aria-label="Type to confirm" style={{ flex: 1, minWidth: 150, height: 34, borderRadius: 10, border: '1px solid var(--line-2)', padding: '0 10px', font: 'inherit', fontSize: 13 }} />}
          <button type="button" disabled={busy || (Boolean(p.typeToConfirm) && typed.trim().toLowerCase() !== p.typeToConfirm!.toLowerCase())} onClick={() => void run(() => confirmSuwiAction(p.id, typed))} style={{ ...primary, opacity: busy ? 0.6 : 1 }}>{busy ? 'Working…' : 'Confirm'}</button>
          <button type="button" disabled={busy} onClick={() => void run(async () => { await cancelSuwiAction(p.id); return { ...p, status: 'cancelled' }; })} style={ghost}>Cancel</button>
          <span style={{ fontSize: 11.5, color: 'var(--ink-3)', width: '100%' }}>Prepared by Suwi · you confirm. Recorded in Suwi's activity as "via Suwi".</span>
        </div>
      )}
      {p.status === 'done' && p.undoable && <div><button type="button" disabled={busy} onClick={() => void run(() => undoSuwiAction(p.id))} style={ghost}>{busy ? 'Working…' : 'Undo'}</button></div>}
    </div>
  );
}

const ghost: CSSProperties = { height: 32, padding: '0 12px', borderRadius: 999, border: '1px solid var(--line-2)', background: 'var(--surface)', color: 'var(--ink)', fontSize: 12.5, fontWeight: 500, cursor: 'pointer', font: 'inherit' };
const primary: CSSProperties = { height: 34, padding: '0 16px', borderRadius: 999, border: 'none', background: 'var(--accent)', color: 'var(--on-accent)', fontSize: 13, fontWeight: 600, cursor: 'pointer', font: 'inherit' };
const linkBtn: CSSProperties = { background: 'var(--accent-soft)', color: 'var(--accent-ink)', border: 'none', borderRadius: 999, padding: '5px 11px', fontSize: 12.5, fontWeight: 500, cursor: 'pointer', font: 'inherit' };
