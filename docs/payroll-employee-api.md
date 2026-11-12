# Employee payroll API (app)

Contract for the app's Payroll screens: Payroll home (with its summary
cards), Missing punches, My split / Review split, Payslips / Payslip,
Investment declaration and Investment proofs, "<Month> salary", Tax,
Earnings, EPF, FBP (bills), Downloads › Form 16, plus the HR endpoints that
review proofs, file Form 16, keep an EPF balance and mark calendar days
(§7, §8, §14, §15).

Conventions (same as the rest of the backend):

- Every route needs `Authorization: Bearer <token>`.
- Success: `200` with `{ "success": true, ...body }`.
- Error: `{ "success": false, "message": string, "requestId": string }` with
  the HTTP status listed per endpoint. Show `message` to the person; it is
  written for them.
- Money is **integer paise** in every field ending `Paise` (₹1,500 = `150000`).
- A month is `"YYYY-MM"`, a day `"YYYY-MM-DD"`, a moment an ISO timestamp.
  A financial year is `"2026-27"` (April 2026 to March 2027).
- Every `/payroll/*` route reads the signed-in person's own data only. There
  is no `userId` parameter anywhere on them, so nobody can ask for someone
  else's pay.

**Payroll is off in the app until HR switches it on** for the company
(`appEnabled`, see §8; a company that never set it is off). While it is off,
`GET /payroll/home` answers `{ "success": true, "appEnabled": false, "period", "fy" }`
and nothing else, and every other `/payroll/*` route answers `403`:

```jsonc
{ "success": false, "message": "Payroll is not switched on in the app for your company yet", "requestId": "…",
  "details": { "reason": "payroll_app_off" } }
```

The sign-in / profile payload (`user` from `POST /auth/verify-otp` and `GET /auth/me`) carries
the same switch as `features.payroll` (boolean), so the app can hide the
Payroll entry without another call. (`/payslips/*` is unchanged and not gated.)

**Every payroll value comes from the database, set on the HR dashboard.**
There are no defaults in code. Whatever HR has not set yet is reported as
not set up, never replaced by an invented value:

- a section or to-do carries `"notConfigured": true` and `"missing": [field…]`
  (the settings HR still has to fill: `splitCutoffDay`, `declarationDue`,
  `proofsDue`, `billsDue`, `flexiblePoolPaise`), and its date is `null`;
- an action that needs it answers `409` with
  `{ "message": "…", "details": { "reason": "payroll_not_configured", "missing": ["billsDue"] } }`;
- a FY whose income tax rules (`tds_configs`) are missing answers `409` with
  `details: { "reason": "tax_rules_not_set_up", "fy": "2026-27" }` on the
  declaration endpoints (home shows the declaration as not configured instead).

HR cannot switch Payroll on in the app (§8) until every deadline is set, so
the deadline cases only show if a value is removed from the database by hand.

Deadlines (HR sets them with `PUT /admin/payroll/employee-app-settings`, §8;
the values below are the ones the one-time seed writes, which HR can change):

| What | Deadline |
| --- | --- |
| Change the flexible split | one window a FY, until `splitDue` of the FY (e.g. **15 Nov**, `"11-15"`; not seeded, not required to switch Payroll on: without it the split is not set up, `missing: ["splitDue"]`). After it the split is **locked for the FY** (`locked_for_fy`), a first split too. While open, a change applies from this month until its `splitCutoffDay` (seed: the **15th**), else from next month, and never to a month whose run is locked |
| FBP bills for a month | due by `fbpBillsDueDay` of that month (e.g. the **20th**; not seeded, optional: without it no monthly date is given, `monthlyDueOn: null`); `billsDue` stays the last day any bill of the FY can be sent |
| Fix a missing punch / absent day | **per day**: the day + the correction window of the person's shift policy (`correction.backdateDays`, e.g. 7 days), and only while that month's run is not locked. Not a company setting: it comes from the shift policy, see §2 |
| Choose the regime and declare investments | `declarationDue` of the FY (seed: **30 Nov**, `"11-30"`) |
| Upload investment proofs | `proofsDue` of the FY (seed: **31 Jan**, `"01-31"`) |
| Upload bills for the flexible heads | `billsDue` of the FY (seed: **31 Mar**, `"03-31"`) |

A payroll run is **locked** for a month once it is past draft: status
`pending_approval`, `approved` or `paid`. A `draft` run is still being worked
on and does not lock anything.

---

## 1. Payroll home

### `GET /payroll/home`

Query: `period` (optional, `YYYY-MM`, default the pay period holding today, by
the company's `payroll_periods`: paying 26th to 25th, 28 Oct is in `"2026-11"`;
a pay period that has not started is refused, 400).

```jsonc
{
  "success": true,
  "appEnabled": true,                  // false: Payroll is off for the company; the body is only appEnabled, period, fy
  "period": "2026-10",                 // the pay period the salary is for
  "fy": "2026-27",
  "form16Enabled": false,              // the app shows Form 16 (Downloads' tab, the Tax page's row) only when true (§14, the Form 16 switch)
  "payPeriod": { "period": "2026-10", "from": "2026-09-26", "to": "2026-10-25", "baseDays": 30 },   // null when HR's pay cycle is not usable
  "hasSalaryStructure": true,          // false: no structure assigned yet; salary and salaryNotSetUp are null
  "salaryNotSetUp": null,              // or { "notConfigured": true, "reason": "statutory_not_set_up" | "tax_rules_not_set_up" | "pay_period_not_set_up", "fy": "2026-27" | null,
                                       //      "message": "… Ask HR." }: the pay cannot be worked out until HR sets this up; salary is null (no made-up figures)
  "salary": {
    "period": "2026-10",
    "status": "estimate",              // "estimate" (the payslip a run made now would give this person: same lines, LOP from attendance to yesterday by their paid days template, same TDS) | "final" (from the released payslip)
    "payslipId": null,                 // string when status is "final"
    "periodFrom": "2026-09-26",        // the pay period's days (null on "final": they are on the run)
    "periodTo": "2026-10-25",
    "baseDays": 30,                    // loss of pay = gross ÷ baseDays × lopDays; on "final" the run's own; null if unknown
    "grossPaise": 12400000,            // gross before loss of pay
    "lopDays": 2,                      // may be a half: 1.5
    "lopPaise": 800000,                // from the earnings alone: overtime never offsets it
    "overtimePaise": 0,                // approved overtime: on "final" the payslip's (the template's rule, or HR's amount); on an estimate what the run would pay by the template's rule
    "deductions": [                    // employee deductions, in payslip order; keys: "epf" | "esi" | "pt" | "lwf" | "income_tax" | a pay head code
      { "key": "epf", "label": "Provident fund", "amountPaise": 180000 },
      { "key": "income_tax", "label": "Income tax (TDS)", "amountPaise": 760000 },
      { "key": "pt", "label": "Professional tax", "amountPaise": 20000 }
    ],
    "netPaise": 10640000,              // gross − LOP + overtime − deductions
    "reimbursementsPaise": 0,          // flexible heads and other reimbursements paid with salary
    "takeHomePaise": 10640000          // net + reimbursements
  },
  "todo": [                            // only what needs action now, in this order; empty when nothing does
    { "kind": "missing_punches", "count": 4, "dueOn": "2026-10-20", "period": "2026-10" },   // count: fixable days only; dueOn: the earliest fixBy among them
    { "kind": "flexible_split", "dueOn": "2026-11-15", "effectiveFrom": "2026-11", "submitted": false },
    { "kind": "fbp_bills", "pending": 3, "notUploaded": 3, "rejected": 1, "inReview": 3, "dueOn": "2026-10-20", "billsDueOn": "2027-03-31" },   // bills to upload (pending) or re-upload (rejected) this FY, while bills are open; dueOn: this month's due date (fbpBillsDueDay), null when not set
    { "kind": "tax_regime", "regime": "new", "chosen": false, "dueOn": "2026-11-30" },
    { "kind": "investment_proofs", "notUploaded": 3, "rejected": 1, "dueOn": "2027-01-31" }
  ],
  "cards": {                           // the summary carousel; each card is null when it has nothing to show
    "salary": {                        // the PREVIOUS pay period's salary: its released payslip, else the estimate over all its days.
                                       // null: no salary structure, or joined after that period ended
      "period": "2026-09", "label": "September",
      "notConfigured": false,
      "released": true,                // false: an estimate
      "payslipId": "…",                // null on an estimate
      "daysPaid": 28, "daysInPeriod": 30,   // daysPaid = base days − LOP days; both null when the payslip has no base days
      "grossPaise": 12400000, "takeHomePaise": 10640000, "deductionsPaise": 960000,
      "lopPaise": 800000, "lopDays": 2,
      "overtimePaise": 0, "reimbursementsPaise": 0     // paid on top of gross (inside the take-home)
    },
    // not set up: { "period", "label", "notConfigured": true, "reason": "statutory_not_set_up" | "tax_rules_not_set_up" | "pay_period_not_set_up",
    //               "fy": "2026-27" | null, "message": "… Ask HR." }  (as salaryNotSetUp; no figures)
    "tax": {                           // income tax this FY
      "fy": "2026-27",
      "notConfigured": false,
      "regime": "new", "regimeChosen": false,
      "paidSoFarPaise": 4560000,       // paidBeforeThisMonthPaise + thisMonthPaise (0 while that is null)
      "paidBeforeThisMonthPaise": 3800000,   // released payslips' TDS, April to the month before `thisMonth`
      "thisMonthPaise": 760000,        // this pay period's payslip once released, else home's estimate; null while the pay can't be worked out
      "thisMonthReleased": false,
      "fromMonth": "2026-04",
      "toMonth": "2026-10",            // the last month the total covers (the month before thisMonth while thisMonthPaise is null)
      "thisMonth": "2026-10"
    },
    // not set up: { "fy", "notConfigured": true, "reason": "tax_rules_not_set_up", "message": "The income tax rules for FY 2026-27 are not set up yet. Ask HR." }
    "fbp": {                           // null without flexible components
      "poolPaise": 600000,             // null: the template has no flexiblePoolPaise (show as split, with no "Not assigned" share)
      "heads": [ { "code": "FUEL", "name": "Fuel & vehicle", "amountPaise": 250000 } ],   // heads above 0 only
      "assignedPaise": 450000, "unassignedPaise": 150000,
      "notConfigured": false, "missing": []    // as GET /payroll/split
    }
  },
  "missingPunches": { "period": "2026-10", "count": 4, "fixBy": "2026-10-20", "locked": false },   // as GET /payroll/missing-punches: fixBy null when nothing is fixable
  "split": {                           // null when the person's template has no flexible components
    "notConfigured": false, "missing": [],   // true + e.g. ["flexiblePoolPaise"]: HR has not set something the split needs; dates/pool may be null
    "open": true, "effectiveFrom": "2026-11", "closesOn": "2026-11-15",
    "poolPaise": 600000, "assignedPaise": 450000, "unassignedPaise": 150000,
    "bills": { "approved": 16, "inReview": 3, "rejected": 1 }
  },
  "declaration": { "fy": "2026-27", "regime": "new", "chosen": false, "status": "not_started", "locked": false, "dueOn": "2026-11-30",
                   "notConfigured": false, "reason": null, "missing": [] },
  // not set up: { "fy", "regime": null, "chosen": false, "status": null, "locked": false, "dueOn": null,
  //               "notConfigured": true, "reason": "tax_rules_not_set_up" | "payroll_not_configured", "missing": [] | ["declarationDue"] }
  "proofs": { "fy": "2026-27", "required": false, "dueOn": "2027-01-31", "notConfigured": false, "missing": [],
              "notUploaded": 0, "uploaded": 0, "approved": 0, "rejected": 0 }
}
```

