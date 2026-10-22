// Paid Days Templates — how attendance becomes paid days, apart from what
// someone is paid. Each company has one Default, used for anyone not given
// another; a template can skip the calendar altogether ("all days of the
// month are paid days"). People are given a template on their Salary details.
import { useEffect, useState } from 'react';
import { useStore } from '../store';
import { ApiError } from '../../services/http';
import {
  createPaidDaysTemplate,
  deletePaidDaysTemplate,
  listPaidDaysTemplates,
  makeDefaultPaidDaysTemplate,
  updatePaidDaysTemplate,
  type PaidDaysTemplateDTO,
  type PaidDaysTemplateInput,
} from '../../services/payroll';
import { Card, EmptyRow, ListPending } from '../ui';
import type { LoadState } from '../ui';
import { IconPlus } from '../icons';
import { DEDUCTION_TRIGGER_LABELS } from '../../services/payroll';
import { dangerLink, Field, ghostBtn, input, primaryBtn, ruleText, RulesCard, tableStyle, Td, Th } from './SalaryTemplates';

type Form = PaidDaysTemplateInput & { editingCode?: string; isDefault?: boolean };

const EMPTY: Form = { name: '', description: '', allDaysPaid: false, deductionRules: [], monthlyPaidLeaveDays: 0 };
// Absent days and half days always come from the calendar; a rule on them was never applied.
const CALENDAR_ONLY = new Set(['absent', 'half_day']);

/** One line for the list: what the template does. */
export function paidDaysSummary(t: Pick<PaidDaysTemplateDTO, 'allDaysPaid' | 'deductionRules' | 'monthlyPaidLeaveDays'>): string {
  if (t.allDaysPaid) return 'All days of the month are paid';
  const rules = t.deductionRules.filter((r) => r.active && !CALENDAR_ONLY.has(r.trigger));
  const parts = ['Attendance calendar', ...rules.map((r) => `${DEDUCTION_TRIGGER_LABELS[r.trigger]}: ${ruleText(r).toLowerCase()}`)];
  if (t.monthlyPaidLeaveDays > 0) parts.push(`${t.monthlyPaidLeaveDays} paid leave ${t.monthlyPaidLeaveDays === 1 ? 'day' : 'days'} a month`);
  return parts.join(' · ');
}

