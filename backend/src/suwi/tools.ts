/**
 * Suwi's tools: the only way Claude reaches Sowaka's data. Each tool is a thin
 * wrapper over an existing service, run as the person asking, and declares the
 * dashboard API it stands for so the same People › Accesses rules apply: a
 * tool behind a tab this person wasn't given is not even offered to Claude.
 *
 * A tool returns small, plain data (never bank numbers, PAN or tokens), plus
 * optional links the panel turns into buttons. A tool in an area set to "Act
 * after you confirm" may return a proposal instead of changing anything; the
 * change only happens when HR presses Confirm (see proposals.ts).
 */
import { User } from '../models/user.model';
import { tabsForRequest } from '../models/dashboard-tabs';
import { hasAllDashboardTabs } from '../middleware/admin.middleware';
import { hasPayrollAccess } from '../services/payrollAccess.service';
import { LlmTool } from './llm';
import type { ParsedSheet } from './sheet';
import { cachedToolRun } from './toolCache';

export type SuwiArea = 'requests' | 'attendance' | 'people' | 'payroll' | 'claims' | 'performance' | 'connect' | 'settings';
export const SUWI_AREAS: { key: SuwiArea; label: string; covers: string }[] = [
  { key: 'requests', label: 'Requests', covers: 'Leave, overtime, corrections, check-ins' },
  { key: 'attendance', label: 'Attendance', covers: 'Lates, missed punches, absences, leave balances, shifts' },
  { key: 'people', label: 'People and data', covers: 'Headcount, profiles, missing details, designations' },
  { key: 'payroll', label: 'Payroll', covers: 'Runs, pay changes, templates, tax' },
  { key: 'claims', label: 'Claims', covers: 'Reimbursements, bills, limits' },
  { key: 'performance', label: 'Performance', covers: 'KPIs, reviews, templates' },
  { key: 'connect', label: 'Connect', covers: 'Engagement, posts, polls, reported content' },
  { key: 'settings', label: 'Settings', covers: 'How Sowaka works and where things are' },
];
export type SuwiLevel = 'answer' | 'suggest' | 'act';

export interface SuwiContext {
  userId: string;
  org: string;
  user: Omit<User, 'profilePhotoUrl'>;
  payroll: boolean;
  levels: Record<SuwiArea, SuwiLevel>;
  /** Today in the company's calendar, YYYY-MM-DD. */
  today: string;
  /** The spreadsheet HR attached to this question, or in the last half hour, read into rows. */
  sheet?: ParsedSheet;
}

export interface SuwiLink {
  label: string; view?: string; userId?: string; tab?: string;
  /** Opens the review page for this person and cycle with these scores and comments filled in (reviewChat.ts). */
  review?: { userId: string; period: string; parameters: { parameterId: string; score: number; note: string }[] };
}
/** A list the panel draws as a table from the data itself, so the model never has to write it out. */
export interface SuwiTable { title: string; columns: string[]; rows: (string | number)[][] }
export interface ToolOutput {
  /** What Claude reads: small, plain JSON. */
  data: unknown;
  /** Buttons for the panel ("Open attendance report"). */
  links?: SuwiLink[];
  /** Rows to show as tables under the answer (the model is told not to repeat them). */
  tables?: SuwiTable[];
  /** Read from today's attendance, which punches change without a write hook: answers using it are kept a minute only. */
  live?: boolean;
  /** A prepared change, shown as a "What will happen" card; nothing is saved yet. */
  proposalId?: string;
  /** Several cards at once (a sheet with a different value per row: one card per value). */
  proposalIds?: string[];
}

export interface SuwiTool {
  name: string;
  area: SuwiArea;
  /** One line for the "What I checked" list, e.g. "Attendance for October". */
  label: (input: Record<string, unknown>) => string;
  description: string;
  input_schema: Record<string, unknown>;
  /** The dashboard API this stands for: its tab rule decides who may use it. */
  api: { method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'; path: string };
  /** Needs payroll access (salary, bank, tax). */
  payroll?: boolean;
  /** Prepares a change: offered only where the area is set to "Act after you confirm". */
  acts?: boolean;
  run: (ctx: SuwiContext, input: Record<string, unknown>) => Promise<ToolOutput>;
}

const REGISTRY = new Map<string, SuwiTool>();
export function defineTools(...tools: SuwiTool[]) {
  for (const t of tools) {
    if (REGISTRY.has(t.name)) throw new Error(`Suwi tool ${t.name} defined twice`);
    // Read-only tools answer from what was kept on unchanged data (toolCache.ts); changes never are.
    if (!t.acts) {
      const body = t.run.bind(t);
      t.run = (ctx, input) => cachedToolRun(t, ctx, input, () => body(ctx, input));
    }
    REGISTRY.set(t.name, t);
  }
}
export const toolByName = (name: string) => REGISTRY.get(name);

/** A manager on the dashboard (team scope): sees and acts on their own subtree only. */
export const teamScoped = (u: Omit<User, 'profilePhotoUrl'>) => (u as { dashboardScope?: string }).dashboardScope === 'team';

/**
 * What a manager's Suwi may use (25 Nov 2026, HR: "enable Suwi for the managers' dashboard"): only tools whose
 * data is limited to their team. People lookups read a roster cut to their subtree (people.ts), attendance reads
 * the report the server already scopes, and review drafting saves only for their own direct reports. Every other
 * tool reads the whole company, so it is not offered, whatever their tabs say.
 */
const TEAM_TOOLS = new Set(['search_people', 'person_details', 'dashboard_help', 'attendance_summary', 'review_draft', 'prepare_save_review_draft']);

/** May this person use this tool? The same checks as the API it stands for. */
export function toolAllowed(ctx: SuwiContext, t: SuwiTool): boolean {
  if (teamScoped(ctx.user) && !TEAM_TOOLS.has(t.name)) return false;
  if (t.payroll && !ctx.payroll) return false;
  if (t.acts && ctx.levels[t.area] !== 'act') return false;
  if (hasAllDashboardTabs(ctx.user)) return true;
  const needed = tabsForRequest(t.api.method, t.api.path);
  if (needed === null) return true;
  const mine = new Set(ctx.user.dashboardTabs ?? []);
  return needed.some((tab) => mine.has(tab));
}

export function toolsFor(ctx: SuwiContext): SuwiTool[] {
  return [...REGISTRY.values()].filter((t) => toolAllowed(ctx, t));
}

export const asLlmTool = (t: SuwiTool): LlmTool => ({ name: t.name, description: t.description, input_schema: t.input_schema });

export function contextFor(user: Omit<User, 'profilePhotoUrl'>, levels: Record<SuwiArea, SuwiLevel>, today: string): SuwiContext {
  return { userId: user.userId, org: user.org!, user, payroll: hasPayrollAccess(user), levels, today };
}

// —— Small helpers for tool code ——
export const str = (v: unknown, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
export const num = (v: unknown, dflt: number, min = -Infinity, max = Infinity) => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : dflt;
};
/** A YYYY-MM month from input, else this month. */
export const monthOf = (v: unknown, today: string) => (typeof v === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(v) ? v : today.slice(0, 7));
export const rupees = (paise: number) => `₹${Math.round(paise / 100).toLocaleString('en-IN')}`;
