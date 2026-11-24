// Holiday Bank (Shifts › Holiday Bank): the company's paid days off, by
// location. Read the list; add or remove holidays through the same service the
// dashboard's buttons use (createCompanyHoliday / deleteCompanyHoliday), as a
// "What will happen" card. Undo deletes what was added, or re-adds what was removed.
import { ObjectId } from 'mongodb';
import { holidays } from '../../config/db';
import { ALL_LOCATIONS, createCompanyHoliday, deleteCompanyHoliday, listCompanyHolidays } from '../../services/holiday.service';
import { defineTools, str } from '../tools';
import { defineExecutor, propose } from '../proposals';
import { isDate, niceDate } from './team';

const where = (state: string) => (state === ALL_LOCATIONS ? 'All locations' : state.replace(/\b\w/g, (c) => c.toUpperCase()));
const PAID_LINE = 'A Holiday Bank holiday is a paid day off for everyone at those locations. The attendance report, the app calendar and payroll all read it: nobody is marked absent that day.';

type HolidayIn = { name: string; date: string; locations: string[] };

function holidaysFrom(i: Record<string, unknown>): HolidayIn[] {
  const raw = Array.isArray(i.holidays) ? i.holidays : [i];
  const out: HolidayIn[] = [];
  for (const h of raw as Record<string, unknown>[]) {
    const name = str(h?.name, 120);
    const date = str(h?.date);
    if (!name || !date) continue;
    if (!isDate(date)) throw new Error(`The date for ${name} must be YYYY-MM-DD`);
    const locs = Array.isArray(h.locations) ? (h.locations as unknown[]).map((l) => str(l, 80)).filter(Boolean) : [];
    const all = !locs.length || locs.some((l) => l === '*' || /^(all|everyone|all locations)$/i.test(l));
    out.push({ name, date, locations: all ? [ALL_LOCATIONS] : [...new Set(locs.map((l) => l.toLowerCase()))] });
  }
  if (!out.length) throw new Error('Give each holiday a name and a date (YYYY-MM-DD)');
  if (out.length > 50) throw new Error('At most 50 holidays at once');
  return out;
}

