// Leave types — what accrues each month, and what happens to an unused balance
// when the year is processed. Live: saved to the org's shift policy.
//
// The year-end order is fixed: carry forward up to a limit, then encash what is
// left, and anything still remaining lapses. Lapse is the tail of the other
// two, so it is shown rather than set — asking for it again as a choice is what
// made the earlier draft confusing.
import { useEffect, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { useStore } from '../store';
import { Card } from '../ui';
import { getShiftPolicy, saveShiftPolicy } from '../../services/hrms';
import type { LeaveTypeKey, LeaveTypeRule } from '../../services/hrms';

const RESET_OPTIONS: { value: LeaveTypeRule['resetOn']; label: string }[] = [
  { value: 'calendar_year', label: 'End of calendar year' },
  { value: 'financial_year', label: 'End of financial year' },
];
const ENCASH_OPTIONS: { value: LeaveTypeRule['encashment']; label: string }[] = [
  { value: 'all', label: 'Encash all of it' },
  { value: 'limit', label: 'Encash up to a limit' },
  { value: 'none', label: 'Nothing — it lapses' },
];
const SWATCH: Record<LeaveTypeKey, string> = {
  sick: '#C4382E',
  casual: '#4A6FA5',
  earned: '#4F7A52',
  comp_off: '#8A6D1F',
};

export function LeaveTypes() {
  const { flash } = useStore();
  const [types, setTypes] = useState<LeaveTypeRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    getShiftPolicy()
      .then(({ leave }) => setTypes(leave.types))
      .catch((error: Error) => flash(error.message))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const update = (index: number, patch: Partial<LeaveTypeRule>) =>
    setTypes((rows) => rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));

  const save = async () => {
    setSaving(true);
    try {
      const { leave } = await getShiftPolicy();
      await saveShiftPolicy({ leave: { ...leave, types } });
      flash('Leave types saved');
    } catch (error) {
      flash((error as Error).message);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div style={{ padding: '44px 20px', textAlign: 'center', color: '#9197A2', fontSize: 15 }}>Loading leave types…</div>;
  }

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 14 }}>
        <div style={{ fontSize: 13, color: '#717171' }}>
          Accrual and year-end handling. The balance an employee sees is built from these.
        </div>
        <button onClick={() => void save()} disabled={saving} style={{ ...primaryBtn, marginLeft: 'auto' }}>
          {saving ? 'Saving…' : 'Save leave types'}
        </button>
      </div>
      {types.map((row, index) => (
        <LeaveTypeCard key={row.key} row={row} onChange={(patch) => update(index, patch)} />
      ))}
    </>
  );
}