export function PaidDaysTemplates() {
  const { flash } = useStore();
  const [templates, setTemplates] = useState<PaidDaysTemplateDTO[]>([]);
  // Skeleton until the first load; a refresh after a save keeps the table up.
  const [state, setState] = useState<LoadState>('loading');
  const [form, setForm] = useState<Form | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const load = async () => {
    try {
      setTemplates(await listPaidDaysTemplates());
      setState('ready');
    } catch (e) {
      setState((st) => (st === 'ready' ? st : 'error'));
      flash(e instanceof ApiError ? e.message : 'Could not load paid days templates', 'error');
    }
  };
  useEffect(() => { void load(); }, []);

  const open = (t: PaidDaysTemplateDTO) => {
    setConfirmDelete(false);
    setForm({ editingCode: t.code, isDefault: t.isDefault, name: t.name, description: t.description, allDaysPaid: t.allDaysPaid, deductionRules: t.deductionRules, monthlyPaidLeaveDays: t.monthlyPaidLeaveDays });
  };
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => (f ? { ...f, [k]: v } : f));

  const save = async () => {
    if (!form) return;
    if (!form.name.trim()) return flash('Enter a name');
    setSaving(true);
    try {
      const body: PaidDaysTemplateInput = { name: form.name.trim(), description: form.description.trim(), allDaysPaid: form.allDaysPaid, deductionRules: form.deductionRules, monthlyPaidLeaveDays: form.monthlyPaidLeaveDays };
      if (form.editingCode) await updatePaidDaysTemplate(form.editingCode, body);
      else await createPaidDaysTemplate(body);
      flash(`"${body.name}" saved`);
      setForm(null);
      await load();
    } catch (e) {
      flash(e instanceof ApiError ? e.message : 'Could not save', 'error');
    } finally {
      setSaving(false);
    }
  };

  const makeDefault = async () => {
    if (!form?.editingCode) return;
    setSaving(true);
    try {
      setTemplates(await makeDefaultPaidDaysTemplate(form.editingCode));
      flash(`"${form.name}" is now the Default`);
      setForm(null);
    } catch (e) {
      flash(e instanceof ApiError ? e.message : 'Could not change the Default', 'error');
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!form?.editingCode) return;
    if (!confirmDelete) { setConfirmDelete(true); return; }
    setConfirmDelete(false);
    setSaving(true);
    try {
      await deletePaidDaysTemplate(form.editingCode);
      flash('Template deleted');
      setForm(null);
      await load();
    } catch (e) {
      flash(e instanceof ApiError ? e.message : 'Could not delete', 'error');
    } finally {
      setSaving(false);
    }
  };

  if (form) {
    return (
      <div style={{ maxWidth: 900 }}>
        <Card style={{ padding: '20px 22px', marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
            <div style={{ fontSize: 16.5, fontWeight: 500, flex: 1 }}>{form.editingCode ? form.name || 'Paid days template' : 'New paid days template'}</div>
            {form.isDefault && <DefaultBadge />}
          </div>
          <div style={{ display: 'grid', gap: 14 }}>
            <Field label="Name" required>
              <input value={form.name} maxLength={80} onChange={(e) => set('name', e.target.value)} style={input} placeholder="e.g. Field staff" />
            </Field>
            <Field label="Description">
              <textarea value={form.description} maxLength={500} rows={2} onChange={(e) => set('description', e.target.value)} style={{ ...input, resize: 'vertical', minHeight: 54 }} placeholder="Who it is for" />
            </Field>
          </div>
        </Card>
        <RulesCard
          enabled={!form.allDaysPaid}
          onEnabled={(v) => set('allDaysPaid', !v)}
          rules={form.deductionRules}
          onChange={(rules) => set('deductionRules', rules)}
          paidLeaveDays={form.monthlyPaidLeaveDays}
          onPaidLeaveDays={(v) => set('monthlyPaidLeaveDays', v)}
        />
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 18, flexWrap: 'wrap' }}>
          <button onClick={() => void save()} disabled={saving} style={primaryBtn}>{saving ? 'Saving…' : 'Save'}</button>
          <button onClick={() => setForm(null)} style={ghostBtn}>Cancel</button>
          <div style={{ flex: 1 }} />
          {form.editingCode && !form.isDefault && (
            <>
              <button onClick={() => void makeDefault()} disabled={saving} style={ghostBtn}>Make Default</button>
              <button onClick={() => void remove()} disabled={saving} style={dangerLink}>{confirmDelete ? 'Click again to delete' : 'Delete'}</button>
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <div style={{ flex: 1, fontSize: 13, color: 'var(--ink-3)' }}>
          How attendance turns into paid days. Everyone is on the <strong>Default</strong> unless given another on their Salary details.
        </div>
        <button onClick={() => { setConfirmDelete(false); setForm({ ...EMPTY }); }} style={primaryBtn}><IconPlus size={15} /> Create New</button>
      </div>
      <Card>
        {state !== 'ready' ? (
          <ListPending state={state} onRetry={() => { setState('loading'); void load(); }} rows={3} cols={3} avatar={false} rowHeight={56} />
        ) : templates.length === 0 ? (
          <EmptyRow text="No paid days templates yet." />
        ) : (
          <table style={tableStyle}>
            <thead>
              <tr><Th>Template</Th><Th>Paid days</Th><Th>People</Th></tr>
            </thead>
            <tbody>
              {templates.map((t) => (
                <tr key={t.code} onClick={() => open(t)} style={{ cursor: 'pointer' }}>
                  <Td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <strong style={{ color: 'var(--accent-ink)' }}>{t.name}</strong>
                      {t.isDefault && <DefaultBadge />}
                    </div>
                    {t.description && <div style={{ fontSize: 12.5, color: 'var(--ink-4)', marginTop: 2 }}>{t.description}</div>}
                  </Td>
                  <Td muted>{paidDaysSummary(t)}</Td>
                  <Td>{t.people}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}

function DefaultBadge() {
  return <span style={{ fontSize: 11.5, fontWeight: 500, color: 'var(--accent-ink)', background: 'var(--accent-soft)', borderRadius: 6, padding: '2px 8px' }}>Default</span>;
}
