// Employee profile › Salary details › Income tax: the person's regime for
// the financial year, their declarations (old regime) and whether proofs are
// in. The employee declares item by item on the app (PPF, ELSS, rent…); the
// section totals below are what a run's TDS engine reads, and HR can still
// change them. When HR has, HR's totals are what payroll uses; the employee's
// items are kept as they declared them (and replace HR's totals if they save
// on the app again).
import { useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import { useStore } from '../store';
import { ApiError } from '../../services/http';
import { getTaxDeclaration, listInvestmentProofs, rupeesToPaise, saveTaxDeclaration } from '../../services/payroll';
import type { InvestmentProofDTO, TaxDeclarationDTO, TaxDeclarationResponse, TaxDeclarations } from '../../services/payroll';
import { DECLARATION_ITEMS, FALLBACK_OLD_LIMITS, declarationSections } from '../../../../backend/src/shared/payroll/declaration';
import { Card, LoadError, Pill, SkeletonLines } from '../ui';
import type { Pill as PillTone } from '../theme';
import * as Lk from './look';
import type { LoadState } from '../ui';
import './people.css';

const AMOUNTS: { key: keyof TaxDeclarations; label: string; oldOnly?: boolean }[] = [
  { key: 'sec80C', label: '80C investments (PF is added automatically)', oldOnly: true },
  { key: 'sec80CCD1B', label: '80CCD(1B) NPS', oldOnly: true },
  { key: 'sec80DSelf', label: '80D health insurance, self & family', oldOnly: true },
  { key: 'sec80DParents', label: '80D health insurance, parents', oldOnly: true },
  { key: 'homeLoanInterest', label: 'Home loan interest, 24(b)', oldOnly: true },
  { key: 'sec80TTA', label: '80TTA savings interest', oldOnly: true },
  { key: 'rentPaidPaise', label: 'Rent paid in the year (HRA exemption)', oldOnly: true },
  { key: 'otherIncomePaise', label: 'Other income to tax through salary' },
  { key: 'previousEmployerSalaryPaise', label: 'Salary from a previous employer this year' },
  { key: 'previousEmployerTdsPaise', label: 'Tax deducted by that employer' },
];

export function IncomeTaxCard({ userId }: { userId: string }) {
  const { flash } = useStore();
  const [data, setData] = useState<TaxDeclarationResponse | null>(null);
  const [regime, setRegime] = useState<'new' | 'old'>('new');
  const [values, setValues] = useState<Record<string, string>>({});
  const [flags, setFlags] = useState<{ metro: boolean; selfSenior: boolean; parentsSenior: boolean }>({ metro: false, selfSenior: false, parentsSenior: false });
  const [proofs, setProofs] = useState<'none' | 'submitted' | 'verified'>('none');
  const [saving, setSaving] = useState(false);
  // Hidden when it is not theirs to see (403/404), as before; any other failure says so.
  const [state, setState] = useState<LoadState | 'hidden'>('loading');
  const [attempt, setAttempt] = useState(0);
  // The employee's proofs for the year, per item; null until they arrive (or if they cannot).
  const [proofList, setProofList] = useState<InvestmentProofDTO[] | null>(null);

  useEffect(() => {
    let live = true;
    setData(null);
    setState('loading');
    getTaxDeclaration(userId)
      .then((r) => {
        if (!live) return;
        setData(r);
        const d = r.declaration;
        setRegime(d?.regime ?? 'new');
        setProofs(d?.proofs ?? 'none');
        const dec = d?.declarations ?? {};
        setValues(Object.fromEntries(AMOUNTS.filter((a) => typeof dec[a.key] === 'number').map((a) => [a.key, String((dec[a.key] as number) / 100)])));
        setFlags({ metro: dec.metro === true, selfSenior: dec.selfSenior === true, parentsSenior: dec.parentsSenior === true });
        setState('ready');
        if (d?.items) {
          listInvestmentProofs({ fy: r.fy, userId }).then((p) => { if (live) setProofList(p.proofs); }).catch(() => { if (live) setProofList(null); });
        }
      })
      .catch((e: unknown) => { if (live) { setData(null); setState(e instanceof ApiError && (e.status === 403 || e.status === 404) ? 'hidden' : 'error'); } });
    return () => { live = false; };
  }, [userId, attempt]);

  if (state === 'hidden') return null;
  if (state !== 'ready' || !data) {
    return (
      <Card style={{ padding: '20px 24px', marginTop: 22 }}>
        <div style={{ fontSize: 15, fontWeight: 600 }}>Income tax</div>
        {state === 'error'
          ? <LoadError compact text="The tax declaration could not be loaded." onRetry={() => setAttempt((n) => n + 1)} />
          : <SkeletonLines lines={3} style={{ marginTop: 16 }} />}
      </Card>
    );
  }
  const save = async () => {
    const declarations: TaxDeclarations = { ...flags };
    for (const a of AMOUNTS) {
      const v = values[a.key];
      if (v === undefined || v === '') continue;
      if (!(Number(v) >= 0)) return flash(`${a.label}: enter an amount`, 'error');
      (declarations as Record<string, number | boolean>)[a.key] = rupeesToPaise(v);
    }
    setSaving(true);
    try {
      setData(await saveTaxDeclaration(userId, { regime, declarations, proofs }, data.fy));
      flash('Tax declaration saved');
    } catch (e) {
      flash(e instanceof ApiError ? e.message : 'Could not save the declaration', 'error');
    } finally {
      setSaving(false);
    }
  };
  const status = data.configs.find((c) => c.regime === regime)?.status;
  const fromApp = data.declaration?.items !== undefined || data.declaration?.status !== undefined;
  const overridden = data.declaration ? hrOverrides(data.declaration) : false;
  return (
    <section className="pd-card" style={{ marginTop: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600, letterSpacing: '-.01em', flex: 1 }}>Income tax · FY {data.fy}</h3>
        {status === 'to_confirm' && <span style={{ fontSize: 11.5, fontWeight: 500, padding: '3px 10px', borderRadius: 999, background: 'var(--p-yellow)', color: 'var(--p-yellow-ink)' }}>Slabs to confirm</span>}
        {!status && <span style={{ fontSize: 11.5, color: 'var(--ink-3)' }}>No tax slabs for this year yet</span>}
      </div>
      {fromApp && data.declaration
        ? <EmployeeDeclaration d={data.declaration} proofs={proofList} overridden={overridden} />
        : <div style={{ ...Lk.note, marginTop: 16 }}>Nothing declared on the app yet. The figures below are HR's.</div>}

      <div style={{ ...Lk.eyebrow, marginTop: 22 }}>{fromApp ? "HR's figures · what payroll uses" : 'Declaration'}</div>
      <div style={{ display: 'flex', gap: 20, marginTop: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        <label style={row}><input type="radio" checked={regime === 'new'} onChange={() => setRegime('new')} /> New regime</label>
        <label style={row}><input type="radio" checked={regime === 'old'} onChange={() => setRegime('old')} /> Old regime</label>
        <label style={row}>
          Proofs
          <select value={proofs} onChange={(e) => setProofs(e.target.value as typeof proofs)} style={field}>
            <option value="none">Not submitted</option>
            <option value="submitted">Submitted</option>
            <option value="verified">Verified</option>
          </select>
        </label>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 16, marginTop: 16 }}>
        {AMOUNTS.filter((a) => regime === 'old' || !a.oldOnly).map((a) => (
          <label key={a.key} style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 11.5, color: 'var(--ink-2)' }}>
            {a.label}
            <input type="number" min={0} value={values[a.key] ?? ''} placeholder="₹ a year" onChange={(e) => setValues({ ...values, [a.key]: e.target.value })} style={field} />
          </label>
        ))}
      </div>
      {regime === 'old' && (
        <div style={{ display: 'flex', gap: 20, marginTop: 12, flexWrap: 'wrap' }}>
          <label style={row}><input type="checkbox" checked={flags.metro} onChange={(e) => setFlags({ ...flags, metro: e.target.checked })} /> Lives in a metro (HRA 50% of Basic)</label>
          <label style={row}><input type="checkbox" checked={flags.selfSenior} onChange={(e) => setFlags({ ...flags, selfSenior: e.target.checked })} /> Self is a senior citizen</label>
          <label style={row}><input type="checkbox" checked={flags.parentsSenior} onChange={(e) => setFlags({ ...flags, parentsSenior: e.target.checked })} /> Parents are senior citizens</label>
        </div>
      )}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 16 }}>
        <button type="button" onClick={() => void save()} disabled={saving} className="pd-btn primary">{saving ? 'Saving…' : 'Save'}</button>
        <span style={{ fontSize: 11.5, color: 'var(--ink-3)' }}>
          Used by the TDS engine on each run (Statutory Components › Income Tax). A figure typed on a run wins.
          {fromApp && data.declaration?.items && ' Saving here puts these totals over the employee\'s items for payroll; their items stay as they declared them.'}
        </span>
      </div>
    </section>
  );
}

