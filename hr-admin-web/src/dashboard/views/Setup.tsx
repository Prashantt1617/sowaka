// Setup: every settings page in one place, a card per area; each card lists only what this person may open.
import { useStore } from '../store';
import { useAuth } from '../auth/AuthContext';
import { canOpen } from '../access';
import { navIcon } from '../icons';
import { prefetchView } from '../viewChunks';
import { BULK_GROUPS, SETUP_GROUPS } from '../setupGroups';
import type { SetupGroup } from '../setupGroups';

export function Setup() {
  return <Hub groups={SETUP_GROUPS} />;
}

/** Bulk assign: every bulk assignment, a card per area. */
export function BulkAssign() {
  return <Hub groups={BULK_GROUPS} />;
}

function Hub({ groups: all }: { groups: SetupGroup[] }) {
  const s = useStore();
  const { user } = useAuth();
  const groups = all.map((g) => ({ ...g, items: g.items.filter((i) => canOpen(user, i.view)) })).filter((g) => g.items.length > 0);
  return (
    <div style={{ animation: 'fade .3s ease both', display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 16 }}>
      {groups.map((g) => (
        <section key={g.key} aria-labelledby={`setup-${g.key}`} style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 20, padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span aria-hidden style={{ width: 40, height: 40, borderRadius: 12, background: 'var(--accent-soft)', color: 'var(--accent-ink)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>{navIcon[g.icon]}</span>
            <h2 id={`setup-${g.key}`} style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>{g.title}</h2>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {g.items.map((i, n) => (
              <button key={i.view} type="button" onClick={() => s.setView(i.view)} onMouseEnter={() => prefetchView(i.view)} onFocus={() => prefetchView(i.view)}
                className="ds-nav-item"
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '11px 4px', border: 0, borderTop: n ? '1px solid var(--line)' : 0, background: 'none', cursor: 'pointer', font: 'inherit', fontSize: 14, color: 'var(--ink)', textAlign: 'left', borderRadius: 0 }}>
                {i.label}
                <svg aria-hidden width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--ink-3)" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><path d="m9 6 6 6-6 6" /></svg>
              </button>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
