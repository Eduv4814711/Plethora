# Leave management

A from-scratch, deliberately simple leave system for a South African
employer with two kinds of staff: **general employees** (Basic Conditions
of Employment Act, BCEA) and **security officers** covered by the NBCPSS
bargaining council. Both are handled by the same code — the only thing
that differs between them is a handful of numbers in one config file.

This document explains every calculation in plain English, states the
assumptions the code makes, and flags the ones that should be confirmed
with labour counsel before this is relied on for real payroll decisions.
It is not legal advice.

## Where things live

| Concern | File |
|---|---|
| The two employee types' numbers (days/week, hours/shift, entitlements) | `apps/api/src/lib/leave-rules.config.ts` |
| The calculation engine (pure functions, no database) | `apps/api/src/services/leave-rules.ts` |
| The service layer (loads an employee, calls the engine, writes rows) | `apps/api/src/services/leave-v3.service.ts` |
| The API routes | `apps/api/src/routes/leave-v3.ts`, registered at `/leave` |
| The frontend page | `apps/web/app/(dashboard)/employees/leave/page.tsx` |
| Unit tests for every rule below | `apps/api/src/services/__tests__/leave-rules.test.ts` |
| End-to-end tests against the real API | `apps/api/src/routes/__tests__/leave-v3.integration.test.ts` |

## The data model — four tables

- **`LeaveRequest`** — every request for every leave type, one row each.
  Holds `startDate`/`endDate` (for record-keeping), `unitsRequested`
  (entered directly — see below), `status` (`PENDING` / `APPROVED` /
  `REJECTED` / `CANCELLED`), and type-specific fields
  (`familyResponsibilityReason`, `parentalLeaveScenario`).
- **`MedicalCertificate`** — sick leave only. Practitioner name,
  registration number, consultation date, the booked-off date range, and a
  pointer to the uploaded file. **No diagnosis field exists anywhere in
  this schema** — not optional, not nullable, must never be added (POPIA).
- **`LeaveAdjustment`** — manual balance corrections (rare). Signed units,
  a required reason, who made it, when.
- **`LeaveAuditLog`** — append-only. Every request, approval, rejection,
  cancellation, and balance adjustment gets a row. Application code never
  updates or deletes rows here.

There is **no fifth table for balances**. A balance is never stored — it's
computed fresh every time it's needed:

```
available = entitlement (for the current cycle) + adjustments (in that cycle) − taken (in that cycle)
```

This keeps the whole system to four tables instead of the accrual-ledger
design that would otherwise be needed, at the cost of recomputing balances
on every read instead of reading a maintained running total. For the
volumes this system handles, that trade is worth it.

## The two employee types

```ts
general:          { workUnitsPerWeek: 5, hoursPerUnit: 8,  annualLeaveDays: 21, studyLeaveDaysPerYear: 0 }
security_officer: { workUnitsPerWeek: 4, hoursPerUnit: 12, annualLeaveDays: 21, studyLeaveDaysPerYear: 6 }
```

A "work unit" is a **day** for general staff and a **shift** for security
officers. Every formula below is written in terms of "work units" and
plugs in the right number for whichever employee it's calculating for —
there is no separate code path per employee type, only a different number
looked up from this table.

`employeeType` is a plain string column on `Employee` (`"general"` or
`"security_officer"`) — not a table, not a class hierarchy.

## Leave cycles run from the employee's own anniversary

Every leave type has a cycle length (12 months for annual/family-
responsibility/study/parental, 36 months for sick leave). The cycle is
always anchored to the employee's own **commencement date**, never the
calendar year. An employee who joined on 15 March gets a cycle that runs
15 March → 14 March each year, not January → December. Someone who joined
mid-year still gets a full, correctly-dated first cycle from day one.

Sick leave's 36-month cycle defaults to the same anchor
(`commencementDate`) but can be set independently via
`Employee.sickLeaveCycleAnchor` — this only needs a value if HR wants the
sick cycle to start on a different date than the employee's official start
date (for example, after a break in service). If it's left blank, the
sick cycle and the 12-month cycles simply produce different windows from
the same anchor date.

## Annual leave