- Every to-do carries `notConfigured`. When true it also has `reason`
  (`"payroll_not_configured"`, or `"tax_rules_not_set_up"` for `tax_regime`)
  and `missing`, and its `dueOn` is `null`: show it as "not set up yet", not
  as something to do by a date.
- `todo` kinds: `missing_punches` (some day can still be fixed: inside its
  correction window, month not locked, no pending or approved correction;
  `dueOn` is the earliest of those days' `fixBy`), `flexible_split`
  (no split submitted yet for the FY the window is in), `fbp_bills` (a bill
  for a flexible head was rejected this FY; `inReview` is for the subtitle), `tax_regime`
  (regime not chosen yet and before the deadline), `investment_proofs` (old
  regime, something not uploaded or rejected, before the deadline).
- `cards.salary` is the pay period before `period` (the one most recently
  over); tap through to `GET /payroll/me/salary` (§9) with that `period`.
  `cards.tax` reads the declaration's regime; it is not set up when the FY's
  income tax rules are missing. `cards.fbp` is `GET /payroll/split` in short.
- `missingPunches` (and the `missing_punches` to-do) stay on the calendar
  month, as the attendance calendar shows them, whatever the pay period.
- A FY with no statutory row (`payroll_statutory_configs`) or a pay cycle that
  does not make sense never fails home: `salaryNotSetUp` says so and the rest
  of home is as usual. A released payslip is shown either way.
- Errors: `401` not signed in; `409` the account has no company.
- Every `409` from these routes says what to do; one the employee cannot fix
  ends with "Ask HR." (or "…, ask HR."), which the app turns into a Support
  Desk link. Setup errors from payroll itself (statutory or tax rows, pay
  cycle) come back with `details.reason: "payroll_not_configured"`.

---

## 2. Missing punches

### `GET /payroll/missing-punches`

Query: `period` (optional, `YYYY-MM`, default this month; not in the future).

```jsonc
{
  "success": true,
  "period": "2026-10",
  "fixBy": "2026-10-20",         // the earliest fixBy among the days counted; null when none can be fixed
  "locked": false,               // the month's run is locked: no day of it can be fixed any more
  "count": 4,                    // days still to fix: canFix and no pending or approved correction
  "days": [
    {
      "date": "2026-10-01",
      "weekday": "Thu",
      "punchIn": null,           // ISO timestamp or null ("NA")
      "punchOut": null,
      "trigger": "Both punches missing",   // "Missing punch-in" | "Missing punch-out" | "Both punches missing"
      "status": "absent",        // the graded day: "missed_punch" | "absent"
      "label": "Absent",         // how the calendar reads it
      "countsAs": null,          // for a missed punch: "Absent" | "Half Day" | ... what it counts as
      "fixBy": "2026-10-08",     // last day this day can be fixed: date + the shift policy's correction.backdateDays; null when the policy allows no correction of it
      "canFix": false,           // false: show it, but not as something to fix
      "closedReason": "window_closed",   // null | "window_closed" (past fixBy) | "payroll_locked" (the month's run is locked) | "corrections_off" (the policy does not let this day be corrected)
      "closedMessage": "The time to fix this day has passed",   // for the person; null when canFix
      "request": null            // or { "id": "…", "status": "pending" | "approved" | "declined", "requestedDayType": "full_day" | … }
    }
  ]
}
```

Only past working days (today is not final yet) graded `missed_punch` or
`absent`. Week-offs, holidays and leave never appear.

**Fix-by is per day, from the shift policy's correction window**, the same
rule `POST /attendance/regularizations` enforces: the policy that governed
that day (the person's shift template on that date, else the company's shift
policy) gives `correction.backdateDays`, and the day can be fixed until
`date + backdateDays` (India date). A month whose run is locked closes every
day of it at once (`payroll_locked`). A policy that allows no correction of
that kind of day (its trigger, e.g. "Both punches missing", switched off, or
`backdateDays` 0) makes it `corrections_off` with `fixBy: null`. Days that
cannot be fixed are still listed, so the person sees them, but are not counted.

**Fixing a day** reuses the existing correction flow, unchanged:
`POST /attendance/regularizations` with `{ "workDate": "2026-10-01", "dayType": "full_day", "note": "…" }`
(see the attendance API; its errors are the ones to show). Re-fetch this list
afterwards: the day then carries `request.status: "pending"` and stops
counting.

Errors: `400` bad or future `period`.

---

## 3. Flexible split (FBP)

The flexible components are the reimbursement heads on the person's salary
template (Fuel & vehicle, Internet, Telephone, Books & periodicals, …) and any
pay head marked `fbp`, that are set per person (not a fixed amount every
month) and have a monthly limit (`maxClaimablePaise`) above zero. The person
splits a monthly **pool** among them, each within its limit. What is left
unassigned is paid with salary as the template's balancing component (Fixed
Allowance) and taxed in full. Assigned amounts are paid every month and become
tax-free as bills are approved.

