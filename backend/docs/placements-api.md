# Placements API

Placements is for a company that places people in jobs: an HR placement
agency. Its **clients** are the companies hiring; its **customers** are the
candidates being placed; a **placement** is one candidate put forward for one
position at one client, followed from shortlist to joining.

The app's Actions tab adds clients, customers and placements and moves a
placement along; the HR dashboard's Placements section lists, edits, deletes
and exports them.

## Who has it

Only a company whose record says so:

```js
// companies
{ id: 'hrorgsol', name: "HR Organization's Solutions", features: { placements: true } }
```

Absent or `false` is off. It is set by Sowaka in the database; nothing in the
dashboard or the app sets it. For any other company every route below answers
`403`:

```json
{ "success": false, "message": "Placements is not switched on for your company", "requestId": "…" }
```

The signed-in profile says whether it is on, so the app and the dashboard show
the Placements screens only then. `POST /auth/verify-otp` and `GET /auth/me`
carry, on `user`:

```json
{ "features": { "placements": true } }
```

Every record belongs to the signed-in person's company. A record of another
company reads as not found (`404`), and a reference to one (`clientId`,
`customerId`) is refused (`400`).

## Records

Optional text fields are always present, as `""` when not set. Numbers not set
are `null`. `interviewDate` and `joiningDate` are calendar days, `YYYY-MM-DD`,
or `null`. Timestamps are ISO strings.

### Client: a company hiring

```json
{
  "id": "6f1c2a7e-0d4b-4a39-9b55-3d1e8f0c2b11",
  "name": "Northwind Logistics",
  "contactName": "Meera Rao",
  "phone": "+91 98450 12345",
  "email": "meera@northwind.in",
  "industry": "Logistics",
  "city": "Bengaluru",
  "notes": "Hiring 6 warehouse supervisors by December",
  "createdByUserId": "u-123",
  "createdAt": "2026-10-26T09:12:44.120Z",
  "updatedAt": "2026-10-26T09:12:44.120Z"
}
```

### Customer: a candidate

```json
{
  "id": "0b8e4c55-9f0a-4d8e-a7a4-21c3f5d1e9aa",
  "name": "Arjun Mehta",
  "phone": "9876543210",
  "email": "arjun.mehta@gmail.com",
  "currentRole": "Shift supervisor",
  "experienceYears": 4.5,
  "skills": ["Inventory", "SAP", "Team handling"],
  "city": "Mysuru",
  "notes": "",
  "createdByUserId": "u-123",
  "createdAt": "2026-10-26T09:15:02.311Z",
  "updatedAt": "2026-10-26T09:15:02.311Z"
}
```

### Placement

`status` is one of `shortlisted`, `interviewing`, `offered`, `joined`,
`dropped`; new placements start `shortlisted` unless another is given.
`history` holds every status the placement has had, oldest first, starting
with the one it was created with.

A `PlacementView` is a placement with `clientName` and `customerName`, read
with it in the same query.

```json
{
  "id": "c7d0f1e2-3b4a-4c5d-8e9f-0a1b2c3d4e5f",
  "customerId": "0b8e4c55-9f0a-4d8e-a7a4-21c3f5d1e9aa",
  "clientId": "6f1c2a7e-0d4b-4a39-9b55-3d1e8f0c2b11",
  "position": "Warehouse supervisor",
  "status": "interviewing",
  "interviewDate": "2026-10-29",
  "joiningDate": null,
  "ctcRupees": 420000,
  "feeRupees": 35000,
  "notes": "Second round with the ops head",
  "createdByUserId": "u-123",
  "createdAt": "2026-10-26T09:20:10.004Z",
  "updatedAt": "2026-10-27T11:02:40.870Z",
  "history": [
    { "status": "shortlisted", "at": "2026-10-26T09:20:10.004Z", "byUserId": "u-123" },
    { "status": "interviewing", "at": "2026-10-27T11:02:40.870Z", "byUserId": "u-123" }
  ],
  "clientName": "Northwind Logistics",
  "customerName": "Arjun Mehta"
}
```

## Validation

Strings are trimmed. A bad field is refused with `400` and a message naming
it, for example `{ "success": false, "message": "phone must be a phone number of 7 to 15 digits" }`.

| Field | Rule |
| --- | --- |
| `name` (client, customer) | required, up to 120 characters |
| `contactName`, `currentRole`, `position` | up to 120 characters; `position` required |
| `industry`, `city` | up to 80 characters |
| `notes` | up to 2,000 characters |
| `phone` | digits, spaces, `+`, `-`, `(`, `)`, with 7 to 15 digits; required for a customer |
| `email` | an email address, up to 254 characters; stored lower-case |
| `experienceYears` | a number from 0 to 60, kept to one decimal |
| `skills` | a list of strings, or one comma-separated string; up to 30, each up to 40 characters; repeats dropped |
| `ctcRupees`, `feeRupees` | a number from 0 to 1,000,000,000, kept to two decimals |
| `interviewDate`, `joiningDate` | `YYYY-MM-DD`, a real calendar day |
| `status` | one of the five above |
| `customerId`, `clientId` | a customer and a client of the same company |

On a PATCH, `""` or `null` clears an optional field; a field left out is kept.

## App routes

Signed in (`Authorization: Bearer <token>`). The company's own records only.

### `GET /placements/summary`

