import { useStore } from '../store';
import { PH } from '../theme';
import { phIcon } from '../icons';

export function Placeholder() {
  const s = useStore();
  const ph = PH[s.view];
  if (!ph) return null;
  return (
    <div style={{ animation: 'fade .3s ease both', display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 520 }}>
      <div style={{ maxWidth: 480, textAlign: 'center' }}>
        <div style={{ width: 76, height: 76, borderRadius: 'var(--r-lg)', background: 'var(--surface)', border: '1px solid transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 22px', boxShadow: 'var(--shadow)' }}>
          <div style={{ color: 'var(--accent-ink)' }}>{phIcon[s.view]}</div>
        </div>
        {ph.soon && (
          <span style={{ display: 'inline-block', fontSize: 11.5, fontWeight: 500, letterSpacing: '.6px', color: 'var(--warn)', background: 'var(--warn-bg)', borderRadius: 'var(--r-lg)', padding: '4px 12px', marginBottom: 14 }}>
            COMING SOON
          </span>
        )}
        <div style={{ fontSize: 21, fontWeight: 600, letterSpacing: '-.5px', marginBottom: 9 }}>{ph.title}</div>
        <div style={{ fontSize: 14, color: 'var(--ink-3)', fontWeight: 400, lineHeight: 1.55, marginBottom: 22 }}>{ph.desc}</div>
        {ph.fields.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'center' }}>
            {ph.fields.map((f) => (
              <span key={f} style={{ fontSize: 13, fontWeight: 400, color: 'var(--ink-2)', background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 9, padding: '6px 12px' }}>{f}</span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
