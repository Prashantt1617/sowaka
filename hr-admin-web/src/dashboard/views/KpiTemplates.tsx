// Performance › Templates — reusable, weighted sets of KPI parameters.
//
// A template is fixed once created: its parameters, their weights and its rules
// are what they were on the day it was made, so anything assigned from it can
// be traced back to a set that never moved. To change one, create a replacement
// and delete the old one.
//
// Assigning in bulk lives under Performance › Bulk Assign. Assigning one person
// happens on their own profile, where the set stays editable for them alone.
import { useEffect, useMemo, useState } from 'react';
import { useStore } from '../store';
import { Card } from '../ui';
import { IconPlus } from '../icons';
import {
  createKpiTemplate, kpiTemplateMembers, listKpiParameters, listKpiTemplates,
} from '../../services/kpi';
import type { KpiTemplateMemberDTO } from '../../services/kpi';
import { downloadCsvSections } from '../export';
import type { KpiParameterDTO, KpiTemplateDTO } from '../../services/kpi';
import { periodLabel } from '../period';
import { DetailPage, Field, NameCell, Td, Th } from './kpiUi';
import { TemplateDetailModal } from './KpiTemplateDetail';
import { inputStyle, panelCard, panelTitle, primaryBtn, smallBtn, warnTag } from './kpiStyles';
import { WeightPicker } from './kpiWeights';
import { weightError } from '../weights';

export function KpiTemplates() {
  const s = useStore();
  const [params, setParams] = useState<KpiParameterDTO[]>([]);
  const [templates, setTemplates] = useState<KpiTemplateDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [form, setForm] = useState<TForm | null>(null);
  const [viewing, setViewing] = useState<KpiTemplateDTO | null>(null);

  async function reload() {
    setLoading(true);
    try {
      const [p, t] = await Promise.all([listKpiParameters(), listKpiTemplates()]);
      setParams(p); setTemplates(t); setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load KPI data');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void reload(); }, []);

  const paramById = useMemo(() => new Map(params.map((p) => [p.id, p])), [params]);

  /**
   * Everyone on this template, as a spreadsheet.
   *
   * Weights come from each person's own assignment rather than the template,
   * so a set edited for one individual exports as what they are actually
   * scored on. Parameter columns cover every parameter anyone on the template
   * holds, which is why a person edited off one leaves that cell blank.
   */
  async function exportTemplate(t: KpiTemplateDTO) {
    try {
      // Both cycles in one file: the live one is what managers are scoring
      // against, the next is what has been scheduled. Conflating them would
      // misreport who is on the template today.
      const [live, upcoming] = await Promise.all([
        kpiTemplateMembers(t.id, s.cycle.period),
        kpiTemplateMembers(t.id, s.cycle.next),
      ]);
      const members = [...live.members, ...upcoming.members];
      if (members.length === 0) {
        setError(`Nobody is on “${t.name}” for ${periodLabel(s.cycle.period)} or ${periodLabel(s.cycle.next)}.`);
        return;
      }
      const columns = [...new Set(members.flatMap((m) => m.parameterIds))];
      downloadCsvSections<KpiTemplateMemberDTO>(
        `kpi-${t.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${s.cycle.period}`,
        [
          { header: 'Employee ID', value: (m) => m.employeeId ?? '' },
          { header: 'Employee name', value: (m) => m.name },
          { header: 'Department', value: (m) => m.department ?? '' },
          { header: 'Designation', value: (m) => m.designation ?? '' },
          { header: 'Location', value: (m) => m.location ?? '' },
          { header: 'Branch', value: (m) => m.branch ?? '' },
          { header: 'Recognition', value: (m) => m.recognition ?? '' },
          { header: 'Manager', value: (m) => m.managerName ?? '' },
          { header: 'Template', value: () => t.name },
          ...columns.map((id) => ({
            header: `${paramById.get(id)?.title ?? 'Parameter'} (weight %)`,
            value: (m: KpiTemplateMemberDTO) =>
              m.parameterIds.includes(id) ? String(m.weights[id] ?? 0) : '',
          })),
          { header: 'Total weight %', value: (m) =>
            String(m.parameterIds.reduce((sum, id) => sum + (m.weights[id] ?? 0), 0)) },
        ],
        [
          { heading: `In effect · ${periodLabel(s.cycle.period)}`, rows: live.members },
          { heading: `In effect · ${periodLabel(s.cycle.next)}`, rows: upcoming.members },
        ],
      );
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not export');
    }
  }

  async function save() {
    if (!form) return;
    if (!form.name.trim()) { setError('Please enter a template name'); return; }
    const bad = weightError(form.parameterIds, form.weights);
    if (bad) { setError(bad); return; }
    try {
      await createKpiTemplate({
        name: form.name,
        description: form.description,
        parameterIds: form.parameterIds,
        weights: form.weights,
      });
      setForm(null);
      setError('');
      void reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save');
    }
  }

  // Pages, not dialogs: both carry enough content that the list underneath is
  // noise rather than context.
  if (form) {
    return (
      <TemplateForm
        form={form}
        setForm={setForm}
        params={params}
        error={error}
        onBack={() => { setForm(null); setError(''); }}
        onSave={save}
      />
    );
  }

  if (viewing) {
    return (
      <TemplateDetailModal
        template={viewing}
        paramById={paramById}
        onBack={() => setViewing(null)}
        onDeleted={() => { setViewing(null); void reload(); }}
        onError={setError}
      />
    );
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 18 }}>
        <div style={{ fontSize: 16, color: '#717171', fontWeight: 600 }}>
          {templates.length} template{templates.length === 1 ? '' : 's'} · cycle {periodLabel(s.cycle.period)}
        </div>
        <button
          onClick={() => setForm(blankTemplate())}
          disabled={params.length === 0}
          title={params.length === 0 ? 'Create KPI parameters first' : undefined}
          style={{ ...primaryBtn, marginLeft: 'auto', opacity: params.length === 0 ? 0.5 : 1 }}
        >
          <IconPlus size={15} /> Add Template
        </button>
      </div>

      {error && (
        <div style={{ ...warnTag, background: '#F7E4E4', borderColor: '#E8C9C9', color: '#A32B2B', marginBottom: 14 }}>
          {error}
        </div>
      )}

      <Card>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 16 }}>
          <thead>
            <tr>
              <Th>Template</Th>
              <Th width={230}>Employees using it</Th>
              <Th width={120} right>{' '}</Th>
            </tr>
          </thead>
          <tbody>
            {templates.map((t) => (
              <tr key={t.id} className="phm-row" onClick={() => setViewing(t)} style={{ cursor: 'pointer' }}>
                <Td>
                  <NameCell name={t.name} />
                  {t.description && (
                    <div style={{ fontSize: 13.5, color: '#717171', marginTop: 3, lineHeight: 1.45 }}>{t.description}</div>
                  )}
                </Td>
                <Td>
                  <span style={{ fontWeight: 800, fontVariantNumeric: 'tabular-nums', color: t.employeeCount ? '#222222' : '#9197A2' }}>
                    {t.employeeCount}
                  </span>
                  <span style={{ fontSize: 14, color: '#9197A2' }}>
                    {t.employeeCount === 1 ? ' employee' : ' employees'}
                  </span>
                </Td>
                <Td right>
                  <button
                    onClick={(e) => { e.stopPropagation(); void exportTemplate(t); }}
                    disabled={t.employeeCount === 0 && t.upcomingCount === 0}
                    title={t.employeeCount === 0 && t.upcomingCount === 0 ? 'Nobody is on this template yet' : 'Export the people on it'}
                    style={{ ...smallBtn, opacity: t.employeeCount === 0 && t.upcomingCount === 0 ? 0.45 : 1 }}
                  >
                    Export
                  </button>
                </Td>
              </tr>
            ))}
            {!loading && templates.length === 0 && (
              <tr>
                <td colSpan={3} style={{ padding: '26px 14px', textAlign: 'center', color: '#717171', fontSize: 15 }}>
                  {params.length === 0
                    ? 'Create KPI parameters first, then group them into templates.'
                    : 'No templates yet.'}
                </td>
              </tr>
            )}
            {loading && (
              <tr><td colSpan={2} style={{ padding: '26px 14px', textAlign: 'center', color: '#717171', fontSize: 15 }}>Loading…</td></tr>
            )}
          </tbody>
        </table>
      </Card>

    </div>
  );
}

