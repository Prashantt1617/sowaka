// KPI parameters from Suwi (24 Nov, HR asked that Suwi can do what the dashboard's KPI Parameters page
// does): add a parameter, change its guidance, rename one nobody uses yet, retire (archive) or restore
// one, and delete one that nothing references. ONE card for any number of changes; nothing changes until
// HR presses Confirm, and the executor calls the same kpi.service functions the page's routes call.
// The service's rules stand: guidance edits wait for the next cycle, a title is fixed once anything uses
// the parameter, and a parameter in use (a template, an assignment such as the cycle in progress, or a
// sent review) is never deleted: Suwi retires it instead and the card says so. Undo puts each change back.
import { feedbackRecords, kpiAssignments, kpiTemplates } from '../../config/db';
import { currentPeriodFor } from '../../services/cycle';
import { cycleName } from '../../services/feedback-notifications.service';
import {
  archiveKpiParameter, cancelKpiParameterEdit, createKpiParameter, deleteKpiParameter, listKpiParameters, updateKpiParameter,
} from '../../services/kpi.service';
import { normaliseName } from '../content/kpiSuggestions';
import { defineTools, str } from '../tools';
import { defineExecutor, propose } from '../proposals';
import { cycles } from './kpi-templates';

type Action = 'add' | 'guidance' | 'rename' | 'retire' | 'restore' | 'delete';
const ACTIONS: Action[] = ['add', 'guidance', 'rename', 'retire', 'restore', 'delete'];
type Parameter = Awaited<ReturnType<typeof listKpiParameters>>[number];

/** One change as the executor runs it. `retire` may stand in for a delete the service would refuse. */
interface Item {
  action: Action;
  id: string | null;
  title: string;
  newTitle?: string;
  guidance?: string;
  /** What Undo needs: the wording before, and any edit that was already waiting. */
  oldGuidance?: string;
  oldPending?: string | null;
  /** A delete turned into retire because the parameter is in use. */
  insteadOfDelete?: boolean;
}

/** Where a parameter is used: the same references deleteKpiParameter counts, plus the cycle in progress. */
async function usageOf(org: string, id: string, live: string) {
  const [templates, assignments, liveAssignments, reviews] = await Promise.all([
    kpiTemplates().countDocuments({ org, parameterIds: id }),
    kpiAssignments().countDocuments({ org, parameterIds: id }),
    kpiAssignments().countDocuments({ org, parameterIds: id, period: { $gte: live } }),
    feedbackRecords().countDocuments({ 'parameters.parameterId': id }),
  ]);
  const parts = [
    liveAssignments ? `${liveAssignments} ${liveAssignments === 1 ? 'person is' : 'people are'} being reviewed on it in the ${cycleName(live)} cycle or later` : '',
    templates ? `${templates} template${templates === 1 ? '' : 's'}` : '',
    assignments > liveAssignments ? `${assignments - liveAssignments} earlier assignment${assignments - liveAssignments === 1 ? '' : 's'}` : '',
    reviews ? `${reviews} saved or sent review${reviews === 1 ? '' : 's'}` : '',
  ].filter(Boolean);
  return { used: Boolean(templates || assignments || reviews), inProgress: liveAssignments > 0, where: parts.join(', ') };
}

const find = (all: Parameter[], title: string) =>
  all.find((p) => normaliseName(p.title) === normaliseName(title))
  ?? (normaliseName(title).length >= 4 ? all.filter((p) => normaliseName(p.title).includes(normaliseName(title))).sort((a, b) => a.title.length - b.title.length)[0] : undefined);

