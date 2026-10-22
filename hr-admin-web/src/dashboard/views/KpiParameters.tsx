// Performance › KPI Parameters — the org's catalogue of what employees are
// scored on, laid out like the Salary Components catalogue.
//
// A parameter is a title ("Performance") and the guidance shown with it: on the
// manager's feedback form while scoring, and on the employee's own Grow page.
// Managers never author these; HR does, and templates and assignments are
// built from them.
//
// A parameter is fixed once created: templates, assignments and sent reviews
// all reference it, and a sent review has to keep reading the way it did when
// it was sent, so the wording cannot be edited. It can be deleted only while
// nothing references it in any cycle — the server is the authority on that,
// since this page only sees the current one.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useStore } from '../store';
import { Card, ListPending } from '../ui';
import type { LoadState } from '../ui';
import { IconPlus, IconSearch } from '../icons';
import {
  cancelKpiParameterEdit,
  createKpiParameter,
  deleteKpiParameter,
  listKpiAssignments,
  listKpiParameters,
  listKpiTemplates,
  updateKpiParameter,
} from '../../services/kpi';
import type { KpiParameterDTO, KpiTemplateDTO } from '../../services/kpi';
import { DetailPage, Field } from './kpiUi';
import { NameCell, Td, Th } from './lookUi';
import * as L from './look';
import { periodLabel } from '../period';
import { ghostBtn, inputStyle, panelCard, panelTitle, primaryBtn, warnTag } from './kpiLook';

/** Every parameter is scored on the same scale — the form has no other mode. */
const MAX_SCORE = 5;

type PForm = { title: string; description: string };
const blank = (): PForm => ({ title: '', description: '' });

/** How many people and templates currently reference each parameter. */
type Usage = { employees: number; templates: number };