The pool is the template's `flexiblePoolPaise` (HR sets it on the salary
template, see §7), and only that: a template with flexible components but no
pool reports `notConfigured: true, missing: ["flexiblePoolPaise"]`, `poolPaise`
and `unassignedPaise` `null`, and the split cannot be reviewed or saved (409).

A split takes effect from one month (`effectiveFrom`) to the end of the FY and
replaces any split before it from that month on.

### `GET /payroll/split`

```jsonc
{
  "success": true,
  "split": {
    "available": true,                 // false: no flexible components; everything below is empty
    "notConfigured": false,            // true: HR has not set something it needs; review/save answer 409
    "missing": [],                     // of "flexiblePoolPaise" | "splitCutoffDay" | "splitDue" | "billsDue" | "splitStepPaise"
    "editable": true,                  // it can be changed now: window open and nothing missing
    "lockedReason": null,              // "locked_for_fy" past the FY's close date (splitDue): a change goes through a ticket
    "closesOn": "2026-11-15",          // while editable: the last day it can be changed (and changed again) this FY; else null
    "poolPaise": 600000,               // null when the template has no flexiblePoolPaise
    "assignedPaise": 450000,
    "unassignedPaise": 150000,
    "stepPaise": 50000,                // each − / + moves a head this much (HR's splitStepPaise, §8); null: not set up (missing names it)
    "components": [
      {
        "code": "FUEL",
        "name": "Fuel & vehicle",      // payslip name
        "limitPaise": 300000,          // "Max ₹3,000"
        "amountPaise": 250000,         // what applies for window.effectiveFrom today
        "stepPaise": 50000,            // the same step as above (null when not set); any whole-rupee amount is accepted
        "bills": { "approved": 4, "inReview": 1, "rejected": 2 }   // this FY's bills for this head
      }
    ],
    "current": { "effectiveFrom": "2026-04", "submittedAt": "2026-04-10T09:12:00.000Z", "billsAcknowledgedAt": "2026-04-10T09:12:00.000Z" },  // billsAcknowledgedAt: when the bills tick was given; null on splits saved before it was kept;  // the split in force for window.effectiveFrom; null: the template's amounts
    "window": {                        // without a splitCutoffDay or splitDue: { "open": false, "effectiveFrom": null, "effectiveTo": null, "closesOn": null, "reason": "payroll_not_configured", "missing": [...] }
                                       // past the close date: { "open": false, "effectiveFrom": null, "effectiveTo": null, "closesOn": "2026-11-15", "reason": "locked_for_fy", "missing": [] }
      "open": true,
      "effectiveFrom": "2026-11",      // the first month a change made now applies to
      "effectiveTo": "2027-03",        // the FY's last month
      "closesOn": "2026-11-15",        // the FY's close date (splitDue): the last day to change it this FY
      "reason": null,
      "missing": []
    },
    "billsDueOn": "2027-03-31"
  }
}
```

### `POST /payroll/split/review`

Checks a split and shows what it will be, without saving. Body:

```jsonc
{ "amounts": { "FUEL": 300000, "INTERNET": 100000, "TELEPHONE": 150000, "BOOKS": 50000 } }
```

