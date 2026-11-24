// People › Import from Suwi: HR attaches a sheet of joiners or changes ("Import these 30 joiners") and
// Suwi reads it through the dashboard's own import planner (employeeImport.service: the same matching by
// Employee ID / work email, the same skipped cells and rows), with the import risk check (importRisk.ts)
// on top. people_import_plan only reads; prepare_people_import stores the preview exactly as the Import
// page's upload does and puts it on a card, whose Confirm applies it through applyImport (refused if anyone
// in it changed since). No values are shown to the model, only counts, names and which fields change, so
// bank, PAN and salary columns never reach it. No Undo: an import has no inverse on the dashboard either.
import { applyImport, planImport, previewImport, type ImportPlan } from '../../services/employeeImport.service';
import { importRisks, ruleSummary, type ImportRisk } from '../importRisk';
import { defineTools, SuwiContext } from '../tools';
import { defineExecutor, propose } from '../proposals';

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const STATUS = { new: 'New employee', updated: 'Updated', unchanged: 'No change', 'not imported': 'Not imported' } as const;

function sheetRows(ctx: SuwiContext) {
  const s = ctx.sheet;
  if (!s) throw new Error('Attach the spreadsheet first (the paperclip in the Suwi panel): People › Import reads one row per person, matched by Employee ID or work email.');
  if (!s.records?.length) throw new Error(`"${s.file}" has no rows Suwi can read for an import`);
  return { file: s.file, rows: s.records };
}

const mappingOf = (v: unknown) => (v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, string> : undefined);
const rowsOf = (v: unknown) => (Array.isArray(v) ? v.map(Number).filter((n) => Number.isInteger(n) && n > 0) : []);

/** The plan in words, for the model: counts, risks and the rows that need HR, never a value. */
function planFacts(plan: ImportPlan, risks: ImportRisk[], skipRows: number[]) {
  const skip = new Set(skipRows);
  const rows = plan.rows.filter((r) => !skip.has(r.row));
  return {
    columnsRead: plan.columns.map((c) => `${c.from} → ${c.label}`),
    ignoredColumns: plan.ignoredColumns,
    newEmployees: rows.filter((r) => r.status === 'new').length,
    updated: rows.filter((r) => r.status === 'updated').length,
    unchanged: plan.unchanged,
    notImported: plan.errors.filter((e) => e.row > 0 && !skip.has(e.row)).map((e) => ({ row: e.row, why: e.message })).slice(0, 20),
    skippedCells: plan.skippedCells.filter((c) => !skip.has(c.row)).map((c) => ({ row: c.row, who: c.name, column: c.column || c.label, why: c.message })).slice(0, 20),
    blocked: plan.errors.find((e) => e.row === 0)?.message ?? null,
    risks: risks.map((r) => ({ level: r.level, text: r.text, examples: r.people })),
    riskSummary: ruleSummary(plan, risks),
    notes: plan.notes,
    accountLimit: plan.accountLimit,
    ...(skipRows.length ? { leftOutByHr: skipRows } : {}),
  };
}

/** Which fields change for an updated row, never their values. */
const changedFields = (plan: ImportPlan, row: number) => plan.updates.find((u) => u.row === row)?.changes.map((c) => c.label).join(', ') ?? '';

const INPUT = {
  type: 'object',
  properties: {
    emptyRemoves: { type: 'boolean', description: 'An empty cell removes the value the person has (default false: empty cells are left alone). Only when HR says so.' },
    skipRows: { type: 'array', items: { type: 'number' }, description: 'Sheet row numbers to leave out' },
    mapping: { type: 'object', description: 'Only when HR corrects a column: { "sheet header": field key, or "" to ignore that column }' },
  },
};