export function KpiParameters() {
  // One source for the cycle: the store loads it from the server, since it
  // depends on the company's configured start day.
  const { cycle, cycleLoaded, listState, reload: reloadStore } = useStore();
  const [rows, setRows] = useState<KpiParameterDTO[]>([]);
  const [usage, setUsage] = useState<Map<string, Usage>>(new Map());
  /** Which templates include each parameter, so the count can be opened. */
  const [byParam, setByParam] = useState<Map<string, KpiTemplateDTO[]>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  // Once the list has loaded, a refresh keeps it on screen.
  const [loaded, setLoaded] = useState(false);
  const [search, setSearch] = useState('');
  const [form, setForm] = useState<PForm | null>(null);
  const [viewing, setViewing] = useState<KpiParameterDTO | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const [params, templates, assignments] = await Promise.all([
        listKpiParameters(),
        listKpiTemplates(),
        listKpiAssignments(cycle.period),
      ]);
      const counts = new Map<string, Usage>();
      const bump = (id: string, key: keyof Usage) => {
        const cur = counts.get(id) ?? { employees: 0, templates: 0 };
        cur[key] += 1;
        counts.set(id, cur);
      };
      const templatesFor = new Map<string, KpiTemplateDTO[]>();
      for (const a of assignments) for (const p of a.parameters) bump(p.id, 'employees');
      for (const t of templates) {
        for (const id of t.parameterIds) {
          bump(id, 'templates');
          templatesFor.set(id, [...(templatesFor.get(id) ?? []), t]);
        }
      }
      setRows(params);
      setUsage(counts);
      setByParam(templatesFor);
      setError('');
      setLoaded(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load parameters');
    } finally {
      setLoading(false);
    }
    // Re-runs once the store's real cycle lands, replacing the seeded fallback.
  }, [cycle.period]);

  // Waits for the real cycle, so the counts are never the guessed cycle's.
  useEffect(() => { if (cycleLoaded) void reload(); }, [reload, cycleLoaded]);
  const cycleState = listState('cycle');
  const listSt: LoadState = loaded ? 'ready' : cycleState === 'error' || (error && !loading) ? 'error' : 'loading';

  const q = search.trim().toLowerCase();
  const visible = useMemo(
    () => rows.filter((r) => !q || r.title.toLowerCase().includes(q) || r.description.toLowerCase().includes(q)),
    [rows, q],
  );

  async function save() {
    if (!form) return;
    if (!form.title.trim()) { setError('Please enter a parameter name'); return; }
    try {
      await createKpiParameter({
        title: form.title, description: form.description,
      });
      setForm(null);
      setError('');
      void reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save');
    }
  }

  // A full page rather than a dialog: the detail carries editable fields, a
  // usage breakdown and a destructive action, which is more than a modal should
  // hold — and the table underneath is not context anyone needs while reading it.
  if (form) {
    return (
      <AddParameterPage
        form={form}
        setForm={setForm}
        error={error}
        onBack={() => { setForm(null); setError(''); }}
        onSave={save}
      />
    );
  }

  if (viewing) {
    return (
      <ParameterDetail
        param={viewing}
        usage={usage.get(viewing.id) ?? { employees: 0, templates: 0 }}
        templates={byParam.get(viewing.id) ?? []}
        cycle={cycle}
        cycleLoaded={cycleLoaded}
        onBack={() => { setViewing(null); setError(''); }}
        onChanged={() => { setViewing(null); void reload(); }}
        onError={setError}
      />
    );
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 20 }}>
        <button onClick={() => setForm(blank())} className="lk-btn-p" style={{ ...primaryBtn, marginLeft: 'auto' }}>
          <IconPlus size={15} /> Add Parameter
        </button>
      </div>

      {error && loaded && (
        <div style={{ ...warnTag, background: 'var(--bad-bg)', borderColor: 'var(--bad-line)', color: 'var(--bad)', marginBottom: 14 }}>
          {error}
        </div>
      )}

      <Card style={L.cardPad}>
        <label className="lk-field" style={{ ...L.field, width: 218, marginBottom: 16 }}>
          <IconSearch size={15} stroke="currentColor" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search parameters…"
            style={{ width: '100%' }}
          />
        </label>
        <table className="lk-t" style={L.table}>
          <thead>
            <tr>
              <Th width="28%">Parameter</Th>
              <Th>Guidance</Th>
              <Th width={150}>In use by</Th>
              <Th width={120}>Templates</Th>
            </tr>
          </thead>
          <tbody>
            {visible.map((r) => {
              const u = usage.get(r.id) ?? { employees: 0, templates: 0 };
              return (
                <tr key={r.id} className="phm-row" onClick={() => setViewing(r)} style={{ cursor: 'pointer' }}>
                  <Td>
                    <NameCell name={r.title} tag={r.pendingEdit ? 'Edit pending' : undefined} tagTone={r.pendingEdit ? 'amber' : undefined} />
                  </Td>
                  <Td muted>{r.description || '—'}</Td>
                  <Td>
                    <span style={{ color: u.employees ? 'var(--ink)' : 'var(--ink-3)', fontVariantNumeric: 'tabular-nums' }}>
                      {u.employees}
                    </span>
                    <span style={{ color: u.employees ? 'var(--ink)' : 'var(--ink-3)' }}>
                      {u.employees === 1 ? ' employee' : ' employees'}
                    </span>
                  </Td>
                  <Td muted>
                    <span style={{ fontVariantNumeric: 'tabular-nums', color: u.templates ? 'var(--ink)' : 'var(--ink-3)' }}>
                      {u.templates}
                    </span>
                  </Td>
                </tr>
              );
            })}
            {listSt === 'ready' && visible.length === 0 && (
              <tr>
                <td colSpan={4} style={{ padding: 40, textAlign: 'center', color: 'var(--ink-3)', fontSize: 13.5 }}>
                  {q ? 'No parameters match your search.' : 'No parameters yet. Add one to start building templates.'}
                </td>
              </tr>
            )}
            {listSt !== 'ready' && (
              <tr><td colSpan={4} style={{ padding: 0 }}><ListPending state={listSt} errorText={error || undefined} onRetry={() => { if (cycleState === 'error') void reloadStore(); else void reload(); }} rows={5} cols={4} avatar={false} rowHeight={56} /></td></tr>
            )}
          </tbody>
        </table>
      </Card>

    </div>
  );
}