defineTools({
  name: 'prepare_kpi_parameters',
  area: 'performance',
  acts: true,
  label: (i) => {
    const n = Array.isArray(i.changes) ? i.changes.length : 0;
    return `Prepared: ${n === 1 ? 'a KPI parameter change' : `${n || ''} KPI parameter changes`.trim()}`;
  },
  description: "Prepare ONE card with any number of changes to the company's KPI parameters (the headings managers score 1–5 on, each with a line of guidance), as the KPI Parameters page makes them. Each change: action add (title + guidance), guidance (title + new guidance; it applies from the next cycle, never the one in progress), rename (title + newTitle; only for a parameter nothing uses yet, since sent reviews and templates are labelled with the title), retire (archive: it leaves the pickers, stays readable on past reviews), restore (un-archive), or delete (only when nothing references it; a parameter in use is retired instead and the card says so). Name parameters by title. Changes nothing until HR confirms; Undo puts each change back. For whole templates or assigning parameters to people, use prepare_kpi_template / prepare_assign_kpi_template; to read the current list, kpi_setup.",
  input_schema: {
    type: 'object',
    properties: {
      changes: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            action: { type: 'string', enum: ACTIONS },
            title: { type: 'string', description: 'The parameter as it is called now (or the new one, for add)' },
            newTitle: { type: 'string', description: 'rename only: the new title' },
            guidance: { type: 'string', description: 'add / guidance: the one line shown under the parameter on the manager\'s form and the employee\'s Grow page (max 600 characters)' },
          },
          required: ['action', 'title'],
        },
      },
    },
    required: ['changes'],
  },
  api: { method: 'POST', path: '/admin/kpi/parameters' },
  async run(ctx, i) {
    const wanted = (Array.isArray(i.changes) ? i.changes as Record<string, unknown>[] : []).slice(0, 30);
    if (!wanted.length) throw new Error('Give at least one change: action and title');
    const [all, c] = await Promise.all([listKpiParameters(ctx.userId, true), cycles(ctx)]);
    const items: Item[] = [];
    const lines: { text: string; why?: string; tone?: 'info' | 'warn' }[] = [];
    const skipped: { who: string; reason: string }[] = [];
    const titlesTaken = new Set(all.map((p) => normaliseName(p.title)));
    for (const w of wanted) {
      const action = str(w.action) as Action;
      const title = str(w.title, 80);
      const guidance = str(w.guidance, 600);
      if (!ACTIONS.includes(action) || !title) { skipped.push({ who: title || '(no title)', reason: 'Needs an action (add, guidance, rename, retire, restore, delete) and a title' }); continue; }
      if (action === 'add') {
        const hit = all.find((p) => normaliseName(p.title) === normaliseName(title));
        if (hit || titlesTaken.has(normaliseName(title))) { skipped.push({ who: title, reason: hit?.archived ? `"${hit.title}" exists but is retired: restore it instead` : `"${hit?.title ?? title}" already exists` }); continue; }
        titlesTaken.add(normaliseName(title));
        items.push({ action, id: null, title, guidance });
        lines.push({ text: `Add "${title}"${guidance ? ` with the guidance "${guidance}"` : ' with no guidance yet'}. It can be put in templates and assigned straight away.`, why: 'A parameter is a heading a manager scores 1–5 against; its guidance is the line shown under it on the manager\'s form and on the employee\'s Grow page.' });
        continue;
      }
      const p = find(all, title);
      if (!p) { skipped.push({ who: title, reason: 'No KPI parameter with that title' }); continue; }
      if (action === 'guidance') {
        if (!guidance) { skipped.push({ who: p.title, reason: 'Give the new guidance' }); continue; }
        if (guidance === p.description && !p.pendingEdit) { skipped.push({ who: p.title, reason: 'That is already its guidance' }); continue; }
        items.push({ action, id: p.id, title: p.title, guidance, oldGuidance: p.description, oldPending: p.pendingEdit?.description ?? null });
        lines.push({ text: `"${p.title}": new guidance "${guidance}" from the ${c.nextName} cycle (starts ${c.nextStart}). The ${c.liveName} cycle keeps "${p.description || '(none)'}".${p.pendingEdit ? ` This replaces the edit already waiting ("${p.pendingEdit.description}").` : ''}`, why: 'Managers are scoring against the current words right now; changing them mid-cycle would have two managers judge the same parameter against different text, so the service holds the edit until the next cycle opens.' });
        continue;
      }
      if (action === 'rename') {
        const newTitle = str(w.newTitle, 80);
        if (!newTitle) { skipped.push({ who: p.title, reason: 'Give the new title (newTitle)' }); continue; }
        if (titlesTaken.has(normaliseName(newTitle))) { skipped.push({ who: p.title, reason: `"${newTitle}" already exists` }); continue; }
        const u = await usageOf(ctx.org, p.id, c.live);
        if (u.used) { skipped.push({ who: p.title, reason: `In use (${u.where}), so its title is fixed: reviews and templates are labelled with it. Add "${newTitle}" as a new parameter and retire "${p.title}", or change only its guidance` }); continue; }
        titlesTaken.add(normaliseName(newTitle));
        items.push({ action, id: p.id, title: p.title, newTitle, guidance: guidance || p.description, oldGuidance: p.description });
        lines.push({ text: `Rename "${p.title}" to "${newTitle}"${guidance && guidance !== p.description ? ` with the guidance "${guidance}"` : ''}.`, why: 'Nothing uses it yet (no template, assignment or review), so the old one is replaced by a new parameter with the new title; nobody\'s form or history changes.' });
        continue;
      }
      if (action === 'retire' || action === 'restore') {
        if (action === 'retire' && p.archived) { skipped.push({ who: p.title, reason: 'Already retired' }); continue; }
        if (action === 'restore' && !p.archived) { skipped.push({ who: p.title, reason: 'Not retired' }); continue; }
        items.push({ action, id: p.id, title: p.title });
        lines.push(action === 'retire'
          ? { text: `Retire "${p.title}": it leaves the parameter pickers; past reviews still show it.`, why: 'Retiring (archiving) keeps it readable wherever it was used. Templates and assignments that already include it keep it until HR changes them.' }
          : { text: `Restore "${p.title}": it is back in the parameter pickers.` });
        continue;
      }
      // delete
      const u = await usageOf(ctx.org, p.id, c.live);
      if (u.used) {
        if (p.archived) { skipped.push({ who: p.title, reason: `In use (${u.where}), so it cannot be deleted; it is already retired` }); continue; }
        items.push({ action: 'retire', id: p.id, title: p.title, insteadOfDelete: true });
        lines.push({ text: `"${p.title}" is not deleted: ${u.where}. It is retired instead (it leaves the pickers; past reviews still show it).`, tone: 'warn', why: u.inProgress ? 'Managers are scoring people on it in the cycle in progress; deleting it would pull it out from under their reviews.' : 'Deleting it would break the templates and reviews that point at it, so the service refuses; retiring is the safe way to stop using it.' });
        continue;
      }
      items.push({ action: 'delete', id: p.id, title: p.title, oldGuidance: p.description });
      lines.push({ text: `Delete "${p.title}" for good: nothing uses it (no template, assignment or review).` });
    }
    if (!items.length) return { data: { prepared: false, message: 'Nothing to change.', skipped } };
    const counts = ACTIONS.map((a) => [a, items.filter((x) => x.action === a).length] as const).filter(([, n]) => n);
    const verb: Record<Action, string> = { add: 'add', guidance: 'reword', rename: 'rename', retire: 'retire', restore: 'restore', delete: 'delete' };
    const title = items.length === 1
      ? `${verb[items[0].action][0].toUpperCase()}${verb[items[0].action].slice(1)} KPI parameter "${items[0].title}"`
      : `${items.length} KPI parameter changes (${counts.map(([a, n]) => `${verb[a]} ${n}`).join(', ')})`;
    const proposalId = await propose(ctx, {
      kind: 'kpi_parameters', area: 'performance', title,
      summary: `${title}. Reviews already sent keep the wording they were scored on.`,
      lines: [
        ...lines,
        ...(skipped.length ? [{ text: `Left out: ${skipped.map((s) => `${s.who} (${s.reason})`).join('; ')}.`, tone: 'warn' as const }] : []),
        { text: 'Undo puts each change back (an added parameter is removed only while nothing uses it).', tone: 'info' as const },
      ],
      effectiveFrom: items.some((x) => x.action === 'guidance') ? c.nextStart : ctx.today, undoable: true,
      payload: { byUserId: ctx.userId, items },
    });
    return {
      data: { prepared: true, title, changes: items.map((x) => ({ action: x.insteadOfDelete ? 'retire (instead of delete: in use)' : x.action, title: x.title, ...(x.newTitle ? { newTitle: x.newTitle } : {}) })), leftOut: skipped, note: 'Nothing changes until HR presses Confirm on the card.' },
      proposalId, links: [{ label: 'Open KPI parameters', view: 'kpi' }],
    };
  },
});

