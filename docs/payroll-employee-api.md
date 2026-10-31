# Employee payroll API (app)

Contract for the app's Payroll screens: Payroll home, Missing punches, Change
my split / Review split, Payslips / Payslip, Investment declaration and
Investment proofs, plus the HR endpoints that review proofs.

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

Default deadlines (a company can change them on its record, under
`payrollEmployee`; there is no screen for that yet):

| What | Default |
| --- | --- |
| Change the flexible split for a month | until the **15th** of that month (`splitCutoffDay`) and only while that month's run is not locked |
| Fix missing punches of a month | the **last day** of that month, and only while that month's run is not locked |
| Choose the regime and declare investments | **30 Nov** of the FY (`declarationDue: "11-30"`) |
| Upload investment proofs | **31 Jan** of the FY (`proofsDue: "01-31"`) |
| Upload bills for the flexible heads | **31 Mar**, the FY's last day |

A payroll run is **locked** for a month once it is past draft: status
`pending_approval`, `approved` or `paid`. A `draft` run is still being worked
on and does not lock anything.

---

## 1. Payroll home

### `GET /payroll/home`

Query: `period` (optional, `YYYY-MM`, default this month).

```jsonc
{
  "success": true,
  "period": "2026-10",
  "fy": "2026-27",
  "hasSalaryStructure": true,          // false: no structure assigned yet; salary is null
  "salary": {
    "period": "2026-10",
    "status": "estimate",              // "estimate" (worked out from the salary structure and attendance so far) | "final" (from the released payslip)
    "payslipId": null,                 // string when status is "final"
    "grossPaise": 12400000,            // gross before loss of pay
    "lopDays": 2,                      // may be a half: 1.5
    "lopPaise": 800000,
    "deductions": [                    // employee deductions, in payslip order; keys: "epf" | "esi" | "pt" | "lwf" | "income_tax" | a pay head code
      { "key": "epf", "label": "Provident fund", "amountPaise": 180000 },
      { "key": "income_tax", "label": "Income tax (TDS)", "amountPaise": 760000 },
      { "key": "pt", "label": "Professional tax", "amountPaise": 20000 }
    ],
    "netPaise": 10640000,              // gross − LOP − deductions
    "reimbursementsPaise": 0,          // flexible heads and other reimbursements paid with salary
    "takeHomePaise": 10640000          // net + reimbursements
  },
  "todo": [                            // only what needs action now, in this order; empty when nothing does
    { "kind": "missing_punches", "count": 12, "dueOn": "2026-10-31", "period": "2026-10" },
    { "kind": "flexible_split", "dueOn": "2026-11-15", "effectiveFrom": "2026-11", "submitted": false },
    { "kind": "fbp_bills", "rejected": 1, "inReview": 3, "dueOn": "2027-03-31" },
    { "kind": "tax_regime", "regime": "new", "chosen": false, "dueOn": "2026-11-30" },
    { "kind": "investment_proofs", "notUploaded": 3, "rejected": 1, "dueOn": "2027-01-31" }
  ],
  "missingPunches": { "period": "2026-10", "count": 12, "fixBy": "2026-10-31", "locked": false },
  "split": {                           // null when the person's template has no flexible components
    "open": true, "effectiveFrom": "2026-11", "closesOn": "2026-11-15",
    "poolPaise": 600000, "assignedPaise": 450000, "unassignedPaise": 150000,
    "bills": { "approved": 16, "inReview": 3, "rejected": 1 }
  },
  "declaration": { "fy": "2026-27", "regime": "new", "chosen": false, "status": "not_started", "locked": false, "dueOn": "2026-11-30" },
  "proofs": { "fy": "2026-27", "required": false, "dueOn": "2027-01-31", "notUploaded": 0, "uploaded": 0, "approved": 0, "rejected": 0 }
}
```

- `todo` kinds: `missing_punches` (count > 0 and not locked), `flexible_split`
  (no split submitted yet for the FY the window is in), `fbp_bills` (a bill
  for a flexible head was rejected this FY; `inReview` is for the subtitle), `tax_regime`
  (regime not chosen yet and before the deadline), `investment_proofs` (old
  regime, something not uploaded or rejected, before the deadline).
- Errors: `401` not signed in; `409` the account has no company.

---

## 2. Missing punches

### `GET /payroll/missing-punches`

Query: `period` (optional, `YYYY-MM`, default this month; not in the future).

```jsonc
{
  "success": true,
  "period": "2026-10",
  "fixBy": "2026-10-31",
  "locked": false,               // the month's run is locked: corrections no longer change this month's pay
  "count": 12,                   // days still to fix: no pending or approved correction
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
      "request": null            // or { "id": "…", "status": "pending" | "approved" | "declined", "requestedDayType": "full_day" | … }
    }
  ]
}
```

Only past working days (today is not final yet) graded `missed_punch` or
`absent`. Week-offs, holidays and leave never appear.

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
template, see §7); without one, the pool is the sum of the components' limits.