// —— Authoring ————————————————————————————————————————————————————————————

type TForm = {
  name: string;
  description: string;
  parameterIds: string[];
  weights: Record<string, number>;
};

const blankTemplate = (): TForm => ({ name: '', description: '', parameterIds: [], weights: {} });

function TemplateForm({
  form, setForm, params, error, onBack, onSave,
}: {
  form: TForm;
  setForm: (f: TForm) => void;
  params: KpiParameterDTO[];
  error: string;
  onBack: () => void;
  onSave: () => void;
}) {
  const set = <K extends keyof TForm>(k: K, v: TForm[K]) => setForm({ ...form, [k]: v });
  const invalid = weightError(form.parameterIds, form.weights);

  return (
    <DetailPage
      title="Add Template"
      backLabel="Back to templates"
      onBack={onBack}
      width={1040}
      actions={
        <>
          <span style={{ fontSize: 13, color: '#A8475F' }}>* indicates mandatory fields</span>
          <button
            onClick={onSave}
            disabled={Boolean(invalid)}
            style={{ ...primaryBtn, marginLeft: 'auto', opacity: invalid ? 0.5 : 1, cursor: invalid ? 'not-allowed' : 'pointer' }}
          >
            Save
          </button>
        </>
      }
    >
      {error && (
        <div style={{ ...warnTag, background: '#F7E4E4', borderColor: '#E8C9C9', color: '#A32B2B', marginBottom: 14 }}>
          {error}
        </div>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18, alignItems: 'start' }}>
        <div style={panelCard}>
          <div style={panelTitle}>Details</div>
          <Field label="Template Name" req>
            <input value={form.name} onChange={(e) => set('name', e.target.value)} maxLength={80} autoFocus style={inputStyle} />
          </Field>
          <Field label="Description">
            <input value={form.description} onChange={(e) => set('description', e.target.value)} maxLength={160} style={inputStyle} />
          </Field>
        </div>

        <div style={panelCard}>
          <div style={panelTitle}>Parameters and weights</div>
          <WeightPicker
            params={params}
            picked={form.parameterIds}
            weights={form.weights}
            onChange={(parameterIds, weights) => setForm({ ...form, parameterIds, weights })}
          />
        </div>
      </div>

    </DetailPage>
  );
}