async function runEach(items: Item[], fn: (x: Item) => Promise<string>) {
  const done: string[] = [];
  const failed: string[] = [];
  for (const x of items) {
    try { done.push(await fn(x)); } catch (e) { failed.push(`"${x.title}" (${(e as Error).message})`); }
  }
  return { done, failed };
}

defineExecutor('kpi_parameters', {
  async run(p) {
    const { byUserId, items } = p.payload as { byUserId: string; items: Item[] };
    const undo: Item[] = [];
    const r = await runEach(items, async (x) => {
      switch (x.action) {
        case 'add': {
          const made = await createKpiParameter(byUserId, { title: x.title, description: x.guidance ?? '' });
          undo.push({ ...x, id: made.id });
          return `added "${x.title}"`;
        }
        case 'guidance':
          await updateKpiParameter(byUserId, x.id!, { description: x.guidance });
          undo.push(x);
          return `reworded "${x.title}" from the next cycle`;
        case 'rename': {
          const made = await createKpiParameter(byUserId, { title: x.newTitle, description: x.guidance ?? '' });
          try { await deleteKpiParameter(byUserId, x.id!); } catch (e) { await deleteKpiParameter(byUserId, made.id).catch(() => undefined); throw e; }
          undo.push({ ...x, id: made.id });
          return `renamed "${x.title}" to "${x.newTitle}"`;
        }
        case 'retire':
          await archiveKpiParameter(byUserId, x.id!, true);
          undo.push(x);
          return x.insteadOfDelete ? `retired "${x.title}" (in use, so not deleted)` : `retired "${x.title}"`;
        case 'restore':
          await archiveKpiParameter(byUserId, x.id!, false);
          undo.push(x);
          return `restored "${x.title}"`;
        case 'delete':
          await deleteKpiParameter(byUserId, x.id!);
          undo.push(x);
          return `deleted "${x.title}"`;
      }
    });
    const text = r.done.join(', ');
    return {
      message: `${text ? `${text[0].toUpperCase()}${text.slice(1)}.` : 'Nothing changed.'}${r.failed.length ? ` Not done: ${r.failed.join('; ')}.` : ''}`,
      undo: { items: undo },
    };
  },
  async undo(p) {
    const { byUserId } = p.payload as { byUserId: string };
    const items = ((p.undo?.items as Item[] | undefined) ?? []).slice().reverse();
    const org = p.org;
    const live = await currentPeriodFor(org);
    const r = await runEach(items, async (x) => {
      switch (x.action) {
        case 'add':
          await deleteKpiParameter(byUserId, x.id!);
          return `removed "${x.title}"`;
        case 'guidance':
          if (x.oldPending) await updateKpiParameter(byUserId, x.id!, { description: x.oldPending });
          else await cancelKpiParameterEdit(byUserId, x.id!);
          return `put back the guidance of "${x.title}"`;
        case 'rename': {
          const u = await usageOf(org, x.id!, live);
          if (u.used) throw new Error(`"${x.newTitle}" is in use now (${u.where})`);
          await createKpiParameter(byUserId, { title: x.title, description: x.oldGuidance ?? '' });
          await deleteKpiParameter(byUserId, x.id!);
          return `renamed "${x.newTitle}" back to "${x.title}"`;
        }
        case 'retire':
          await archiveKpiParameter(byUserId, x.id!, false);
          return `restored "${x.title}"`;
        case 'restore':
          await archiveKpiParameter(byUserId, x.id!, true);
          return `retired "${x.title}" again`;
        case 'delete':
          await createKpiParameter(byUserId, { title: x.title, description: x.oldGuidance ?? '' });
          return `added "${x.title}" back`;
      }
    });
    const text = r.done.join(', ');
    return `${text ? `${text[0].toUpperCase()}${text.slice(1)}.` : 'Nothing was put back.'}${r.failed.length ? ` Not undone: ${r.failed.join('; ')}.` : ''}`;
  },
});
