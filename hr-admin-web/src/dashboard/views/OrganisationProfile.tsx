// The current Organisation — top-level profile that sits above People Ops.
// Three field groups: Organisation (identity), Organisation Address (filing
// address) and Contact Information (notification + sender emails).
//
// NOTE: frontend-capture phase — renders from local mock data, no API calls.
// Every field carries an inline explanation of what it means.
import { useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { useStore } from '../store';
import { Card } from '../ui';
import { Logo } from '../icons';
import { ORG_DISPLAY_NAME, ORG_REGISTERED_NAME } from '../org';

type OrgForm = {
  name: string;
  displayName: string;
  country: string;
  industry: string;
  incorporatedOn: string;
  // Address
  addressLine1: string;
  addressLine2: string;
  city: string;
  state: string;
  pincode: string;
  addressCountry: string;
  // Contact
  primaryContactEmail: string;
  senderEmail: string;
  senderName: string;
  replyToEmail: string;
};

// —— Mock data for capture ————————————————————————————————————————————
const MOCK: OrgForm = {
  name: ORG_REGISTERED_NAME,
  displayName: ORG_DISPLAY_NAME,
  country: 'India',
  industry: 'Services',
  incorporatedOn: '2021-06-14',
  addressLine1: 'WeWork Prestige Central, 3rd Floor',
  addressLine2: '36 Infantry Road, Tasker Town',
  city: 'Bengaluru',
  state: 'Karnataka',
  pincode: '560001',
  addressCountry: 'India',
  primaryContactEmail: 'people@convrse.ai',
  senderEmail: 'no-reply@connect.convrse.ai',
  senderName: 'Convrse Spaces HR',
  replyToEmail: 'hr@convrse.ai',
};

export function OrganisationProfile() {
  const { flash } = useStore();
  const [form, setForm] = useState<OrgForm>({ ...MOCK });
  const [saving, setSaving] = useState(false);

  const set = <K extends keyof OrgForm>(k: K, v: OrgForm[K]) => setForm({ ...form, [k]: v });

  const save = () => {
    setSaving(true);
    setTimeout(() => {
      setSaving(false);
      flash('Organisation details saved');
    }, 400);
  };

  return (
    <div style={{ maxWidth: 860 }}>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 14 }}>
        <button onClick={save} disabled={saving} style={primaryBtn}>{saving ? 'Saving…' : 'Save changes'}</button>
      </div>

      {/* ——— Group 1: Organisation ——— */}
      <Card style={{ padding: '20px 22px', marginBottom: 16 }}>
        <GroupHeader
          title="Organisation"
          sub="Who this workspace belongs to. The name and logo are set by the owner who created the organisation and can’t be changed here."
        />

        {/* Logo — owner-managed, read-only */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 18, margin: '4px 0 20px' }}>
          <div style={logoTile}>
            <div style={{ transform: 'scale(2.4)' }}>
              <Logo />
            </div>
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
              <div style={{ fontSize: 16, fontWeight: 800, color: '#484848' }}>Organisation logo</div>
              <span style={lockPill}>🔒 Owner-managed</span>
            </div>
            <div style={explain}>Appears on payslips, emails and the employee app. Only the organisation owner can replace it.</div>
          </div>
        </div>

        <div style={grid2}>
          <Field
            label="Registered name"
            explain="Your legally registered company name — used on statutory filings and payslips. Owner-managed, read-only here."
          >
            <input value={form.name} disabled style={{ ...inputStyle, ...readonly }} />
          </Field>
          <Field
            label="Display name"
            explain="The name employees see across the app — the sidebar, invites and the employee portal. Your public-facing brand name."
          >
            <input value={form.displayName} onChange={(e) => set('displayName', e.target.value)} style={inputStyle} />
          </Field>
          <Field
            label="Business location (country)"
            explain="The primary country your business operates and files taxes in. Drives statutory rules and currency."
          >
            <select value={form.country} onChange={(e) => set('country', e.target.value)} style={inputStyle}>
              <option>India</option>
              <option>United Arab Emirates</option>
              <option>Singapore</option>
              <option>United States</option>
            </select>
          </Field>
          <Field
            label="Industry"
            explain="The sector your organisation belongs to. Used to tailor templates and benchmark reports."
          >
            <select value={form.industry} onChange={(e) => set('industry', e.target.value)} style={inputStyle}>
              <option>Services</option>
              <option>Manufacturing</option>
              <option>Information Technology</option>
              <option>Retail &amp; E-commerce</option>
              <option>Healthcare</option>
            </select>
          </Field>
          <Field
            label="Date of incorporation"
            explain="The date the entity was legally registered. Used on statutory filings and tenure calculations."
          >
            <input type="date" value={form.incorporatedOn} onChange={(e) => set('incorporatedOn', e.target.value)} style={inputStyle} />
          </Field>
        </div>
      </Card>

      {/* ——— Group 2: Organisation Address ——— */}
      <Card style={{ padding: '20px 22px', marginBottom: 16 }}>
        <GroupHeader
          title="Organisation Address"
          sub="Your registered filing address. This is the address printed on statutory returns, payslips and official correspondence."
        />
        <div style={grid2}>
          <Field
            label="Address line 1"
            explain="Building / street of your registered office as it appears on incorporation documents."
            full
          >
            <input value={form.addressLine1} onChange={(e) => set('addressLine1', e.target.value)} style={inputStyle} />
          </Field>
          <Field
            label="Address line 2"
            explain="Area / landmark. Optional second line of the filing address."
            full
          >
            <input value={form.addressLine2} onChange={(e) => set('addressLine2', e.target.value)} style={inputStyle} />
          </Field>
          <Field label="City" explain="City / town of the registered office.">
            <input value={form.city} onChange={(e) => set('city', e.target.value)} style={inputStyle} />
          </Field>
          <Field label="State" explain="State of registration — determines which state statutory rules (PT, LWF) apply.">
            <input value={form.state} onChange={(e) => set('state', e.target.value)} style={inputStyle} />
          </Field>
          <Field label="PIN code" explain="6-digit postal code of the filing address.">
            <input value={form.pincode} onChange={(e) => set('pincode', e.target.value)} style={inputStyle} />
          </Field>
          <Field label="Country" explain="Country of the registered office. Usually the same as your business location.">
            <input value={form.addressCountry} onChange={(e) => set('addressCountry', e.target.value)} style={inputStyle} />
          </Field>
        </div>
      </Card>

      {/* ——— Group 3: Contact Information ——— */}
      <Card style={{ padding: '20px 22px' }}>
        <GroupHeader
          title="Contact Information"
          sub="The email addresses Sowaka Connect uses to talk to you and to your employees."
        />
        <div style={grid2}>
          <Field
            label="Primary contact email"
            explain="Where Sowaka Connect sends notifications TO your organisation — approvals, run reminders, alerts and system updates. This is your inbox."
            full
          >
            <input value={form.primaryContactEmail} onChange={(e) => set('primaryContactEmail', e.target.value)} style={inputStyle} />
          </Field>
          <Field
            label="Sender email (emails to employees are sent FROM this)"
            explain="The ‘from’ address on every email Sowaka Connect sends to your employees — payslips, invites, announcements. Employees see this as the sender."
            full
          >
            <input value={form.senderEmail} onChange={(e) => set('senderEmail', e.target.value)} style={inputStyle} />
          </Field>
          <Field
            label="Sender display name"
            explain="The friendly name shown next to the sender email in employees’ inboxes (e.g. “Convrse Spaces HR”)."
          >
            <input value={form.senderName} onChange={(e) => set('senderName', e.target.value)} style={inputStyle} />
          </Field>
          <Field
            label="Reply-to email"
            explain="Where employee replies to those emails land, so someone on your team can respond."
          >
            <input value={form.replyToEmail} onChange={(e) => set('replyToEmail', e.target.value)} style={inputStyle} />
          </Field>
        </div>
      </Card>
    </div>
  );
}