defineTools(
  {
    name: 'holiday_bank',
    area: 'attendance',
    label: (i) => `Holiday Bank${i.year ? ` for ${i.year}` : ''}${i.from ? ` from ${i.from}` : ''}${i.to ? ` to ${i.to}` : ''}`,
    description: "The company's Holiday Bank (Shifts › Holiday Bank): each holiday's name, date and which locations it is for (\"All locations\" or named ones). For a year (this year unless given) or a from/to range. HR sees the list as a table; each row carries its id for prepare_remove_holiday.",
    input_schema: { type: 'object', properties: { year: { type: 'number' }, from: { type: 'string', description: 'YYYY-MM-DD' }, to: { type: 'string', description: 'YYYY-MM-DD' } }, required: [] },
    api: { method: 'GET', path: '/holidays' },
    async run(ctx, i) {
      const year = Number(i.year) || Number(ctx.today.slice(0, 4));
      const from = isDate(i.from) ? i.from : `${year}-01-01`;
      const to = isDate(i.to) ? i.to : isDate(i.from) ? `${i.from.slice(0, 4)}-12-31` : `${year}-12-31`;
      const all = (await listCompanyHolidays(ctx.userId, { state: '*' })).filter((h) => h.date >= from && h.date <= to);
      return {
        data: {
          from, to, count: all.length,
          holidays: all.slice(0, 60).map((h) => ({ id: h.id, name: h.name, date: h.date, location: where(h.state), type: h.type })),
          note: all.length ? 'HR sees them all in the table.' : 'No Holiday Bank holidays in this range.',
        },
        tables: all.length ? [{ title: `Holiday Bank, ${niceDate(from)} to ${niceDate(to)}`, columns: ['Date', 'Holiday', 'Locations', 'Type'], rows: all.map((h) => [niceDate(h.date), h.name, where(h.state), h.type]) }] : [],
        links: [{ label: 'Open Holiday Bank', view: 'holidaybank' }],
      };
    },
  },
  {
    name: 'prepare_add_holiday',
    area: 'attendance',
    acts: true,
    label: (i) => `Prepared: add ${Array.isArray(i.holidays) ? `${i.holidays.length} holidays` : `${i.name ?? 'a holiday'} on ${i.date ?? ''}`} to the Holiday Bank`,
    description: 'Prepare adding one or more holidays to the Holiday Bank (Shifts › Holiday Bank), e.g. "mark 7 Nov as a holiday for everyone". This is how a company-wide (or location-wide) holiday is given; do NOT use bulk day marks for that. Each holiday: name, date (YYYY-MM-DD), locations (omit or ["all"] for every location, else location names as on employee profiles). Changes nothing until HR confirms; Undo deletes what it added.',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string' }, date: { type: 'string', description: 'YYYY-MM-DD' }, locations: { type: 'array', items: { type: 'string' } },
        holidays: { type: 'array', description: 'Several at once (instead of name/date/locations)', items: { type: 'object', properties: { name: { type: 'string' }, date: { type: 'string' }, locations: { type: 'array', items: { type: 'string' } } }, required: ['name', 'date'] } },
      },
      required: [],
    },
    api: { method: 'POST', path: '/holidays' },
    async run(ctx, i) {
      const wanted = holidaysFrom(i);
      const rows: { name: string; current: string; next: string }[] = [];
      const skipped: { who: string; reason: string }[] = [];
      const toAdd: { name: string; date: string; state: string }[] = [];
      for (const h of wanted) {
        for (const state of h.locations) {
          const existing = await holidays().findOne({ org: ctx.org, state, date: new Date(`${h.date}T00:00:00.000Z`) }, { projection: { name: 1 } });
          if (existing) { skipped.push({ who: `${niceDate(h.date)} (${where(state)})`, reason: `Already in the Holiday Bank as ${existing.name}` }); continue; }
          toAdd.push({ name: h.name, date: h.date, state });
          rows.push({ name: `${niceDate(h.date)}: ${h.name}`, current: 'Not a holiday', next: `Holiday, ${where(state)}` });
        }
      }
      if (!toAdd.length) return { data: { nothingToDo: true, skipped, message: 'Every one of these is already in the Holiday Bank.' } };
      const title = toAdd.length === 1 ? `Add ${toAdd[0].name} (${niceDate(toAdd[0].date)}) to the Holiday Bank` : `Add ${toAdd.length} holidays to the Holiday Bank`;
      const past = toAdd.filter((h) => h.date < ctx.today);
      const proposalId = await propose(ctx, {
        kind: 'add_holiday', area: 'attendance', title,
        summary: `${toAdd.map((h) => `${h.name} on ${niceDate(h.date)} (${where(h.state)})`).join('; ')}. ${PAID_LINE}`,
        lines: [
          ...toAdd.map((h) => ({ text: `${niceDate(h.date)}: ${h.name}, for ${h.state === ALL_LOCATIONS ? 'everyone at every location' : `everyone whose work location is ${where(h.state)}`}.` })),
          { text: PAID_LINE, why: 'The Holiday Bank is the one list of company holidays; every screen and payroll read it.', tone: 'info' as const },
          ...(past.length ? [{ text: `${past.map((h) => niceDate(h.date)).join(', ')} ${past.length === 1 ? 'is' : 'are'} already past: anyone marked absent that day becomes Holiday, unless HR marked the day by hand. A month whose payroll is already submitted is not recalculated.`, tone: 'warn' as const }] : []),
          ...(skipped.length ? [{ text: `Left out: ${skipped.map((s) => `${s.who}, ${s.reason.toLowerCase()}`).join('; ')}.`, tone: 'info' as const }] : []),
          { text: 'Undo deletes the holidays this adds.', tone: 'info' as const },
        ],
        effectiveFrom: toAdd[0].date, undoable: true,
        preview: { field: 'Holiday Bank', rows, skipped },
        payload: { byUserId: ctx.userId, holidays: toAdd },
      });
      return { data: { prepared: true, title, adding: toAdd.map((h) => ({ ...h, location: where(h.state) })), skipped, note: 'Nothing is saved until HR presses Confirm on the card.' }, proposalId, links: [{ label: 'Open Holiday Bank', view: 'holidaybank' }] };
    },
  },
  {
    name: 'prepare_remove_holiday',
    area: 'attendance',
    acts: true,
    label: (i) => `Prepared: remove ${i.name ?? 'a holiday'}${i.date ? ` on ${i.date}` : ''} from the Holiday Bank`,
    description: 'Prepare removing a holiday from the Holiday Bank. Give its id from holiday_bank, or its date (and name or location when that date has several). Changes nothing until HR confirms; Undo adds it back.',
    input_schema: { type: 'object', properties: { holidayId: { type: 'string' }, date: { type: 'string', description: 'YYYY-MM-DD' }, name: { type: 'string' }, location: { type: 'string' } }, required: [] },
    api: { method: 'DELETE', path: '/holidays/x' },
    async run(ctx, i) {
      const id = str(i.holidayId);
      let found;
      if (id && ObjectId.isValid(id)) found = await holidays().find({ org: ctx.org, _id: new ObjectId(id) }).toArray();
      else {
        const date = str(i.date);
        if (!isDate(date)) throw new Error('Say which holiday: its id from holiday_bank, or its date (YYYY-MM-DD)');
        found = await holidays().find({ org: ctx.org, date: new Date(`${date}T00:00:00.000Z`) }).toArray();
        const n = str(i.name).toLowerCase();
        const loc = str(i.location).toLowerCase();
        if (found.length > 1 && n) found = found.filter((h) => h.name.toLowerCase().includes(n));
        if (found.length > 1 && loc) found = found.filter((h) => (/^(all|everyone)/.test(loc) ? h.state === ALL_LOCATIONS : h.state === loc));
      }
      if (!found.length) throw new Error('No such holiday in the Holiday Bank');
      if (found.length > 1) return { data: { ambiguous: true, candidates: found.map((h) => ({ id: h._id!.toHexString(), name: h.name, date: h.date.toISOString().slice(0, 10), location: where(h.state) })), note: 'Several holidays match; ask with the id.' } };
      const h = found[0];
      const date = h.date.toISOString().slice(0, 10);
      const title = `Remove ${h.name} (${niceDate(date)}, ${where(h.state)}) from the Holiday Bank`;
      const proposalId = await propose(ctx, {
        kind: 'remove_holiday', area: 'attendance', title,
        summary: `${niceDate(date)} stops being a paid holiday for ${h.state === ALL_LOCATIONS ? 'everyone' : `everyone at ${where(h.state)}`}.`,
        lines: [
          { text: `${niceDate(date)}: ${h.name} (${where(h.state)}) is removed. The day becomes an ordinary working day (or week off) for those people.` },
          { text: 'The attendance report, the app calendar and payroll all read the Holiday Bank: if that day has passed, anyone who did not punch in becomes absent unless HR marks the day.', tone: date < ctx.today ? 'warn' as const : 'info' as const },
          { text: 'Undo adds the holiday back.', tone: 'info' as const },
        ],
        effectiveFrom: date, undoable: true,
        payload: { byUserId: ctx.userId, id: h._id!.toHexString(), name: h.name, date, state: h.state, type: h.type },
      });
      return { data: { prepared: true, title, note: 'Nothing is saved until HR presses Confirm on the card.' }, proposalId, links: [{ label: 'Open Holiday Bank', view: 'holidaybank' }] };
    },
  },
);

