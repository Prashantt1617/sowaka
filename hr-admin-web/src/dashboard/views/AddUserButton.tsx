// Add user (24 Nov, HR): one button and one flow on People › Employees and Employee lifecycle › Onboarding.
// It opens one form (AddUserDialog, the offer letter's details); Continue goes by the joining date:
// - passed: the Add employee wizard with Basic details filled in (after the account-limit check, as
//   before). A joining date within the last month also starts onboarding on their app;
// - still to come: Send offer letter (Documents › Offer letter, filled in) or Confirm (on the onboarding
//   board as confirmed, with or without the joining portal email).
// Where the employee lifecycle is off for the company, the button goes straight to the wizard.
import { useState } from 'react';
import { useStore } from '../store';
import { canOpen, canSeePay } from '../access';
import { useLifecycleOn } from '../lifecycleSwitch';
import { getAccountLimit } from '../../services/hrms';
import { IconPlus } from '../icons';
import { AddEmployeeWizard, splitName } from './AddEmployeeWizard';
import type { WizardPrefill } from './AddEmployeeWizard';
import { AccountLimitModal } from './AccountLimitModal';
import { DOCS_OPEN_KEY, NEW_OFFER_STASH_KEY } from './lifecycle/format';
import { AddUserDialog } from './lifecycle/ConfirmJoiner';
import type { NewUserDetails } from './lifecycle/ConfirmJoiner';
import './people.css';

type Open = null | 'form' | 'wizard';

export function AddUserButton({ onConfirmed }: { onConfirmed?: (journeyId: string) => void }) {
  const { user, setView } = useStore();
  const lifecycle = useLifecycleOn(Boolean(user?.dashboardAccess));
  const [open, setOpen] = useState<Open>(null);
  const [prefill, setPrefill] = useState<WizardPrefill | undefined>(undefined);
  // Set to the company's limit when it is already reached: the popup instead of the wizard.
  const [limitReached, setLimitReached] = useState<number | null | false>(false);
  const [checkingLimit, setCheckingLimit] = useState(false);

  const pay = canSeePay(user);

  // A company without a limit (every company unless Sowaka sets one) goes straight to the wizard.
  // If the check itself fails, the wizard opens anyway: the server still refuses an account over the limit.
  const openWizard = (p?: WizardPrefill) => {
    if (checkingLimit) return;
    setCheckingLimit(true);
    setPrefill(p);
    getAccountLimit()
      .then(({ max, used }) => { if (max !== null && used >= max) { setOpen(null); setLimitReached(max); } else setOpen('wizard'); })
      .catch(() => setOpen('wizard'))
      .finally(() => setCheckingLimit(false));
  };

  // Joined already: the wizard, Basic details filled in from the form.
  const joined = (d: NewUserDetails) => openWizard({
    basic: {
      ...splitName(d.name), personalEmail: d.personalEmail, mobile: d.phone, doj: d.fields.tj,
      designation: d.fields.designation.trim(), department: (d.fields.department ?? '').trim(), workLocation: (d.fields.location ?? '').trim(),
    },
    managerUserId: d.fields.managerUserId || undefined,
    employeeType: d.fields.employeeType,
    onboardingTemplateId: d.templateId || undefined,
  });

  // Still to join: Documents › Offer letter on a new joiner, the form kept as that page's own draft.
  const offer = (d: NewUserDetails) => {
    try {
      sessionStorage.setItem(NEW_OFFER_STASH_KEY, JSON.stringify({ name: d.name, email: d.personalEmail, phone: d.phone, fields: d.fields, edits: {}, bodyEdit: null, templateId: d.templateId }));
      sessionStorage.setItem(DOCS_OPEN_KEY, JSON.stringify({ kind: 'offer', newOffer: true }));
    } catch { /* Documents opens on the offer letter anyway */ }
    setOpen(null);
    setView('lifecycle_documents');
  };

  const start = () => {
    if (lifecycle === true) setOpen('form');
    else openWizard();
  };

  return (
    <>
      <button type="button" onClick={start} disabled={checkingLimit} className="pd-btn primary">
        <IconPlus size={15} /> Add user
      </button>
      {open === 'form' && (
        <AddUserDialog pay={pay} canAddEmployee={canOpen(user, 'employees')}
          canOffer={canOpen(user, 'lifecycle_documents')}
          onClose={() => setOpen(null)}
          onDone={(id) => { setOpen(null); onConfirmed?.(id); }}
          onJoined={joined} onOffer={offer} />
      )}
      {open === 'wizard' && <AddEmployeeWizard prefill={prefill} onClose={() => { setOpen(null); setPrefill(undefined); }} />}
      {limitReached !== false && <AccountLimitModal max={limitReached} onClose={() => setLimitReached(false)} />}
    </>
  );
}
