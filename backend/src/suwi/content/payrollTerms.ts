/**
 * Plain explanations of payroll terms for Suwi, each with a worked example in
 * round numbers. Nothing here is a rate the company uses: the payroll_term
 * tool adds "this company's setting" from the real settings, so Suwi never
 * has to remember or invent one. Text only; keep each entry short.
 */
export interface PayrollTerm {
  key: string;
  title: string;
  /** Other ways people ask for it (lower case). */
  aliases: string[];
  explain: string;
  example: string;
}

export const PAYROLL_TERMS: PayrollTerm[] = [
  {
    key: 'lop',
    title: 'Loss of pay (LOP)',
    aliases: ['loss of pay', 'lop days', 'unpaid days', 'paid days', 'payable days', 'absent deduction'],
    explain: 'Days in the month a person is not paid for. Salary is spread over every day of the month (weekly offs and holidays included), so paid days = days in the month − LOP days, and each earning is paid in that proportion. LOP comes from the attendance calendar (absences, and half days at half a day each), plus whatever the person\'s paid-days template docks for lates or early leaves, less the template\'s paid-leave allowance. HR can type a different LOP figure on the run; that figure is kept until the run is submitted.',
    example: 'Gross salary ₹60,000 for a 30-day month with 3 LOP days: paid days 27, so ₹60,000 × 27 ÷ 30 = ₹54,000 gross that month. One half day costs half a day: ₹1,000.',
  },
  {
    key: 'ctc',
    title: 'CTC, gross and net pay',
    aliases: ['cost to company', 'gross', 'gross pay', 'net', 'net pay', 'take home', 'take-home', 'in hand', 'salary breakup', 'ctc vs gross', 'gross vs net'],
    explain: 'CTC (cost to company) is everything the company spends on a person in a year: the earnings, plus employer contributions (PF, ESI) and benefits (gratuity) when the company counts them inside CTC. Gross pay is the month\'s earnings before anything is taken off. Net pay (take-home) is gross minus the employee\'s deductions (PF, ESI, professional tax, income tax, any advance), plus reimbursements, which are paid on top without tax or deductions.',
    example: 'Annual CTC ₹6,00,000 is ₹50,000 a month. If the employer\'s PF of ₹1,800 sits inside CTC, gross is ₹48,200. Employee PF ₹1,800 and professional tax ₹200 come off, so net pay is ₹46,200. A ₹1,500 internet reimbursement is added on top: ₹47,700 paid.',
  },
  {
    key: 'basic',
    title: 'Basic salary',
    aliases: ['basic pay', 'basic component', 'basic salary'],
    explain: 'The core earning every other percentage hangs on. HRA, statutory bonus and gratuity are worked out as a share of Basic, and PF is contributed on the PF wage, which Basic is always part of. Basic is fully taxable. A higher Basic means more PF and gratuity; a lower Basic leaves more in allowances.',
    example: 'Monthly CTC ₹50,000 with Basic at 50% of CTC: Basic is ₹25,000. HRA at 50% of Basic is then ₹12,500, and employee PF at 12% of Basic is ₹3,000.',
  },
  {
    key: 'hra',
    title: 'House rent allowance (HRA)',
    aliases: ['house rent', 'rent allowance', 'hra exemption'],
    explain: 'An allowance towards rent, usually a share of Basic. Under the old tax regime, part of it is tax-free when the person actually pays rent: the least of HRA received, rent paid minus 10% of Basic, and 50% of Basic in a metro (40% elsewhere). The new regime gives no HRA exemption. Sowaka applies the exemption from the rent declared on the person\'s tax declaration.',
    example: 'Basic ₹3,00,000 a year, HRA ₹1,50,000, rent paid ₹1,80,000 in a metro. Rent − 10% of Basic = ₹1,50,000; 50% of Basic = ₹1,50,000; HRA received = ₹1,50,000. The exempt amount is the least: ₹1,50,000, so the whole HRA is tax-free that year under the old regime.',
  },
  {
    key: 'fbp',
    title: 'Flexible benefit plan (FBP)',
    aliases: ['flexible benefits', 'flexi benefits', 'flexible benefit', 'fbp components'],
    explain: 'A pool inside CTC that the employee chooses how to split between allowances such as meal card, telephone, books or fuel reimbursement, within each component\'s limit. Some of these are tax-free up to a limit or against bills; the rest goes to a taxable allowance. In Sowaka a component is part of the FBP pool when its pay head is marked FBP.',
    example: 'An FBP pool of ₹5,000 a month: the person puts ₹2,200 on the meal card and ₹1,500 on internet, and the remaining ₹1,300 is paid as taxable special allowance.',
  },
  {
    key: 'pf',
    title: 'Provident fund (PF / EPF) and the wage ceiling',
    aliases: ['epf', 'provident fund', 'pf ceiling', 'wage ceiling', 'pf wage', 'eps', 'pension', 'restricted pf', 'actual pf', 'uan', 'edli', 'pf admin charges', '15000', '25000'],
    explain: 'Both the employee and the employer put 12% of the PF wage (Basic and the other components marked for PF) into the person\'s provident fund account every month. The wage ceiling is the most of the PF wage the contribution has to be worked out on: a company can restrict both sides to the ceiling or contribute on the actual wage. Of the employer\'s 12%, 8.33% goes to the pension scheme (EPS, always capped at the ceiling) and the rest to PF; the employer may also pay EDLI (0.5%) and admin charges (0.5%). A company can count the employer\'s share inside CTC or on top of it. The ceiling moved from ₹15,000 to ₹25,000 on 17 September 2026, so September 2026 used a day-weighted average.',
    example: 'PF wage ₹40,000, contributions restricted to a ₹25,000 ceiling: employee PF 12% × ₹25,000 = ₹3,000; employer ₹3,000 of which EPS 8.33% × ₹25,000 = ₹2,083 and EPF ₹917. On the actual wage instead, each side would be ₹4,800.',
  },
  {
    key: 'esi',
    title: 'Employee state insurance (ESI)',
    aliases: ['esic', 'state insurance', 'esi ceiling', '21000', 'esi contribution period'],
    explain: 'Medical and cash-benefit insurance for people whose monthly wage is at or below the ESI ceiling (₹21,000). The employee pays 0.75% of the wage and the employer 3.25%. Eligibility is decided at the start of each contribution period (April–September, October–March): once a person is covered, they stay covered until the period ends even if a raise takes them over the ceiling. A company can count the employer\'s ESI inside CTC or on top.',
    example: 'Gross ₹18,000: employee ESI 0.75% = ₹135, employer 3.25% = ₹585. A raise to ₹23,000 in July keeps ESI on until September; from October, no ESI.',
  },
  {
    key: 'pt',
    title: 'Professional tax (PT)',
    aliases: ['professional tax', 'profession tax', 'pt slab', 'pt slabs'],
    explain: 'A small monthly tax levied by some states on salaried people, deducted by the employer and paid to the state. The amount depends on the state the person works in and their monthly gross, by slabs; some states charge a different amount in one month of the year (Karnataka and Maharashtra in February). Under the old regime it is deductible from taxable income; states like Delhi and Haryana levy none.',
    example: 'Karnataka: gross above ₹25,000 a month → ₹200 PT each month (₹300 in February), ₹2,500 a year. Maharashtra: gross above ₹10,000 → ₹200 a month, ₹300 in February.',
  },
  {
    key: 'tds',
    title: 'Income tax (TDS) and the two regimes',
    aliases: ['income tax', 'tax deducted at source', 'tax regime', 'new regime', 'old regime', 'regimes', 'section 192', 'tax slab', 'tax slabs', 'standard deduction', 'rebate', '87a', 'cess', 'surcharge', 'tax declaration', 'investment declaration', 'proofs', 'tax proofs'],
    explain: 'The employer withholds income tax from salary every month (section 192) so that by March the year\'s tax is paid. Each month the engine projects the year\'s taxable salary (paid so far plus the months to come), works out the annual tax under the person\'s regime, subtracts what has already been withheld, and spreads the rest over the months left. The new regime has lower slab rates, a larger standard deduction and a rebate that makes income up to ₹12 lakh tax-free, but allows almost no deductions. The old regime has higher rates but allows HRA exemption, 80C, 80D, home-loan interest and professional tax. Employees declare their regime and investments; proofs are checked before the year ends. HR can also type a tax figure on a run, which overrides the engine for that month.',
    example: 'New regime, salary ₹13,00,000: after the ₹75,000 standard deduction, taxable ₹12,25,000. Slab tax ₹63,750, but marginal relief just above the ₹12 lakh rebate limit caps it at ₹25,000; plus 4% cess = ₹26,000 for the year, so about ₹2,167 a month over 12 months.',
  },
  {
    key: 'form16',
    title: 'Form 16',
    aliases: ['form 16', 'form-16', 'tds certificate', 'part a', 'part b'],
    explain: 'The certificate the employer gives each employee after the financial year showing the salary paid and the tax deducted and deposited. Part A (from the TRACES portal) lists the TDS deposited quarter by quarter; Part B is the salary break-up and the tax computation. It is due by 15 June and is what the employee files their return from. Sowaka does not yet generate or track Form 16; the TDS work sheet on each payslip holds the same computation.',
    example: 'For FY 2026-27 (April 2026 to March 2027), Form 16 is issued by 15 June 2027. A person who paid ₹26,000 TDS through the year sees ₹26,000 in Part A and the ₹13,00,000 salary computation in Part B.',
  },
  {
    key: 'gratuity',
    title: 'Gratuity',
    aliases: ['gratuity provision', '4.81'],
    explain: 'A lump sum paid when someone leaves after five or more years of continuous service: 15 days\' last-drawn Basic (and DA) for every completed year, tax-free up to ₹20 lakh. Companies provide for it every month at 4.81% of Basic (15 ÷ 26 ÷ 12), which is why it appears as an employer benefit on the salary structure and in cost to company, though nothing is paid to the employee until they leave.',
    example: 'Basic ₹25,000 a month: the monthly provision is 4.81% × ₹25,000 ≈ ₹1,203. Leaving after 6 years with Basic ₹30,000: 15 ÷ 26 × ₹30,000 × 6 = ₹1,03,846 gratuity.',
  },
  {
    key: 'arrears',
    title: 'Arrears and one-time amounts',
    aliases: ['arrear', 'back pay', 'backdated', 'one-time', 'one time', 'bonus payout', 'salary advance', 'hold amount', 'adjustment', 'adjustments'],
    explain: 'Arrears are pay owed for earlier months that is paid now, usually after a backdated salary revision or a correction. In Sowaka they are paid as a one-time amount on the run: HR enters an amount against a one-time component (Bonus, Arrears, Salary Advance deduction, Hold Amount…) for that person and month, and it appears as its own line on that payslip, taxed as that month\'s income.',
    example: 'A raise of ₹5,000 a month effective 1 August is set up in October: the October run pays the new salary plus ₹10,000 arrears for August and September as a one-time line.',
  },
  {
    key: 'fnf',
    title: 'Full and final settlement (F&F)',
    aliases: ['full and final', 'full & final', 'final settlement', 'f&f', 'fnf', 'exit settlement', 'leaver settlement'],
    explain: 'The last payment to someone leaving: salary up to the last working day, leave encashment, any bonus or reimbursement due, and gratuity if eligible, less notice-period recovery, advances and tax. Sowaka pays a leaver\'s last month through the regular run pro-rated to the days worked; a separate F&F run type is not available yet, so encashment or recoveries are entered as one-time amounts on that run.',
    example: 'Leaving on the 10th of a 30-day month with gross ₹60,000: salary ₹20,000 for 10 days, plus 8 days\' leave encashment ₹16,000, less a 15-day notice shortfall ₹30,000 — settlement ₹6,000 before tax.',
  },
  {
    key: 'bonus',
    title: 'Statutory bonus',
    aliases: ['statutory bonus', 'bonus act', '8.33', 'payment of bonus'],
    explain: 'Under the Payment of Bonus Act, people earning up to ₹21,000 a month get a bonus of 8.33% to 20% of their wage (Basic, or the state minimum wage if higher, capped at ₹7,000 a month). Sowaka can pay it monthly as a salary line or yearly, at the rate the company sets.',
    example: 'Basic ₹15,000 and the minimum wage ₹12,000: the bonus base is ₹15,000 (capped at ₹7,000 by the Act for the monthly figure), so 8.33% × ₹7,000 = ₹583 a month.',
  },
  {
    key: 'lwf',
    title: 'Labour welfare fund (LWF)',
    aliases: ['labour welfare', 'welfare fund'],
    explain: 'A small contribution by employee and employer to a state welfare fund, with the amount and the cycle set by each state: some deduct every month, others twice a year (June and December). Sowaka applies the state\'s rule by the person\'s work location, and a company can switch it off for a state.',
    example: 'Haryana: ₹31 from the employee and ₹62 from the employer every month. Delhi: ₹0.75 and ₹2.25, deducted in June and December.',
  },
  {
    key: 'reimbursement',
    title: 'Reimbursements and claims',
    aliases: ['reimbursements', 'claims', 'claim', 'expense claim', 'fuel reimbursement', 'internet reimbursement', 'bills', 'salary reimbursement'],
    explain: 'Two kinds. A salary reimbursement (fuel, internet, telephone…) is a fixed component paid in full every month and counted as taxable until bills come in: an approved claim of the matching type makes that much tax-free rather than being paid again. A business-expense claim (travel, meals…) is submitted with a receipt, approved on the dashboard, and paid on the next payroll run on top of net pay, with no tax or deductions. Each claim type has its own cap and how far back it may be dated.',
    example: 'Internet reimbursement ₹1,500 a month is paid from April. Bills for ₹6,000 approved in July make ₹6,000 of the ₹6,000 paid so far tax-free; the rest of the year is taxable until more bills arrive. A ₹3,200 travel claim approved on 20 October is paid with the October salary.',
  },
  {
    key: 'meal_card',
    title: 'Meal card and food coupons',
    aliases: ['meal card', 'food coupon', 'food coupons', 'sodexo', 'meal allowance', 'food card'],
    explain: 'Money loaded onto a food card instead of paid in cash. It appears as an earning and the same amount comes back off as a food-coupon deduction, so net pay is unchanged. Up to ₹50 a meal (₹2,200 a month for 44 meals; Sowaka treats up to ₹8,800 a month as tax-free under the current rules) is exempt from tax; anything above is taxed.',
    example: 'Meal card ₹2,200 a month: gross goes up by ₹2,200, a ₹2,200 food-coupon deduction brings net back, and ₹2,200 of taxable income is saved — roughly ₹660 a year less tax at 30%.',
  },
  {
    key: 'overtime',
    title: 'Overtime pay',
    aliases: ['ot', 'ot pay', 'overtime hours', 'double rate'],
    explain: 'Pay for approved overtime hours on top of salary. A salary template can set the rule — an hourly rate from monthly Basic or gross (the Factories Act pays twice the ordinary rate) or a flat amount an hour — and the run multiplies it by the month\'s approved overtime hours. Without a rule, HR types the overtime amount on the run. Overtime is taxable and counts in the ESI wage.',
    example: 'Gross ₹30,000, 30-day month, 8-hour day, multiplier 2: hourly rate ₹30,000 ÷ 240 = ₹125, so 10 approved hours pay ₹2,500.',
  },
];

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9&]+/g, ' ').trim();

/** The entry a question most likely means, by key, title or alias; undefined when nothing fits. */
export function findPayrollTerm(text: string): PayrollTerm | undefined {
  const q = norm(text);
  if (!q) return undefined;
  const exact = PAYROLL_TERMS.find((t) => t.key === q || norm(t.title) === q || t.aliases.some((a) => norm(a) === q));
  if (exact) return exact;
  // Longest alias contained in the question wins ("pf ceiling" over "pf").
  let best: { term: PayrollTerm; len: number } | undefined;
  for (const t of PAYROLL_TERMS) {
    for (const a of [t.key, ...t.aliases.map(norm)]) {
      const hit = a.length >= 2 && (q === a || q.includes(` ${a} `) || q.startsWith(`${a} `) || q.endsWith(` ${a}`) || (a.length >= 4 && q.includes(a)));
      if (hit && (!best || a.length > best.len)) best = { term: t, len: a.length };
    }
  }
  return best?.term;
}
