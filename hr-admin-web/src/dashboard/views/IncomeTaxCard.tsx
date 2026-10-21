// Employee profile › Salary details › Income tax: the person's regime for
// the financial year, their declarations (old regime) and whether proofs are
// in. HR enters these for now; a run's TDS engine reads them.
import { useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import { useStore } from '../store';
import { ApiError } from '../../services/http';
import { getTaxDeclaration, rupeesToPaise, saveTaxDeclaration } from '../../services/payroll';
import type { TaxDeclarationResponse, TaxDeclarations } from '../../services/payroll';
import { Card } from '../ui';

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

  useEffect(() => {
    let live = true;
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
      })
      .catch(() => live && setData(null));
    return () => { live = false; };
  }, [userId]);

  if (!data) return null;
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
  return (
    <Card style={{ padding: '20px 24px', marginTop: 22 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 17, fontWeight: 800, flex: 1 }}>Income tax · FY {data.fy}</div>
        {status === 'to_confirm' && <span style={{ fontSize: 12, fontWeight: 700, padding: '3px 9px', borderRadius: 6, background: '#F6E9D5', color: '#8A6A20' }}>Slabs to confirm</span>}
        {!status && <span style={{ fontSize: 12, color: '#9197A2' }}>No tax slabs for this year yet</span>}
      </div>
      <div style={{ display: 'flex', gap: 20, marginTop: 14, flexWrap: 'wrap', alignItems: 'center' }}>
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
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 12, marginTop: 14 }}>
        {AMOUNTS.filter((a) => regime === 'old' || !a.oldOnly).map((a) => (
          <label key={a.key} style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13, color: '#484848' }}>
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
        <button type="button" onClick={() => void save()} disabled={saving} style={btn}>{saving ? 'Saving…' : 'Save'}</button>
        <span style={{ fontSize: 13, color: '#717171' }}>Used by the TDS engine on each run (Statutory Components › Income Tax). A figure typed on a run wins.</span>
      </div>
    </Card>
  );
}

const row: CSSProperties = { display: 'flex', alignItems: 'center', gap: 6, fontSize: 14, color: '#222222' };
const field: CSSProperties = { padding: '7px 10px', border: '1px solid #EBEBEB', borderRadius: 9, fontSize: 15, fontFamily: 'inherit' };
const btn: CSSProperties = { background: '#0571A6', color: '#fff', border: 'none', padding: '9px 18px', borderRadius: 11, fontSize: 15, fontWeight: 700, cursor: 'pointer' };
