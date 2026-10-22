// One `field in (…)` targeting rule, joined to the previous with AND.
//
// Shared by template authoring and bulk assignment: both build the same kind of
// rule set, and the two have to read identically or the preview stops meaning
// the same thing in each place.
import type { Emp } from '../seed';
import type { FacetDef } from '../kpiTargeting';
import { andLabel } from '../kpiTargeting';
import { smallBtn } from './kpiStyles';

/** One `field in (…)` rule, joined to the previous with AND. */
export function RuleRow({
  facet, first, values, options, emps, onChange, onRemove,
}: {
  facet: FacetDef;
  first: boolean;
  values: string[];
  options: string[];
  emps: Emp[];
  onChange: (values: string[]) => void;
  onRemove: () => void;
}) {
  const remaining = options.filter((o) => !values.includes(o));
  return (
    <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', marginTop: first ? 0 : 10 }}>
      <span style={{ ...andLabel, visibility: first ? 'hidden' : 'visible' }}>AND</span>
      <div style={{ flex: 1, minWidth: 0, background: 'var(--surface-2)', border: '1px solid var(--line)', borderRadius: 12, padding: '11px 13px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--ink)' }}>{facet.label}</span>
          <span style={{ fontSize: 12.5, color: 'var(--ink-3)' }}>is any of</span>
          {values.map((v) => (
            <button
              key={v}
              onClick={() => onChange(values.filter((x) => x !== v))}
              title="Remove"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'var(--accent-soft)', color: 'var(--accent-ink)', border: 'none', borderRadius: 'var(--r-lg)', padding: '4px 10px', fontSize: 12.5, fontWeight: 500, cursor: 'pointer' }}
            >
              {facet.display(v, emps)} <span style={{ fontSize: 13.5, lineHeight: 1 }}>×</span>
            </button>
          ))}
          {remaining.length > 0 && (
            <select
              value=""
              onChange={(e) => { if (e.target.value) onChange([...values, e.target.value]); }}
              style={{ border: '1px dashed var(--line-2)', borderRadius: 'var(--r-lg)', padding: '4px 9px', fontSize: 12.5, fontWeight: 500, color: 'var(--ink-3)', background: 'var(--surface)', fontFamily: 'inherit', cursor: 'pointer' }}
            >
              <option value="">+ value</option>
              {remaining.map((o) => (
                <option key={o} value={o}>{facet.display(o, emps)}</option>
              ))}
            </select>
          )}
        </div>
      </div>
      <button onClick={onRemove} title="Remove rule" style={{ ...smallBtn, color: 'var(--bad)', flexShrink: 0, marginTop: 5 }}>
        Remove
      </button>
    </div>
  );
}