function GroupHeader({ title, sub }: { title: string; sub: string }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ fontSize: 20, fontWeight: 800, letterSpacing: '-.2px' }}>{title}</div>
      <div style={{ fontSize: 14, color: '#717171', marginTop: 3, lineHeight: 1.5, maxWidth: 640 }}>{sub}</div>
    </div>
  );
}

function Field({ label, explain: exp, full, children }: { label: string; explain: string; full?: boolean; children: ReactNode }) {
  return (
    <div style={full ? { gridColumn: '1 / -1' } : undefined}>
      <label style={{ display: 'block', fontSize: 14, fontWeight: 700, marginBottom: 5, color: '#484848' }}>{label}</label>
      {children}
      <div style={explain}>{exp}</div>
    </div>
  );
}

const grid2: CSSProperties = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 };
const inputStyle: CSSProperties = { width: '100%', padding: '9px 11px', border: '1px solid #EBEBEB', borderRadius: 10, fontSize: 16, fontFamily: 'inherit', background: '#fff', color: '#222222' };
const readonly: CSSProperties = { background: '#F7F7F9', color: '#717171' };
const explain: CSSProperties = { fontSize: 14, color: '#717171', marginTop: 5, lineHeight: 1.45 };
const primaryBtn: CSSProperties = { background: '#0571A6', color: '#fff', border: 'none', padding: '9px 18px', borderRadius: 11, fontSize: 16, fontWeight: 700, cursor: 'pointer' };
const logoTile: CSSProperties = { width: 76, height: 76, borderRadius: 18, background: '#0571A6', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, boxShadow: '0 4px 14px rgba(5,113,166,.28)' };
const lockPill: CSSProperties = { fontSize: 12, fontWeight: 700, color: '#9A6B25', background: '#F6E9D5', border: '1px solid #ECD9B4', borderRadius: 20, padding: '2px 10px' };
