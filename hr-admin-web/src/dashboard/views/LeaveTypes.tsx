import { Card } from '../ui';
// A leave type as the shift template editor edits it — what accrues each month,
// when it can be applied for, and what happens to an unused balance when the
// year is processed.
//
// The year-end order is fixed: carry forward up to a limit, then encash what is
// left, and anything still remaining lapses. Lapse is the tail of the other
// two, so it is shown rather than set — asking for it again as a choice is what
// made the earlier draft confusing.
import { useState, type CSSProperties, type ReactNode } from 'react';
import type { LeaveTypeRule } from '../../services/hrms';

const RESET_OPTIONS: { value: LeaveTypeRule['resetOn']; label: string }[] = [
  { value: 'monthly', label: 'End of every month' },
  { value: 'calendar_year', label: 'End of calendar year' },
  { value: 'financial_year', label: 'End of financial year' },
];
const ENCASH_OPTIONS: { value: LeaveTypeRule['encashment']; label: string }[] = [
  { value: 'all', label: 'Encash all of it' },
  { value: 'limit', label: 'Encash up to a limit' },
  { value: 'none', label: 'Nothing — it lapses' },
];
const SWATCH: Record<string, string> = {
  sick: 'var(--bad)',
  casual: 'var(--t-sky-i)',
  earned: 'var(--ok)',
  comp_off: 'var(--warn)',
};
/** Types HR adds share one colour; the four built in keep theirs. */
const swatchFor = (key: string) => SWATCH[key] ?? 'var(--t-lilac-i)';

/** 'Emergency Leave' -> 'emergency', the same slug the server would make. */
function leaveKeyFrom(name: string): string {
  return name
    .toLowerCase()
    .replace(/\bleaves?\b/g, ' ')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/^(\d)/, 'l_$1')
    .slice(0, 32);
}

/** A new type opens with nothing accrued and a plain window; HR fills in the rest. */
function newLeaveType(name: string, key: string): LeaveTypeRule {
  return {
    key, name, perMonth: 0, resetOn: 'calendar_year', carryForwardDays: 0, encashment: 'none',
    encashLimitDays: 0, advanceDays: 30, allowBackdated: true, backdatedDays: 3, active: true,
  };
}

/**
 * Adds a leave type by name. Its key is made from the name and kept for good,
 * so renaming it later never orphans leave already taken.
 */
export function AddLeaveType({ existing, onAdd }: { existing: LeaveTypeRule[]; onAdd: (row: LeaveTypeRule) => void }) {
  const [name, setName] = useState('');
  const trimmed = name.trim();
  const base = leaveKeyFrom(trimmed);
  const taken = new Set(existing.map((t) => t.key));
  // A suffixed key must still fit the server's 32-character limit.
  let key = base;
  for (let n = 2; taken.has(key); n += 1) key = `${base.slice(0, 32 - `_${n}`.length)}_${n}`;
  const clash = existing.some((t) => t.name.trim().toLowerCase() === trimmed.toLowerCase());
  const full = existing.length >= 12;
  const canAdd = !!trimmed && !!base && !clash && !full;
  const add = () => {
    if (!canAdd) return;
    onAdd(newLeaveType(trimmed, key));
    setName('');
  };
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }}
        placeholder="New leave type, e.g. Emergency Leave"
        maxLength={40}
        style={{ ...input, width: 300 }}
      />
      <button type="button" onClick={add} disabled={!canAdd} style={{ ...addButton, opacity: canAdd ? 1 : 0.5, cursor: canAdd ? 'pointer' : 'default' }}>
        + Add leave type
      </button>
      {clash && <span style={{ fontSize: 12.5, color: 'var(--bad)' }}>There is already a type with that name.</span>}
      {full && <span style={{ fontSize: 12.5, color: 'var(--ink-3)' }}>A shift can have at most 12 leave types.</span>}
    </div>
  );
}