- **21 consecutive days per 12-month cycle, both employee types** — the
  BCEA minimum, granted the same way regardless of employeeType.
- **Granted in full at the start of each cycle**, not accrued
  incrementally through it (BCEA s20 permits 1 day per 17 days worked
  instead; upfront-grant is common practice and simpler to reason about).
  🚩 *Flagged assumption* — if this employer wants day-by-day accrual with
  pro-rata forfeiture on exit, this needs to change.
- **A public holiday that falls inside an approved annual leave request is
  not deducted from the balance.** The system checks each of the
  configured public holidays' *observed* dates (see below) against the
  request's date range and subtracts however many fall inside it from
  `unitsRequested` before deducting from the balance. Example: a 5-unit
  request that contains one public holiday only deducts 4 units.
- **No carry-over, forfeiture, or expiry modeling.** Balance is always
  "entitlement for the current cycle minus what's been taken in that
  cycle" — nothing carries from one cycle to the next, and nothing is
  automatically forfeited either (there's simply no memory of prior
  cycles' balances at all). 🚩 *Flagged assumption* — this is a real gap
  against full BCEA s20(4) carry-over/forfeiture rules, not just a
  simplification. If unused annual leave should roll over, this needs to
  be built.
- **Termination payout** (annual leave only — the one leave type ever paid
  out) is not automated by this module; it isn't in scope per the original
  brief.

## Sick leave — the universal formula

The same formula for both employee types:

```
6 × (work units per week), on a 36-month cycle
```

- **General staff:** 6 × 5 = 30 days per 36-month cycle.
- **Security officers:** 6 × 4 = 24 shifts per 36-month cycle.

**First 6 months of employment:** instead of the full-cycle number above,
the entitlement is **1 unit of sick leave per 26 units worked**, estimated
from the employee's configured work pattern
(`workUnitsPerWeek × weeks elapsed since commencement`). 🚩 *Flagged
assumption* — this module does not integrate with attendance or
rostering, so "units worked" is an estimate from the configured pattern,
not an actual count of shifts/days the employee showed up for. If an
employee's real attendance differs meaningfully from their configured
pattern in their first 6 months, this estimate will be off.

**Medical certificate requirement:** a certificate is required when either
of these is true:
- the request is for **more than 2 consecutive units**, or
- the employee has already been on sick leave **more than twice in the
  trailing 8 weeks (56 days)**.

The certificate itself stores only: practitioner name, practitioner
registration number, consultation date, the booked-off date range, and a
file reference. **Never a diagnosis.**

## Family responsibility leave

- **3 days per 12-month cycle**, same for both employee types.
- **Eligibility requires more than 4 months of service AND working at
  least 4 work units a week.** For general staff (5 days/week) this is
  automatically satisfied. For security officers (4 shifts/week), 4 shifts
  a week is treated as satisfying the BCEA's "4 days a week" eligibility
  test. 🚩 *Flagged assumption, explicitly not a settled legal position* —
  "4 shifts = 4 days" is a reasonable reading but should be confirmed with
  labour counsel before being relied on to grant or deny this leave type.
- **Reason must come from a fixed list** — free text is rejected outright.
  The list (mirroring BCEA s27): birth of the employee's child, the
  employee's child being sick, and the death of a spouse/life partner,
  parent, adoptive parent, grandparent, child, adopted child, grandchild,
  or sibling.
- **Never paid out** on termination or otherwise.

## Parental leave

One leave type, not split by gender or parental status — the employee
picks a scenario at request time:

- **Sole or only-employed parent:** capped at **4 consecutive months**
  from the request's start date.
- **Shared pool** (both parents employed): capped at **4 months + 10
  days** from the request's start date, shared between both parents.

Both caps are computed as a day count from the start date (calendar
months, not work units) — parental leave has no "balance" concept the way
the other leave types do, only a per-request cap checked against
`unitsRequested`.

- **Unpaid by statute** — no pay calculation happens for parental leave
  anywhere in this module.
- **The employee declares which scenario applies and how many days they're
  taking from the shared pool; this is never verified against the other
  parent's employer.** 🚩 *Explicitly out of scope, not a bug* — cross-
  employer verification was excluded from the original brief.
- **The NBCPSS employer top-up (if any) is out of scope** — this module
  tracks statutory leave only, no top-up percentages or Rand values.

## Study leave

- **Security officers only** — 6 days/year, config-driven
  (`studyLeaveDaysPerYear`).
- **Unavailable to general employees** — the leave type simply doesn't
  appear as an option, and a direct API request for it is rejected with a
  clear error (`LEAVE_TYPE_NOT_AVAILABLE`).
- Same mechanics as annual leave otherwise (granted in full at cycle
  start, no carry-over).

## Public holidays

A list of the year's public holidays lives in the config file, copied
verbatim from the same list used elsewhere in the app so both stay in
sync. Each holiday's **observed date** is computed at read time — a
holiday falling on a **Sunday moves to the following Monday**; Saturdays
do **not** shift. This only affects the annual-leave non-deduction rule
above; it is not stored anywhere.

**`workedPublicHoliday` is a manual flag on the request, not integrated
with attendance.** 🚩 *Flagged assumption* — nobody automatically detects
that an employee actually worked on a public holiday; whoever captures the
leave request has to tick the box themselves. There's no pay-premium
calculation for it either (`publicHolidayWorkedMultiplier` in the config
is defined but not wired into any payroll math in this module).

## How a request becomes a balance change

`unitsRequested` is entered **directly** by whoever creates the request —
it is **not derived from the start/end date range**. The date range is
for record-keeping and calendar display only. 🚩 *Flagged design
decision* — this was chosen deliberately to avoid needing this module to
understand which of an employee's calendar days are their normal working
days (that would require integrating with rostering, which the original
brief explicitly excluded). It means the requester is trusted to enter the
right number of units, checked only against the available balance, not
against the calendar.

A request only affects the balance while it's `PENDING` or `APPROVED` —
`REJECTED` and `CANCELLED` requests are excluded. This means a pending
request already "reserves" the units it would consume, so a second request
for the same cycle correctly sees a reduced available balance even before
the first one is decided.

**Over-balance requests are blocked with a clear message**, both when
previewing (`POST /leave/preview`) and when actually submitting
(`POST /leave`) — the API returns `400 EXCEEDS_BALANCE` naming the units
requested and the units available. The frontend also disables the submit
button once a preview shows the request would exceed balance, but the
server is the authoritative check either way.

## PSIRA fields

`Employee.psiraRegistrationNumber`, `psiraRegistrationExpiry`, and
`psiraGrade` (`E`/`D`/`C`/`B`/`A`) are **stored only** — there is no
expiry alerting, no grade-based validation, and no wiring into leave
calculations. They exist purely as employee record fields.

## POPIA compliance

- **No diagnosis field anywhere in the schema.** Not on `Employee`, not on
  `MedicalCertificate`, not anywhere else. This is a hard constraint, not
  a default that happens to be unset.
- Medical certificates store only practitioner identity, dates, and a file
  reference.
- Every `LeaveRequest` carries a `retentionUntil` date, set to **3 years
  after creation** at write time. Nothing currently reads this field to
  auto-delete records — it is stored so a future retention job has
  somewhere to look, per POPIA's data-minimisation principle, but no such
  job exists yet. 🚩 *Flagged gap* — if automatic deletion after the
  retention period is required, that job still needs to be built.

## Audit log

Every `LeaveAuditLog` row records: who (`actorUserId`), what
(`action` — `REQUEST_CREATED`, `REQUEST_APPROVED`, `REQUEST_REJECTED`,
`REQUEST_CANCELLED`, `BALANCE_ADJUSTED`, `MEDICAL_CERTIFICATE_ATTACHED`),
when, and a before/after JSON snapshot where relevant. Rows are never
updated or deleted by application code. Linking a leave request to a
payroll run (`LeaveRequest.payrollRunId`, set when payroll consumes it and
cleared if that run is reverted) is **not** audit-logged — it's treated as
routine payroll bookkeeping, not a leave-lifecycle event.

## How payroll consumes leave

- **Timesheet hours** (`timesheet.service.ts`): every `APPROVED` leave
  request overlapping the pay period contributes hours =
  `unitsRequested × hoursPerUnit(employeeType)`. Annual/sick/family-
  responsibility/study leave count as paid `leaveHours`; parental leave
  (unpaid by statute) counts as `unpaidLeaveHours`. The old UIF-supported
  and injury-on-duty leave buckets that existed in the previous system
  **always report zero now** — both were explicitly out of scope for this
  rebuild.
- **A request spanning a pay-period boundary is prorated** by the ratio of
  its calendar days that fall inside this period versus its total calendar
  days — an approximation, not a roster-aware day-by-day split. 🚩
  *Flagged assumption* — a request that happens to span a period boundary
  on a week with public holidays or weekends will still be split evenly
  by calendar days, which may not exactly match which of those days were
  actually the employee's scheduled work days.
- **Payroll is blocked from calculating or approving** while any `PENDING`
  leave request overlaps the pay period — `getLeaveReadiness()` in
  `leave-v3.service.ts` returns `blocked: true` with the count and IDs of
  the unresolved requests.
- **Approving a payroll run links every approved leave request in the
  period to that run** (`payrollRunId`), so it's clear which leave has
  already been paid. **Reverting an approved-but-unpaid run clears that
  link** so the leave can be corrected and re-posted when the run is
  re-approved. This is deliberately simpler than the previous system's
  separate posting-ledger table — the link lives directly on the leave
  request.

## WhatsApp leave capture

The WhatsApp command `leave <date> [<end-date>] <type> [...]` creates a
request via the same service everything else uses. Two simplifications
specific to this channel:

- **`unitsRequested` defaults to the number of calendar days between start
  and end date**, inclusive — there's no way to say "2 units over a
  3-calendar-day span" over WhatsApp; the app request form and API support
  that, WhatsApp doesn't.
- **Medical certificate uploads via WhatsApp use placeholder values** for
  the structured fields (practitioner name, registration number,
  consultation date, booked-off range) that the certificate record
  requires, since there's no good way to collect four separate structured
  fields over a chat message. 🚩 *Flagged limitation* — anyone reviewing a
  WhatsApp-submitted certificate should expect to fill in the real
  practitioner details afterward via the web app.
- Parental leave requires a scenario keyword (`sole` or `shared`) right
  after the leave type; family responsibility leave requires a reason
  keyword. Both are rejected with a specific error message if omitted.

## Explicitly out of scope

None of the following exist in this module, by design:

- UIF benefit calculation
- Verifying a partner's leave with their own employer (parental leave
  shared pool)
