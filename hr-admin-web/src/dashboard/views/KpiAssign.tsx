// Assigning KPIs to one person, from that person's profile.
//
// Assignment copies a template's parameters onto the employee for the cycle
// rather than pointing at the template, which is what lets HR then add or
// remove parameters for one individual. Editing a template afterwards does not
// reach back into anyone already assigned from it.
import { useCallback, useEffect, useState } from 'react';
import {
  assignKpis,
  getKpiAssignment,
  listKpiParameters,
  listKpiTemplates,
  removeKpiAssignment,
} from '../../services/kpi';
import type { KpiAssignmentDTO, KpiParameterDTO, KpiTemplateDTO } from '../../services/kpi';
import { Field, Modal } from './kpiUi';
import { WeightPicker } from './kpiWeights';
import { evenWeights, weightError } from '../weights';
import { periodLabel } from '../period';
import { MAX_PER_SET, ghostBtn, inputStyle, noteTag, panelCard, panelTitle, primaryBtn, smallBtn } from './kpiStyles';

/**
 * The KPI block on an employee's profile: what they are scored on this cycle,
 * and the way to change it. Loads its own data so the profile does not have to
 * carry KPI state for every employee it might show.
 */
export function EmployeeKpiPanel({
  userId,
  userName,
  designation,
  period,
  nextPeriod,
}: {
  userId: string;
  userName: string;
  designation: string;
  /** The live cycle — what their manager is scoring against, read-only. */
  period: string;
  /** The cycle being edited. The one in progress is frozen. */
  nextPeriod: string;
}) {
  const [params, setParams] = useState<KpiParameterDTO[]>([]);
  const [templates, setTemplates] = useState<KpiTemplateDTO[]>([]);
  const [assignment, setAssignment] = useState<KpiAssignmentDTO | null>(null);
  const [upcoming, setUpcoming] = useState<KpiAssignmentDTO | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [open, setOpen] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const [p, t, live, upcoming] = await Promise.all([
        listKpiParameters(),
        listKpiTemplates(),
        getKpiAssignment(userId, period),
        getKpiAssignment(userId, nextPeriod),
      ]);
      setParams(p);
      setTemplates(t);
      setAssignment(live);
      setUpcoming(upcoming);
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load KPIs');
    } finally {
      setLoading(false);
    }
  }, [userId, period, nextPeriod]);

  useEffect(() => { void reload(); }, [reload]);

  return (
    <>
      {open && (
        <KpiAssignModal
          userId={userId}
          userName={userName}
          userDesignation={designation}
          period={nextPeriod}
          params={params}
          templates={templates}
          existing={upcoming}
          onClose={() => setOpen(false)}
          onSaved={() => { setOpen(false); void reload(); }}
        />
      )}

      {error && <div style={{ fontSize: 14, color: '#A32B2B', fontWeight: 600, marginBottom: 10 }}>{error}</div>}

      {loading ? (
        <div style={{ fontSize: 14, color: '#9197A2' }}>Loading…</div>
      ) : (
        <>
          {/* What their manager is scoring against right now. Frozen. */}
          <CycleBlock
            label={`In effect · ${periodLabel(period)}`}
            assignment={assignment}
            templates={templates}
            empty="Nothing assigned, so their manager cannot submit a review this cycle."
          />

          {/* The editable one. Every change lands here, never in the live cycle. */}
          <div style={{ marginTop: 16, paddingTop: 14, borderTop: '1px solid #F0F0F2' }}>
            <CycleBlock
              label={`From ${periodLabel(nextPeriod)}`}
              assignment={upcoming}
              templates={templates}
              empty={`Nothing set yet. Without it they carry no KPIs into ${periodLabel(nextPeriod)}.`}
            />
            <button
              onClick={() => setOpen(true)}
              disabled={params.length === 0}
              title={params.length === 0 ? 'Create KPI parameters first' : undefined}
              style={{
                ...(upcoming ? smallBtn : primaryBtn),
                marginTop: 12, width: '100%', justifyContent: 'center', padding: '9px 12px',
                opacity: params.length === 0 ? 0.5 : 1,
              }}
            >
              {upcoming ? 'Edit next cycle KPIs' : 'Set KPIs for next cycle'}
            </button>
          </div>
        </>
      )}
    </>
  );
}

/** One cycle's assigned set, with each parameter's weight. */
function CycleBlock({
  label, assignment, templates, empty,
}: {
  label: string;
  assignment: KpiAssignmentDTO | null;
  templates: KpiTemplateDTO[];
  empty: string;
}) {
  // Where the set came from, whether it was assigned in bulk or one at a time.
  // Absent when HR built the set by hand rather than from a template.
  const source = assignment?.templateId
    ? templates.find((t) => t.id === assignment.templateId)
    : undefined;
  return (
    <>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 9, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: '.03em', color: '#717171' }}>
          {label.toUpperCase()}
        </span>
        {assignment && (
          <span style={{ background: '#EAF3F8', color: '#0571A6', borderRadius: 20, padding: '2px 9px', fontSize: 12, fontWeight: 700 }}>
            {source ? source.name : 'Custom set'}
          </span>
        )}
      </div>
      {assignment && assignment.parameters.length > 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
          {assignment.parameters.map((p) => (
            <div key={p.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14.5, fontWeight: 700 }}>{p.title}</div>
                {p.subtitle && (
                  <div style={{ fontSize: 13, color: '#717171', lineHeight: 1.45, marginTop: 1 }}>{p.subtitle}</div>
                )}
              </div>
              <span style={{ flexShrink: 0, fontSize: 13.5, fontWeight: 800, color: '#484848', fontVariantNumeric: 'tabular-nums' }}>
                {assignment.weights[p.id] ?? 0}%
              </span>
            </div>
          ))}
        </div>
      ) : (
        <div style={{ fontSize: 13.5, color: '#9197A2', lineHeight: 1.55 }}>{empty}</div>
      )}
    </>
  );
}