Codes left out keep their current amount. A split that changes nothing from
the one in force (or, with none, the structure's own amounts) is refused
(`400`, "Nothing has changed in your split …").

```jsonc
{
  "success": true,
  "review": {
    "effectiveFrom": "2026-11", "effectiveTo": "2027-03", "closesOn": "2026-11-15",
    "lines": [
      { "code": "FUEL", "name": "Fuel & vehicle", "previousPaise": 250000, "amountPaise": 300000, "changePaise": 50000, "isNew": false },
      { "code": "BOOKS", "name": "Books & periodicals", "previousPaise": 0, "amountPaise": 50000, "changePaise": 50000, "isNew": true }
    ],
    "totalPaise": 600000,
    "poolPaise": 600000,
    "unassignedPaise": 0,
    "monthlyTaxSavingPaise": 94000,    // about this much less tax a month once bills are approved, for the whole new split (the TDS engine on the FY's tax rules); null when the rules are not set up or it cannot be worked out
    "billsDueOn": "2027-03-31"
  }
}
```

### `PUT /payroll/split`

Saves it. Body: `{ "amounts": { … }, "acknowledged": true, "effectiveFrom": "2026-11" }` —
`acknowledged` is the "I'll keep bills … and upload them by 31 Mar" tick and
must be `true` (the split row keeps when it was given, `billsAcknowledgedAt`); `effectiveFrom` (optional, recommended) is the month the
Review screen showed: if the window has moved since (the cutoff passed or a
run locked that month), the save is refused with `409` and the app should
review again.
Response: the same `split` object as `GET /payroll/split`, now with the new
amounts and `current.effectiveFrom` = `window.effectiveFrom`. Saving again
for the same month replaces it.

**How the window works.** Each FY has one window, closing on the company's
`splitDue` for that FY (the FY of the month a change made now would apply
from). Until then a change can be made, and made again. A change made today
applies from this month while today is on or before the cutoff day (15th)
and this month's run is not locked; otherwise from the next month whose run
is not locked. After the close date the split is locked for the rest of the
FY: GET says `editable: false, lockedReason: "locked_for_fy"`, review and
save answer `409` `split_locked`. There is no exception for a first split:
someone who joins after the close date is paid their structure's amounts. A month whose
run is locked never changes. The payroll run pays each month the split in
force for that month (the latest one starting on or before it, same FY), on
top of the structure's own values; months before it keep what they had.

Errors (both review and save):
- `400` an unknown or non-flexible code; an amount that is negative, not whole
  rupees (multiple of 100 paise), or above its `limitPaise`; the total above
  `poolPaise`; nothing changed from the split in force; `acknowledged` not
  true (save only).
- `404` no salary structure assigned.
- `409` no flexible components on the template; (save) `effectiveFrom` no
  longer matches the window; `split_locked` past the FY's close date
  ("Your split is locked for this FY. To change it, raise a ticket.");
  `payroll_not_configured` (pool, cutoff day, close date, bills date or
  split step not set; `details.missing` names them).

---

## 4. Payslips

Only payslips from runs that are approved or paid. A draft run is never shown.

### `GET /payslips/mine`

Query: `limit` (optional, 1–24, default 3 — the default keeps older app
versions unchanged; the Payslips screen asks for 12).

```jsonc
{
  "success": true,
  "company": { "name": "Sowaka Technologies", "address": "…", "org": "sowaka" },  // null when there are none
  "payslips": [
    {
      "run": { "id": "…", "period": "2026-09", "status": "paid", "paidAt": "…", … },
      "payslip": {
        "id": "…", "period": "2026-09", "employeeName": "…", "employeeId": "…", "designation": "…", "department": "…",
        "annualCtcPaise": 0, "monthlyCtcPaise": 0,
        "earnings": [{ "code": "BASIC", "name": "Basic", "calcLabel": "50% of CTC", "fullPaise": 0, "paidPaise": 0, "hidden": false }],
        "deductions": [{ "key": "epf", "name": "EPF", "amountPaise": 0 }],
        "reimbursementLines": [{ "code": "FUEL", "name": "Fuel Reimbursement", "amountPaise": 0 }],
        "grossPaise": 0, "employeeDeductionsPaise": 0, "netPaise": 0, "reimbursementsPaise": 0, "netPayablePaise": 0,
        "inputs": { "workingDays": 31, "lopDays": 0, "payableDays": 31, … },
        "ytd": { "earnings": { "BASIC": 0 }, "deductions": { "epf": 0 }, "reimbursementsPaise": 0 },
        "bankAccountNo": "XXXX1234"
      }
    }
  ]
}
```

(The shape is the existing one, unchanged.)

### `GET /payslips/:payslipId`

One of the person's own payslips: `{ "success": true, "company": {…}, "run": {…}, "payslip": {…} }`
with the same `run` and `payslip` shapes as above.
Errors: `404` not theirs, not released, or no such id.

### Existing, unchanged
- `GET /payslips/:payslipId/html` → `{ "html": string }` (the printable payslip).
- `GET /payslips/:payslipId/calendar` → `{ "calendar": … }` (the graded month: why pay was lost).

---

## 5. Investment declaration

One declaration per FY. The regime is **new** until the person chooses.

Items and the section each counts in:

| key | label | section | cap (old regime) |
| --- | --- | --- | --- |
| `epf` | Provident fund (from payroll) — read only | 80C | ₹1,50,000 for the whole section |
| `ppf` | PPF | 80C | (shared) |
| `elss` | ELSS mutual funds | 80C | (shared) |
| `lifeInsurance` | Life insurance | 80C | (shared) |
| `other80C` | Other 80C (tuition, NSC, FD, home loan principal) | 80C | (shared) |
| `nps` | NPS, your own contribution | 80CCD(1B) | ₹50,000 |
| `healthSelf` | Health insurance, self and family | 80D | ₹25,000 (₹50,000 if `selfSenior`) |
| `healthParents` | Health insurance, parents | 80D | ₹25,000 (₹50,000 if `parentsSenior`) |
| `rentMonthly` | Rent a month (HRA) | HRA | no cap; the exemption is worked out from Basic, HRA and rent |
| `homeLoanInterest` | Home loan interest (a year) | 24(b) | ₹2,00,000 |

Caps come only from the FY's old-regime tax config (`tds_configs`), so a new
Finance Act is a data change. There are no figures in code: a FY with no
old-regime row answers `409` (`details.reason: "tax_rules_not_set_up"`, message
"The income tax rules for FY 2026-27 are not set up yet. Ask HR.") on GET and
PUT. (The table's amounts are the FY 2026-27 rows as seeded, for illustration.) Amounts above a cap are accepted and kept (the
proof may still be asked for), but only the cap counts: see `countedPaise`.
Every amount is a year's amount except `rentMonthly`. For 80D the section's
`capPaise` is the self and parents limits together; each item counts up to
its own limit. The HRA section's `countedPaise` is the year's rent; the
exemption itself is worked out by the payroll run from Basic, HRA and rent.

On the **new regime** none of these reduce tax: every section comes back with
`applicable: false` and `note: "Not needed on the new regime"`, amounts are
kept (in case the person switches back) but `countedPaise` is 0, and no
proofs are asked for.

### `GET /payroll/tax-declaration`

Query: `fy` (optional, default the current FY).

```jsonc
{
  "success": true,
  "declaration": {
    "fy": "2026-27",
    "regime": "old",                 // "new" | "old"
    "chosen": true,                  // false: never chosen, "new" is the default
    "status": "submitted",           // "not_started" | "saved" | "submitted"
    "locked": false,                 // past dueOn: read only
    "dueOn": "2026-11-30",
    "proofsDueOn": "2027-01-31",
    "submittedAt": "2026-10-30T10:00:00.000Z",   // or null
    "metro": false, "selfSenior": false, "parentsSenior": false,
    "sections": [
      {
        "key": "80C", "label": "80C investments",
        "capPaise": 15000000,         // null: no cap (HRA)
        "declaredPaise": 15000000,    // items together (epf included)
        "countedPaise": 15000000,     // min(declared, cap); 0 on the new regime
        "applicable": true,
        "note": null,                 // "Not needed on the new regime" | "Old regime only"
        "items": [
          { "key": "epf", "label": "Provident fund (from payroll)", "amountPaise": 2160000, "readOnly": true, "proofNeeded": false },
          { "key": "ppf", "label": "PPF", "amountPaise": 5000000, "readOnly": false, "proofNeeded": true }
        ]
      }
      // "80CCD1B", "80D", "HRA", "24B"
    ],
    "regimes": [ { "regime": "new", "configStatus": "confirmed" }, { "regime": "old", "configStatus": "confirmed" } ]
  }
}
```

`epf` is the year's employee PF from the salary structure (a normal month × 12).

### `PUT /payroll/tax-declaration`

Query: `fy` (optional). Body:

```jsonc
{
  "regime": "old",                    // required: "new" | "old"
  "items": { "ppf": 5000000, "elss": 5000000, "lifeInsurance": 2840000, "other80C": 0,
             "nps": 0, "healthSelf": 2500000, "healthParents": 0,
             "rentMonthly": 1500000, "homeLoanInterest": 0 },   // any subset; left out = unchanged; 0 or null clears
  "metro": false, "selfSenior": false, "parentsSenior": false,   // optional
  "submit": true                      // false/absent: "Declaration saved"; true: "Declaration submitted"
}
```

Response: the same `declaration` object as the GET.

Errors: `400` unknown regime, unknown item, `epf` sent, an amount not a
whole non-negative number of paise, or bad `fy`; `409` past the deadline
(`locked`), `tax_rules_not_set_up`, or `payroll_not_configured` (no
`declarationDue`).

Without a `declarationDue` the GET has `"notConfigured": true, "missing": ["declarationDue"], "dueOn": null, "locked": false`
(and `proofsDueOn` is `null` without a `proofsDue`).

The TDS a payroll run withholds reads this declaration (the item totals per
section) from the next run on.

---

## 6. Investment proofs

One proof file per declared item (old regime, amount above 0, `proofNeeded`).
Status per item:

| status | meaning | app shows |
| --- | --- | --- |
| `not_uploaded` | nothing yet | Upload proof |
| `uploaded` | sent, HR has not looked yet | In review |
| `approved` | HR accepted it | Approved |
| `rejected` | HR sent it back with `reason` | Rejected · Re-upload proof |

### `GET /payroll/investment-proofs`

Query: `fy` (optional).

```jsonc
{
  "success": true,
  "proofs": {
    "fy": "2026-27",
    "regime": "old",
    "required": true,                 // false on the new regime (items is empty)
    "dueOn": "2027-01-31",
    "locked": false,                  // past dueOn: no uploads
    "notConfigured": false, "missing": [],   // true + ["proofsDue"]: HR has not set the due date (dueOn null, no uploads)
    "itrDueOn": "2027-07-31",         // the FY's income tax return date (31 July after the FY, s.139(1)): the law's, not HR's
    "closed": null,                   // set once locked (past dueOn):
    // {
    //   "closedOn": "2027-01-31",
    //   "submitted": 3, "notSubmitted": 1, "total": 4,     // submitted = uploaded + approved
    //   "lastPayPeriod": "2027-03",                         // the FY's last payroll a late proof (through HR) can still reach
    //   "itrDueOn": "2027-07-31",                           // where the rest can still be claimed
    //   "counted": {                                        // "What counted"
    //     "rows": [ { "item": "ppf", "label": "PPF", "provedPaise": 5000000, "notProvedPaise": 0 } ],
    //                                                       // a sent proof counts up to its amount, capped at yearPaise; one never sent or rejected counts 0
    //     "provedPaise": 12840000, "notProvedPaise": 2160000,
    //     "pfPaise": 2160000                                // the year's employee PF from payroll: counts under 80C with no proof (0 with no items)
    //   }
    // }
    "summary": { "total": 4, "notUploaded": 1, "uploaded": 2, "approved": 0, "rejected": 1,
                 "submitted": 2, "notSubmitted": 2,   // submitted = uploaded + approved
                 "allSent": false,      // nothing left not uploaded or rejected ("All bills sent for review")
                 "allApproved": false }, // every item approved ("All set")
    "sections": [                     // the same items grouped by section, in declaration order; sections with no items left out
      { "key": "80C", "label": "80C", "items": [ /* entries as in items */ ] }
      // labels: "80C", "NPS (80CCD 1B)", "80D", "Rent (HRA)", "Home loan"
    ],
    "items": [
      {
        "item": "ppf", "label": "PPF", "section": "80C",   // proof labels: e.g. "Rent", "NPS · your own contribution", "Health insurance · parents"
        "declaredPaise": 5000000,      // as declared (rent: a month)
        "perMonth": false,             // true for rentMonthly only
        "months": null,                // rent: { "from": "2026-04", "to": "2027-03" } ("₹15,000 a month · Apr to Mar")
        "yearPaise": 5000000,          // the FY's amount the proof is set against (rent: declaredPaise × 12)
        "document": "PPF passbook or statement",   // what to upload
        "status": "rejected",
        "proof": {                      // null when not_uploaded
          "id": "…",
          "fileName": "ppf-passbook.pdf", "contentType": "application/pdf", "size": 182311,
          "amountPaise": 5000000,       // "Amount on proof"
          "uploadedAt": "…",
          "decidedAt": "…",             // or null
          "reason": "This certificate is for FY 2025–26. Upload the one for FY 2026–27.",   // rejected only
          "landlordPan": null           // rent only: the PAN they typed, in full (their own proof); null when none
        }
      }
    ]
  }
}
```

### `POST /payroll/investment-proofs/:item`

Upload or re-upload the proof for one item. `multipart/form-data`:
- `proof` — the file: PDF, JPEG or PNG, at most 5 MB.
- `amountPaise` — the amount on the proof (whole paise, > 0).
- `landlordPan` — optional, `rentMonthly` only: the landlord's PAN
  (`ABCDE1234F`; spaces dropped, upper-cased). Stored encrypted. A re-upload
  without it removes the earlier one.

Query: `fy` (optional). Response: `{ "success": true, "item": { …one entry of items… } }`
with `status: "uploaded"`. A re-upload replaces the earlier file and clears
the rejection.

Errors: `400` no file, not PDF/JPEG/PNG, bad `amountPaise`, an item not
declared (or `epf`), new regime, a `landlordPan` on anything but rent ("Only
rent takes a landlord PAN") or not shaped like a PAN; `409` the item is already approved, past
`dueOn`, or `payroll_not_configured` (no `proofsDue`; the GET then has
`"notConfigured": true, "missing": ["proofsDue"], "dueOn": null`); `413` file over 5 MB; `503` file storage not configured.

### `GET /payroll/investment-proofs/:item/file`

`{ "success": true, "url": "https://…" }` — a short-lived link to view the
uploaded file. `404` nothing uploaded.

---

## 7. HR (dashboard) endpoints

Under `/admin/payroll`, so they need dashboard access, and in addition payroll
access as everywhere else that shows what people earn: a dashboard admin,
someone with every tab, or someone given **Payroll Runs** or **Salary
details**. Anyone else gets `403`. Only people of the viewer's own company.

### `GET /admin/payroll/investment-proofs`

Query: `fy` (optional), `status` (optional: `uploaded` | `approved` | `rejected`), `userId` (optional).

```jsonc
{
  "success": true,
  "fy": "2026-27",
  "proofs": [
    { "id": "…", "userId": "…", "employeeName": "…", "employeeId": "SW001",
      "fy": "2026-27", "item": "ppf", "label": "PPF", "section": "80C",
      "document": "PPF passbook or statement",   // what the employee was asked to upload; null for an unknown item
      "declaredPaise": 5000000, "amountPaise": 5000000,
      "status": "uploaded", "fileName": "…", "contentType": "application/pdf", "size": 182311,
      "uploadedAt": "…", "decidedAt": null, "decidedByUserId": null, "reason": null,
      "landlordPan": null }             // rent: masked, "•••• 234F" (a third party's PAN is never listed in full)
  ]
}
```

Oldest upload first.

### `GET /admin/payroll/investment-proofs/:proofId/file`

`{ "success": true, "url": "https://…" }`.

### `POST /admin/payroll/investment-proofs/:proofId/decision`

Body: `{ "decision": "approved" | "rejected", "reason": "…" }` — `reason` is
required (3–500 characters) to reject (`note` is read the same as `reason`). Response: `{ "success": true, "proof": { … as in the list … } }`.
When every proof of the person's declaration is approved, the declaration's
proof state becomes `verified`; otherwise `submitted` while anything is
uploaded.

Errors: `400` bad decision or missing reason; `403` no payroll access; `404`
no such proof in the viewer's company; `409` the proof was replaced since
(only an `uploaded` proof can be decided).

### Salary template: the flexible pool

`PUT /admin/payroll/salary-templates/:code` (and `POST`) accept an optional
`flexiblePoolPaise` (whole rupees in paise, ≥ 0; `null` removes it): the
monthly pool people on this template split among the flexible components.
`GET` returns it.

### `GET /admin/payroll/employees/:userId/flexible-split`

One employee's flexible split for a FY, for the dashboard. Query: `fy`
(optional, default the current FY). Payroll access and the same company:
`403` without payroll access, `404` for someone of another company (or no
such person), `400` bad `fy`.

```jsonc
{
  "success": true,
  "split": {
    "fy": "2026-27",
    "employee": { "userId": "…", "name": "Asha Test", "employeeId": "E-ASHA" },
    "hasSalaryStructure": true,          // false: no structure; baseline is empty, versions may still show
    "available": true,                   // the template has flexible components today
    "template": { "code": "FLEX", "name": "Flexible" },   // null without a structure
    "poolPaise": 600000,                 // today's pool: the template's flexiblePoolPaise; null without one (or without a structure)
    "notConfigured": false,              // true: the pool, the cutoff day, the bills date or the split step is not set
    "missing": [],                       // of "flexiblePoolPaise" | "splitCutoffDay" | "billsDue" | "splitStepPaise"
    "asOf": "2026-10",                   // the month "in force now" means: this month; a past FY's last month; null for a future FY
    "baseline": [                        // what applies with no split: the structure's own amounts
      { "code": "FUEL", "name": "Fuel & vehicle", "amountPaise": 250000, "limitPaise": 300000 }
    ],
    "current": { … one of versions … },  // the version in force at asOf; null: none (the baseline applies)
    "versions": [                        // every split of the FY, oldest first
      {
        "effectiveFrom": "2026-07",
        "effectiveTo": "2026-10",        // the month before the next version, else the FY's last month
        "submittedAt": "2026-07-10T09:12:00.000Z",
        "billsAcknowledgedAt": "2026-07-10T09:12:00.000Z",   // when they ticked "I'll keep bills …"; null on splits saved before it was kept
        "inForce": false,
        "poolPaise": 600000,             // the pool it was saved against
        "poolSource": "saved",           // "saved" | "current_template" (older splits, saved before the pool was kept) | null
        "assignedPaise": 450000,
        "unassignedPaise": 150000,       // null when the pool is unknown
        "components": [                  // today's flexible components, then any other code the split has
          { "code": "FUEL", "name": "Fuel & vehicle", "amountPaise": 250000, "limitPaise": 300000 }   // limitPaise: as saved, else today's; null if unknown
        ]
      }
    ],
    "window": { "open": true, "effectiveFrom": "2026-11", "effectiveTo": "2027-03", "closesOn": "2026-11-15", "reason": null },  // when the employee's next change would apply
    "billsDueOn": "2027-03-31"
  }
}
```

---

## 8. The app's Payroll settings (HR)

### `GET /admin/payroll/employee-app-settings`

Payroll access only (`403` otherwise); the viewer's own company. Query: `fy`
(optional, default the current FY) for the `dates` block.

```jsonc
{
  "success": true,
  "fy": "2026-27",
  "settings": {                        // as stored; null = HR has not set it (there are no defaults)
    "appEnabled": false,               // show Payroll in the app; off until HR turns it on
    "splitCutoffDay": 15,              // day of the month until which that month's split can change
    "declarationDue": "11-30",         // MM-DD, in the FY's first calendar year (April to December)
    "proofsDue": "01-31",              // MM-DD, in the FY's second calendar year (January to March)
    "billsDue": null,                  // MM-DD, in the FY's second calendar year (January to March)
    "splitStepPaise": 50000,           // paise, whole rupees: each − / + on My split moves a head this much. Not a deadline (not in missing, does not hold Payroll off); while null the split says not set up
    "splitDue": "11-15",               // MM-DD, any day of the FY (April–December: its first year; January–March: its second): the FY's one split window closes on it, then the split is locked for the FY. Not a deadline; while null the split says not set up
    "fbpBillsDueDay": 20               // 1 to 28: each month's FBP bills are due by this day of the month. Not a deadline; while null no monthly date is shown
  },
  "missing": ["billsDue"],             // deadlines still to set; Payroll can be switched on only when empty
  "ready": false,                      // missing is empty
  "dates": {                           // the deadlines as days of `fy`, this month's split cutoff and FBP bills due date; null where not set
    "splitClosesOn": "2026-11-15",     // from splitDue
    "splitCutoffOn": "2026-10-15",     // this month's, from splitCutoffDay
    "fbpBillsDueOn": "2026-10-20",     // this month's, from fbpBillsDueDay
    "declarationDueOn": "2026-11-30",
    "proofsDueOn": "2027-01-31",
    "billsDueOn": null
  },
  "updatedAt": "2026-10-31T06:00:00.000Z",   // or null
  "updatedBy": "…"                            // userId, or null
}
```

### `PUT /admin/payroll/employee-app-settings`

Body: any of the eight fields; a field left out stays as it is, `null`
clears it (it is then missing: there is no default to fall back to). Query: `fy` (optional; only used to check a full date).
Response: the same body as the GET.

```jsonc
{ "appEnabled": true, "splitCutoffDay": 20, "declarationDue": "2026-12-15", "proofsDue": "02-15", "billsDue": null, "splitStepPaise": 50000 }
```

- `appEnabled`: `true` | `false`. Turning it on is refused with `409`
  (`details.reason: "payroll_not_configured"`, `details.missing` naming the
  deadlines, message e.g. "Set proofsDue, billsDue before switching Payroll on
  in the app") until every deadline is set, counting the ones in the same
  request. Clearing a deadline while it is on is refused the same way.
- `splitCutoffDay`, `fbpBillsDueDay`: a whole day of the month, **1 to 28**.
- `splitDue`: `"MM-DD"` or a full date within `fy` (1 April to 31 March).
- `splitStepPaise`: paise in whole rupees, **100 to 1000000** (₹1 to ₹10,000).
- `declarationDue`, `proofsDue`, `billsDue`: `"MM-DD"`, or a full `"YYYY-MM-DD"`
  date (only its month and day are kept: the deadline repeats every FY). They
  must fall **within the FY**: `declarationDue` from 1 April to 31 December,
  `proofsDue` and `billsDue` from 1 January to 31 March; a full date must be
  in that part of `fy` (e.g. `2026-12-15` for 2026-27, `2027-02-15` for the
  proofs). 29 February is refused (it does not come every year).

Errors: `400` an unknown field, nothing sent, a value out of range or a date
outside the FY; `403` no payroll access; `409` `payroll_not_configured` as above.

### One-time seed

`npm run payroll:employee-settings-seed -- --org <org>` (dry run: prints what
it would write) and `-- --org <org> --apply` write the values the app used
before HR could set them (cutoff the 15th, `11-30`, `01-31`, `03-31`) into the
company's settings, only where HR has not set a value, so HR starts from them
on the dashboard and changes them there. It never touches `appEnabled`. It
writes to whatever database the environment points at.

---

## 9. Salary summary ("<Month> salary")

### `GET /payroll/me/salary`

One pay period's pay as a receipt, every line with a plain-English reason
built from the real figures and the company's own rules (the FY's statutory
row, the person's state PT / LWF rule, the pay period's base days). The
released payslip when there is one, else the estimate home shows.

Query: `period` (optional, `YYYY-MM`; default the **previous** pay period,
the one most recently over on the company's `payroll_periods`: paying 26th to
25th, 28 Oct defaults to `"2026-10"`). Checked as home checks it.

```jsonc
{
  "success": true,
  "salary": {
    "period": "2026-10",
    "label": "October 2026",
    "released": true,                  // false: an estimate (or nothing, see notSetUp)
    "payslipId": "…",                  // null unless released
    "periodFrom": "2026-09-26", "periodTo": "2026-10-25",   // the run's dates when released; the pay period's otherwise; null if unknown
    "daysPaid": 28,                    // the payslip's payable days, else baseDays − lop.days; null when not set up
    "daysInPeriod": 30,                // calendar days from periodFrom to periodTo
    "baseDays": 30,                    // what LOP divides by; null if unknown
    "grossPaise": 12400000,            // null when not set up
    "takeHomePaise": 10640000,         // null when not set up
    "lines": [                         // receipt order: gross, LOP, overtime, deductions (epf, esi, income_tax, pt, lwf, then the rest), other deductions, reimbursements
      { "key": "gross", "label": "Gross salary", "amountPaise": 12400000, "kind": "earning",
        "explanation": "Your fixed monthly pay before any deductions: Basic ₹62,000 + HRA ₹24,800 + other pay ₹37,200." },
      { "key": "lop", "label": "Loss of pay · 2 days", "amountPaise": 800000, "kind": "lop",
        "explanation": "1 absent day + 2 half days. One day's pay is ₹4,133 (₹1,24,000 ÷ 30 days from 26 Sep to 25 Oct)." },
      { "key": "epf", "label": "Provident fund", "amountPaise": 180000, "kind": "deduction", "explanation": "12% of your PF wage of ₹15,000, …" }
      // keys: "gross" | "lop" | "overtime" | "epf" | "esi" | "income_tax" | "pt" | "lwf" | a pay head code
      //       | "other_deductions" (lines not listed on the payslip, released only) | "reimbursements"
      // kind: "earning" | "deduction" | "lop"
    ],
    "lop": {                           // null when not set up
      "days": 2,                       // what was divided by the base days (halves count)
      "absentDays": 1, "halfDays": 2,
      "missedPunchDays": 0,            // missed punches the shift counts as absent / half day, in days
      "unpaidLeaveDays": 0,
      "perDayPaise": 413333,           // gross ÷ base days; null when base days unknown
      "enteredByHr": false             // HR typed the LOP on the run
    },
    "unpaidDays": { "period": "2026-10", "count": 0, "fixBy": null, "locked": true },   // as GET /payroll/missing-punches, for "Fix unpaid days"
    "payslips": { "count": 7, "from": "2026-04", "to": "2026-10" },                   // the person's released payslips ("All payslips")
    "notSetUp": null                   // or { "reason", "message" }: released false, grossPaise / takeHomePaise / lop null, lines []
  }
}
```

`notSetUp.reason`: `"no_salary_structure"` ("Your salary shows here once HR
sets up your pay."), `"statutory_not_set_up"`, `"tax_rules_not_set_up"` or
`"pay_period_not_set_up"` (each message ends "Ask HR."). A rule missing for
one line only (e.g. the state's PT slabs, or the FY's statutory row on a
released payslip) is said in that line's `explanation`, never with a made-up
figure.

Errors: `400` bad `period` or one that has not started; `409` no company.

---

## 10. Tax summary

### `GET /payroll/me/tax`

The year's income tax: what the TDS engine makes of the whole FY, what this
FY's released payslips already withheld, and each month to come at the figure
a run would take now. Paid months are the payslips' own income tax line.

Query: `fy` (optional, default the current FY).

```jsonc
{
  "success": true,
  "tax": {
    "fy": "2026-27",
    "regime": "new",                   // the declaration's, else the company's default regime
    "chosen": false,                   // a declaration exists for the FY
    "defaultRegime": "new",
    "regimeDueOn": "2026-11-30",       // declarationDue as a day of fy; null: not set
    "proofsDueOn": "2027-01-31",       // null: not set
    "locked": false,                   // past regimeDueOn
    "canChangeRegime": true,           // both regimes' rules set and regimeDueOn set and not passed (change it with PUT /payroll/tax-declaration)
    "notConfigured": false,            // true: no estimate for the year; reason and message say why
    "reason": null,                    // "tax_rules_not_set_up" | "tds_off" | "salary_not_set_up" | "statutory_not_set_up"
    "message": null,                   // for the person, ending "Ask HR."
    "missing": [],                     // of "declarationDue" | "proofsDue"
    "annualTaxPaise": 9120000,         // the year's tax; null while notConfigured (with no month left to come: paidSoFarPaise)
    "paidSoFarPaise": 3800000,         // released payslips' income tax this FY
    "paidThroughMonth": "2026-09",     // the last released month; null: none yet
    "monthlyNowPaise": 760000,         // what a run would take a month now; null while notConfigured
    "months": [                        // April to March
      { "period": "2026-04", "label": "April 2026", "amountPaise": 760000, "status": "paid" },
      { "period": "2026-10", "label": "October 2026", "amountPaise": 760000, "status": "estimate" }
      // status: "paid" (the payslip's) | "estimate" (monthlyNowPaise; null while not set up)
      //       | "no_payslip" (before the projection with no released payslip: before joining, or paid elsewhere; amountPaise null)
    ],
    "estimate": true,                  // some month is still to come
    "form16Enabled": false             // the page offers "Download Form 16" only when true (§14, the Form 16 switch)
  }
}
```

The projection starts after the last released payslip (else this month), and
never before the joining month. Not set up: `tds_off` (HR has not switched
TDS on for the company), `tax_rules_not_set_up` (no `tds_configs` row for the
regime, or an incomplete one), `salary_not_set_up` (no structure, or the
template no longer resolves), `statutory_not_set_up` (no statutory row).

Errors: `400` bad `fy`.

---

## 11. Earnings

### `GET /payroll/me/earnings`

What the person has been paid in a FY, month by month, and their yearly
salary. Every figure is from their released payslips, plus (for the current
year) this pay period's estimate exactly as home works it out.

Query: `fy` (optional; default the latest year they have pay in, else the
current one).

```jsonc
{
  "success": true,
  "earnings": {
    "fy": "2026-27",
    "current": true,                   // the year it is now (its figures are "so far")
    "fys": ["2026-27", "2025-26"],     // years with pay to switch between, newest first
    "span": "Apr–Oct",                 // the months listed; "Oct" for one; null for none
    "grossPaise": 80600000,            // gross paid: earnings after LOP, with overtime
    "taxPaise": 5320000,
    "pfPtPaise": 1400000,              // EPF + professional tax
    "otherDeductionsPaise": 0,         // every other deduction (hidden lines included)
    "reimbursementsPaise": 0,
    "takeHomePaise": 73880000,         // what reached the bank
    "componentsSource": "structure",   // "structure" (current year: the structure as it pays now, with the split)
                                       // | "payslips" (earlier year: what its payslips were entitled to, before LOP)
    "components": [ { "code": "BASIC", "name": "Basic", "annualPaise": 74400000 } ],   // earnings and reimbursements above 0
    "annualTotalPaise": 148800000,
    "componentsNotSetUp": null,        // or { "reason", "message" }; components is then []
    "estimateNotSetUp": null,          // current year only: { "reason", "message" } when this pay period can't be estimated (the month is not listed)
    "months": [
      { "period": "2026-10", "label": "October 2026", "grossPaise": 11600000, "netPaise": 10640000,
        "unpaidDays": 2, "status": "estimate", "payslipId": null }   // status "released" carries its payslipId
    ]
  }
}
```

`reason` in either not-set-up block: `"no_salary_structure"`,
`"statutory_not_set_up"`, `"structure_not_set_up"` (the template no longer
resolves), `"pay_period_not_set_up"`, `"tax_rules_not_set_up"`. A month with
no released payslip and no estimate is simply not listed.

Errors: `400` bad `fy`, or a FY that has not started.

---

## 12. EPF

Sowaka cannot read EPFO. The page shows only what Sowaka knows: the PF put in
through Sowaka payroll (employee + employer EPF share from released payslips;
the pension share is not in the PF balance), a balance someone typed in from
the EPFO passbook (`epf_balances`; the newest entry wins), this month's split,
and the person's own UAN.

### `GET /payroll/me/epf`

```jsonc
{
  "success": true,
  "epf": {
    "enrolled": true,
    "notEnrolledReason": null,         // when not enrolled: "no_salary_structure" | "pf_off_for_company" | "pf_off_for_you" | "not_deducted"
    "uan": "100123456789",             // in full, for Copy (their own, on this route only); null when none or unreadable here
    "uanLast4": "6789",                // null when none on record
    "uanOnRecord": true,               // true with uan null: on record but can't be read on this server
    "savedThroughSowaka": {            // released payslips with PF
      "employeePaise": 1260000, "employerEpfPaise": 385000,
      "months": 7, "sincePeriod": "2026-04", "throughPeriod": "2026-10"   // periods null with no months
    },
    "balance": {                       // null: nobody has entered one
      "balancePaise": 45000000, "asOn": "2026-09-30",
      "source": "employee",            // "employee" | "hr"
      "updatedAt": "…",
      "addedSincePaise": 235000,       // payslips' PF (both shares) for the months after asOn's month
      "totalPaise": 45235000
    },
    "monthly": {                       // this month's split from the structure; null when not enrolled or not set up
      "period": "2026-11",
      "employeePaise": 180000, "employerEpfPaise": 55000, "employerEpsPaise": 125000,
      "pfWagePaise": 1500000,          // the wage the employee rate applies to (capped at the ceiling when restricted)
      "ratePercent": 12, "employerRatePercent": 12
    },
    "notSetUp": null                   // or { "reason": "statutory_not_set_up" | "payroll_not_configured", "fy": "2026-27", "message": "… Ask HR." }
  }
}
```

`notSetUp` is set (and `monthly` null) when the FY's statutory row is missing
(`statutory_not_set_up`) or the person's salary template no longer resolves
(`payroll_not_configured`); `enrolled` then follows the PF switches alone.

### `PUT /payroll/me/epf/balance`

The person enters their balance from the EPFO passbook. Body:

```jsonc
{ "balancePaise": 45000000, "asOn": "2026-09-30" }
```

`balancePaise`: whole rupees in paise, ≥ 0. `asOn`: a real day, not in the
future (India date). Each save is a new entry (the newest wins). Response: the
same `epf` object as the GET, with `balance.source: "employee"`.

Errors: `400` a negative, non-integer or non-whole-rupee amount; a bad or
future `asOn`.

---

## 13. FBP (flexible benefit plan bills)

The month's split as a summary, each flexible head's bills from April (or the
month pay started) to this month, and the upload of a month's bill. Nothing
new is stored: the heads and amounts are the split's (§3); a bill is a
reimbursement claim of the bill type HR linked to the head
(`ReimbursementType.payHeadCode`), dated in its month, and HR approves or
rejects it on the dashboard's Reimbursements page like any claim (HR's note
on a rejection is the `reason`).

Bill status per month: `not_uploaded` | `in_review` | `approved` |
`rejected` (one approved wins, then one in review, then the latest rejected).
A month the head pays nothing is not listed unless a bill was sent for it.

### `GET /payroll/me/fbp`

```jsonc
{
  "success": true,
  "fbp": {
    "available": true,                 // false: no flexible components (heads [], declared null, unassignedPaise null)
    "fy": "2026-27",
    "period": "2026-11",               // this month (India)
    "billsDueOn": "2027-03-31",        // null: billsDue not set
    "lock": {                          // can the split still change this FY?
      "locked": false,                 // true: a change now would only start next FY (reason "fy_closed")
      "notConfigured": false, "missing": [],   // true + ["splitCutoffDay"], reason "payroll_not_configured", dates null
      "reason": null,
      "effectiveFrom": "2026-11",      // while open: the month a change made now starts from
      "closesOn": "2026-11-15"         // while open: the last day to change it for that month
    },
    "poolPaise": 600000,               // null: the template has no flexiblePoolPaise
    "assignedPaise": 450000,
    "unassignedPaise": 150000,         // null when the pool is unknown
    "declared": { "effectiveFrom": "2026-07", "submittedAt": "…" },   // the split this month's amounts come from; null: the structure's amounts
    "heads": [
      {
        "code": "FUEL", "name": "Fuel & vehicle",
        "amountPaise": 250000, "limitPaise": 300000,   // this month
        "months": 8,                   // months listed for this head
        "approved": 4, "inReview": 1, "rejected": 1, "toUpload": 2,
        "needsAction": 3,              // toUpload + rejected (the red count)
        "billsSetUp": true             // false: HR has not linked a bill type to this head (no uploads)
      }
    ],
    "summary": { "toUpload": 2, "toReupload": 1, "inReview": 1, "approved": 4 },
    "missing": []                      // of "flexiblePoolPaise" | "billsDue" | "splitCutoffDay"
  }
}
```

### `GET /payroll/me/fbp/:code`

One head's page: every month of this FY so far and its bill.

```jsonc
{
  "success": true,
  "head": {
    "code": "FUEL", "name": "Fuel & vehicle",
    "fy": "2026-27", "period": "2026-11",
    "amountPaise": 250000, "limitPaise": 300000,
    "billsDueOn": "2027-03-31",
    "billType": "Fuel",                // the bill type new bills are filed under, as HR named it; null: none linked
    "uploadsBlocked": null,            // or { "reason", "message", "missing" }: why bills can't be sent now
    "months": [
      {
        "period": "2026-10",
        "amountPaise": 250000,         // the head's amount that month (the split in force, else the structure's)
        "status": "rejected",
        "bill": {                      // the bill that decides the status; null when nothing was sent
          "id": "…", "amountPaise": 250000, "fileName": "fuel-oct.pdf",
          "uploadedAt": "…", "decidedAt": "…",
          "reason": "The bill is for September"   // rejected only
        },
        "canUpload": true              // not_uploaded or rejected, and uploads not blocked
      }
    ]
  }
}
```

`uploadsBlocked.reason`: `"payroll_not_configured"` (`missing: ["billsDue"]`,
or `["billType"]` when HR has not set up a bill type for the head) or
`"bills_closed"` (past `billsDueOn`; "To send one late, ask HR.").

Errors: `404` no salary structure, or `code` is not one of their FBP heads.

### `POST /payroll/me/fbp/:code/bills`

Upload (or, after a rejection, re-upload) one month's bill. `multipart/form-data`:
- `proof` — the file: PDF, JPEG or PNG, at most 5 MB.
- `period` — the month it is for, `YYYY-MM` (this FY, not before pay started, not in the future).
- `amountPaise` — the amount on the bill: whole rupees in paise, > 0, within the bill type's cap when HR set one.

Response: `{ "success": true, "head": { … as GET /payroll/me/fbp/:code … } }`
with that month now `in_review`. The claim is dated the month's last day (or
today, for this month).

Errors: `400` bad or future `period`, a month outside this FY, a month the
head pays nothing, a bad amount (not whole rupees, above the type's cap), no
file, not PDF/JPEG/PNG; `404` as the GET; `409` `payroll_not_configured`
(`details.missing` `["billsDue"]` or `["billType"]`), `bills_closed`
(`details.dueOn`), `bill_approved`, `bill_in_review`; `413` file over 5 MB;
`503` file storage not configured.

### `GET /payroll/me/fbp/bills/:billId/file`

`{ "success": true, "url": "https://…" }` — a short-lived link to a bill the
person sent. `400` bad id; `404` not theirs or no file.

---

## 14. Form 16

Sowaka does not generate Form 16: HR gets Part A from TRACES and Part B from
their tax tool and uploads the PDFs (`form16_documents`, one per person, FY
and part). A person has either one `combined` file for a FY or a Part `A` and
a Part `B`: a combined upload replaces both parts, a part replaces the
combined file. The dates are the law's, worked out from the FY: Form 16 is
due by **15 June** after the FY (Rule 31), the return by **31 July** (s.139(1)).

**The Form 16 switch.** The app shows Form 16 only where Sowaka has set
`companies.features.form16: true` in the database (no dashboard control; set
it with `npm run form16:switch -- --org <id> --on --apply`, see
`backend/src/scripts/form16-switch.ts`). Absent or false is hidden:
`GET /payroll/home` and `GET /payroll/me/tax` send `"form16Enabled": false`,
and the app hides the Downloads tab and the Tax page's "Download Form 16";
`GET /payroll/form16` answers `{ "enabled": false, "currentFy": "…", "filing": null, "years": [] }`
and every file `404` (`details.reason: "form16_off"`), so an app build that
does not read the flag shows nothing either. HR's routes below work either
way (HR can upload ahead), and their list says `shownInApp`.

A document, everywhere below:

```jsonc
{ "id": "…", "fy": "2025-26", "part": "combined", "fileName": "Form16_ABCDE1234F.pdf", "size": 104233, "uploadedAt": "…" }   // part: "A" | "B" | "combined"
```

### `GET /payroll/form16`

The person's years (Downloads › Form 16), newest first: this FY (never ready:
not due yet), every FY with a file, and last FY when Sowaka paid them in it.

```jsonc
{
  "success": true,
  "form16": {
    "enabled": true,                                          // false: the company's switch is off, and years is []
    "currentFy": "2026-27",
    "filing": { "fy": "2025-26", "lastDate": "2026-07-31" },   // last FY's return date
    "years": [
      { "fy": "2026-27", "status": "pending", "readyBy": "2027-06-15", "documents": [] },
      { "fy": "2025-26", "status": "ready", "readyBy": "2026-06-15", "documents": [ { … } ] }
      // status: "ready" (files to download) | "pending" (not due yet: ready by readyBy) | "missing" (past readyBy, nothing filed: ask HR)
    ]
  }
}
```

### `GET /payroll/form16/:documentId/file`

`{ "success": true, "url": "https://…", "fileName": "…" }` — a short-lived
link to one of the person's own files. `404` not theirs or no such id.

Both are behind the app's Payroll switch (`403 payroll_app_off`) like the
rest of `/payroll/*`.

### HR: `GET /admin/payroll/form16`

Payroll access only (as §7). Query: `fy` (optional, default last FY).
Everyone who should have one: people working here who had joined by the FY's
end, anyone paid in it, anyone with a file.

```jsonc
{
  "success": true,
  "fy": "2025-26",
  "readyBy": "2026-06-15",
  "ended": true,                       // false for the current FY: uploads for it are refused
  "shownInApp": false,                 // companies.features.form16: false, the dashboard notes "Hidden in the app for this company"
  "counts": { "employees": 48, "withForm16": 40 },
  "employees": [                       // by name
    { "userId": "…", "name": "Asha Test", "employeeId": "E-ASHA", "panLast4": "234F", "documents": [ { … } ] }
  ]
}
```

### HR: `POST /admin/payroll/form16/employees/:userId`

One person's Form 16. `multipart/form-data`: `file` (one PDF, checked by its
bytes, at most 3 MB); `fy` (required, query or body: a FY that has ended);
`part` (optional, query or body: `A` | `B` | `combined`, default `combined`).
Response: `{ "success": true, "document": { … } }`.

