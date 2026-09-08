// Performance › Bulk Assign — put one template on a group, in three steps.
//
// Everything here lands in the *next* cycle. The cycle in progress is frozen:
// a manager scoring right now must not have the parameters move underneath
// them, and two managers in one cycle must not be judging against different
// sets. The server refuses a past or current period outright.
//
//   1. Build the rules that pick the group out.
//   2. Review who they matched, and what each person already has.
//   3. Choose the template, and assign it to the ones ticked.
//
// The rules are built here rather than read off a template: which people you
// want and which template they should get are separate decisions, and pairing
// them at the end is what makes overwriting somebody's current set a visible
// choice rather than a side effect.
import { useState } from 'react';
import { useStore } from '../store';
import { Card } from '../ui';
import {
  assignTemplateToUsers, listKpiParameters, listKpiTemplates, resolveKpiAudience,
} from '../../services/kpi';
import type {
  KpiAudienceRowDTO, KpiParameterDTO, KpiTargeting, KpiTemplateDTO,
} from '../../services/kpi';
import { downloadCsv } from '../export';
import { periodLabel } from '../period';
import { NameCell, Td, Th } from './kpiUi';
import { TemplateDetailModal } from './KpiTemplateDetail';
import { ghostBtn, inputStyle, panelCard, panelTitle, primaryBtn, smallBtn, warnTag } from './kpiStyles';
import {
  andLabel, EMPTY_TARGET, FACETS, matchEmployees, optionsFor, queryCode, targetSummary,
} from '../kpiTargeting';
import type { FacetDef, FacetKey } from '../kpiTargeting';
import { RuleRow } from './kpiRuleRow';

type Step = 'rules' | 'people' | 'template';

const PAGE_SIZE = 10;

/** Shown against anyone whose set assigning would overwrite. */
const REPLACE_HINT =
  'Already has a template assigned. Proceeding replaces their performance template.';

