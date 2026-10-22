// Where is it, and how does it work: answered only from content/help.ts, so
// Suwi never describes a page or a feature Sowaka doesn't have.
import { defineTools, str } from '../tools';
import { HOW_TOS, NOT_SUPPORTED, VIEWS } from '../content/help';

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** How well a question matches an entry: whole keyword hits count most, then single words. */
function score(question: string, keywords: string[], title: string): number {
  const q = ` ${norm(question)} `;
  let n = 0;
  for (const k of [title, ...keywords]) {
    const kk = norm(k);
    if (!kk) continue;
    if (q.includes(` ${kk} `)) n += kk.includes(' ') ? 4 : 2;
    else for (const w of kk.split(' ')) if (w.length > 3 && q.includes(` ${w} `)) n += 1;
  }
  return n;
}

defineTools({
  name: 'dashboard_help',
  area: 'settings',
  label: (i) => (i.view ? `Help for the ${String(i.view)} page` : `Where to find: "${str(i.question, 60)}"`),
  description: 'Where something is in the HR dashboard and how it works: what each page does, step-by-step how-tos (add a holiday, assign a shift, add an employee, import, run payroll, set up reimbursement types, approvals, leave types, salary, access) and a list of what Sowaka does not do. Answer such questions ONLY from what this returns; if nothing matches, say Sowaka does not have it.',
  input_schema: { type: 'object', properties: { question: { type: 'string', description: 'What they asked, in their words' }, view: { type: 'string', description: 'A page key to describe, if known' } } },
  api: { method: 'GET', path: '/admin/employees' },
  async run(_ctx, i) {
    const question = str(i.question, 300);
    const view = str(i.view, 40);
    const pages = VIEWS.filter((v) => (view && v.view === view) || (question && score(question, v.keywords, v.title) > 0))
      .map((v) => ({ ...v, s: view && v.view === view ? 99 : score(question, v.keywords, v.title) }))
      .sort((a, b) => b.s - a.s).slice(0, 4);
    const howTos = HOW_TOS.filter((h) => question && score(question, h.keywords, h.title) > 0 || (view && h.view === view))
      .map((h) => ({ ...h, s: score(question, h.keywords, h.title) })).sort((a, b) => b.s - a.s).slice(0, 3);
    const unsupported = NOT_SUPPORTED.filter((n) => question && score(question, [n], '') >= 2);
    const first = howTos[0] ?? pages[0];
    return {
      data: {
        pages: pages.map(({ view: key, title, section, what }) => ({ view: key, title, section, what })),
        howTos: howTos.map(({ key, title, view: key2, steps }) => ({ key, title, view: key2, steps })),
        notSupported: unsupported.length ? unsupported : undefined,
        allNotSupported: !pages.length && !howTos.length ? NOT_SUPPORTED : undefined,
        note: pages.length || howTos.length
          ? 'Answer from these entries only. Name the page as Section › Title and give the steps as listed.'
          : 'Nothing in the dashboard matches. Say plainly that Sowaka does not have this, and list anything close from allNotSupported.',
      },
      links: first ? [{ label: `Open ${first.title}`, view: first.view }] : [],
    };
  },
});