- The NBCPSS employer top-up percentage or Rand value for parental leave
- Night-work compensation
- PSIRA expiry alerts or validation
- Armed-response-specific rules
- Area/grade wage lookups
- Sectoral determinations for sectors other than NBCPSS security
- Email/SMS notifications
- Reporting dashboards beyond the leave module's own tabs
- Multi-company support beyond the existing tenancy model
- A calendar-grid UI (the "calendar" tab is a simple approved-leave list
  filtered by date range, not an interactive grid)

## Summary of flagged assumptions (for labour-counsel review)

1. Annual/study/family-responsibility leave is granted in full at cycle
   start, not accrued incrementally (BCEA s20 permits either).
2. No carry-over, forfeiture, or expiry of unused annual leave between
   cycles — a real gap against BCEA s20(4), not just a simplification.
3. First-6-months sick leave entitlement is estimated from the employee's
   configured work pattern, not actual attendance.
4. "4 shifts a week" is treated as satisfying the BCEA's "4 days a week"
   family-responsibility-leave eligibility test for security officers.
5. `unitsRequested` is entered directly by the requester, not derived from
   or validated against the calendar/roster.
6. `workedPublicHoliday` is a manual, unverified flag with no pay-premium
   calculation wired to it.
7. A leave request spanning a payroll period boundary is prorated by
   calendar-day ratio, not by actual scheduled work days.
8. `retentionUntil` is stored on every request but nothing currently
   enforces it — no automatic deletion job exists yet.
9. WhatsApp-submitted medical certificates carry placeholder structured
   fields that need to be completed properly afterward.