export function KpiBulkAssign() {
  const s = useStore();
  const [step, setStep] = useState<Step>('rules');
  const [target, setTarget] = useState<KpiTargeting>(EMPTY_TARGET);
  /**
   * Which rules are on screen, kept apart from their values.
   *
   * A facet with no values places no constraint, so it cannot double as "this
   * rule exists" — without this a freshly added rule would have to be given a
   * value immediately just to stay visible.
   */
  const [ruleKeys, setRuleKeys] = useState<FacetKey[]>([]);
  const [page, setPage] = useState(1);
  const [audience, setAudience] = useState<KpiAudienceRowDTO[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [templates, setTemplates] = useState<KpiTemplateDTO[]>([]);
  const [params, setParams] = useState<KpiParameterDTO[]>([]);
  const [templateId, setTemplateId] = useState('');
  /** Template whose detail card is open — inspecting is not the same as picking. */
  const [inspecting, setInspecting] = useState<KpiTemplateDTO | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState('');

  const setFacet = (key: FacetKey, values: string[]) =>
    setTarget((cur) => ({ ...cur, [key]: values }));

  const addRule = (key: FacetKey) => setRuleKeys((cur) => [...cur, key]);
  const removeRule = (key: FacetKey) => {
    setRuleKeys((cur) => cur.filter((k) => k !== key));
    setFacet(key, []);
  };

  // The roster arrives with the store, and this cluster is slow — until it
  // lands, an empty match is "not loaded yet", not "nobody qualifies".
  const rosterReady = s.loaded && s.emps.length > 0;
  const preview = matchEmployees(s.emps, target);
  const activeFacets = FACETS.filter((f) => ruleKeys.includes(f.key));
  const unusedFacets = FACETS.filter((f) => !ruleKeys.includes(f.key));
  // A rule with nothing chosen filters nothing, so say so rather than letting
  // the count silently include everyone.
  const emptyRules = activeFacets.filter((f) => target[f.key].length === 0);

  async function findPeople() {
    setBusy(true);
    try {
      const rows = await resolveKpiAudience(target, s.cycle.next);
      setAudience(rows);
      setPage(1);
      setSelected(new Set(rows.map((r) => r.userId)));
      setError('');
      setStep('people');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not resolve the rules');
    } finally {
      setBusy(false);
    }
  }

  async function toTemplateStep() {
    setBusy(true);
    try {
      const [t, p] = await Promise.all([listKpiTemplates(), listKpiParameters()]);
      setTemplates(t);
      setParams(p);
      setError('');
      setStep('template');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load templates');
    } finally {
      setBusy(false);
    }
  }

  async function assign() {
    if (!templateId) { setError('Pick a template to assign'); return; }
    setBusy(true);
    try {
      const result = await assignTemplateToUsers(templateId, assignIds, s.cycle.next);
      const name = templates.find((t) => t.id === templateId)?.name ?? 'Template';
      setDone(`“${name}” assigned to ${result.assigned} employee${result.assigned === 1 ? '' : 's'} for ${periodLabel(s.cycle.next)}.`);
      setError('');
      void s.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not assign');
    } finally {
      setBusy(false);
    }
  }

  /**
   * What was assigned, as a spreadsheet.
   *
   * Carries the identity columns, every facet the rules filtered on, and one
   * column per parameter holding its weight — so the file is a standalone
   * record of who was assigned what, and on what basis.
   */
  function exportAssigned() {
    const template = templates.find((t) => t.id === templateId);
    if (!template) return;
    const titleById = new Map(params.map((p) => [p.id, p.title]));
    const rows = audience.filter((a) => assignIds.includes(a.userId));
    const usedFacets = FACETS.filter((f) => target[f.key].length > 0);

    downloadCsv<KpiAudienceRowDTO>(
      `kpi-assignment-${template.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${s.cycle.next}`,
      [
        { header: 'Employee ID', value: (r) => r.employeeId ?? '' },
        { header: 'Employee name', value: (r) => r.name },
        { header: 'Department', value: (r) => r.department ?? '' },
        { header: 'Designation', value: (r) => r.designation ?? '' },
        { header: 'Location', value: (r) => r.location ?? '' },
        { header: 'Manager', value: (r) => r.managerName ?? '' },
        // Only the facets actually used, so the file records the basis.
        ...usedFacets.map((f) => ({
          header: `Matched on ${f.label}`,
          value: (r: KpiAudienceRowDTO) => valueFor(f, r),
        })),
        { header: 'Previous template', value: (r) => r.currentTemplateName ?? (r.parameterCount ? 'Custom set' : 'None') },
        { header: 'Cycle', value: () => s.cycle.next },
        { header: 'Template', value: () => template.name },
        ...template.parameterIds.map((id) => ({
          header: `${titleById.get(id) ?? 'Parameter'} (weight %)`,
          value: () => String(template.weights[id] ?? 0),
        })),
        { header: 'Total weight %', value: () => String(
          template.parameterIds.reduce((sum, id) => sum + (template.weights[id] ?? 0), 0),
        ) },
      ],
      rows,
    );
  }

  /**
   * Backward navigation only — the strip cannot move forward, because each
   * forward hop has to run work first (resolving the rules, loading the
   * templates) and that belongs on an explicit button, not a breadcrumb.
   */
  async function goTo(target: Step) {
    if (target === step || busy) return;
    if (target === 'rules') { setStep('rules'); return; }
    if (target === 'people') {
      if (audience.length > 0) { setStep('people'); return; }
      await findPeople();
      return;
    }
    await toTemplateStep();
  }

  /** Why the next step cannot be reached yet, or empty when it can. */
  function blockedReason(target: Step): string {
    if (target === 'people' && audience.length === 0) {
      if (!rosterReady) return 'Employees are still loading';
      if (preview.length === 0) return 'No employees match these rules yet';
    }
    if (target === 'template') {
      if (audience.length === 0) return 'Find the people first';
      if (assignIds.length === 0) return 'Select at least one employee';
    }
    return '';
  }

  function restart() {
    setStep('rules');
    setTarget(EMPTY_TARGET);
    setRuleKeys([]);
    setAudience([]);
    setSelected(new Set());
    setTemplateId('');
    setDone('');
    setError('');
  }

  // People already on something lead the list: assigning replaces what they
  // have, so they are the rows worth reading before confirming. Everyone is
  // toggleable — an unassigned person is still a choice, just a cheaper one.
  const ordered = [...audience].sort((a, b) => {
    const weight = (row: KpiAudienceRowDTO) => (hasSomething(row) ? 0 : 1);
    return weight(a) - weight(b) || a.name.localeCompare(b.name);
  });
  const assignIds = ordered.filter((a) => selected.has(a.userId)).map((a) => a.userId);

  // Paged rather than one long scroll: the people already on a template sort
  // first, and a scroll hides where that group ends.
  const pageCount = Math.max(1, Math.ceil(ordered.length / PAGE_SIZE));
  const curPage = Math.min(page, pageCount);
  const pageRows = ordered.slice((curPage - 1) * PAGE_SIZE, curPage * PAGE_SIZE);

  const toggle = (userId: string) =>
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });

  const overwriting = ordered.filter((a) => selected.has(a.userId) && hasSomething(a)).length;

  if (inspecting) {
    return (
      <TemplateDetailModal
        template={inspecting}
        paramById={new Map(params.map((p) => [p.id, p]))}
        onBack={() => setInspecting(null)}
      />
    );
  }

  if (done) {
    return (
      <div style={{ maxWidth: 640 }}>
        <Card style={{ padding: 28, textAlign: 'center' }}>
          <div style={{ fontSize: 20, fontWeight: 800, marginBottom: 8 }}>Assigned</div>
          <div style={{ fontSize: 15.5, color: '#484848', lineHeight: 1.6, marginBottom: 20 }}>{done}</div>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
            <button onClick={exportAssigned} style={ghostBtn}>Export as CSV</button>
            <button onClick={restart} style={primaryBtn}>Start another</button>
          </div>
          <div style={{ background: '#EAF2FB', color: '#3C6E9E', borderRadius: 10, padding: '12px 14px', fontSize: 13.5, lineHeight: 1.55, marginTop: 18, textAlign: 'left' }}>
            <strong>Takes effect from {periodLabel(s.cycle.next)}.</strong> The cycle in progress
            is frozen, so managers scoring right now keep the parameters they started with. These
            appear on the feedback form when the next cycle opens.
          </div>
          <div style={{ fontSize: 13, color: '#9197A2', marginTop: 12, lineHeight: 1.5, textAlign: 'left' }}>
            The export carries employee ID, name, department, designation, manager, the filters
            that matched them, and each parameter's weight.
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div>
      <Steps step={step} busy={busy} onGo={goTo} />

      {error && (
        <div style={{ ...warnTag, background: '#F7E4E4', borderColor: '#E8C9C9', color: '#A32B2B', marginBottom: 14 }}>
          {error}
        </div>
      )}

      {/* —— 1. Rules ——————————————————————————————————————————————————— */}
      {step === 'rules' && (
        <div style={panelCard}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
            <div style={panelTitle}>Who are you assigning to?</div>
            <div style={{ marginLeft: 'auto', fontSize: 14, fontWeight: 700, color: !rosterReady ? '#9197A2' : preview.length ? '#4F7A52' : '#A8475F' }}>
              {rosterReady ? `${preview.length} of ${s.emps.length} employees match` : 'Loading employees…'}
            </div>
          </div>
          <div style={{ fontSize: 13, color: '#717171', marginBottom: 14, lineHeight: 1.5 }}>
            This assigment will be applied from the next cycle.
          </div>

          {activeFacets.map((f, i) => (
            <RuleRow
              key={f.key}
              facet={f}
              first={i === 0}
              values={target[f.key]}
              options={optionsFor(f, s.emps)}
              emps={s.emps}
              onChange={(v: string[]) => setFacet(f.key, v)}
              onRemove={() => removeRule(f.key)}
            />
          ))}

          {unusedFacets.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: activeFacets.length ? 12 : 0 }}>
              <span style={{ ...andLabel, marginTop: 0, visibility: activeFacets.length ? 'visible' : 'hidden' }}>AND</span>
              <select
                value=""
                onChange={(e) => {
                  const f = FACETS.find((x) => x.key === e.target.value);
                  // Added empty — choosing the value is the next step, not a default.
                  if (f) addRule(f.key);
                }}
                style={{ ...inputStyle, maxWidth: 280 }}
              >
                <option value="">+ Add a rule…</option>
                {unusedFacets.map((f) => {
                  const n = optionsFor(f, s.emps).length;
                  return (
                    <option key={f.key} value={f.key} disabled={n === 0}>
                      {f.label}{n === 0 ? ' — no values on the roster' : ` (${n})`}
                    </option>
                  );
                })}
              </select>
            </div>
          )}

          <div style={{ marginTop: 16, paddingTop: 14, borderTop: '1px solid #EBEBEB' }}>
            <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: '.03em', color: '#717171', marginBottom: 7 }}>
              RESULTING RULE
            </div>
            <code style={{ ...queryCode, display: 'block', padding: '11px 13px', background: '#F7F7F9', borderRadius: 10, lineHeight: 1.7 }}>
              {targetSummary(target, s.emps)}
            </code>
            {emptyRules.length > 0 && (
              <div style={{ fontSize: 13, color: '#9A6B25', fontWeight: 600, marginTop: 9 }}>
                {emptyRules.map((f) => f.label).join(' and ')}{' '}
                {emptyRules.length === 1 ? 'has' : 'have'} no value chosen yet, so{' '}
                {emptyRules.length === 1 ? 'it is' : 'they are'} not narrowing anything.
              </div>
            )}
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 18 }}>
            <button
              onClick={() => void goTo('people')}
              disabled={busy || Boolean(blockedReason('people'))}
              title={blockedReason('people') || undefined}
              style={{ ...primaryBtn, opacity: busy || blockedReason('people') ? 0.5 : 1 }}
            >
              {busy ? 'Finding…' : `Continue with ${preview.length}`}
            </button>
          </div>
        </div>
      )}

      {/* —— 2. People ——————————————————————————————————————————————————— */}
      {step === 'people' && (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 11, marginBottom: 11 }}>
            <div style={{ fontSize: 16, color: '#717171', fontWeight: 600 }}>
              {assignIds.length} of {audience.length} selected
            </div>
            <button
              onClick={() => setSelected(
                selected.size === audience.length ? new Set() : new Set(audience.map((a) => a.userId)),
              )}
              style={{ ...smallBtn, marginLeft: 'auto' }}
            >
              {selected.size === audience.length ? 'Deselect all' : 'Select all'}
            </button>
          </div>

          <Card>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 16 }}>
              <thead>
                <tr>
                  <Th width={44}>{' '}</Th>
                  <Th>Employee</Th>
                  {FACETS.filter((f) => target[f.key].length > 0).map((f) => (
                    <Th key={f.key} width="13%">{f.label}</Th>
                  ))}
                  <Th width={200}>Current template</Th>
                </tr>
              </thead>
              <tbody>
                {pageRows.map((a) => {
                  const on = selected.has(a.userId);
                  return (
                    <tr
                      key={a.userId}
                      className="phm-row"
                      onClick={() => toggle(a.userId)}
                      style={{ cursor: 'pointer', background: on ? '#F4FAFD' : '#fff' }}
                    >
                      <Td>
                        <span style={{ display: 'flex', width: 18, height: 18, borderRadius: 5, border: `1.5px solid ${on ? '#0571A6' : '#C7CBD2'}`, background: on ? '#0571A6' : '#fff', color: '#fff', alignItems: 'center', justifyContent: 'center', fontSize: 12 }}>
                          {on ? '✓' : ''}
                        </span>
                      </Td>
                      <Td>
                        <NameCell name={a.name} />
                        {a.employeeId && (
                          <span style={{ fontSize: 13, color: '#9197A2', marginLeft: 8 }}>{a.employeeId}</span>
                        )}
                      </Td>
                      {FACETS.filter((f) => target[f.key].length > 0).map((f) => (
                        <Td key={f.key} muted>
                          <span style={{ fontSize: 14.5, color: '#717171' }}>{valueFor(f, a) || '—'}</span>
                        </Td>
                      ))}
                      <Td>
                        {a.currentTemplateName ? (
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                            <ReplaceTip />
                            <span style={{ fontSize: 14, fontWeight: 700, color: '#9A6B25' }}>
                              {a.currentTemplateName}
                            </span>
                          </span>
                        ) : a.parameterCount > 0 ? (
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                            <ReplaceTip />
                            <span style={{ fontSize: 14, color: '#9A6B25', fontWeight: 700 }}>
                              {a.parameterCount} custom KPIs
                            </span>
                          </span>
                        ) : (
                          <span style={{ fontSize: 14, color: '#9197A2' }}>None</span>
                        )}
                      </Td>
                    </tr>
                  );
                })}
                {audience.length === 0 && (
                  <tr>
                    <td colSpan={9} style={{ padding: '26px 14px', textAlign: 'center', color: '#717171', fontSize: 15 }}>
                      Nobody matched those rules.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </Card>

          <Pager page={curPage} pageCount={pageCount} total={ordered.length} onPage={setPage} />

          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
            <button
              onClick={() => void goTo('template')}
              disabled={busy || Boolean(blockedReason('template'))}
              title={blockedReason('template') || undefined}
              style={{ ...primaryBtn, opacity: busy || blockedReason('template') ? 0.5 : 1 }}
            >
              {busy ? 'Loading…' : 'Select a template →'}
            </button>
          </div>
        </>
      )}

      {/* —— 3. Template ————————————————————————————————————————————————— */}
      {step === 'template' && (
        <>
          <div style={{ fontSize: 16, color: '#717171', fontWeight: 600, marginBottom: 14 }}>
            Assigning to <strong style={{ color: '#222222' }}>{assignIds.length} employees</strong> for{' '}
            {periodLabel(s.cycle.next)}
            {overwriting > 0 && (
              <span style={{ color: '#9A6B25', fontWeight: 700 }}>
                {' '}· {overwriting} will have their current set replaced
              </span>
            )}
          </div>

          <Card>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 16 }}>
              <thead>
                <tr>
                  <Th width={44}>{' '}</Th>
                  <Th>Template</Th>
                  <Th width={190}>Employees using it</Th>
                </tr>
              </thead>
              <tbody>
                {templates.map((t) => {
                  const on = templateId === t.id;
                  return (
                    <tr key={t.id} className="phm-row" onClick={() => setTemplateId(t.id)} style={{ cursor: 'pointer', background: on ? '#F4FAFD' : '#fff' }}>
                      <Td>
                        <span style={{ display: 'flex', width: 17, height: 17, borderRadius: '50%', border: `1.5px solid ${on ? '#0571A6' : '#C7CBD2'}`, alignItems: 'center', justifyContent: 'center' }}>
                          {on && <span style={{ width: 9, height: 9, borderRadius: '50%', background: '#0571A6' }} />}
                        </span>
                      </Td>
                      <Td>
                        <button
                          onClick={(e) => { e.stopPropagation(); setInspecting(t); }}
                          title="See its parameters and weights"
                          style={{ border: 'none', background: 'none', padding: 0, font: 'inherit', cursor: 'pointer', textAlign: 'left' }}
                        >
                          <NameCell name={t.name} />
                        </button>
                      </Td>
                      <Td muted>
                        <span style={{ fontWeight: 700, color: t.employeeCount ? '#222222' : '#9197A2', fontVariantNumeric: 'tabular-nums' }}>
                          {t.employeeCount}
                        </span>
                        <span style={{ fontSize: 14, color: '#9197A2' }}>
                          {t.employeeCount === 1 ? ' employee' : ' employees'}
                        </span>
                      </Td>
                    </tr>
                  );
                })}
                {templates.length === 0 && (
                  <tr>
                    <td colSpan={3} style={{ padding: '26px 14px', textAlign: 'center', color: '#717171', fontSize: 15 }}>
                      No templates yet. Create one under Performance › Templates.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </Card>

          <div style={{ fontSize: 13, color: '#9197A2', marginTop: 10 }}>
            Click a template's name to see its parameters and weights before picking it.
          </div>

          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 16 }}>
            <button
              onClick={assign}
              disabled={busy || !templateId}
              style={{ ...primaryBtn, opacity: busy || !templateId ? 0.5 : 1 }}
            >
              {busy ? 'Assigning…' : `Assign to ${assignIds.length}`}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