/** Closed by default: the header is the summary, the chevron opens it for editing. */
export function LeaveTypeCard({ row, onChange, onRemove }: { row: LeaveTypeRule; onChange: (patch: Partial<LeaveTypeRule>) => void; onRemove?: () => void }) {
  const isCompOff = row.key === 'comp_off';
  const monthly = row.resetOn === 'monthly';
  const annual = +(row.perMonth * 12).toFixed(1);
  const [open, setOpen] = useState(false);

  return (
    <Card style={{ padding: 0, overflow: 'hidden', marginBottom: 14 }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', textAlign: 'left', padding: '14px 20px', borderBottom: open ? '1px solid var(--line)' : 'none', background: 'var(--surface-2)', border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}
      >
        <span style={{ width: 11, height: 11, borderRadius: 3, background: swatchFor(row.key), flexShrink: 0 }} />
        <div style={{ fontSize: 15, fontWeight: 600, letterSpacing: '-.2px', color: 'var(--ink)' }}>{row.name}</div>
        <span style={annualPill}>
          {isCompOff ? 'earned from overtime' : monthly ? `${row.perMonth} ${row.perMonth === 1 ? 'day' : 'days'} / month` : `${annual} days / year`}
        </span>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--ink-4)" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, transition: 'transform .18s', transform: open ? 'rotate(0deg)' : 'rotate(-90deg)' }}>
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {open && <div style={{ padding: '18px 20px' }}>
        <MiniLabel>Name</MiniLabel>
        <input
          value={row.name}
          onChange={(e) => onChange({ name: e.target.value })}
          maxLength={40}
          style={{ ...input, width: 300 }}
        />
        <div style={{ fontSize: 12.5, color: 'var(--ink-4)', marginTop: 6 }}>What employees see in the app.</div>

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
            {!monthly && (
              <span style={{ fontSize: 13, color: 'var(--ink-3)' }}>
                = <strong style={{ color: 'var(--ink)' }}>{annual}</strong> / year
              </span>
            )}
          </div>
        )}

        <MiniLabel>When is the balance processed?</MiniLabel>
        <select value={row.resetOn} onChange={(e) => onChange({ resetOn: e.target.value as LeaveTypeRule['resetOn'] })} style={{ ...input, width: 'auto', cursor: 'pointer' }}>
          {RESET_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>

        <MiniLabel>{row.resetOn === 'monthly' ? 'How many unused days can be carried into the next month?' : 'How many unused days can be carried forward?'}</MiniLabel>
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

        {onRemove && (
          <div style={{ marginTop: 18, paddingTop: 14, borderTop: '1px solid var(--line)' }}>
            <button
              type="button"
              onClick={() => {
                if (window.confirm(`Remove ${row.name || 'this leave type'}? People on this shift will no longer be able to apply for it. Leave already taken stays on record.`)) onRemove();
              }}
              style={removeButton}
            >
              Remove this leave type
            </button>
          </div>
        )}
      </div>}
    </Card>
  );
}

function YesNo({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  const opts: { v: boolean; l: string }[] = [{ v: true, l: 'Yes' }, { v: false, l: 'No' }];
  return (
    <div style={{ display: 'inline-flex', border: '1px solid var(--line)', borderRadius: 10, overflow: 'hidden' }}>
      {opts.map((o) => (
        <button
          key={o.l}
          onClick={() => onChange(o.v)}
          style={{
            padding: '7px 18px', fontSize: 13, fontWeight: 500, cursor: 'pointer', border: 'none',
            borderLeft: o.v ? 'none' : '1px solid var(--line)',
            background: value === o.v ? 'var(--accent-grad)' : 'var(--surface)',
            color: value === o.v ? 'var(--on-accent)' : 'var(--ink-2)',
          }}
        >
          {o.l}
        </button>
      ))}
    </div>
  );
}
function MiniLabel({ children }: { children: ReactNode }) {
  return <div style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: 'var(--ink-4)', margin: '18px 0 8px' }}>{children}</div>;
}
function Suffixed({ value, onChange, suffix, width, step }: { value: string; onChange: (v: string) => void; suffix: string; width?: number; step?: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', border: '1px solid var(--line)', borderRadius: 9, overflow: 'hidden', background: 'var(--surface)', width: width ?? '100%' }}>
      <input type="number" min="0" step={step ?? '1'} value={value} onChange={(e) => onChange(e.target.value)} style={{ border: 'none', outline: 'none', padding: '9px 11px', fontSize: 14, width: '100%', color: 'var(--ink)', background: 'transparent' }} />
      <span style={{ padding: '9px 12px', color: 'var(--ink-3)', borderLeft: '1px solid var(--line)', fontSize: 13, whiteSpace: 'nowrap' }}>{suffix}</span>
    </div>
  );
}

const addButton: CSSProperties = { padding: '9px 16px', fontSize: 13, fontWeight: 500, border: '1px solid var(--accent)', borderRadius: 9, background: 'var(--surface)', color: 'var(--accent-ink)', fontFamily: 'inherit' };
const removeButton: CSSProperties = { padding: 0, fontSize: 13, fontWeight: 500, border: 'none', background: 'none', color: 'var(--bad)', cursor: 'pointer', fontFamily: 'inherit' };
const input: CSSProperties = { padding: '9px 11px', border: '1px solid var(--line)', borderRadius: 9, fontSize: 14, fontFamily: 'inherit', background: 'var(--surface)', color: 'var(--ink)' };
const fieldLabel: CSSProperties = { fontSize: 13, fontWeight: 500, color: 'var(--ink-2)' };
const annualPill: CSSProperties = { marginLeft: 'auto', fontSize: 12.5, fontWeight: 500, color: 'var(--t-sky-i)', background: 'var(--accent-soft)', border: '1px solid var(--accent-line)', borderRadius: 'var(--r-lg)', padding: '3px 11px' };
const note: CSSProperties = { fontSize: 12.5, color: 'var(--ink-2)', background: 'var(--accent-soft)', border: '1px solid var(--accent-line)', borderRadius: 10, padding: '11px 14px', lineHeight: 1.55 };
const lapseRow: CSSProperties = { display: 'flex', alignItems: 'center', gap: 10, marginTop: 14, fontSize: 13, color: 'var(--ink-3)' };
const lapseTag: CSSProperties = { flexShrink: 0, fontSize: 11.5, fontWeight: 600, letterSpacing: '.02em', color: 'var(--ink-3)', background: 'var(--surface-2)', borderRadius: 'var(--r-lg)', padding: '3px 10px' };
