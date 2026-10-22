// The popup an admin sees when their company already has as many accounts as
// its plan allows: shown on "Add user" before the wizard opens, and again if
// the server refuses a new employee for the same reason (another admin got
// there first).
import { ApiError } from '../../services/http';
import './people.css';

/** Whether a failed request was the server refusing a new account over the limit. */
export function isAccountLimitError(error: unknown): boolean {
  return error instanceof ApiError && error.status === 409 && /Contact Sowaka/i.test(error.message);
}

export function AccountLimitModal({ max, onClose }: { max: number | null; onClose: () => void }) {
  return (
    <div className="pd-scrim" style={{ zIndex: 95, background: 'rgba(20, 16, 50, 0.38)' }} onClick={onClose} role="presentation">
      <div className="pd-modal" style={{ width: 'min(460px, 100%)' }} onClick={(e) => e.stopPropagation()} role="alertdialog" aria-modal="true" aria-labelledby="account-limit-title">
        <div className="pd-md-h"><h3 id="account-limit-title">Contact Sowaka for more user entries</h3></div>
        <div className="pd-md-b">
          <p style={{ margin: 0 }}>
            {max === null
              ? 'Your company has reached the number of accounts its plan allows.'
              : `Your company already has ${max} accounts, the most its plan allows.`}{' '}
            To add more people, contact the Sowaka team and we'll raise your limit.
          </p>
        </div>
        <div className="pd-md-f">
          <button onClick={onClose} className="pd-btn primary" autoFocus>OK</button>
        </div>
      </div>
    </div>
  );
}