/** True when the person already holds KPIs — a template's, or a custom set. */
const hasSomething = (a: KpiAudienceRowDTO): boolean =>
  Boolean(a.currentTemplateId) || a.parameterCount > 0;

/**
 * The replace warning, as a hover bubble in front of the person it concerns.
 *
 * Rendered rather than a `title` attribute: the native tooltip waits about a
 * second, cannot be styled, and is easy to miss on a row you are only scanning.
 */
function ReplaceTip() {
  const [open, setOpen] = useState(false);
  return (
    <span
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onClick={(e) => e.stopPropagation()}
      style={{ position: 'relative', display: 'inline-flex', flexShrink: 0 }}
    >
      <span
        style={{
          width: 17, height: 17, borderRadius: '50%', background: '#F6E9D5', color: '#9A6B25',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 11.5, fontWeight: 800, cursor: 'help',
        }}
      >
        !
      </span>
      {open && (
        <span
          role="tooltip"
          style={{
            position: 'absolute', left: '50%', bottom: '140%', transform: 'translateX(-50%)',
            width: 232, background: '#222222', color: '#fff', borderRadius: 9,
            padding: '9px 11px', fontSize: 12.5, fontWeight: 500, lineHeight: 1.5,
            zIndex: 5, boxShadow: '0 6px 18px rgba(0,0,0,.22)', textAlign: 'left',
          }}
        >
          {REPLACE_HINT}
        </span>
      )}
    </span>
  );
}