// —— The employee's declaration from the app ————————————————————————————

const money = (paise: number) => '₹' + (paise / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 });
const dayLabel = (iso: string) => new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });

/** The section totals the employee's items add up to, as the app saves them for the engine. */
function totalsOfItems(d: TaxDeclarationDTO): TaxDeclarations {
  const a = (k: keyof NonNullable<TaxDeclarationDTO['items']>) => Math.max(0, d.items?.[k] ?? 0);
  return {
    sec80C: a('ppf') + a('elss') + a('lifeInsurance') + a('other80C'),
    sec80CCD1B: a('nps'),
    sec80DSelf: a('healthSelf'),
    sec80DParents: a('healthParents'),
    homeLoanInterest: a('homeLoanInterest'),
    rentPaidPaise: a('rentMonthly') * 12,
  };
}

/**
 * Whether HR's section totals are what payroll reads instead of the
 * employee's items: HR saved last, after the employee had declared, and the
 * totals differ from what the items add up to.
 */
function hrOverrides(d: TaxDeclarationDTO): boolean {
  if (!d.items || !d.userId || !d.updatedByUserId || d.updatedByUserId === d.userId) return false;
  const mine = totalsOfItems(d);
  const keys = Object.keys(mine) as (keyof TaxDeclarations)[];
  return keys.some((k) => (Number(d.declarations[k] ?? 0)) !== Number(mine[k] ?? 0));
}

