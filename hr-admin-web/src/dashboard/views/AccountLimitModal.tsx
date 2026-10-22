// The popup an admin sees when their company already has as many accounts as
// its plan allows: shown on "Add user" before the wizard opens, and again if
// the server refuses a new employee for the same reason (another admin got
// there first).
import type { CSSProperties } from 'react';
import { ApiError } from '../../services/http';

/** Whether a failed request was the server refusing a new account over the limit. */
export function isAccountLimitError(error: unknown): boolean {
  return error instanceof ApiError && error.status === 409 && /Contact Sowaka/i.test(error.message);
}

export function AccountLimitModal({ max, onClose }: { max: number | null; onClose: () => void }) {
  return (
    <div style={overlay} onClick={onClose} role="presentation">
      <div style={card} onClick={(e) => e.stopPropagation()} role="alertdialog" aria-modal="true" aria-labelledby="account-limit-title">
        <div id="account-limit-title" style={{ fontSize: 17, fontWeight: 600, color: 'var(--ink)' }}>Contact Sowaka for more user entries</div>
        <p style={{ margin: 0, fontSize: 14, lineHeight: 1.5, color: 'var(--ink-2)' }}>
          {max === null
            ? 'Your company has reached the number of accounts its plan allows.'
            : `Your company already has ${max} accounts, the most its plan allows.`}{' '}
          To add more people, contact the Sowaka team and we'll raise your limit.
        </p>
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={primaryBtn} autoFocus>OK</button>
        </div>
      </div>
    </div>
  );
}

const overlay: CSSProperties = { position: 'fixed', inset: 0, zIndex: 95, background: 'var(--scrim)', backdropFilter: 'blur(2px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 22 };
const card: CSSProperties = { width: '100%', maxWidth: 460, display: 'flex', flexDirection: 'column', gap: 14, background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 'var(--r-lg)', padding: '22px 24px', boxShadow: 'var(--shadow-lg)' };
const primaryBtn: CSSProperties = { background: 'var(--accent-grad)', color: '#fff', border: 'none', padding: '9px 22px', borderRadius: 999, fontSize: 14, fontWeight: 500, cursor: 'pointer' };