/** Read-only: a parameter cannot change once reviews are scored against it. */
function ParameterDetail({
  param, usage, templates, cycle, cycleLoaded, onBack, onChanged, onError,
}: {
  param: KpiParameterDTO;
  usage: Usage;
  /** The templates that include this parameter, listed when the count is opened. */
  templates: KpiTemplateDTO[];
  cycle: { period: string; next: string; startDay: number };
  cycleLoaded: boolean;
  onBack: () => void;
  onChanged: () => void;
  onError: (message: string) => void;
}) {
  const [deleting, setDeleting] = useState(false);
  const [blocked, setBlocked] = useState('');
  const [showTemplates, setShowTemplates] = useState(false);
  // Seeded from a staged edit when one exists, so re-opening shows what is
  // already scheduled rather than the wording it will replace.
  const [description, setDescription] = useState(param.pendingEdit?.description ?? param.description);
  const [saving, setSaving] = useState(false);

  const descriptionDirty = description !== param.description;
  const dirty = descriptionDirty;

  async function saveEdit() {
    setSaving(true);
    try {
      await updateKpiParameter(param.id, { description });
      onChanged();
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Could not save';
      setBlocked(message);
      setSaving(false);
    }
  }

  async function dropEdit() {
    try {
      await cancelKpiParameterEdit(param.id);
      onChanged();
    } catch (e) {
      setBlocked(e instanceof Error ? e.message : 'Could not cancel');
    }
  }
  // The counts here cover the current cycle only. Past assignments and sent
  // reviews also pin a parameter, so the server has the final say — this just
  // avoids offering an action that is obviously going to be refused.
  const inUseNow = usage.employees > 0 || usage.templates > 0;

  async function remove() {
    setDeleting(true);
    try {
      await deleteKpiParameter(param.id);
      onChanged();
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Could not delete';
      setBlocked(message);
      onError(message);
      setDeleting(false);
    }
  }

  return (
    <DetailPage
      title={param.title}
      subtitle={`In use by ${usage.employees} employee${usage.employees === 1 ? '' : 's'}`}
      backLabel="Back to parameters"
      onBack={onBack}
      width={860}
      actions={
        <>
          {/* Hidden rather than disabled: a parameter in use can never be
              deleted, so offering the action at all only invites the click. */}
          {!inUseNow && (
            <button
              onClick={remove}
              disabled={deleting}
              style={{ ...L.btnDanger, height: 40, padding: '0 16px', fontSize: 13, opacity: deleting ? 0.45 : 1 }}
            >
              {deleting ? 'Deleting…' : 'Delete parameter'}
            </button>
          )}
          {dirty && (
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
              <button onClick={onBack} className="lk-btn" style={ghostBtn}>Cancel</button>
              <button onClick={saveEdit} disabled={saving} className="lk-btn-p" style={{ ...primaryBtn, opacity: saving ? 0.6 : 1 }}>
                {saving ? 'Saving…' : 'Save change'}
              </button>
            </div>
          )}
        </>
      }
    >
      <div style={panelCard}>
        <div style={panelTitle}>Details</div>

        {param.pendingEdit && !dirty && (
          <div style={{ ...warnTag, marginBottom: 16 }}>
            <strong>Change scheduled for {periodLabel(param.pendingEdit.effectiveFrom)}.</strong> The
            wording below is what managers see until then.
            <div style={{ marginTop: 9, paddingTop: 9, borderTop: '1px solid var(--warn-line)' }}>
              <div style={{ fontSize: 12.5, fontWeight: 500, marginBottom: 2 }}>New guidance</div>
              <div style={{ fontSize: 13, lineHeight: 1.55 }}>{param.pendingEdit.description || '—'}</div>
            </div>
            <button onClick={dropEdit} className="lk-btn" style={{ ...L.btnSm, marginTop: 12 }}>
              Cancel scheduled change
            </button>
          </div>
        )}

        <ReadRow label="Parameter name" value={param.title} />

        <Field label="Guidance">
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={600}
            className="lk-in" style={{ ...inputStyle, minHeight: 120, resize: 'vertical', lineHeight: 1.5 }}
          />
          {descriptionDirty && <NextCycleNote cycle={cycle} cycleLoaded={cycleLoaded} />}
        </Field>
        <ReadRow label="Maximum score" value={String(MAX_SCORE)} />

        <div style={{ display: 'flex', gap: 26, marginTop: 4, paddingTop: 14, borderTop: '1px solid var(--line)' }}>
          
          <Stat
            label="Templates including it"
            value={usage.templates}
            onClick={templates.length ? () => setShowTemplates((open) => !open) : undefined}
            open={showTemplates}
          />
        </div>

        {showTemplates && templates.length > 0 && (
          <div style={{ marginTop: 16 }}>
            <table className="lk-t" style={L.table}>
              <thead>
                <tr>
                  <Th>Template</Th>
                  <Th width={110} right>Weight here</Th>
                  <Th width={130} right>On it now</Th>
                </tr>
              </thead>
              <tbody>
                {templates.map((t) => (
                  <tr key={t.id}>
                    <Td>
                      <span style={L.cellName}>{t.name}</span>
                      {t.description && (
                        <div style={L.cellSub}>{t.description}</div>
                      )}
                    </Td>
                    <Td right>
                      {/* What this parameter is worth inside that template —
                          the same parameter can count for more in one set. */}
                      <span style={{ fontWeight: 500, fontVariantNumeric: 'tabular-nums' }}>
                        {t.weights[param.id] ?? 0}%
                      </span>
                    </Td>
                    <Td right muted>
                      <span style={{ fontVariantNumeric: 'tabular-nums' }}>{t.employeeCount}</span>
                      <span> employees</span>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {blocked && (
          <div style={{ ...warnTag, background: 'var(--bad-bg)', borderColor: 'var(--bad-line)', color: 'var(--bad)', marginTop: 16 }}>
            {blocked}
          </div>
        )}

        <div style={{ marginTop: 16, paddingTop: 12, borderTop: '1px solid var(--line)', fontSize: 11.5, color: 'var(--ink-3)', lineHeight: 1.5 }}>
          Created by <strong style={{ color: 'var(--ink-2)', fontWeight: 500 }}>{param.createdByName ?? 'Unknown'}</strong>
          {param.createdAt && ` on ${fmtCreated(param.createdAt)}`}
        </div>
      </div>
    </DetailPage>
  );
}

/**
 * Shown under a field the moment its text differs from what is live — saying it
 * up front would claim a change nobody has made.
 */
function NextCycleNote({
  cycle, cycleLoaded,
}: {
  cycle: { next: string };
  cycleLoaded: boolean;
}) {
  return (
    <div style={{ ...warnTag, marginTop: 8 }}>
      The changes will be applied from next cycle{' '}
      {/* Held back until the real cycle lands — the seeded fallback would name
          the wrong month on a non-1st start day. */}
      <strong>{cycleLoaded ? periodLabel(cycle.next) : '…'}</strong>.
    </div>
  );
}

/** "2026-09-08T…" -> "08 Sep 2026, 14:32". */
function fmtCreated(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  return d.toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

function ReadRow({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ ...L.kvDt, marginBottom: 4 }}>{label}</div>
      <div style={{ ...L.kvDd, lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{value}</div>
      {hint && <div style={{ fontSize: 11.5, color: 'var(--ink-3)', marginTop: 5, lineHeight: 1.45 }}>{hint}</div>}
    </div>
  );
}

function Stat({
  label, value, onClick, open,
}: {
  label: string;
  value: number;
  /** Given only when there is something to open — a zero count is not a link. */
  onClick?: () => void;
  open?: boolean;
}) {
  const body = (
    <>
      <div style={{ fontSize: 24, fontWeight: 400, letterSpacing: '-.02em', lineHeight: 1.05, fontVariantNumeric: 'tabular-nums', color: onClick ? 'var(--accent-ink)' : 'var(--ink)' }}>
        {value}
      </div>
      <div style={{ fontSize: 12.5, color: 'var(--ink-2)', fontWeight: 400, marginTop: 6 }}>
        {label}{onClick && <span style={{ color: 'var(--accent-ink)' }}> {open ? '▴' : '▾'}</span>}
      </div>
    </>
  );
  if (!onClick) return <div>{body}</div>;
  return (
    <button
      onClick={onClick}
      title={open ? 'Hide the templates' : 'Show the templates'}
      style={{ border: 'none', background: 'none', padding: 0, font: 'inherit', textAlign: 'left', cursor: 'pointer' }}
    >
      {body}
    </button>
  );
}

function AddParameterPage({
  form, setForm, error, onBack, onSave,
}: {
  form: PForm;
  setForm: (f: PForm) => void;
  error: string;
  onBack: () => void;
  onSave: () => void;
}) {
  const set = <K extends keyof PForm>(k: K, v: PForm[K]) => setForm({ ...form, [k]: v });

  return (
    <DetailPage
      title="Add Parameter"
      subtitle="What a manager sees on the feedback form when scoring this."
      backLabel="Back to parameters"
      onBack={onBack}
      width={820}
      actions={
        <>
          <span style={{ fontSize: 12, color: 'var(--bad)' }}>* indicates mandatory fields</span>
          <button onClick={onSave} className="lk-btn-p" style={{ ...primaryBtn, marginLeft: 'auto' }}>Save</button>
        </>
      }
    >
      {error && (
        <div style={{ ...warnTag, background: 'var(--bad-bg)', borderColor: 'var(--bad-line)', color: 'var(--bad)', marginBottom: 14 }}>
          {error}
        </div>
      )}
      <div style={panelCard}>
        <div style={panelTitle}>Details</div>
        <Field label="Parameter Name" req>
          <input
            value={form.title}
            onChange={(e) => set('title', e.target.value)}
            placeholder="e.g. Performance"
            maxLength={80}
            autoFocus
            className="lk-in" style={inputStyle}
          />
        </Field>
        <Field label="Guidance">
          <textarea
            value={form.description}
            onChange={(e) => set('description', e.target.value)}
            placeholder="e.g. Delivers quality work consistently and on time"
            maxLength={600}
            className="lk-in" style={{ ...inputStyle, minHeight: 120, resize: 'vertical', lineHeight: 1.5 }}
          />
        </Field>
        <Field label="Maximum score">
          <input value={MAX_SCORE} disabled style={{ ...inputStyle, maxWidth: 120, background: 'var(--surface-2)', color: 'var(--ink-3)' }} />
        </Field>

        <div style={warnTag}>
          <strong>Note:</strong> The name is permanent — a sent review is labelled with it. The
          guidance can be reworded later, but any change applies from the next cycle,
          never the one managers are already scoring in.
        </div>
      </div>
    </DetailPage>
  );
}
