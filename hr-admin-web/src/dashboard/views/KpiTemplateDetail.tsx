// The read-only view of a template: what it scores, how much each part counts,
// and how many people are on it.
//
// Shared by Templates (where it can also delete) and Bulk Assign (where it is
// how you check a template before picking it), so the two can never drift into
// describing the same template differently. Rendered as a page in both.
import { useState } from 'react';
import { deleteKpiTemplate } from '../../services/kpi';
import type { KpiParameterDTO, KpiTemplateDTO } from '../../services/kpi';
import { DetailPage, Td, Th } from './kpiUi';
import { ghostBtn, panelCard, panelTitle, warnTag } from './kpiStyles';


export function TemplateDetailModal({
  template, paramById, onBack, onDeleted, onError,
}: {
  template: KpiTemplateDTO;
  paramById: Map<string, KpiParameterDTO>;
  onBack: () => void;
  /** Omit both to render without the delete action, as Bulk Assign does. */
  onDeleted?: () => void;
  onError?: (message: string) => void;
}) {
  const [deleting, setDeleting] = useState(false);
  const [blocked, setBlocked] = useState('');
  const inUse = template.assignmentCount > 0;

  async function remove() {
    setDeleting(true);
    try {
      await deleteKpiTemplate(template.id);
      onDeleted?.();
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Could not delete';
      setBlocked(message);
      onError?.(message);
      setDeleting(false);
    }
  }

  return (
    <DetailPage
      title={template.name}
      subtitle={template.description || `${template.parameterIds.length} parameters`}
      backLabel="Back to templates"
      onBack={onBack}
      width={900}
      actions={
        <>
          {/* Hidden rather than disabled: a template with assignments can never
              be deleted, so the action would only ever be refused. */}
          {onDeleted && !inUse && (
            <button
              onClick={remove}
              disabled={deleting}
              style={{ ...ghostBtn, color: '#A32B2B', opacity: deleting ? 0.45 : 1 }}
            >
              {deleting ? 'Deleting…' : 'Delete template'}
            </button>
          )}
        </>
      }
    >
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 300px', gap: 18, alignItems: 'start' }}>
        <div style={panelCard}>
          <div style={panelTitle}>Parameters and weights</div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 16 }}>
            <thead>
              <tr>
                <Th>Parameter</Th>
                <Th width={90} right>Weight</Th>
                <Th width={110} right>Max points</Th>
              </tr>
            </thead>
            <tbody>
              {template.parameterIds.map((id) => {
                const p = paramById.get(id);
                const w = template.weights[id] ?? 0;
                return (
                  <tr key={id}>
                    <Td top>
                      <div style={{ fontWeight: 700 }}>{p?.title ?? 'Removed parameter'}</div>
                      {p?.subtitle && (
                        <div style={{ fontSize: 13.5, color: '#717171', marginTop: 2, lineHeight: 1.45 }}>{p.subtitle}</div>
                      )}
                    </Td>
                    <Td top right>
                      <span style={{ fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>{w}%</span>
                    </Td>
                    <Td top right>
                      <span style={{ color: '#717171', fontVariantNumeric: 'tabular-nums' }}>
                        {((w / 100) * 5).toFixed(2)}
                      </span>
                    </Td>
                  </tr>
                );
              })}
              <tr>
                <Td><span style={{ fontWeight: 700, color: '#717171' }}>Total</span></Td>
                <Td right><span style={{ fontWeight: 800, color: '#4F7A52' }}>100%</span></Td>
                <Td right><span style={{ fontWeight: 800 }}>5.00</span></Td>
              </tr>
            </tbody>
          </table>
        </div>

        <div>
          <div style={panelCard}>
            <div style={panelTitle}>Usage</div>
            <div style={{ fontSize: 30, fontWeight: 800, letterSpacing: '-.6px', fontVariantNumeric: 'tabular-nums' }}>
              {template.employeeCount}
            </div>
            <div style={{ fontSize: 13, color: '#717171', fontWeight: 600, marginTop: 2 }}>
              employees on it this cycle
            </div>
            <div style={{ fontSize: 13, color: '#9197A2', marginTop: 10, lineHeight: 1.5 }}>
            </div>
          </div>

        </div>
      </div>

      {blocked && (
        <div style={{ ...warnTag, background: '#F7E4E4', borderColor: '#E8C9C9', color: '#A32B2B', marginTop: 16 }}>
          {blocked}
        </div>
      )}
    </DetailPage>
  );
}