export function KpiAssignModal({
  userId, userName, userDesignation, period, params, templates, existing, onClose, onSaved,
}: {
  userId: string;
  userName: string;
  userDesignation: string;
  period: string;
  params: KpiParameterDTO[];
  templates: KpiTemplateDTO[];
  existing: KpiAssignmentDTO | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  // Someone already assigned keeps exactly what they have. Otherwise, if a
  // template names this person's designation, start from it — that is the
  // point of tagging templates with designations. Where several match, the
  // first wins; the dropdown marks the others. It is only a starting point:
  // nothing is saved until Save, and the set stays editable.
  const suggested = existing || !userDesignation
    ? undefined
    : templates.find((t) => t.designations.includes(userDesignation));

  const initialPicked =
    existing?.parameters.map((p) => p.id) ?? suggested?.parameterIds.slice(0, MAX_PER_SET) ?? [];
  const [picked, setPicked] = useState<string[]>(initialPicked);
  // Their own weights if assigned, else the template's, else an even split.
  const [weights, setWeights] = useState<Record<string, number>>(
    existing?.weights ?? suggested?.weights ?? (initialPicked.length ? evenWeights(initialPicked) : {}),
  );
  // An existing assignment remembers which template it came from, so show that
  // rather than "none" — the set may since have been edited for this person,
  // which is called out below the picker instead of being hidden.
  const [fromTemplate, setFromTemplate] = useState<string>(existing?.templateId ?? suggested?.id ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  function applyTemplate(id: string) {
    setFromTemplate(id);
    const t = templates.find((x) => x.id === id);
    if (!t) return;
    const ids = t.parameterIds.slice(0, MAX_PER_SET);
    setPicked(ids);
    setWeights(t.weights ?? evenWeights(ids));
  }

  // Same ids in the same order as the template it came from.
  const source = templates.find((t) => t.id === fromTemplate);
  const divergedFromTemplate =
    !!source &&
    (source.parameterIds.length !== picked.length ||
      source.parameterIds.some((id, i) => picked[i] !== id) ||
      source.parameterIds.some((id) => source.weights?.[id] !== weights[id]));

  const invalid = weightError(picked, weights);

  async function save() {
    if (invalid) { setError(invalid); return; }
    setSaving(true);
    try {
      // Always sent as an explicit list with its weights: the set may have been
      // edited after a template was applied, and that edit is the point. The
      // weights must still total 100 so this person's score stays out of 5.
      await assignKpis({ userId, period, parameterIds: picked, weights, templateId: fromTemplate || undefined });
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not assign');
      setSaving(false);
    }
  }

  return (
    <Modal
      title={existing ? 'Edit KPIs' : 'Assign KPIs'}
      subtitle={`${userName}${userDesignation ? ` · ${userDesignation}` : ''} · from ${periodLabel(period)}`}
      onClose={onClose}
      width={900}
      footer={
        <>
          {existing && (
            <button
              onClick={async () => { await removeKpiAssignment(userId, period); onSaved(); }}
              style={{ ...ghostBtn, color: '#A32B2B', marginRight: 'auto' }}
            >
              Remove assignment
            </button>
          )}
          <button onClick={onClose} style={ghostBtn}>Cancel</button>
          <button
            onClick={save}
            disabled={saving || Boolean(invalid)}
            style={{ ...primaryBtn, opacity: saving || invalid ? 0.5 : 1, cursor: invalid ? 'not-allowed' : 'pointer' }}
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </>
      }
    >
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18, alignItems: 'start' }}>
        <div style={panelCard}>
          <div style={panelTitle}>Start from a template</div>
          <Field label="Template" hint="Optional. Its parameters are copied in, and you can then add or remove them for this person only.">
            <select value={fromTemplate} onChange={(e) => applyTemplate(e.target.value)} style={inputStyle}>
              <option value="">— none —</option>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} ({t.parameterIds.length})
                  {userDesignation && t.designations.includes(userDesignation) ? ` — covers ${userDesignation}` : ''}
                </option>
              ))}
            </select>
          </Field>
          {divergedFromTemplate ? (
            <div style={{ ...noteTag, background: '#F6E9D5', color: '#8A6A20' }}>
              ⓘ&nbsp; Edited for this person — the parameters no longer match{' '}
              <strong>{source?.name}</strong>. Re-picking the template above resets them to it.
            </div>
          ) : suggested ? (
            <div style={noteTag}>
              ⓘ&nbsp; Prefilled from <strong>{suggested.name}</strong>, which covers {userDesignation}.
              Adjust on the right before saving.
            </div>
          ) : (
            <div style={noteTag}>
              ⓘ&nbsp; The cycle in progress is frozen, so this applies from {periodLabel(period)}.
              One person holds one set per cycle — saving replaces whatever they have for it.
            </div>
          )}
        </div>

        <div style={panelCard}>
          <div style={panelTitle}>Parameters and weights</div>
          <WeightPicker
            params={params}
            picked={picked}
            weights={weights}
            onChange={(nextPicked, nextWeights) => { setPicked(nextPicked); setWeights(nextWeights); }}
          />
          {error && <div style={{ color: '#A32B2B', fontWeight: 600, fontSize: 14, marginTop: 10 }}>{error}</div>}
        </div>
      </div>
    </Modal>
  );
}
