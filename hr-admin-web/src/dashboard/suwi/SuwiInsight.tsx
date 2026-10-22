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
    <div
      role="note"
      aria-label="Suwi's checks on this request"
      style={{ border: `1px solid ${insight.ok ? 'var(--ok-line)' : 'var(--warn-line)'}`, background: insight.ok ? 'var(--ok-bg)' : 'var(--warn-bg)', borderRadius: 12, padding: '12px 14px', marginBottom: 18 }}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={{ all: 'unset', display: 'flex', alignItems: 'center', gap: 9, width: '100%', cursor: 'pointer' }}
      >
        <SuwiOrb size={18} />
        <span style={{ flex: 1, fontSize: 13.5, fontWeight: 600, color: insight.ok ? 'var(--ok)' : 'var(--warn)' }}>
          Suwi: {insight.ok ? 'looks fine to approve' : `check before deciding${flagged.length > 1 ? ` (${flagged.length} things)` : ''}`}
        </span>
        {insight.ok && <span style={{ fontSize: 12.5, color: 'var(--ink-3)', fontWeight: 400 }}>{open ? 'Hide' : 'Why?'}</span>}
      </button>
      {shown.length > 0 && (
        <ul style={{ listStyle: 'none', margin: '9px 0 0', padding: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
          {shown.map((c) => (
            <li key={c.text} style={{ display: 'flex', gap: 8, fontSize: 13, lineHeight: 1.45, color: 'var(--ink-2)', fontWeight: 400 }}>
              <span aria-hidden style={{ flexShrink: 0, width: 14, fontWeight: 600, color: c.ok ? 'var(--ok)' : 'var(--warn)' }}>{c.ok ? '✓' : '!'}</span>
              <span>{c.text}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
