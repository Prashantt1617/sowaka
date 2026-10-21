# Payroll encryption

Salaries in an encrypted company are locked with a key that only its payroll
people hold. The server and the database store locked data only: someone with
the database, a backup, the server's logs, or the server itself (Sowaka
included) sees ciphertext, not pay.

It is off for every company until a payroll admin turns it on
(Payroll Runs › **Salary encryption** › **Set up encryption**).

## What it protects, and what it doesn't

| Threat | Protected? |
|---|---|
| A copy of the database or a backup | Yes: amounts are ciphertext |
| Someone with database or server access reading salaries | Yes: the server never holds a key that opens them |
| A bug or log line that prints a record | Yes: the record holds no readable amount |
| Another company's payroll user | Yes: each company has its own key |
| A server that serves *altered dashboard code* to steal a passphrase as it is typed | **No.** End-to-end encryption in a web app trusts the code it is served. Key fingerprints (`keyFingerprint()` in `crypto.ts`) are there for a future check |
| Everyone forgets their passphrase **and** the recovery key is lost | **The data is gone.** Nobody, Sowaka included, can open it |

## Keys

```
your passphrase ──PBKDF2-SHA256, 600,000 rounds──▶ unlocks your RSA-OAEP-3072 private key
company payroll key (AES-256-GCM, random)
  ├─ locked to each payroll person's public key   (a "grant")
  └─ locked to the company's recovery keypair      (opened by the recovery key)
each salary / run total / payslip / tax declaration ──AES-GCM with the payroll key──▶ sealed
each payslip, also ──a fresh key locked to the employee's public key──▶ the employee can open their own
```

Every sealed record is bound (AES-GCM associated data) to its company, kind and
id, so the server cannot move one person's sealed salary into another's record
without it failing to open.

All of it is WebCrypto: the same code (`backend/src/shared/payroll/crypto.ts`,
`sealed-client.ts`) runs in the dashboard and in the Node checks.

## What is and isn't encrypted

| Data | How |
|---|---|
| CTC, component amounts, per-person changes, revision history | End-to-end sealed |
| Payroll run totals, every payslip | End-to-end sealed |
| Tax declarations | End-to-end sealed (regime and proof status stay plain) |
| Bank account, PAN, UAN, PF and ESI numbers | Field encryption with a server key (`PAYROLL_FIELD_KEY`), not end-to-end yet |
| Templates, components, statutory settings and rules | Plain: rules, not anyone's pay |
| Names, attendance, paid days, which template a person is on | Plain: access settings apply |

## Turning it on (a company that already has salaries)

1. A payroll admin opens **Payroll Runs › Salary encryption › Set up encryption**,
   chooses a passphrase (twice, at least 10 characters) and ticks the
   "can't be recovered" box.
2. The browser makes the keys, turns encryption on, then **locks everything that
   was readable**: salaries, runs, payslips and tax declarations are sealed and
   their readable amounts cleared on the server.
3. The **recovery key** is shown once. Copy it, keep it offline (a password
   manager plus a printed copy, or split between two founders), tick
   **I saved it somewhere safe**, click **Done**.

If locking stops halfway (a closed tab, a dropped connection), the panel shows
"N payroll records are still readable" with **Finish locking**. Locking only
touches what is still readable, so running it again is safe. The recovery key
is shown even when locking fails.

Production must run the code that understands sealed records **before** a real
company is encrypted: older code would show ₹0 salaries.

## Day to day

- **Unlock:** every payroll screen asks for your passphrase first ("Unlock
  payroll"). The key stays in that browser tab's memory only, never in storage.
  **Lock** forgets it.
- **Another payroll person:** they open a payroll screen and **Create my key**,
  then someone who holds the key clicks **Grant access** on the panel.
- **Change passphrase:** same key, new passphrase; nobody needs to grant you again.
- **Forgot passphrase:** **Forgot passphrase? Use recovery key**, then set a new one.
  Or have another key holder grant you again after you create a new key.
- **New recovery key:** the old one stops working at once; the payroll key is
  renewed with it. Shown once.
- **Someone loses payroll access:** their grant is dropped and the company is
  flagged for rotation. The next key holder to unlock rotates automatically:
  everything is re-sealed under a new key, so their old copy opens nothing.

## Runs

An encrypted company's month is computed in the browser with the same
calculator the server uses (`backend/src/shared/payroll/`), from the server's
non-amount inputs (attendance, approvals, rules), then uploaded sealed. Approval,
recall and Mark paid work as for any run. Payslips print from the opened slip in
the browser.

## Not done yet

- **Employees' payslips in the app.** Payslips are sealed to each employee's own
  key (`GET/PUT /payslips/key`, `GET /payslips/mine/sealed`; `SealedPayslipReader`
  is the reference), but the Flutter app can't open them yet. Until an app
  release, an encrypted company's employees see no payslips in the app (never a ₹0 one).
- Bank, PAN and UAN moving from the server key to end-to-end.

## Checks

- `PORT=4097 npm run payroll:e2e-check` (backend): the whole flow against the real
  API in the sowaka org, including turning it on over existing plaintext data,
  then a scan that no known amount is stored readable. It sets sowaka's payroll
  aside first and puts it back after (`--restore <file>` after a crash).
- `npm run payroll:reconcile <org>` skips an encrypted org: its amounts can't be read.
