// Add user: one button and one flow on People › Employees and Employee lifecycle › Onboarding. It
// opens a chooser with three ways in:
// - Add existing user: someone already working here, through the Add employee wizard (after the
//   account-limit check, as before);
// - Create new offer: Documents › Offer letter for a new joiner, which sends the offer from the app;
// - Confirm new user: someone who accepted an offer outside the app, with the offer's own details
//   (ConfirmJoiner.tsx), confirmed on the onboarding board without any email.
// Where the employee lifecycle is off for the company, the button goes straight to the wizard.
import { useState } from 'react';
import { useStore } from '../store';
import { canOpen, canSeePay } from '../access';
import { useLifecycleOn } from '../lifecycleSwitch';
import { getAccountLimit } from '../../services/hrms';
import { IconPlus } from '../icons';
import { AddEmployeeWizard } from './AddEmployeeWizard';
import { AccountLimitModal } from './AccountLimitModal';
import { Modal } from './lifecycle/shared';
import { DOCS_OPEN_KEY } from './lifecycle/format';
import { ConfirmJoinerDialog } from './lifecycle/ConfirmJoiner';
import './people.css';

type Open = null | 'chooser' | 'wizard' | 'confirm';

interface Choice { key: 'existing' | 'offer' | 'confirm'; title: string; text: string; off?: string; go: () => void }

export function AddUserButton({ onConfirmed }: { onConfirmed?: (journeyId: string) => void }) {
  const { user, setView } = useStore();
  const lifecycle = useLifecycleOn(Boolean(user?.dashboardAccess));
  const [open, setOpen] = useState<Open>(null);
  // Set to the company's limit when it is already reached: the popup instead of the wizard.
  const [limitReached, setLimitReached] = useState<number | null | false>(false);
  const [checkingLimit, setCheckingLimit] = useState(false);

  const pay = canSeePay(user);
  const lifecycleOk = lifecycle === true;
  const payNote = 'Needs payroll access: the offer states the CTC';

  // A company without a limit (every company unless Sowaka sets one) goes straight to the wizard.
  // If the check itself fails, the wizard opens anyway: the server still refuses an account over the limit.
  const addExisting = () => {
    if (checkingLimit) return;
    setCheckingLimit(true);
    getAccountLimit()
      .then(({ max, used }) => { if (max !== null && used >= max) { setOpen(null); setLimitReached(max); } else setOpen('wizard'); })
      .catch(() => setOpen('wizard'))
      .finally(() => setCheckingLimit(false));
  };
  // Documents › Offer letter, on a new joiner (the form beside the letter), as New offer letter did.
  const newOffer = () => {
    try { sessionStorage.setItem(DOCS_OPEN_KEY, JSON.stringify({ kind: 'offer', newOffer: true })); } catch { /* Documents opens on the offer letter anyway */ }
    setOpen(null);
    setView('lifecycle_documents');
  };

  const choices: Choice[] = [
    {
      key: 'existing', title: 'Add existing user', text: 'Someone already working here: their employee record and app access.',
      off: canOpen(user, 'employees') ? undefined : 'Needs access to People › Employees', go: addExisting,
    },
    {
      key: 'offer', title: 'Create new offer', text: 'Make the offer letter and send it to the candidate from the app.',
      off: !pay ? payNote : !canOpen(user, 'lifecycle_documents') ? 'Needs access to Employee lifecycle › Documents' : undefined, go: newOffer,
    },
    {
      key: 'confirm', title: 'Confirm new user', text: 'Someone who accepted an offer outside the app: the same details as an offer, no letter or email sent.',
      off: !pay ? payNote : !(canOpen(user, 'onboarding') || canOpen(user, 'lifecycle_documents')) ? 'Needs access to Employee lifecycle › Onboarding' : undefined,
      go: () => setOpen('confirm'),
    },
  ];

  const start = () => {
    if (lifecycleOk) setOpen('chooser');
    else addExisting();
  };

  return (
    <>
      <button type="button" onClick={start} disabled={checkingLimit} className="pd-btn primary">
        <IconPlus size={15} /> Add user
      </button>
      {open === 'chooser' && (
        <Modal title="Add user" sub="Who are you adding?" width={480} onClose={() => setOpen(null)} busy={checkingLimit}>
          <div className="au-opts" role="list">
            {choices.map((c) => (
              <button key={c.key} type="button" role="listitem" className="au-opt" onClick={c.go} disabled={Boolean(c.off) || checkingLimit} title={c.off}>
                <span className="au-ic" aria-hidden><ChoiceIcon kind={c.key} /></span>
                <span className="au-tx">
                  <b>{c.title}</b>
                  <span>{c.off ?? c.text}</span>
                </span>
                <svg className="au-go" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="m9 6 6 6-6 6" /></svg>
              </button>
            ))}
          </div>
        </Modal>
      )}
      {open === 'wizard' && <AddEmployeeWizard onClose={() => setOpen(null)} />}
      {open === 'confirm' && <ConfirmJoinerDialog onClose={() => setOpen(null)} onDone={(id) => { setOpen(null); onConfirmed?.(id); }} />}
      {limitReached !== false && <AccountLimitModal max={limitReached} onClose={() => setLimitReached(false)} />}
    </>
  );
}

function ChoiceIcon({ kind }: { kind: Choice['key'] }) {
  const common = { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  if (kind === 'existing') return <svg {...common}><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20c.8-3.6 3.4-5.5 6.5-5.5s5.7 1.9 6.5 5.5M16 7.5h5M18.5 5v5" /></svg>;
  if (kind === 'offer') return <svg {...common}><path d="M14 3H6.5A1.5 1.5 0 0 0 5 4.5v15A1.5 1.5 0 0 0 6.5 21h11a1.5 1.5 0 0 0 1.5-1.5V8z" /><path d="M14 3v5h5M8.5 13h7M8.5 17h4.5" /></svg>;
  return <svg {...common}><circle cx="12" cy="12" r="9" /><path d="m8 12.5 2.7 2.7L16.5 9.5" /></svg>;
}