type ProofState = 'not_uploaded' | 'uploaded' | 'approved' | 'rejected';
const PROOF_LABEL: Record<ProofState, string> = { not_uploaded: 'Not uploaded', uploaded: 'In review', approved: 'Approved', rejected: 'Rejected' };
const PROOF_TONE: Record<ProofState, PillTone> = {
  not_uploaded: Lk.TONES.mute, uploaded: Lk.TONES.warn, approved: Lk.TONES.ok, rejected: Lk.TONES.bad,
};

/** Draft, Submitted, Proofs pending or Verified, as HR reads the employee's declaration. */
function statusOf(d: TaxDeclarationDTO, proofs: InvestmentProofDTO[] | null): { label: string; tone: PillTone; sub?: string } {
  if (d.status !== 'submitted') return { label: 'Draft', tone: Lk.TONES.mute, sub: 'Saved on the app, not submitted' };
  if (d.proofs === 'verified') return { label: 'Verified', tone: Lk.TONES.ok, sub: 'Every proof approved' };
  const needing = d.regime === 'old' ? DECLARATION_ITEMS.filter((i) => (d.items?.[i.key] ?? 0) > 0) : [];
  if (needing.length > 0) {
    const approved = proofs ? needing.filter((i) => proofs.some((p) => p.item === i.key && p.status === 'approved')).length : null;
    return { label: 'Proofs pending', tone: Lk.TONES.warn, sub: approved === null ? undefined : `${approved} of ${needing.length} proofs approved` };
  }
  return { label: 'Submitted', tone: Lk.TONES.info };
}

