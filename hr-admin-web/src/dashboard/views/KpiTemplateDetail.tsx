// The read-only view of a template: what it scores, how much each part counts,
// and how many people are on it.
//
// Shared by Templates (where it can also delete) and Bulk Assign (where it is
// how you check a template before picking it), so the two can never drift into
// describing the same template differently. Rendered as a page in both.
import { useState } from 'react';
import { deleteKpiTemplate } from '../../services/kpi';
import type { KpiParameterDTO, KpiTemplateDTO } from '../../services/kpi';
import { DetailPage } from './kpiUi';
import { Td, Th } from './lookUi';
import * as L from './look';
import { ghostBtn, panelCard, panelTitle, warnTag } from './kpiLook';


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
              style={{ ...L.btnDanger, height: 40, padding: '0 16px', fontSize: 13, opacity: deleting ? 0.45 : 1 }}
            >
              {deleting ? 'Deleting…' : 'Delete template'}
            </button>
          )}
        </>
      }
    >
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 300px', gap: 20, alignItems: 'start' }}>
        <div style={panelCard}>
          <div style={panelTitle}>Parameters and weights</div>
          <table className="lk-t" style={L.table}>
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
                      <div style={L.cellName}>{p?.title ?? 'Removed parameter'}</div>
                      {p?.description && (
                        <div style={{ ...L.cellSub, lineHeight: 1.45 }}>{p.description}</div>
                      )}
                    </Td>
                    <Td top right>
                      <span style={{ fontWeight: 500, fontVariantNumeric: 'tabular-nums' }}>{w}%</span>
                    </Td>
                    <Td top right>
                      <span style={{ color: 'var(--ink-3)', fontVariantNumeric: 'tabular-nums' }}>
                        {((w / 100) * 5).toFixed(2)}
                      </span>
                    </Td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <Td><span style={{ fontWeight: 600, color: 'var(--ink-3)' }}>Total</span></Td>
                <Td right><span style={{ fontWeight: 600, color: 'var(--ok)' }}>100%</span></Td>
                <Td right><span style={{ fontWeight: 600 }}>5.00</span></Td>
              </tr>
            </tfoot>
          </table>
        </div>

        <div>
          <div style={panelCard}>
            <div style={panelTitle}>Usage</div>
            <div style={{ fontSize: 24, fontWeight: 400, letterSpacing: '-.02em', lineHeight: 1.05, fontVariantNumeric: 'tabular-nums' }}>
              {template.employeeCount}
            </div>
            <div style={{ fontSize: 12.5, color: 'var(--ink-2)', fontWeight: 400, marginTop: 6 }}>
              employees on it this cycle
            </div>
            <div style={{ fontSize: 12.5, color: 'var(--ink-4)', marginTop: 10, lineHeight: 1.5 }}>
            </div>
          </div>

        </div>
      </div>

      {blocked && (
        <div style={{ ...warnTag, background: 'var(--bad-bg)', borderColor: 'var(--bad-line)', color: 'var(--bad)', marginTop: 16 }}>
          {blocked}
        </div>
      )}
    </DetailPage>
  );
}