Errors: `400` no `fy`, bad `fy` or `part`, no file, not a PDF; `403` no
payroll access; `404` not someone of the viewer's company; `409`
`fy_not_ended` ("FY 2026-27 has not ended yet. Form 16 is issued after the
year ends, by 15 Jun 2027."); `413` over 3 MB; `503` file storage not configured.

### HR: `POST /admin/payroll/form16/bulk`

A batch for one FY. `multipart/form-data`: `files` (up to 30 PDFs, 3 MB
each; send a bigger batch in several), `fy` (required), `part` (optional:
forces every file's part; otherwise read from the name, "Part A" / "PartB" /
"_Part-A", else `combined`). Each file is matched by the **PAN** in its name
(against Bank & PAN) or, only when the name has no PAN, by an **employee ID**
as a whole word of it (FY-like `2025-26` ignored). A file that matches nobody
or more than one person is listed back, not stored.

```jsonc
{
  "success": true,
  "fy": "2025-26",
  "uploaded": [ { "fileName": "…", "userId": "…", "name": "…", "employeeId": "E-ASHA", "matchedBy": "pan", "document": { … } } ],   // matchedBy: "pan" | "employeeId"
  "unmatched": [ { "fileName": "…", "reason": "No employee with this PAN or employee ID" } ]
  // other reasons: nobody has this PAN saved in Bank & PAN; PANs can't be read on this server; matches N employees;
  //                another file in the batch is already their part; not a PDF
}
```

Errors: `400` no `fy`, bad `part`, no files, more than 30; `403`; `409`
`fy_not_ended`; `413` a file over 3 MB; `503`.

### HR: `GET /admin/payroll/form16/:documentId/file`

`{ "success": true, "url": "https://…", "fileName": "…" }`. `404` not in the
viewer's company.

### HR: `DELETE /admin/payroll/form16/:documentId`

Removes the file: `{ "success": true, "removed": { … the document … } }`. `404` as above.

---

## 15. Other HR (dashboard) endpoints

### `GET /admin/payroll/employees/:userId/epf-balance`

The employee's PF balance as read off their EPFO passbook (the newest entry,
the employee's or HR's). Payroll access only; same company (`404` otherwise).

