// Choosing a template's parameters and splitting 100% between them.
//
// Two stages rather than one list: add a parameter, then say what it is worth.
// A single checkbox list interleaves chosen and unchosen ones, so the set being
// built is never visible in one place, and weight boxes sit against rows that
// have no weight.
import type { KpiParameterDTO } from '../../services/kpi';
import { inputStyle, MAX_PER_SET, smallBtn } from './kpiStyles';
import { evenWeights, weightError, weightTotal, WEIGHT_TOTAL } from '../weights';

export function WeightPicker({
  params, picked, weights, onChange,
}: {
  params: KpiParameterDTO[];
  picked: string[];
  weights: Record<string, number>;
  onChange: (picked: string[], weights: Record<string, number>) => void;
}) {
  const byId = new Map(params.map((p) => [p.id, p]));
  const available = params.filter((p) => !picked.includes(p.id));
  const total = weightTotal(picked, weights);
  const error = weightError(picked, weights);
  const full = picked.length >= MAX_PER_SET;

  // Adding or removing re-spreads evenly: the common case is not caring about
  // the split, and anyone who does care then edits from a valid starting point
  // rather than a set that already fails validation.
  const add = (id: string) => {
    const next = [...picked, id];
    onChange(next, evenWeights(next));
  };
  const remove = (id: string) => {
    const next = picked.filter((x) => x !== id);
    onChange(next, next.length ? evenWeights(next) : {});
  };
  const setWeight = (id: string, raw: string) => {
    const value = raw.trim() === '' ? 0 : Number(raw);
    if (!Number.isFinite(value)) return;
    onChange(picked, { ...weights, [id]: Math.trunc(value) });
  };

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
        <select
          value=""
          disabled={available.length === 0 || full}
          onChange={(e) => { if (e.target.value) add(e.target.value); }}
          style={{ ...inputStyle, flex: 1, opacity: available.length === 0 || full ? 0.6 : 1 }}
        >
          <option value="">
            {full
              ? `Limit reached — ${MAX_PER_SET} parameters`
              : available.length === 0
                ? 'All parameters added'
                : '+ Add a parameter…'}
          </option>
          {available.map((p) => (
            <option key={p.id} value={p.id}>{p.title}</option>
          ))}
        </select>
        {picked.length > 1 && (
          <button onClick={() => onChange(picked, evenWeights(picked))} style={smallBtn}>
            Split evenly
          </button>
        )}
      </div>

      {picked.length === 0 ? (
        <div style={{ border: '1px dashed #D8DBE0', borderRadius: 12, padding: '26px 16px', textAlign: 'center', color: '#9197A2', fontSize: 14.5, lineHeight: 1.6 }}>
          No parameters yet.<br />Add one above to start building the set.
        </div>
      ) : (
        <div style={{ border: '1px solid #EBEBEB', borderRadius: 12, overflow: 'hidden' }}>
          {picked.map((id) => {
            const p = byId.get(id);
            const weight = Number(weights[id]) || 0;
            return (
              <div
                key={id}
                style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 13px', borderBottom: '1px solid #F4F4F6' }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 15, fontWeight: 700 }}>{p?.title ?? 'Removed parameter'}</div>
                  {p?.subtitle && (
                    <div style={{ fontSize: 13, color: '#717171', marginTop: 1, lineHeight: 1.4 }}>{p.subtitle}</div>
                  )}
                  {/* The share of the whole, so the split reads at a glance
                      rather than having to be added up from the boxes. */}
                  <div style={{ height: 4, borderRadius: 4, background: '#F0F0F2', marginTop: 7, overflow: 'hidden' }}>
                    <div style={{ width: `${Math.min(100, weight)}%`, height: '100%', background: '#0571A6' }} />
                  </div>
                </div>
                <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 4 }}>
                  <input
                    value={weight || ''}
                    onChange={(e) => setWeight(id, e.target.value)}
                    inputMode="numeric"
                    maxLength={3}
                    aria-label={`Weight for ${p?.title ?? 'parameter'}`}
                    style={{ ...inputStyle, width: 56, textAlign: 'center', padding: '6px 8px', fontSize: 15, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}
                  />
                  <span style={{ fontSize: 14, color: '#717171', fontWeight: 700 }}>%</span>
                </div>
                <button
                  onClick={() => remove(id)}
                  title="Remove"
                  style={{ flexShrink: 0, border: 'none', background: 'none', color: '#9197A2', fontSize: 17, cursor: 'pointer', padding: '2px 4px', lineHeight: 1 }}
                >
                  ×
                </button>
              </div>
            );
          })}

          <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 13px', background: '#FBFBFC' }}>
            <span style={{ flex: 1, fontSize: 14, fontWeight: 700, color: '#717171' }}>
              {picked.length} of {MAX_PER_SET} parameters
            </span>
            <span
              style={{
                fontSize: 15, fontWeight: 800, fontVariantNumeric: 'tabular-nums',
                color: total === WEIGHT_TOTAL ? '#4F7A52' : '#C4382E',
              }}
            >
              {total}%
            </span>
            <span style={{ width: 22 }} />
          </div>
        </div>
      )}

      {error ? (
        <div style={{ fontSize: 14, color: '#C4382E', fontWeight: 600, marginTop: 10 }}>{error}</div>
      ) : (
        <div style={{ fontSize: 13, color: '#9197A2', marginTop: 10, lineHeight: 1.5 }}>
        </div>
      )}
    </>
  );
}