```json
{
  "success": true,
  "clients": 12,
  "customers": 48,
  "placements": {
    "total": 31,
    "byStatus": { "shortlisted": 9, "interviewing": 8, "offered": 4, "joined": 7, "dropped": 3 }
  }
}
```

Every status is present, `0` when there are none.

### `GET /placements/clients?q=`

Newest first, at most 200. `q` matches the name, any case.

```json
{ "success": true, "clients": [ /* Client */ ] }
```

### `POST /placements/clients`

```json
{ "name": "Northwind Logistics", "contactName": "Meera Rao", "phone": "+91 98450 12345", "email": "meera@northwind.in", "industry": "Logistics", "city": "Bengaluru", "notes": "" }
```

`201`:

```json
{ "success": true, "client": { /* Client */ } }
```

### `GET /placements/customers?q=`

Newest first, at most 200. `q` matches the name or the phone number.

```json
{ "success": true, "customers": [ /* Customer */ ] }
```

### `POST /placements/customers`

```json
{ "name": "Arjun Mehta", "phone": "9876543210", "email": "arjun.mehta@gmail.com", "currentRole": "Shift supervisor", "experienceYears": 4.5, "skills": ["Inventory", "SAP"], "city": "Mysuru", "notes": "" }
```

`201`:

```json
{ "success": true, "customer": { /* Customer */ } }
```

### `GET /placements?mine=1&status=`

Newest first, at most 200. `mine=1`: only those the signed-in person created.
`status`: only that status.

```json
{ "success": true, "placements": [ /* PlacementView */ ] }
```

### `POST /placements`

```json
{ "customerId": "0b8e…", "clientId": "6f1c…", "position": "Warehouse supervisor", "status": "shortlisted", "interviewDate": "2026-10-29", "joiningDate": null, "ctcRupees": 420000, "feeRupees": 35000, "notes": "" }
```

`201`:

```json
{ "success": true, "placement": { /* PlacementView */ } }
```

### `PATCH /placements/:id`

Any of `status`, `interviewDate`, `joiningDate`, `ctcRupees`, `feeRupees`,
`notes`. Allowed for the person who created the placement, or a dashboard
admin of the company; anyone else gets `403`. A new status is added to
`history`; the same status again adds nothing.

```json
{ "status": "interviewing", "interviewDate": "2026-10-29" }
```

```json
{ "success": true, "placement": { /* PlacementView */ } }
```

## Dashboard routes

Under `/admin/placements`: signed in, with HR dashboard access, and the
`placements` dashboard tab (People › Accesses; an admin, or someone never
limited to some tabs, has it). The company must have the feature. The
dashboard's views also carry `createdByName`, and clients and customers
`placements` (how many placements use them), read in the same query.

### `GET /admin/placements/summary`

As `GET /placements/summary`.

### `GET /admin/placements/clients?q=&createdBy=&from=&to=`

`q` matches the name, contact name or city. `createdBy` is a userId. `from`
and `to` (`YYYY-MM-DD`, India time, both days included) bound `createdAt`.
Newest first, at most 2,000.

```json
{ "success": true, "clients": [ { /* Client */ "createdByName": "Tanvi", "placements": 3 } ] }
```

### `POST /admin/placements/clients`, `PATCH /admin/placements/clients/:id`

As the app's POST; PATCH takes any of the same fields. `{ "client": … }`.

### `DELETE /admin/placements/clients/:id`

`409` while a placement uses the client:

```json
{ "success": false, "message": "Northwind Logistics is on 3 placements: delete or move those first" }
```

### `GET /admin/placements/customers?q=&createdBy=&from=&to=`

`q` matches the name, phone, email, current role, city or a skill.
Otherwise as clients. `{ "customers": [ … ] }`.

### `POST /admin/placements/customers`, `PATCH /admin/placements/customers/:id`, `DELETE /admin/placements/customers/:id`

As for clients.

### `GET /admin/placements?q=&status=&clientId=&customerId=&createdBy=&from=&to=`

`q` matches the position, the client's name or the customer's name. `from`
and `to` bound `createdAt`. Newest first, at most 2,000.

```json
{ "success": true, "placements": [ { /* PlacementView */ "createdByName": "Tanvi" } ] }
```

### `POST /admin/placements`, `PATCH /admin/placements/:id`

As the app's. A dashboard admin route may also change `customerId`,
`clientId` and `position`. `{ "placement": … }`.

### `DELETE /admin/placements/:id`

Removes a placement entered by mistake (and so frees its client and customer).

### Export to Excel

The dashboard builds the `.xlsx` from the list it shows (the filtered list
above), as the other dashboard tables do: no separate route.

## Data

Three collections, every document carrying `org`:

- `placement_clients`
- `placement_customers`
- `placements`

Indexes proposed, not created:

```js
db.placement_clients.createIndex({ org: 1, id: 1 }, { unique: true })
db.placement_clients.createIndex({ org: 1, createdAt: -1 })
db.placement_customers.createIndex({ org: 1, id: 1 }, { unique: true })
db.placement_customers.createIndex({ org: 1, createdAt: -1 })
db.placements.createIndex({ org: 1, id: 1 }, { unique: true })
db.placements.createIndex({ org: 1, createdAt: -1 })
db.placements.createIndex({ org: 1, clientId: 1 })
db.placements.createIndex({ org: 1, customerId: 1 })
```