```jsonc
{ "success": true, "balance": { "balancePaise": 45000000, "asOn": "2026-09-30", "source": "hr", "updatedAt": "…" } }   // balance null: none entered
```

### `PUT /admin/payroll/employees/:userId/epf-balance`

Body `{ "balancePaise": 45000000, "asOn": "2026-09-30" }`, checked as
`PUT /payroll/me/epf/balance` (§12) and saved with `source: "hr"`. Response
as the GET. Errors: `400` as §12; `403` no payroll access; `404` another company.

### `employee-app-settings`: `splitStepPaise`

See §8: `GET` / `PUT /admin/payroll/employee-app-settings` carry
`settings.splitStepPaise` (whole rupees in paise, 100 to 1000000). It is not
a deadline (never in `missing`, does not hold Payroll off), but while it is
null `GET /payroll/split` reports `missing: ["splitStepPaise"]`, `stepPaise`
is `null`, and the split cannot be reviewed or saved (409).

### `GET /admin/employees/:userId/calendar`: `days[].canMark`

Unchanged, except every entry of `calendar.days` now carries `canMark`
(boolean): whether HR may mark that day now
(`PUT /admin/employees/:userId/calendar/:date`), by the same rule the save
checks. A day can be marked when it is in the current month, or in the pay
period holding today (so a company paying 26th to 25th can settle 26–31 of
last month), or before today in a period whose run is still `draft` /
`pending_approval`; never in a period whose run is `approved` / `paid`, and
never before the person joined. Always `false` on HR's own calendar.