function EmployeeDeclaration({ d, proofs, overridden }: { d: TaxDeclarationDTO; proofs: InvestmentProofDTO[] | null; overridden: boolean }) {
  const flags = { metro: d.declarations.metro === true, selfSenior: d.declarations.selfSenior === true, parentsSenior: d.declarations.parentsSenior === true };
  // Caps from the Income-tax Act's old-regime limits; provident fund from payroll is added to 80C by the run.
  const sections = declarationSections({ regime: d.regime, items: d.items ?? {}, flags, limits: FALLBACK_OLD_LIMITS, epfYearPaise: 0 })
    .map((s) => ({ ...s, items: s.items.filter((i) => i.key !== 'epf') }));
  const st = statusOf(d, proofs);
  const proofOf = (key: string): ProofState => (proofs?.find((p) => p.item === key)?.status ?? 'not_uploaded');
  const old = d.regime === 'old';
  const anyItem = sections.some((s) => s.items.some((i) => i.amountPaise > 0));
  return (
    <div style={{ marginTop: 16 }}>
      <div style={Lk.eyebrow}>Declared on the app</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 28, flexWrap: 'wrap', marginTop: 10 }}>
        <div><div style={Lk.kvDt}>Regime</div><div style={Lk.kvDd}>{old ? 'Old regime' : 'New regime'}</div></div>
        <div>
          <div style={Lk.kvDt}>Status</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 2 }}>
            <Pill label={st.label} tone={st.tone} />
            {st.sub && <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>{st.sub}</span>}
          </div>
        </div>
        <div><div style={Lk.kvDt}>Submitted</div><div style={Lk.kvDd}>{d.submittedAt ? dayLabel(d.submittedAt) : '—'}</div></div>
        {old && (flags.metro || flags.selfSenior || flags.parentsSenior) && (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {flags.metro && <span style={Lk.tag}>Lives in a metro</span>}
            {flags.selfSenior && <span style={Lk.tag}>Senior citizen</span>}
            {flags.parentsSenior && <span style={Lk.tag}>Parents senior citizens</span>}
          </div>
        )}
      </div>

      {overridden && (
        <div role="note" style={{ ...Lk.note, marginTop: 14, background: 'var(--warn-bg)', borderColor: 'transparent', color: 'var(--ink)' }}>
          <span aria-hidden style={{ fontWeight: 700, color: 'var(--warn)' }}>!</span>
          <span>
            <strong style={{ fontWeight: 600 }}>HR&apos;s totals override the employee&apos;s items for payroll.</strong>{' '}
            HR changed the section totals{d.updatedAt ? ` on ${dayLabel(d.updatedAt)}` : ''}, after the employee declared on the app. Runs use HR&apos;s figures below; the items here are kept as the employee declared them. If the employee saves on the app again, their items become the totals again.
          </span>
        </div>
      )}

      {!old && <div style={{ fontSize: 12.5, color: 'var(--ink-3)', marginTop: 12 }}>On the new regime none of these reduce tax and no proofs are asked for; the amounts are kept in case they switch back.</div>}

      {anyItem ? (
        <table className="lk-t" style={{ ...Lk.table, marginTop: 14 }}>
          <thead>
            <tr>
              <th style={Lk.th}>Item</th>
              <th style={{ ...Lk.th, textAlign: 'right' }}>Declared</th>
              {old && <th style={Lk.th}>Proof</th>}
            </tr>
          </thead>
          <tbody>
            {sections.filter((s) => s.items.some((i) => i.amountPaise > 0)).map((s) => (
              <SectionRows key={s.key} section={s} old={old} proofOf={proofOf} proofsKnown={proofs !== null} />
            ))}
          </tbody>
        </table>
      ) : (
        <div style={{ fontSize: 13, color: 'var(--ink-3)', marginTop: 12 }}>No investments declared, only the regime.</div>
      )}
      {old && anyItem && <div style={{ fontSize: 11.5, color: 'var(--ink-3)', marginTop: 8 }}>Counted: up to each section&apos;s cap. 80C&apos;s ₹1,50,000 is shared with provident fund from payroll, which the run adds. Rent is a month&apos;s rent; HRA&apos;s exemption is worked out on the run.</div>}
    </div>
  );
}

function SectionRows({ section, old, proofOf, proofsKnown }: {
  section: ReturnType<typeof declarationSections>[number];
  old: boolean;
  proofOf: (key: string) => ProofState;
  proofsKnown: boolean;
}) {
  const cols = old ? 3 : 2;
  return (
    <>
      <tr>
        <td colSpan={cols} style={{ ...Lk.td, background: 'var(--surface-2)', fontWeight: 500 }}>
          <span>{section.label}</span>
          <span style={{ float: 'right', fontWeight: 400, color: 'var(--ink-2)', fontVariantNumeric: 'tabular-nums' }}>
            {section.key === 'HRA' ? `${money(section.declaredPaise)} a year` : money(section.declaredPaise)}
            {old && <> · counts {money(section.countedPaise)}{section.capPaise !== null && <span style={{ color: 'var(--ink-3)' }}> of {money(section.capPaise)}</span>}</>}
          </span>
        </td>
      </tr>
      {section.items.filter((i) => i.amountPaise > 0).map((i) => {
        const p = proofOf(i.key);
        return (
          <tr key={i.key}>
            <td style={{ ...Lk.td, paddingLeft: 24 }}>{i.label}</td>
            <td style={{ ...Lk.td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{money(i.amountPaise)}{i.key === 'rentMonthly' && <span style={{ color: 'var(--ink-3)' }}> a month</span>}</td>
            {old && <td style={Lk.td}>{proofsKnown ? <Pill label={PROOF_LABEL[p]} tone={PROOF_TONE[p]} /> : <span style={{ color: 'var(--ink-3)' }}>—</span>}</td>}
          </tr>
        );
      })}
    </>
  );
}

const row: CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--ink)' };
const field: CSSProperties = { height: 42, padding: '0 12px', border: '1px solid var(--line-2)', borderRadius: 12, fontSize: 13, fontFamily: 'inherit', background: 'var(--surface)', color: 'var(--ink)' };