function Pager({
  page, pageCount, total, onPage,
}: {
  page: number;
  pageCount: number;
  total: number;
  onPage: (page: number) => void;
}) {
  if (total === 0) return null;
  const from = (page - 1) * PAGE_SIZE + 1;
  const to = Math.min(total, page * PAGE_SIZE);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 14 }}>
      <div style={{ fontSize: 14, color: '#717171', fontWeight: 600 }}>
        Showing {from}–{to} of {total}
      </div>
      {pageCount > 1 && (
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}>
          <button onClick={() => onPage(page - 1)} disabled={page === 1} style={pageBtn(page === 1)}>
            ← Prev
          </button>
          {Array.from({ length: pageCount }, (_, i) => i + 1).map((p) => (
            <button
              key={p}
              onClick={() => onPage(p)}
              style={{
                minWidth: 32, height: 32, borderRadius: 9, fontSize: 14, fontWeight: 700,
                cursor: 'pointer',
                border: `1px solid ${p === page ? '#0571A6' : '#EBEBEB'}`,
                background: p === page ? '#0571A6' : '#fff',
                color: p === page ? '#fff' : '#484848',
              }}
            >
              {p}
            </button>
          ))}
          <button onClick={() => onPage(page + 1)} disabled={page === pageCount} style={pageBtn(page === pageCount)}>
            Next →
          </button>
        </div>
      )}
    </div>
  );
}