A split takes effect from one month (`effectiveFrom`) to the end of the FY and
replaces any split before it from that month on.

### `GET /payroll/split`

```jsonc
{
  "success": true,
  "split": {
    "available": true,                 // false: no flexible components; everything below is empty
    "poolPaise": 600000,
    "assignedPaise": 450000,
    "unassignedPaise": 150000,
    "components": [
      {
        "code": "FUEL",
        "name": "Fuel & vehicle",      // payslip name
        "limitPaise": 300000,          // "Max ₹3,000"
        "amountPaise": 250000,         // what applies for window.effectiveFrom today
        "stepPaise": 10000,            // suggested +/- step (₹100); any whole-rupee amount is accepted
        "bills": { "approved": 4, "inReview": 1, "rejected": 2 }   // this FY's bills for this head
      }
    ],
    "current": { "effectiveFrom": "2026-04", "submittedAt": "2026-04-10T09:12:00.000Z" },  // the split in force for window.effectiveFrom; null: the template's amounts
    "window": {
      "open": true,                    // always true today: some month is always open (kept for a future hard close)
      "effectiveFrom": "2026-11",      // the first month a change made now applies to
      "effectiveTo": "2027-03",        // the FY's last month
      "closesOn": "2026-11-15",        // last day to change it for effectiveFrom
      "reason": null
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

Codes left out keep their current amount.

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
    "monthlyTaxSavingPaise": 94000,    // about this much less tax a month once bills are approved; null when it cannot be worked out
    "billsDueOn": "2027-03-31"
  }
}
```

### `PUT /payroll/split`

Saves it. Body: `{ "amounts": { … }, "acknowledged": true, "effectiveFrom": "2026-11" }` —
`acknowledged` is the "I'll keep bills … and upload them by 31 Mar" tick and
must be `true`; `effectiveFrom` (optional, recommended) is the month the
Review screen showed: if the window has moved since (the cutoff passed or a
run locked that month), the save is refused with `409` and the app should
review again.
Response: the same `split` object as `GET /payroll/split`, now with the new
amounts and `current.effectiveFrom` = `window.effectiveFrom`. Saving again
for the same month replaces it.

**How the window works.** A change made today applies from this month while
today is on or before the cutoff day (15th) and this month's run is not
locked; otherwise from the next month whose run is not locked. A month whose
run is locked never changes. The payroll run pays each month the split in
force for that month (the latest one starting on or before it, same FY), on
top of the structure's own values; months before it keep what they had.

Errors (both review and save):
- `400` an unknown or non-flexible code; an amount that is negative, not whole
  rupees (multiple of 100 paise), or above its `limitPaise`; the total above
  `poolPaise`; `acknowledged` not true (save only).
- `404` no salary structure assigned.
- `409` no flexible components on the template; (save) `effectiveFrom` no
  longer matches the window.

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

Caps come from the FY's old-regime tax config (`tds_configs`), so a new
Finance Act is a data change. Amounts above a cap are accepted and kept (the
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
(`locked`).

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
    "summary": { "total": 4, "notUploaded": 1, "uploaded": 2, "approved": 0, "rejected": 1,
                 "allSent": false,      // nothing left not uploaded or rejected ("All bills sent for review")
                 "allApproved": false }, // every item approved ("All set")
    "items": [
      {
        "item": "ppf", "label": "PPF", "section": "80C",
        "declaredPaise": 5000000,
        "status": "rejected",
        "proof": {                      // null when not_uploaded
          "id": "…",
          "fileName": "ppf-passbook.pdf", "contentType": "application/pdf", "size": 182311,
          "amountPaise": 5000000,       // "Amount on proof"
          "uploadedAt": "…",
          "decidedAt": "…",             // or null
          "reason": "This certificate is for FY 2025–26. Upload the one for FY 2026–27."   // rejected only
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

Query: `fy` (optional). Response: `{ "success": true, "item": { …one entry of items… } }`
with `status: "uploaded"`. A re-upload replaces the earlier file and clears
the rejection.

Errors: `400` no file, not PDF/JPEG/PNG, bad `amountPaise`, an item not
declared (or `epf`), new regime; `409` the item is already approved, or past
`dueOn`; `413` file over 5 MB; `503` file storage not configured.

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
      "declaredPaise": 5000000, "amountPaise": 5000000,
      "status": "uploaded", "fileName": "…", "contentType": "application/pdf", "size": 182311,
      "uploadedAt": "…", "decidedAt": null, "decidedByUserId": null, "reason": null }
  ]
}
```

Oldest upload first.

### `GET /admin/payroll/investment-proofs/:proofId/file`

`{ "success": true, "url": "https://…" }`.

### `POST /admin/payroll/investment-proofs/:proofId/decision`

Body: `{ "decision": "approved" | "rejected", "reason": "…" }` — `reason` is
required (3–500 characters) to reject. Response: `{ "success": true, "proof": { … as in the list … } }`.
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
