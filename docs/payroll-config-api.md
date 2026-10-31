# Payroll config API (HR dashboard)

Contract for the dashboard's **Payroll › Statutory & tax settings** page. Every
statutory and income-tax figure payroll uses lives in the database, one row per
financial year, and is edited here. Nothing falls back to a figure in code: if a
year has no row, payroll refuses to calculate for that year (see *Missing year*).

Conventions (same as the rest of the backend):

- Every route needs `Authorization: Bearer <token>` and HR dashboard access.
- Success: `200` with `{ "success": true, ...body }`.
- Error: `{ "success": false, "message": string, "requestId": string }`. Show
  `message`; it is written for a person.
- Money is **integer paise** in every field ending `Paise` (₹25,000 = `2500000`).
- A financial year (`fy`) is `"2026-27"` (1 April 2026 to 31 March 2027).
- A day is `"YYYY-MM-DD"`, a moment an ISO timestamp.

## Who can do what

These rows are **national**: one row per year serves every company on Sowaka.

| | Who |
| --- | --- |
| Read (`GET`) | anyone with payroll access (dashboard admin, anyone never limited to some tabs, or someone given the *Payroll Runs* or *Salary details* tab) |
| Write (`PUT`, `POST`) | a **dashboard admin** of a **platform org** (the orgs in the server's `PAYROLL_CONFIG_ORGS`, `sowaka` when unset). A customer company's HR, even its admin, gets `403` |

`GET` responses carry `canEdit: boolean` so the page can show the form
read-only.

---

## Statutory config (`payroll_statutory_configs`)

### Shape: `StatutoryConfig`

```jsonc
{
  "fy": "2026-27",
  "status": "confirmed",            // "to_confirm" | "confirmed"
  "source": "EPFO / ESIC notifications as applied by Zoho, checked 31 Oct 2026", // string | null
  "epf": {
    "employeeRate": 0.12,           // fraction 0–1
    "employerRate": 0.12,           // fraction 0–1 (EPS is carved out of this)
    "epsRate": 0.0833,              // fraction 0–1, ≤ employerRate; always on the capped wage
    "edliRate": 0.005,              // fraction 0–1, on the capped wage
    "adminRate": 0.005,             // fraction 0–1, on the employer's contribution wage
    // The PF wage ceiling across the year, by the day each value starts.
    // First entry starts on the FY's first day ("2026-04-01"); later entries
    // ascending and inside the FY. A month with a change is day-weighted.
    "wageCeilings": [
      { "from": "2026-04-01", "ceilingPaise": 1500000 },
      { "from": "2026-09-17", "ceilingPaise": 2500000 }
    ]
  },
  "esi": {
    "employeeRate": 0.0075,         // fraction 0–1
    "employerRate": 0.0325,         // fraction 0–1
    "grossCeilingPaise": 2100000    // > 0; ESI applies at or under this monthly wage
  },
  "bonus": {                        // Payment of Bonus Act
    "minRate": 0.0833,              // fraction 0–1; a company's bonus rate may not be lower
    "maxRate": 0.2,                 // fraction 0–1, ≥ minRate; nor higher
    "wageFloorPaise": 700000,       // > 0; the bonus wage: min(Basic, this), or max(this, state minimum wage)
    "eligibilityCeilingPaise": 2100000 // > 0; no bonus when Basic is above this
  },
  "mealCard": {
    "exemptMonthlyPaise": 880000    // ≥ 0; tax-free part of a Meal Card each month
  },
  // Professional Tax and Labour Welfare Fund by state (state lower-case).
  // A company may still override a state for itself under
  // /admin/payroll/statutory-rules/:state; that wins over this row.
  "states": [
    {
      "state": "karnataka",
      "pt": {                       // optional
        "slabs": [                  // ascending upToPaise; last one open-ended (null)
          { "upToPaise": 2499999, "amountPaise": 0 },
          { "upToPaise": null, "amountPaise": 20000,
            "monthOverride": { "month": 2, "amountPaise": 30000 } }   // optional
        ]
      }
    },
    {
      "state": "haryana",
      "lwf": {                      // optional
        "cycle": "monthly",         // "monthly" | "half_yearly"
        "deductionMonths": [1,2,3,4,5,6,7,8,9,10,11,12],
        "employee": { "mode": "percentage", "percent": 0.2, "capPaise": 3500 },
        // or { "mode": "flat", "amountPaise": 75 }
        "employer": { "mode": "multiple_of_employee", "factor": 2 }
        // or { "mode": "flat", "amountPaise": 225 } | { "mode": "percentage", "percent": 0.2, "capPaise": 3500 }
      }
    }
  ],
  "updatedAt": "2026-10-31T10:00:00.000Z",
  "updatedByUserId": "u_123"        // null for seeded rows
}
```

(LWF `percent` is a percentage 0–100, as on the existing per-state rules.)

### `GET /admin/payroll/statutory-config`

Without `fy`: the years that have a row.

```json
{ "success": true, "canEdit": true,
  "years": [ { "fy": "2026-27", "status": "confirmed", "updatedAt": "…" },
             { "fy": "2025-26", "status": "confirmed", "updatedAt": "…" } ],
  "currentFy": "2026-27" }
```

### `GET /admin/payroll/statutory-config?fy=2026-27`

```json
{ "success": true, "canEdit": true, "config": StatutoryConfig }
```

`404` `"Statutory settings for FY 2027-28 are not set up"` when the year has no
row (offer *Start from FY 2026-27*, below). `400` for a malformed `fy`.

### `PUT /admin/payroll/statutory-config?fy=2026-27`

Body: the whole `StatutoryConfig` without `fy`, `updatedAt`, `updatedByUserId`
(those are ignored if sent). Replaces the year's row, or creates it. Returns
`{ "success": true, "canEdit": true, "config": StatutoryConfig }`.

Validation (`400`, message names the field, e.g. `"epf.employeeRate must be a fraction between 0 and 1"`):

- every `*Rate` a number 0–1; `epf.epsRate ≤ epf.employerRate`; `bonus.maxRate ≥ bonus.minRate`
- every ceiling / floor `> 0`; `mealCard.exemptMonthlyPaise ≥ 0`; paise are integers
- `epf.wageCeilings`: non-empty, first `from` = the FY's first day, `from`s strictly ascending and inside the FY
- `states[].state` non-empty and unique; each needs `pt` or `lwf`
- PT slabs: non-empty, `upToPaise` strictly ascending, exactly one open-ended top slab (`null`) and it is last; `monthOverride.month` 1–12
- LWF as on the per-state rules (`deductionMonths` 1–12, non-empty; modes as above)
- `status` `"to_confirm"` or `"confirmed"`

`403` for someone who can read but not write.

### `POST /admin/payroll/statutory-config?fy=2027-28&copyFrom=2026-27`

Starts a new year from an earlier one. The copy has `status: "to_confirm"`,
the same rates and state rules, and one PF ceiling from the new FY's first day
at the value the source year ended on. Returns
`{ "success": true, "canEdit": true, "config": StatutoryConfig }`.

- `409` `"Statutory settings for FY 2027-28 already exist"`
- `404` `"Statutory settings for FY 2026-27 are not set up"` (the source)
- `400` missing / malformed `fy` or `copyFrom`

---

## Income tax config (`tds_configs`)

Two rows per year, one per regime. Shape `TdsConfig`:

```jsonc
{
  "fy": "2026-27",
  "regime": "new",                       // "new" | "old"
  "status": "confirmed",                 // "to_confirm" | "confirmed"
  "source": "Finance Act 2025 …",        // string | null
  "standardDeductionPaise": 7500000,     // ≥ 0
  "slabs": [                             // ascending; last open-ended (null)
    { "upToPaise": 40000000, "ratePercent": 0 },
    { "upToPaise": 80000000, "ratePercent": 5 },
    { "upToPaise": null, "ratePercent": 30 }
  ],
  "rebate": { "incomeLimitPaise": 120000000, "maxRebatePaise": 6000000, "marginalRelief": true }, // section 87A
  "surcharge": [ { "abovePaise": 500000000, "ratePercent": 10 } ],  // ascending abovePaise
  "cessPercent": 4,
  "limits": {                            // old regime caps (paise); new regime rows usually 0
    "sec80C": 15000000, "sec80CCD1B": 5000000,
    "sec80DSelf": 2500000, "sec80DSelfSenior": 5000000,
    "sec80DParents": 2500000, "sec80DParentsSenior": 5000000,
    "sec24bHomeLoan": 20000000, "sec80TTA": 1000000
  },
  "ptDeductible": false,                 // old regime: PT deductible (16(iii))
  "hraExemption": false,                 // old regime: HRA exemption (10(13A))
  "hra": {                               // HRA exemption rule (rule 2A)
    "metroPercentOfBasic": 50,           // 0–100
    "nonMetroPercentOfBasic": 40,        // 0–100
    "rentOverPercentOfBasic": 10         // 0–100: rent paid minus this % of Basic
  },
  "updatedAt": "…", "updatedByUserId": "u_123"
}
```

Percentages here (`ratePercent`, `cessPercent`, `hra.*`) are 0–100, as the
`tds_configs` rows have always stored them.

### `GET /admin/payroll/tds-config`

Without `fy`: `{ "success": true, "canEdit": true, "years": [ { "fy": "2026-27", "regimes": ["new","old"], "status": "confirmed" } ], "currentFy": "2026-27" }`
(`status` is `to_confirm` if either regime is).

### `GET /admin/payroll/tds-config?fy=2026-27`

```json
{ "success": true, "canEdit": true, "fy": "2026-27",
  "configs": { "new": TdsConfig, "old": TdsConfig } }
```

A regime with no row is `null`. `404` `"Income tax settings for FY 2027-28 are not set up"` when neither exists.

### `PUT /admin/payroll/tds-config?fy=2026-27&regime=new`

Body: the `TdsConfig` without `fy`, `regime`, `updatedAt`, `updatedByUserId`.
Replaces (or creates) that regime's row. Returns the same body as the `GET`
with `fy`.

Validation (`400`): `ratePercent`, `cessPercent`, surcharge rates and `hra.*`
0–100; slabs non-empty, `upToPaise` strictly ascending, one open-ended top
slab, last; surcharge `abovePaise` strictly ascending and `> 0`; every paise
field a non-negative integer; `regime` `new` or `old`.

### `POST /admin/payroll/tds-config?fy=2027-28&copyFrom=2026-27`

Copies both regimes into the new year, `status: "to_confirm"`. `409` if the
new year already has either regime, `404` if the source has none. Returns the
`GET` body for the new year.

---

## Missing year

Anything that calculates pay for a month (payroll runs, salary structure and
template previews, the TDS work sheet, the employee app's payslip, home and
declaration screens) reads that month's FY rows. Without them it answers
`409` with:

- `"Statutory settings for FY 2027-28 are not set up"` (no `payroll_statutory_configs` row)
- `"Income tax settings for FY 2027-28 are not set up"` (only where income tax is
  worked out: a run for an org with TDS on, the TDS work sheet, the declaration screen)

The dashboard should link those messages to this settings page.
