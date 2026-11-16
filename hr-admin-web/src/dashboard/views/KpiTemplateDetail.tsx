// The read-only view of a template: what it scores, how much each part counts,
// and how many people are on it.
//
// Shared by Templates (where it can also delete) and Bulk Assign (where it is
// how you check a template before picking it), so the two can never drift into
// describing the same template differently. Rendered as a page in both.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { assignTemplateToUsers, deleteKpiTemplate, kpiTemplateMembers, listKpiAssignments, removeKpiAssignment } from '../../services/kpi';
import type { KpiParameterDTO, KpiTemplateDTO } from '../../services/kpi';
import { useStore } from '../store';
import { getAllEmployees } from '../../services/hrms';
import type { Emp } from '../seed';
import { StatusTabs } from '../ui';
import { periodLabel } from '../period';
import { TemplateEditPeople, TemplateMembers } from './TemplatePeople';
import { DetailPage } from './kpiUi';
import { Td, Th } from './lookUi';
import * as L from './look';
import { panelCard, panelTitle, warnTag } from './kpiLook';


type Tab = 'template' | 'employees' | 'edit';

export function TemplateDetailModal({
  template, paramById, onBack, onDeleted, onError, templates,
}: {
  template: KpiTemplateDTO;
  paramById: Map<string, KpiParameterDTO>;
  onBack: () => void;
  /** Given on Templates: adds the Employees and Edit employees tabs (names the other templates people are on). */
  templates?: KpiTemplateDTO[];
  /** Omit both to render without the delete action, as Bulk Assign does. */
  onDeleted?: () => void;
  onError?: (message: string) => void;
}) {
  const [deleting, setDeleting] = useState(false);
  const [blocked, setBlocked] = useState('');
  const inUse = template.assignmentCount > 0;
  const s = useStore();
  const withPeople = !!templates;
  const [tab, setTab] = useState<Tab>('template');
  // Who is on it this cycle (frozen: managers are scoring it) and next cycle (where changes land).
  const [nowIds, setNowIds] = useState<Set<string> | null>(null);
  const [nextOf, setNextOf] = useState<Map<string, string> | null>(null);
  const [tick, setTick] = useState(0);
  const period = s.cycle.period;
  const next = s.cycle.next;
  useEffect(() => {
    if (!withPeople || !period || !next) return;
    let live = true;
    Promise.all([kpiTemplateMembers(template.id, period), listKpiAssignments(next)]).then(([now, upcoming]) => {
      if (!live) return;
      setNowIds(new Set(now.members.map((m) => m.userId)));
      setNextOf(new Map(upcoming.filter((a) => a.templateId).map((a) => [a.userId, a.templateId!])));
    }).catch((e) => onError?.(e instanceof Error ? e.message : 'Could not load who is on it'));
    return () => { live = false; };
  }, [withPeople, template.id, period, next, tick]); // eslint-disable-line react-hooks/exhaustive-deps
  // Only people still working: someone who has left is on no template.
  const [gone, setGone] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (!withPeople) return;
    getAllEmployees().then((all) => setGone(new Set(all.filter((r) => ['offboarded', 'terminated'].includes(r.lifecycleStatus ?? '')).map((r) => r.userId)))).catch(() => undefined);
  }, [withPeople]);
  const working = useMemo(() => s.emps.filter((e) => !gone.has(e.id)), [s.emps, gone]);
  const nameOf = useMemo(() => new Map((templates ?? []).map((t) => [t.id, t.name])), [templates]);
  const members = useMemo(() => (nowIds ? working.filter((e) => nowIds.has(e.id)) : []), [nowIds, working]);
  const placement = useCallback((e: Emp) => {
    const t = nextOf?.get(e.id);
    return { on: t === template.id, elsewhere: t && t !== template.id ? nameOf.get(t) ?? 'Another template' : undefined };
  }, [nextOf, template.id, nameOf]);
  const nextNote = (e: Emp) => {
    const t = nextOf?.get(e.id);
    return t === template.id ? `Stays in ${periodLabel(next)}` : t ? `${nameOf.get(t) ?? 'Another template'} from ${periodLabel(next)}` : `Nothing in ${periodLabel(next)}`;
  };
  const addPeople = async (ids: string[]) => {
    try {
      await assignTemplateToUsers(template.id, ids, next);
      setTick((n) => n + 1);
      s.flash(`${ids.length} ${ids.length === 1 ? 'person is' : 'people are'} on ${template.name} from ${periodLabel(next)}`);
    } catch (e) { s.flash(e instanceof Error ? e.message : 'Could not add', 'error'); }
  };
  const removePeople = async (ids: string[]) => {
    try {
      for (const id of ids) await removeKpiAssignment(id, next);
      setTick((n) => n + 1);
      s.flash(`${ids.length} ${ids.length === 1 ? 'person comes' : 'people come'} off ${template.name} from ${periodLabel(next)}`);
    } catch (e) { s.flash(e instanceof Error ? e.message : 'Could not remove', 'error'); }
  };

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
      width={tab === 'template' ? 900 : 1180}
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
      {withPeople && (
        <div style={{ marginBottom: 18 }}>
          <StatusTabs<Tab> options={['template', 'employees', 'edit']} active={tab} onSelect={setTab}
            labels={{ template: 'Template', employees: 'Employees', edit: 'Edit employees' }} counts={nowIds ? { employees: members.length } : undefined} />
        </div>
      )}
      {withPeople && tab === 'employees' && (
        <TemplateMembers members={members} extra={nextNote}
          emptyText={`Nobody is on this template in ${periodLabel(period)}.`}
          note={<>On it in <strong style={{ color: 'var(--ink)', fontWeight: 600 }}>{periodLabel(period)}</strong>, the cycle managers are scoring now. The last column says where each person is in {periodLabel(next)}.</>} />
      )}
      {withPeople && tab === 'edit' && (
        nextOf ? (
          <TemplateEditPeople emps={working} placement={placement} onAdd={addPeople} onRemove={removePeople}
            note={<>Changes start in <strong style={{ color: 'var(--ink)', fontWeight: 600 }}>{periodLabel(next)}</strong>; {periodLabel(period)} is in progress and stays as it is. Adding someone replaces the template they have for {periodLabel(next)}.</>} />
        ) : <div style={{ ...panelCard, color: 'var(--ink-3)' }}>Loading…</div>
      )}
      {(!withPeople || tab === 'template') && (
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

      )}

      {blocked && (
        <div style={{ ...warnTag, background: 'var(--bad-bg)', borderColor: 'var(--bad-line)', color: 'var(--bad)', marginTop: 16 }}>
          {blocked}
        </div>
      )}
    </DetailPage>
  );
}
