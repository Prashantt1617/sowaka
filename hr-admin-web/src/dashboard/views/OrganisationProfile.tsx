// The current Organisation — top-level profile that sits above People Ops.
// Three field groups: Organisation (identity), Organisation Address (filing
// address) and Contact Information (notification + sender emails).
//
// Loaded from and saved to the server (`/admin/company/profile`), per company.
// Until a company's HR first saves, the page starts from what we already knew
// about that company (below), or from its name alone.
import { useEffect, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { useStore } from '../store';
import { useAuth } from '../auth/AuthContext';
import { useBrand } from '../brand';
import { Card, LoadError, SkeletonForm } from '../ui';
import { Logo } from '../icons';
import { ORG_DISPLAY_NAME, ORG_REGISTERED_NAME } from '../org';
import { getOrganisationProfile, saveOrganisationProfile, type OrganisationProfileDTO } from '../../services/hrms';
import { ApiError } from '../../services/http';

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

// —— What we knew before each company's first save ——————————————————————————
// Only a starting point: once HR saves, the server's copy is what shows.
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
  // What CDE have told us so far; the rest is theirs to fill in.
  cde: {
    name: 'CDE Enterprises LLP',
    displayName: 'CDE Enterprises',
    country: 'India',
    industry: '',
    incorporatedOn: '',
    addressLine1: '',
    addressLine2: '',
    city: '',
    state: '',
    pincode: '',
    addressCountry: 'India',
    primaryContactEmail: 'yash@cdeenterprises.in',
    senderEmail: '',
    senderName: 'CDE Enterprises',
    replyToEmail: 'yash@cdeenterprises.in',
  },
};
const CONVRSE: OrgForm = {
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

MOCKS.convrse = CONVRSE;

const EMPTY: OrgForm = {
  name: '', displayName: '', country: 'India', industry: '', incorporatedOn: '',
  addressLine1: '', addressLine2: '', city: '', state: '', pincode: '', addressCountry: 'India',
  primaryContactEmail: '', senderEmail: '', senderName: '', replyToEmail: '',
};

/** The form from the server's copy, or, before a first save, from what we knew. */
function formFrom(p: OrganisationProfileDTO, org: string): OrgForm {
  if (!p.saved) {
    const known = MOCKS[org];
    return known ? { ...known } : { ...EMPTY, name: p.companyName, displayName: p.companyName, senderName: p.companyName };
  }
  return {
    name: p.registeredName, displayName: p.displayName, country: p.country, industry: p.industry, incorporatedOn: p.incorporatedOn,
    addressLine1: p.addressLine1, addressLine2: p.addressLine2, city: p.city, state: p.state, pincode: p.pincode, addressCountry: p.addressCountry,
    primaryContactEmail: p.primaryContactEmail, senderEmail: p.senderEmail, senderName: p.senderName, replyToEmail: p.replyToEmail,
  };
}

export function OrganisationProfile() {
  const { flash } = useStore();
  const { user } = useAuth();
  const brand = useBrand();
  const org = user?.org ?? '';
  const [form, setForm] = useState<OrgForm | null>(null);
  const [loadError, setLoadError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let live = true;
    setForm(null); setLoadError('');
    getOrganisationProfile()
      .then((p) => { if (live) setForm(formFrom(p, org)); })
      .catch((e) => { if (live) setLoadError(e instanceof ApiError ? e.message : 'Could not load the organisation details'); });
    return () => { live = false; };
  }, [org, attempt]);

  if (loadError) return <div style={{ maxWidth: 860 }}><Card><LoadError text={loadError} onRetry={() => setAttempt((n) => n + 1)} /></Card></div>;
  if (!form) return <div style={{ maxWidth: 860 }}><Card style={{ padding: 22 }}><SkeletonForm fields={8} /></Card></div>;

  const set = <K extends keyof OrgForm>(k: K, v: OrgForm[K]) => setForm({ ...form, [k]: v });

  const save = async () => {
    setSaving(true);
    try {
      const saved = await saveOrganisationProfile({
        registeredName: form.name, displayName: form.displayName, country: form.country, industry: form.industry, incorporatedOn: form.incorporatedOn,
        addressLine1: form.addressLine1, addressLine2: form.addressLine2, city: form.city, state: form.state, pincode: form.pincode, addressCountry: form.addressCountry,
        primaryContactEmail: form.primaryContactEmail, senderEmail: form.senderEmail, senderName: form.senderName, replyToEmail: form.replyToEmail,
      });
      setForm(formFrom(saved, org));
      flash('Organisation details saved');
    } catch (e) {
      flash(e instanceof ApiError ? e.message : 'Could not save the organisation details', 'error');
    } finally {
      setSaving(false);
    }
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
            <img src={brand.icon} alt="" style={{ ...logoTile, objectFit: 'cover', boxShadow: 'var(--shadow)', background: 'var(--surface)' }} />
          ) : (
            <div style={logoTile}>
              <div style={{ transform: 'scale(2.4)' }}>
                <Logo />
              </div>
            </div>
          )}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink-2)' }}>Organisation logo</div>
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
              {!form.industry && <option value="">Select industry</option>}
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
      <div style={{ fontSize: 17, fontWeight: 600, letterSpacing: '-.2px' }}>{title}</div>
    </div>
  );
}

function Field({ label, full, children }: { label: string; full?: boolean; children: ReactNode }) {
  return (
    <div style={full ? { gridColumn: '1 / -1' } : undefined}>
      <label style={{ display: 'block', fontSize: 13, fontWeight: 500, marginBottom: 5, color: 'var(--ink-2)' }}>{label}</label>
      {children}
    </div>
  );
}

const grid2: CSSProperties = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 };
const inputStyle: CSSProperties = { width: '100%', padding: '9px 11px', border: '1px solid var(--line)', borderRadius: 10, fontSize: 14, fontFamily: 'inherit', background: 'var(--surface)', color: 'var(--ink)' };
const readonly: CSSProperties = { background: 'var(--surface-2)', color: 'var(--ink-3)' };
const primaryBtn: CSSProperties = { background: 'var(--accent-grad)', color: 'var(--on-accent)', border: 'none', padding: '9px 18px', borderRadius: 999, fontSize: 14, fontWeight: 500, cursor: 'pointer' };
const logoTile: CSSProperties = { width: 76, height: 76, borderRadius: 'var(--r-lg)', background: 'var(--accent-grad)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, boxShadow: '0 4px 14px rgba(0,136,255,.28)' };
const lockPill: CSSProperties = { fontSize: 11.5, fontWeight: 500, color: 'var(--warn)', background: 'var(--warn-bg)', border: '1px solid var(--warn-line)', borderRadius: 'var(--r-lg)', padding: '2px 10px' };