function LeaveTypeCard({ row, onChange }: { row: LeaveTypeRule; onChange: (patch: Partial<LeaveTypeRule>) => void }) {
  const isCompOff = row.key === 'comp_off';
  const annual = +(row.perMonth * 12).toFixed(1);

  return (
    <Card style={{ padding: 0, overflow: 'hidden', marginBottom: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 20px', borderBottom: '1px solid #EBEBEB', background: '#FBFBFC' }}>
        <span style={{ width: 11, height: 11, borderRadius: 3, background: SWATCH[row.key], flexShrink: 0 }} />
        <div style={{ fontSize: 17, fontWeight: 800, letterSpacing: '-.2px' }}>{row.name}</div>
        <span style={annualPill}>
          {isCompOff ? 'earned from overtime' : `${annual} days / year`}
        </span>
      </div>

      <div style={{ padding: '18px 20px' }}>
        <MiniLabel>Accrual</MiniLabel>
        {isCompOff ? (
          <div style={note}>
            Comp-off is not accrued. The balance moves when overtime is approved — a full day adds
            1 day, a half day adds 0.5. Everything below still applies to what is left unused.
          </div>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <div style={fieldLabel}>Leaves earned per month</div>
            <Suffixed value={String(row.perMonth)} onChange={(v) => onChange({ perMonth: Number(v) || 0 })} suffix="/ month" width={150} step="0.5" />
            <span style={{ fontSize: 14, color: '#717171' }}>
              = <strong style={{ color: '#333' }}>{annual}</strong> / year
            </span>
          </div>
        )}

        <MiniLabel>When is the balance processed?</MiniLabel>
        <select value={row.resetOn} onChange={(e) => onChange({ resetOn: e.target.value as LeaveTypeRule['resetOn'] })} style={{ ...input, width: 'auto', cursor: 'pointer' }}>
          {RESET_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>

        <MiniLabel>How many unused days can be carried forward?</MiniLabel>
        <Suffixed value={String(row.carryForwardDays)} onChange={(v) => onChange({ carryForwardDays: Number(v) || 0 })} suffix="days" width={180} />

        <MiniLabel>What happens to the remaining days?</MiniLabel>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <select value={row.encashment} onChange={(e) => onChange({ encashment: e.target.value as LeaveTypeRule['encashment'] })} style={{ ...input, width: 'auto', cursor: 'pointer' }}>
            {ENCASH_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          {row.encashment === 'limit' && (
            <Suffixed value={String(row.encashLimitDays)} onChange={(v) => onChange({ encashLimitDays: Number(v) || 0 })} suffix="days" width={160} />
          )}
        </div>

        <MiniLabel>When can it be applied for?</MiniLabel>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <div style={fieldLabel}>How far in advance</div>
          <Suffixed value={String(row.advanceDays)} onChange={(v) => onChange({ advanceDays: Number(v) || 0 })} suffix="days ahead" width={180} />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginTop: 10 }}>
          <div style={fieldLabel}>Allow backdated applications</div>
          <YesNo value={row.allowBackdated} onChange={(v) => onChange({ allowBackdated: v })} />
          {row.allowBackdated && (
            <Suffixed value={String(row.backdatedDays)} onChange={(v) => onChange({ backdatedDays: Number(v) || 0 })} suffix="days back" width={170} />
          )}
        </div>

        {/* Not a question: whatever carry-forward and encashment don't take, lapses. */}
        <div style={lapseRow}>
          <span style={lapseTag}>automatic</span>
          <span>Any balance still left after that will <strong>lapse</strong>.</span>
        </div>
      </div>
    </Card>
  );
}

function YesNo({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  const opts: { v: boolean; l: string }[] = [{ v: true, l: 'Yes' }, { v: false, l: 'No' }];
  return (
    <div style={{ display: 'inline-flex', border: '1px solid #EBEBEB', borderRadius: 10, overflow: 'hidden' }}>
      {opts.map((o) => (
        <button
          key={o.l}
          onClick={() => onChange(o.v)}
          style={{
            padding: '7px 18px', fontSize: 14, fontWeight: 700, cursor: 'pointer', border: 'none',
            borderLeft: o.v ? 'none' : '1px solid #EBEBEB',
            background: value === o.v ? '#0571A6' : '#fff',
            color: value === o.v ? '#fff' : '#484848',
          }}
        >
          {o.l}
        </button>
      ))}
    </div>
  );
}
function MiniLabel({ children }: { children: ReactNode }) {
  return <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: '.05em', textTransform: 'uppercase', color: '#9197A2', margin: '18px 0 8px' }}>{children}</div>;
}
function Suffixed({ value, onChange, suffix, width, step }: { value: string; onChange: (v: string) => void; suffix: string; width?: number; step?: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', border: '1px solid #EBEBEB', borderRadius: 9, overflow: 'hidden', background: '#fff', width: width ?? '100%' }}>
      <input type="number" min="0" step={step ?? '1'} value={value} onChange={(e) => onChange(e.target.value)} style={{ border: 'none', outline: 'none', padding: '9px 11px', fontSize: 16, width: '100%', color: '#222222', background: 'transparent' }} />
      <span style={{ padding: '9px 12px', color: '#717171', borderLeft: '1px solid #EBEBEB', fontSize: 14, whiteSpace: 'nowrap' }}>{suffix}</span>
    </div>
  );
}

const input: CSSProperties = { padding: '9px 11px', border: '1px solid #EBEBEB', borderRadius: 9, fontSize: 16, fontFamily: 'inherit', background: '#fff', color: '#222222' };
const fieldLabel: CSSProperties = { fontSize: 14, fontWeight: 700, color: '#484848' };
const annualPill: CSSProperties = { marginLeft: 'auto', fontSize: 13, fontWeight: 700, color: '#4A6FA5', background: '#EEF3FA', border: '1px solid #DEE8F4', borderRadius: 20, padding: '3px 11px' };
const note: CSSProperties = { fontSize: 13, color: '#3A5A6B', background: '#F1F8FC', border: '1px solid #E0EEF6', borderRadius: 10, padding: '11px 14px', lineHeight: 1.55 };
const lapseRow: CSSProperties = { display: 'flex', alignItems: 'center', gap: 10, marginTop: 14, fontSize: 14, color: '#717171' };
const lapseTag: CSSProperties = { flexShrink: 0, fontSize: 11.5, fontWeight: 800, letterSpacing: '.02em', color: '#717171', background: '#EDEDF0', borderRadius: 20, padding: '3px 10px' };
const primaryBtn: CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 6, background: '#0571A6', color: '#fff', border: 'none', padding: '9px 16px', borderRadius: 11, fontSize: 16, fontWeight: 700, cursor: 'pointer' };