defineExecutor('add_holiday', {
  async run(p) {
    const { byUserId, holidays: list } = p.payload as { byUserId: string; holidays: { name: string; date: string; state: string }[] };
    const added: string[] = [];
    const failed: string[] = [];
    for (const h of list) {
      try { added.push((await createCompanyHoliday(byUserId, { name: h.name, date: h.date, state: h.state })).id); }
      catch (e) { failed.push(`${niceDate(h.date)} (${where(h.state)}): ${(e as Error).message}`); }
    }
    if (!added.length) throw new Error(`Nothing was added. ${failed.join('; ')}`);
    return { message: `Added ${added.length} holiday${added.length === 1 ? '' : 's'} to the Holiday Bank.${failed.length ? ` Not added: ${failed.join('; ')}.` : ''}`, undo: { ids: added } };
  },
  async undo(p) {
    const { byUserId } = p.payload as { byUserId: string };
    const ids = ((p.undo as { ids?: string[] } | undefined)?.ids) ?? [];
    let removed = 0;
    for (const id of ids) { try { await deleteCompanyHoliday(byUserId, id); removed += 1; } catch { /* already gone */ } }
    return `Removed the ${removed} holiday${removed === 1 ? '' : 's'} Suwi added.`;
  },
});

defineExecutor('remove_holiday', {
  async run(p) {
    const { byUserId, id, name, date } = p.payload as { byUserId: string; id: string; name: string; date: string };
    await deleteCompanyHoliday(byUserId, id);
    return { message: `Removed ${name} (${niceDate(date)}) from the Holiday Bank.` };
  },
  async undo(p) {
    const { byUserId, name, date, state, type } = p.payload as { byUserId: string; name: string; date: string; state: string; type: string };
    await createCompanyHoliday(byUserId, { name, date, state, type });
    return `Added ${name} (${niceDate(date)}) back to the Holiday Bank.`;
  },
});
