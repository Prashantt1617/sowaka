// A spreadsheet HR attaches to a Suwi question, read on the server so Bulk
// assign uses its rows exactly instead of the model copying IDs out of it.
//
// The browser sends the sheet as CSV text, one block per sheet. This finds the
// first block with a column that identifies people (employee ID, email or
// name), and any columns that name what to assign (shift, department, ...), so
// a sheet can carry one value for everyone or a value per row. The last sheet
// stays available to the same person for half an hour, so a follow-up like
// "now set their department too" still has it.

export const SHEET_FIELDS = ['shift', 'attendance_source', 'reporting_manager', 'department', 'kpi_template', 'paid_days_template'] as const;
export type SheetField = (typeof SHEET_FIELDS)[number];

export interface SheetRow {
  /** Row number as HR sees it in the sheet, header being row 1. */
  row: number;
  employeeId?: string;
  email?: string;
  name?: string;
  values: Partial<Record<SheetField, string>>;
}

export interface ParsedSheet {
  file: string;
  /** The sheet tab the rows came from, when the workbook had several. */
  tab?: string;
  rows: SheetRow[];
  /** The headers as written, for what Suwi tells HR it found. */
  idColumn?: string;
  emailColumn?: string;
  nameColumn?: string;
  fieldColumns: Partial<Record<SheetField, string>>;
}

/** CSV with quoted fields, doubled quotes and line breaks inside quotes. */
function csvRows(text: string): string[][] {
  const out: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); out.push(row); row = []; cell = '';
    } else cell += ch;
  }
  if (cell || row.length) { row.push(cell); out.push(row); }
  return out.map((r) => r.map((c) => c.trim()));
}

const key = (h: string) => h.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const ID = /^(emp|employee|staff|emp no|employee no|employee number|employee code|emp code|emp id|employee id|staff id|id|code)$/;
const EMAIL = /\b(e ?mail|work email|email id)\b/;
const NAME = /^(name|full name|employee name|employee|staff name)$/;
const FIELD_HEADERS: [SheetField, RegExp][] = [
  ['paid_days_template', /paid ?days/],
  ['kpi_template', /\bkpi\b/],
  ['attendance_source', /attendance source|punch (format|mode|type)|^source$/],
  ['reporting_manager', /manager|reports to|reporting/],
  ['shift', /^shift( template| name)?$/],
  ['department', /^(department|dept|team)$/],
];

/** Reads the first block of the CSV that identifies people; null when none does. */
export function parseSheet(file: string, text: string): ParsedSheet | null {
  const blocks = text.includes('--- Sheet: ')
    ? text.split(/^--- Sheet: (.*?) ---$/m).slice(1).reduce<{ tab: string; csv: string }[]>((acc, part, i, all) => (i % 2 === 0 ? [...acc, { tab: part, csv: all[i + 1] ?? '' }] : acc), [])
    : [{ tab: '', csv: text }];
  for (const { tab, csv } of blocks) {
    // Blank rows still count, so "Row 7" is row 7 in the spreadsheet.
    const all = csvRows(csv.replace(/^\s*\n/, '').trimEnd());
    const top = all.findIndex((r) => r.some(Boolean));
    if (top < 0) continue;
    const headers = all[top];
    const rows = all.slice(top).map((r, i) => ({ r, row: top + i + 1 })).filter((x, i) => i === 0 || x.r.some(Boolean));
    if (rows.length < 2) continue;
    const find = (re: RegExp) => headers.findIndex((h) => re.test(key(h)));
    const id = find(ID);
    const email = find(EMAIL);
    // A "Reporting manager name" column is not the person's own name.
    const name = headers.findIndex((h) => NAME.test(key(h)));
    if (id < 0 && email < 0 && name < 0) continue;
    const fields: Partial<Record<SheetField, number>> = {};
    for (const [field, re] of FIELD_HEADERS) {
      const at = headers.findIndex((h, i) => i !== id && i !== email && i !== name && re.test(key(h)) && !Object.values(fields).includes(i));
      if (at >= 0) fields[field] = at;
    }
    const parsed: SheetRow[] = rows.slice(1).map(({ r, row }) => ({
      row,
      ...(id >= 0 && r[id] ? { employeeId: r[id] } : {}),
      ...(email >= 0 && r[email] ? { email: r[email].toLowerCase() } : {}),
      ...(name >= 0 && r[name] ? { name: r[name] } : {}),
      values: Object.fromEntries(Object.entries(fields).map(([f, at]) => [f, r[at as number] ?? '']).filter(([, v]) => v)) as SheetRow['values'],
    })).filter((r) => r.employeeId || r.email || r.name);
    if (!parsed.length) continue;
    return {
      file, ...(tab ? { tab } : {}), rows: parsed.slice(0, 2000),
      ...(id >= 0 ? { idColumn: headers[id] } : {}),
      ...(email >= 0 ? { emailColumn: headers[email] } : {}),
      ...(name >= 0 ? { nameColumn: headers[name] } : {}),
      fieldColumns: Object.fromEntries(Object.entries(fields).map(([f, at]) => [f, headers[at as number]])),
    };
  }
  return null;
}

const TTL_MS = 30 * 60_000;
const lastSheets = new Map<string, { sheet: ParsedSheet; at: number }>();

export function rememberSheet(userId: string, sheet: ParsedSheet) {
  lastSheets.set(userId, { sheet, at: Date.now() });
}

/** The sheet this person attached in the last half hour, if any. */
export function lastSheet(userId: string): ParsedSheet | undefined {
  const hit = lastSheets.get(userId);
  if (!hit) return undefined;
  if (Date.now() - hit.at > TTL_MS) { lastSheets.delete(userId); return undefined; }
  return hit.sheet;
}

/** One line for Suwi's instructions: what the sheet holds. */
export function describeSheet(s: ParsedSheet): string {
  const by = [s.idColumn && `employee ID ("${s.idColumn}")`, s.emailColumn && `email ("${s.emailColumn}")`, s.nameColumn && `name ("${s.nameColumn}")`].filter(Boolean).join(', ');
  const per = Object.entries(s.fieldColumns).map(([f, h]) => `${f} ("${h}")`).join(', ');
  return `"${s.file}"${s.tab ? `, tab ${s.tab}` : ''}: ${s.rows.length} people, matched by ${by}${per ? `; a value per row for ${per}` : ''}`;
}