const pageBtn = (off: boolean) => ({
  ...smallBtn,
  color: off ? '#9197A2' : '#484848',
  background: off ? '#F7F7F9' : '#fff',
  cursor: off ? 'not-allowed' : 'pointer',
});

/** The employee's value for a facet, for the columns the rules filtered on. */
function valueFor(f: FacetDef, row: KpiAudienceRowDTO): string {
  switch (f.key) {
    case 'locations': return row.location ?? '';
    case 'designations': return row.designation ?? '';
    case 'departments': return row.department ?? '';
    case 'managerUserIds': return row.managerName ?? '';
    default: return '';
  }
}

/** The step strip, which is also how you move between steps. */
function Steps({
  step, busy, onGo,
}: {
  step: Step;
  busy: boolean;
  onGo: (target: Step) => void;
}) {
  const items: { key: Step; label: string }[] = [
    { key: 'rules', label: 'Build the rules' },
    { key: 'people', label: 'Review the people' },
    { key: 'template', label: 'Pick a template' },
  ];
  const at = items.findIndex((i) => i.key === step);

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 18, flexWrap: 'wrap' }}>
      {items.map((item, i) => {
        const state = i < at ? 'done' : i === at ? 'now' : 'todo';
        // Only completed steps are clickable: going forward runs work, which
        // belongs on the buttons below.
        const disabled = state !== 'done' || busy;
        return (
          <span key={item.key} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button
              onClick={() => onGo(item.key)}
              disabled={disabled}
              title={disabled ? undefined : `Back to ${item.label.toLowerCase()}`}
              style={{
                display: 'flex', alignItems: 'center', gap: 8, border: 'none', background: 'none',
                padding: '4px 2px', font: 'inherit',
                cursor: disabled ? 'default' : 'pointer',
              }}
            >
              <span
                style={{
                  width: 22, height: 22, borderRadius: '50%', display: 'flex',
                  alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 800,
                  background: state === 'todo' ? '#F0F0F2' : '#0571A6',
                  color: state === 'todo' ? '#9197A2' : '#fff',
                }}
              >
                {state === 'done' ? '✓' : i + 1}
              </span>
              <span
                style={{
                  fontSize: 15,
                  fontWeight: state === 'now' ? 800 : 600,
                  color: state === 'now' ? '#222222' : state === 'todo' ? '#9197A2' : '#0571A6',
                  // `disabled` already covers the current step, so anything
                  // still clickable here is a step you can navigate to.
                  textDecoration: disabled ? 'none' : 'underline',
                  textUnderlineOffset: 3,
                }}
              >
                {item.label}
              </span>
            </button>
            {i < items.length - 1 && <span style={{ color: '#C7CBD2' }}>→</span>}
          </span>
        );
      })}
      {busy && <span style={{ fontSize: 14, color: '#717171', fontWeight: 600 }}>Working…</span>}
    </div>
  );
}
