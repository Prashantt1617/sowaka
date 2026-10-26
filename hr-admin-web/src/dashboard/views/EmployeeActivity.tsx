// A person's change history on their profile: every edit to their details,
// manager, shift and templates, who made it, and from where.
import { useState } from 'react';
import { getEmployeeActivity, type EmployeeActivityDTO } from '../../services/hrms';
import { ListPending } from '../ui';
import { useLoad } from '../useLoad';
import { PdClock, PdEdit, PdTarget, PdUser } from './pdIcons';

const VIA: Record<EmployeeActivityDTO['via'], string> = { dashboard: '', suwi: 'via Suwi', import: 'via import' };

const when = (iso: string) =>
  new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });
const day = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });

function KindIcon({ kind }: { kind: EmployeeActivityDTO['kind'] }) {
  if (kind === 'shift') return <PdClock />;
  if (kind === 'kpi' || kind === 'paid_days') return <PdTarget />;
  if (kind === 'manager' || kind === 'created') return <PdUser />;
  return <PdEdit />;
}

export function EmployeeActivity({ userId }: { userId: string }) {
  const { data, state, retry } = useLoad(() => getEmployeeActivity(userId), [userId]);
  const [older, setOlder] = useState<EmployeeActivityDTO[]>([]);
  const [more, setMore] = useState<boolean | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const items = [...(data?.items ?? []), ...older];
  const hasMore = more ?? data?.more ?? false;

  const loadMore = async () => {
    const last = items[items.length - 1];
    if (!last) return;
    setLoadingMore(true);
    try {
      const next = await getEmployeeActivity(userId, last.id);
      setOlder((o) => [...o, ...next.items]);
      setMore(next.more);
    } finally {
      setLoadingMore(false);
    }
  };

  if (state !== 'ready') return <ListPending state={state} onRetry={retry} rows={4} cols={2} />;
  if (!items.length) return <p className="pd-subnote" style={{ padding: '6px 0' }}>No changes recorded yet. Edits to details, reporting manager, shift and templates show here from now on.</p>;
  return (
    <div className="pd-list pd-act">
      {items.map((a) => (
        <div key={a.id} className="pd-li pd-act-i">
          <span className="pd-li-i"><KindIcon kind={a.kind} /></span>
          <span className="grow">
            <b>{a.title}{a.effectiveFrom ? <span className="pd-act-from"> · from {day(a.effectiveFrom)}</span> : null}</b>
            {a.changes.length > 0 && (a.kind === 'details' || a.changes.length > 1 || a.changes[0].from) && (
              <span className="pd-act-ch">
                {a.changes.map((c) => (
                  <span key={c.field}>
                    {c.label}: <s>{c.from || 'empty'}</s> → <em>{c.to || 'empty'}</em>
                  </span>
                ))}
              </span>
            )}
            <span className="s">{a.by} · {when(a.at)}{VIA[a.via] ? ` · ${VIA[a.via]}` : ''}</span>
          </span>
        </div>
      ))}
      {hasMore && (
        <div className="pd-li">
          <button type="button" className="pd-sec-act" onClick={() => void loadMore()} disabled={loadingMore}>{loadingMore ? 'Loading…' : 'Show older'}</button>
        </div>
      )}
    </div>
  );
}
