// A manager writing one review on the dashboard (24 Nov 2026, HR): a full page, one tab per KPI parameter
// (Performance, Ownership, ...), a 1–5 score and a comment on each. The comment can be spoken: the browser turns
// speech into text as they talk (Chrome's speech recognition; the mic hides where there is none). Once there
// is text, "Refine with Suwi" tidies it into a clear comment with the same facts (POST /manager/feedback/refine).
// Saved through the app's own endpoint (PUT /manager/feedback/:userId), which accepts direct reports only.
import { useEffect, useRef, useState } from 'react';
import { api } from '../../services/http';
import { periodLabel } from '../period';
import { ghostBtn, smallBtn } from './kpiLook';
import type { WorkspaceMember } from './TeamReviews';

const NOTE_MIN = 75;
type Param = { parameterId: string; name: string; subtitle?: string; weight?: number; score: number; note: string };

type Recognition = {
  lang: string; continuous: boolean; interimResults: boolean;
  start: () => void; stop: () => void;
  onresult: ((e: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onend: (() => void) | null; onerror: ((e: { error?: string }) => void) | null;
};
const SpeechCtor: (new () => Recognition) | undefined = typeof window !== 'undefined'
  ? ((window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition }).SpeechRecognition
    ?? (window as unknown as { webkitSpeechRecognition?: new () => Recognition }).webkitSpeechRecognition)
  : undefined;

const done = (p: Param) => p.score > 0 && p.note.trim().length >= NOTE_MIN;

export function ReviewPage({ member, period, onBack, onSaved }: { member: WorkspaceMember; period: string; onBack: () => void; onSaved: (sent: boolean) => void }) {
  const [params, setParams] = useState<Param[]>(() => member.parameters.map((p) => ({ ...p, note: p.note ?? '', score: p.score ?? 0 })));
  const [tab, setTab] = useState(0);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [listening, setListening] = useState(false);
  const [heard, setHeard] = useState('');
  const [refining, setRefining] = useState(false);
  const [beforeRefine, setBeforeRefine] = useState<{ i: number; note: string } | null>(null);
  const rec = useRef<Recognition | null>(null);
  const alreadySent = member.feedbackStatus === 'sent';
  const p = params[tab];
  const set = (i: number, patch: Partial<Param>) => setParams((ps) => ps.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const sendReady = params.every(done);

  // Stop listening when the tab changes or the page closes.
  useEffect(() => () => rec.current?.stop(), []);
  useEffect(() => { rec.current?.stop(); setHeard(''); setBeforeRefine(null); }, [tab]);

  const listen = () => {
    if (!SpeechCtor) return;
    if (listening) { rec.current?.stop(); return; }
    const r = new SpeechCtor();
    r.lang = 'en-IN'; r.continuous = true; r.interimResults = true;
    const at = tab;
    r.onresult = (e) => {
      let interim = '';
      for (let k = e.resultIndex; k < e.results.length; k++) {
        const res = e.results[k];
        if (res.isFinal) {
          const said = res[0].transcript.trim();
          if (said) setParams((ps) => ps.map((x, j) => (j === at ? { ...x, note: `${x.note}${x.note && !/\s$/.test(x.note) ? ' ' : ''}${said}` } : x)));
        } else interim += res[0].transcript;
      }
      setHeard(interim);
    };
    r.onerror = (e) => { setErr(e.error === 'not-allowed' ? 'Allow the microphone for this site to dictate' : 'Dictation stopped'); };
    r.onend = () => { setListening(false); setHeard(''); };
    rec.current = r;
    setErr(null);
    r.start();
    setListening(true);
  };

  const refine = async () => {
    if (!p.note.trim()) return;
    rec.current?.stop();
    setRefining(true); setErr(null);
    try {
      const r = await api<{ text: string }>('/manager/feedback/refine', { method: 'POST', body: { employeeUserId: member.userId, parameter: p.name, score: p.score, text: p.note } });
      setBeforeRefine({ i: tab, note: p.note });
      set(tab, { note: r.text.slice(0, 1000) });
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Suwi could not refine it');
    } finally {
      setRefining(false);
    }
  };

  const save = async (status: 'saved' | 'sent') => {
    rec.current?.stop();
    setBusy(true); setErr(null);
    try {
      await api(`/manager/feedback/${encodeURIComponent(member.userId)}`, {
        method: 'PUT',
        body: { status, period, parameters: params.map((x) => ({ parameterId: x.parameterId, score: x.score, note: x.note })) },
      });
      onSaved(status === 'sent');
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not save the review');
    } finally {
      setBusy(false);
    }
  };

  const chars = p.note.trim().length;
  return (
    <div style={{ animation: 'fade .3s ease both', display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <button type="button" style={ghostBtn} onClick={onBack}>← Back</button>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 20, fontWeight: 600 }}>Review: {member.name}</div>
          <div style={{ fontSize: 13, color: 'var(--ink-3)' }}>{periodLabel(period)} · score each parameter 1 to 5 · a sent review needs at least {NOTE_MIN} characters in every comment</div>
        </div>
      </div>

      <div role="tablist" aria-label="Parameters" style={{ display: 'flex', gap: 6, flexWrap: 'wrap', borderBottom: '1px solid var(--line)', paddingBottom: 8 }}>
        {params.map((x, i) => (
          <button key={x.parameterId} type="button" role="tab" aria-selected={i === tab} onClick={() => setTab(i)}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '8px 14px', borderRadius: 999, border: `1px solid ${i === tab ? 'var(--ink)' : 'var(--line)'}`, background: i === tab ? 'var(--ink)' : 'var(--surface)', color: i === tab ? 'var(--surface)' : 'var(--ink)', font: 'inherit', fontSize: 13, cursor: 'pointer' }}>
            <span aria-hidden style={{ width: 8, height: 8, borderRadius: 4, background: done(x) ? 'var(--ok)' : x.score || x.note ? 'var(--warn)' : 'var(--line-2)' }} />
            {x.name}
          </button>
        ))}
      </div>

      <div style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 16, padding: 24, display: 'flex', flexDirection: 'column', gap: 16, minHeight: 420 }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 600 }}>{p.name}{p.weight ? <span style={{ color: 'var(--ink-3)', fontWeight: 400, fontSize: 14 }}> · weight {p.weight}</span> : null}</div>
          {p.subtitle && <div style={{ fontSize: 13, color: 'var(--ink-3)', marginTop: 2 }}>{p.subtitle}</div>}
        </div>
        <div style={{ display: 'flex', gap: 8 }} role="radiogroup" aria-label="Score">
          {[1, 2, 3, 4, 5].map((n) => (
            <button key={n} type="button" role="radio" aria-checked={p.score === n} onClick={() => set(tab, { score: n })}
              style={{ width: 52, height: 52, borderRadius: 26, border: `1px solid ${p.score === n ? 'var(--hi)' : 'var(--line-2)'}`, background: p.score === n ? 'var(--hi)' : 'transparent', color: p.score === n ? '#fff' : 'var(--ink)', font: 'inherit', fontSize: 18, fontWeight: 500, cursor: 'pointer' }}>
              {n}
            </button>
          ))}
        </div>
        <div style={{ position: 'relative' }}>
          <textarea value={p.note} onChange={(e) => { set(tab, { note: e.target.value }); setBeforeRefine(null); }} rows={9} maxLength={1000}
            placeholder={SpeechCtor ? 'Why this score? Type, or press Record and speak.' : 'Why this score?'}
            style={{ width: '100%', boxSizing: 'border-box', font: 'inherit', fontSize: 14, lineHeight: 1.55, padding: 14, borderRadius: 12, border: `1px solid ${listening ? 'var(--bad)' : 'var(--line-2)'}`, background: 'transparent', color: 'inherit', resize: 'vertical' }} />
          {heard && <div style={{ fontSize: 13, color: 'var(--ink-3)', fontStyle: 'italic', marginTop: 4 }}>{heard}…</div>}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          {SpeechCtor && (
            <button type="button" onClick={listen} disabled={refining}
              style={{ ...ghostBtn, display: 'inline-flex', alignItems: 'center', gap: 8, ...(listening ? { borderColor: 'var(--bad)', color: 'var(--bad)' } : {}) }}>
              <span aria-hidden style={{ width: 10, height: 10, borderRadius: 5, background: 'var(--bad)', animation: listening ? 'pulse 1.2s ease-in-out infinite' : undefined }} />
              {listening ? 'Stop recording' : 'Record'}
            </button>
          )}
          <button type="button" onClick={() => void refine()} disabled={refining || !p.note.trim()}
            style={{ ...ghostBtn, display: 'inline-flex', alignItems: 'center', gap: 8, borderColor: 'color-mix(in srgb, var(--suwi) 40%, var(--line))', color: 'var(--suwi-ink)' }}>
            {refining ? 'Refining…' : 'Refine with Suwi'}
          </button>
          {beforeRefine?.i === tab && <button type="button" style={{ ...ghostBtn, border: 0 }} onClick={() => { set(tab, { note: beforeRefine.note }); setBeforeRefine(null); }}>Undo refine</button>}
          <span style={{ marginLeft: 'auto', fontSize: 12, color: chars >= NOTE_MIN ? 'var(--ink-3)' : 'var(--bad)' }}>{chars} / {NOTE_MIN}</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 'auto' }}>
          <button type="button" style={ghostBtn} disabled={tab === 0} onClick={() => setTab(tab - 1)}>← {tab > 0 ? params[tab - 1].name : 'Previous'}</button>
          <button type="button" style={ghostBtn} disabled={tab === params.length - 1} onClick={() => setTab(tab + 1)}>{tab < params.length - 1 ? params[tab + 1].name : 'Next'} →</button>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', alignItems: 'center' }}>
        {err && <span style={{ color: 'var(--bad)', fontSize: 13, marginRight: 'auto' }}>{err}</span>}
        <span style={{ fontSize: 12, color: 'var(--ink-3)', marginRight: err ? 0 : 'auto' }}>{params.filter(done).length} of {params.length} parameters ready</span>
        <button type="button" style={ghostBtn} onClick={onBack} disabled={busy}>Cancel</button>
        {!alreadySent && <button type="button" style={ghostBtn} onClick={() => void save('saved')} disabled={busy}>Save draft</button>}
        <button type="button" style={smallBtn} onClick={() => void save('sent')} disabled={busy || !sendReady} title={sendReady ? undefined : 'Score every parameter and write at least 75 characters on each'}>{alreadySent ? 'Update review' : 'Send review'}</button>
      </div>
    </div>
  );
}