defineTools(
  {
    name: 'people_import_plan',
    area: 'people',
    label: () => 'What the attached sheet would import',
    description: 'Read the spreadsheet HR attached as a People › Import file and say what importing it would do, without saving anything: which columns are read as what, how many new employees and updated people, rows not imported and cells skipped (with row numbers and why), and the import risks (people losing a manager, emails or employee IDs changing, values removed, new people with no manager, the account limit). Use for "what would this sheet change?". To actually import it use prepare_people_import. Not for assigning a shift/department/template to the people in a sheet (that is prepare_bulk_assign with fromSheet).',
    input_schema: INPUT,
    api: { method: 'POST', path: '/admin/employees/import/preview' },
    async run(ctx, i) {
      if (ctx.user.dashboardAdmin !== true) throw new Error('Only a dashboard admin can import employee details');
      const { file, rows } = sheetRows(ctx);
      const { plan } = await planImport(ctx.userId, { rows, emptyRemoves: i.emptyRemoves === true, mapping: mappingOf(i.mapping) });
      const facts = planFacts(plan, importRisks(plan), rowsOf(i.skipRows));
      return {
        data: { file, ...facts, note: 'Nothing is saved. HR sees each row in the table: do not list them.' },
        tables: [{ title: `${file}: what each row would do`, columns: ['Row', 'Who', 'Result', 'Detail'], rows: plan.rows.map((r) => [r.row, r.name || '—', STATUS[r.status], r.status === 'updated' ? changedFields(plan, r.row) : r.detail || '']) }],
        links: [{ label: 'Open Import employees', view: 'employeeimport' }],
      };
    },
  },
  {
    name: 'prepare_people_import',
    area: 'people',
    acts: true,
    label: () => 'Prepared: import the attached sheet',
    description: 'Prepare importing the spreadsheet HR attached, exactly as People › Import does: new rows add employees, matched rows (by Employee ID or work email) update only the columns the sheet has. ONE card for the whole sheet with the risk lines and a row-by-row table; HR confirms once. Use for "import these 30 joiners" or "update everyone\'s designation from this sheet". Changes nothing until Confirm; applying is refused if anyone in it changed in between (attach again). Cannot be undone. For one new person without a sheet use prepare_add_employee.',
    input_schema: INPUT,
    api: { method: 'POST', path: '/admin/employees/import/x/apply' },
    async run(ctx, i) {
      if (ctx.user.dashboardAdmin !== true) throw new Error('Only a dashboard admin can import employee details');
      const { file, rows } = sheetRows(ctx);
      const skipRows = rowsOf(i.skipRows);
      const preview = await previewImport(ctx.userId, { fileName: file, rows, emptyRemoves: i.emptyRemoves === true, mapping: mappingOf(i.mapping) });
      const { importId, ...plan } = preview;
      const risks = importRisks(plan);
      const facts = planFacts(plan, risks, skipRows);
      if (facts.blocked) return { data: { prepared: false, ...facts, note: 'This sheet cannot be imported as it is: tell HR why.' } };
      const skip = new Set(skipRows);
      const willAdd = facts.newEmployees, willUpdate = facts.updated;
      if (!willAdd && !willUpdate) return { data: { prepared: false, ...facts, note: 'Nothing in this sheet would change anyone.' } };
      const title = `Import ${file}: ${[willAdd && plural(willAdd, 'new employee'), willUpdate && `${plural(willUpdate, 'person', 'people')} updated`].filter(Boolean).join(', ')}`;
      const serious = risks.filter((r) => r.level === 'high');
      const proposalId = await propose(ctx, {
        kind: 'people_import', area: 'people', title,
        summary: facts.riskSummary,
        lines: [
          ...(willAdd ? [{ text: `Adds ${plural(willAdd, 'new employee')} (status Onboarding; each can sign in with their work email).` }] : []),
          ...(willUpdate ? [{ text: `Updates ${plural(willUpdate, 'person', 'people')}: only the columns in the sheet are written${i.emptyRemoves === true ? '; an empty cell removes the value they have' : '; empty cells leave values as they are'}.` }] : []),
          { text: `Columns read: ${plan.columns.map((c) => `${c.from} as ${c.label}`).join(', ') || 'none'}.${plan.ignoredColumns.length ? ` Ignored: ${plan.ignoredColumns.join(', ')}.` : ''}`, tone: 'info' },
          ...risks.filter((r) => r.level !== 'info').map((r) => ({ text: `${r.text}${r.people.length ? ` (${r.people.join(', ')}${r.count > r.people.length ? '…' : ''})` : ''}.`, tone: 'warn' as const })),
          ...risks.filter((r) => r.level === 'info').map((r) => ({ text: `${r.text}.`, tone: 'info' as const })),
          ...plan.notes.map((n) => ({ text: n, tone: 'info' as const })),
          ...(skipRows.length ? [{ text: `Left out at your request: row${skipRows.length === 1 ? '' : 's'} ${skipRows.join(', ')}.`, tone: 'info' as const }] : []),
          { text: 'No Undo: an import cannot be reversed from Suwi. If anyone in it is changed before you confirm, the import is refused and the sheet has to be attached again.', tone: 'warn' },
        ],
        effectiveFrom: ctx.today, undoable: false,
        ...(serious.length ? { typeToConfirm: String(willAdd + willUpdate) } : {}),
        preview: {
          field: 'Import',
          rows: plan.rows.filter((r) => !skip.has(r.row) && (r.status === 'new' || r.status === 'updated')).slice(0, 300)
            .map((r) => ({ name: `Row ${r.row}: ${r.name || '—'}`, current: r.status === 'new' ? 'Not on the roll' : 'On the roll', next: r.status === 'new' ? `New employee${r.detail ? ` (${r.detail})` : ''}` : `Changes ${changedFields(plan, r.row)}` })),
          skipped: [
            ...plan.errors.filter((e) => e.row > 0 && !skip.has(e.row)).map((e) => ({ who: `Row ${e.row}`, reason: e.message })),
            ...plan.skippedCells.filter((c) => !skip.has(c.row)).map((c) => ({ who: `Row ${c.row}: ${c.name}`, reason: `${c.label} ${c.message}` })),
          ].slice(0, 100),
        },
        payload: { byUserId: ctx.userId, importId, skipRows },
      });
      return {
        data: { prepared: true, title, ...facts, ...(serious.length ? { typeToConfirm: String(willAdd + willUpdate) } : {}), note: 'Nothing is saved until HR presses Confirm on the card. HR sees every row on the card: do not list them.' },
        proposalId,
        links: [{ label: 'Open Import employees', view: 'employeeimport' }],
      };
    },
  },
);

defineExecutor('people_import', {
  async run(p) {
    const { byUserId, importId, skipRows } = p.payload as { byUserId: string; importId: string; skipRows: number[] };
    const r = await applyImport(byUserId, importId, { skipRows });
    const failed = r.failed.map((f) => `${f.row ? `row ${f.row}: ` : ''}${f.message}`);
    return { message: `Imported: ${plural(r.created, 'new employee')} added, ${plural(r.updated, 'person', 'people')} updated.${failed.length ? ` Not done: ${failed.slice(0, 5).join('; ')}${failed.length > 5 ? ` and ${failed.length - 5} more` : ''}.` : ''}` };
  },
});
