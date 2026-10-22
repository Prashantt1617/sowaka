// Suwi's read on one pending request or claim, at the top of its drawer:
// "looks fine to approve" or "check before deciding", with the checks behind
// it (balance, team clash, manager step, days waiting, claim rules). It only
// informs: Approve and Decline work exactly as before. It shows nothing when
// the request isn't pending, Suwi is off or set to "Answer only" for this
// area, this person can't see that page, or the checks can't be loaded.
import { useEffect, useState } from 'react';
import { api } from '../../services/http';
import { SuwiOrb } from './SuwiPanel';

export type SuwiInsightKind = 'leave' | 'overtime' | 'correction' | 'ool' | 'claim';
type Insight = { ok: boolean; pending: boolean; checks: { ok: boolean; text: string }[] };

export function SuwiInsight({ kind, id, pending }: { kind: SuwiInsightKind; id: string; pending: boolean }) {
  const [insight, setInsight] = useState<Insight | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let alive = true;
    setInsight(null);
    setOpen(false);
    if (!pending || !id) return;
    api<{ insight: Insight | null }>(`/suwi/insight/${kind}/${encodeURIComponent(id)}`)
      .then((r) => { if (alive) setInsight(r.insight); })
      .catch(() => { /* Suwi is a helper here: no box rather than an error. */ });
    return () => { alive = false; };
  }, [kind, id, pending]);

  if (!pending || !insight || !insight.pending || !insight.checks.length) return null;
  const flagged = insight.checks.filter((c) => !c.ok);
  const shown = open || !insight.ok ? insight.checks : [];
  return (
    <div role="note" aria-label="Suwi's checks on this request" className={insight.ok ? 'sora-ins ok' : 'sora-ins look'}>
      <SuwiOrb size={20} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={shown.length > 0} className="sora-ins-h">
          <b>Suwi: {insight.ok ? 'looks fine to approve' : `check before deciding${flagged.length > 1 ? ` (${flagged.length} things)` : ''}`}</b>
          {insight.ok && <small>{open ? 'Hide' : 'Why?'}</small>}
        </button>
        {shown.length > 0 && (
          <ul>
            {shown.map((c) => (
              <li key={c.text} className={c.ok ? 'g' : 'w'}>
                <CheckMark ok={c.ok} />
                <span>{c.text}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function CheckMark({ ok }: { ok: boolean }) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {ok ? <path d="m5 12.5 4.5 4.5L19 7.5" /> : <><path d="M12 4 2.8 19.5h18.4z" /><path d="M12 10v4M12 17h.01" /></>}
    </svg>
  );
}
