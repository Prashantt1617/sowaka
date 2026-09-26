// The current Organisation — top-level profile that sits above People Ops.
// Three field groups: Organisation (identity), Organisation Address (filing
// address) and Contact Information (notification + sender emails).
//
// NOTE: frontend-capture phase — renders from local mock data, no API calls.
// Every field carries an inline explanation of what it means.
import { useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { useStore } from '../store';
import { useAuth } from '../auth/AuthContext';
import { useBrand } from '../brand';
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

// —— Mock data for capture, per organisation ————————————————————————————
// Which set shows is decided by the signed-in org; nothing here is fetched.
const MOCKS: Record<string, OrgForm> = {
  acmt: {
    name: 'ACMT Group of Colleges',
    displayName: 'ACMT',
    country: 'India',
    industry: 'Education',
    incorporatedOn: '2008-07-01',
    addressLine1: 'ACMT Campus, Sector 20',
    addressLine2: 'Near Metro Station',
    city: 'New Delhi',
    state: 'Delhi',
    pincode: '110001',
    addressCountry: 'India',
    primaryContactEmail: 'admin@acmt.in',
    senderEmail: 'no-reply@acmt.in',
    senderName: 'ACMT HR',
    replyToEmail: 'hr@acmt.in',
  },
};
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
  const { user } = useAuth();
  const brand = useBrand();
  const [form, setForm] = useState<OrgForm>({ ...(MOCKS[user?.org ?? ''] ?? MOCK) });
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
        />

        {/* Logo — owner-managed, read-only */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 18, margin: '4px 0 20px' }}>
          {brand.icon ? (
            // The organisation's own mark, the same one the sidebar and sign-in wear.
            <img src={brand.icon} alt="" style={{ ...logoTile, objectFit: 'cover', boxShadow: '0 4px 14px rgba(0,0,0,.14)', background: '#fff' }} />
          ) : (
            <div style={logoTile}>
              <div style={{ transform: 'scale(2.4)' }}>
                <Logo />
              </div>
            </div>
          )}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
              <div style={{ fontSize: 16, fontWeight: 800, color: '#484848' }}>Organisation logo</div>
              <span style={lockPill}>🔒 Owner-managed</span>
            </div>
          </div>
        </div>

        <div style={grid2}>
          <Field
            label="Registered name"
          >
            <input value={form.name} disabled style={{ ...inputStyle, ...readonly }} />
          </Field>
          <Field
            label="Display name"
          >
            <input value={form.displayName} onChange={(e) => set('displayName', e.target.value)} style={inputStyle} />
          </Field>
          <Field
            label="Business location (country)"
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
          >
            <select value={form.industry} onChange={(e) => set('industry', e.target.value)} style={inputStyle}>
              <option>Services</option>
              <option>Education</option>
              <option>Manufacturing</option>
              <option>Information Technology</option>
              <option>Retail &amp; E-commerce</option>
              <option>Healthcare</option>
            </select>
          </Field>
          <Field
            label="Date of incorporation"
          >
            <input type="date" value={form.incorporatedOn} onChange={(e) => set('incorporatedOn', e.target.value)} style={inputStyle} />
          </Field>
        </div>
      </Card>

      {/* ——— Group 2: Organisation Address ——— */}
      <Card style={{ padding: '20px 22px', marginBottom: 16 }}>
        <GroupHeader
          title="Organisation Address"
        />
        <div style={grid2}>
          <Field
            label="Address line 1"
            full
          >
            <input value={form.addressLine1} onChange={(e) => set('addressLine1', e.target.value)} style={inputStyle} />
          </Field>
          <Field
            label="Address line 2"
            full
          >
            <input value={form.addressLine2} onChange={(e) => set('addressLine2', e.target.value)} style={inputStyle} />
          </Field>
          <Field label="City">
            <input value={form.city} onChange={(e) => set('city', e.target.value)} style={inputStyle} />
          </Field>
          <Field label="State">
            <input value={form.state} onChange={(e) => set('state', e.target.value)} style={inputStyle} />
          </Field>
          <Field label="PIN code">
            <input value={form.pincode} onChange={(e) => set('pincode', e.target.value)} style={inputStyle} />
          </Field>
          <Field label="Country">
            <input value={form.addressCountry} onChange={(e) => set('addressCountry', e.target.value)} style={inputStyle} />
          </Field>
        </div>
      </Card>

      {/* ——— Group 3: Contact Information ——— */}
      <Card style={{ padding: '20px 22px' }}>
        <GroupHeader
          title="Contact Information"
        />
        <div style={grid2}>
          <Field
            label="Primary contact email"
            full
          >
            <input value={form.primaryContactEmail} onChange={(e) => set('primaryContactEmail', e.target.value)} style={inputStyle} />
          </Field>
          <Field
            label="Sender email (emails to employees are sent FROM this)"
            full
          >
            <input value={form.senderEmail} onChange={(e) => set('senderEmail', e.target.value)} style={inputStyle} />
          </Field>
          <Field
            label="Sender display name"
          >
            <input value={form.senderName} onChange={(e) => set('senderName', e.target.value)} style={inputStyle} />
          </Field>
          <Field
            label="Reply-to email"
          >
            <input value={form.replyToEmail} onChange={(e) => set('replyToEmail', e.target.value)} style={inputStyle} />
          </Field>
        </div>
      </Card>
    </div>
  );
}

function GroupHeader({ title }: { title: string }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ fontSize: 20, fontWeight: 800, letterSpacing: '-.2px' }}>{title}</div>
    </div>
  );
}

function Field({ label, full, children }: { label: string; full?: boolean; children: ReactNode }) {
  return (
    <div style={full ? { gridColumn: '1 / -1' } : undefined}>
      <label style={{ display: 'block', fontSize: 14, fontWeight: 700, marginBottom: 5, color: '#484848' }}>{label}</label>
      {children}
    </div>
  );
}

const grid2: CSSProperties = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 };
const inputStyle: CSSProperties = { width: '100%', padding: '9px 11px', border: '1px solid #EBEBEB', borderRadius: 10, fontSize: 16, fontFamily: 'inherit', background: '#fff', color: '#222222' };
const readonly: CSSProperties = { background: '#F7F7F9', color: '#717171' };
const primaryBtn: CSSProperties = { background: '#0571A6', color: '#fff', border: 'none', padding: '9px 18px', borderRadius: 11, fontSize: 16, fontWeight: 700, cursor: 'pointer' };
const logoTile: CSSProperties = { width: 76, height: 76, borderRadius: 18, background: '#0571A6', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, boxShadow: '0 4px 14px rgba(5,113,166,.28)' };
const lockPill: CSSProperties = { fontSize: 12, fontWeight: 700, color: '#9A6B25', background: '#F6E9D5', border: '1px solid #ECD9B4', borderRadius: 20, padding: '2px 10px' };
