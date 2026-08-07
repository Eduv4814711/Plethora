# Attendance Functional Improvement Roadmap

This roadmap follows the workforce attendance UX refresh. It deliberately separates interface improvements from new operational capabilities so attendance and payroll rules can be validated before new automation is introduced.

## Recommended delivery order

| Priority | Capability | User value | Effort | Dependencies | Main risk | Suggested phase |
|---|---|---|---|---|---|---|
| ~~1~~ **Delivered** | Bulk “worked as scheduled” confirmation | Lets a controller confirm routine shifts quickly while keeping exceptions and OB validation visible. | Medium | Batch validation endpoint, per-entry error response, audit events | Incorrect bulk confirmation if changed shifts are not excluded | Phase 2A |
| 2 | Scheduled exception scans and reminders | Removes reliance on manually selecting “Scan” and alerts supervisors before attendance blocks payroll. | Medium | Background scheduler, notification preferences, WhatsApp/dashboard delivery | Alert fatigue; duplicate reminders | Phase 2A |
| 3 | Attendance source and confidence | Shows whether an entry came from a clock device, WhatsApp, geofence, import, or manual change and highlights conflicting evidence. | Medium | Normalized source metadata and reconciliation rules | Users may treat automated evidence as infallible | Phase 2B |
| 4 | Correction requests and second-level approval | Gives authorized users a controlled way to correct locked attendance with evidence, comments, ownership, and audit history. | High | Approval workflow, attachments, capability policy, payroll-lock integration | Delayed payroll if approval ownership is unclear | Phase 2B |
| 5 | Offline mobile capture | Allows on-site attendance work with unreliable connectivity and safely synchronizes later. | High | Local encrypted storage, conflict detection, retry queue, PWA support | Conflicting edits and exposure of sensitive data on shared devices | Phase 3A |
| 6 | Employee attendance history and disputes | Lets employees see approved attendance and submit discrepancies before payroll closes. | High | Employee self-service access, privacy rules, correction workflow | Increased review volume and cross-employee data exposure | Phase 3A |
| 7 | Attendance trend reporting | Helps operations identify repeated absence, lateness, overtime, unresolved issues, and low-completion sites. | Medium | Trusted historical data, agreed KPI definitions, reporting permissions | Misleading trends when source data is incomplete | Phase 3B |

## Delivery notes

### Phase 2A — reduce daily administration

- Bulk confirmation must default to scheduled guard, scheduled shift, and scheduled times only for entries with no discrepancies.
- Every selected entry must still pass Duty ON/OFF, leave-conflict, and lock validation.

**Delivered — bulk confirmation** (`POST /rosters/site-timesheets/:id/rows/bulk-confirm`).
Notes for anyone extending it:

- Eligibility is recomputed server-side against the **projected** post-confirm state. An
  uncaptured rostered row has no actual guard or shift yet, so measuring it as-is makes
  every clean row look like a coverage shortfall.
- Date-level coverage codes (`DAY_COVERAGE_SHORT`, `NIGHT_COVERAGE_SHORT`) are excluded
  from row eligibility. They attach to every row on a date, so one absent guard would
  otherwise block bulk confirmation for everyone who did turn up.
- A row with no resolvable day/night shift is rejected outright (`NO_SHIFT_TYPE`) and never
  defaulted. Payroll de-duplicates raw `Shift` records against timesheet rows on
  `siteId:guard:date:actualShiftType`; a null shift type makes that key `…:unknown`, stops
  suppressing the raw shift, and double-counts the hours.
- The write is the full patch — guard, shift type and code, clock in/out, hours, status —
  not just `approvalStatus`. A row approved without times pays zero hours while looking
  complete.
- Shared derivation lives in `apps/api/src/modules/rosters/site-timesheet-derive.ts`, with a
  parity test against the browser copy in `apps/web/lib/site-timesheet-utils.ts`.
- Scheduled scans should be idempotent and use configurable grace periods and reminder frequency.
- Completion notifications should link directly to the affected site, period, and shift.

### Phase 2B — improve trust and governance

- Display source, last update, editor, and confidence without changing the approved timesheet as payroll’s source of truth.
- Corrections should record before/after values, reason, evidence, requester, approver, timestamps, and payroll impact.
- Make second-level approval configurable by correction type and payroll state rather than mandatory for every edit.

### Phase 3 — extend access and insight

- Offline synchronization must never silently overwrite a newer server record; conflicts require an explicit user choice.
- Employee access must be limited to the employee’s own records and use the same correction workflow as supervisor requests.
- Reports should expose data completeness alongside every rate or trend so missing attendance is not interpreted as absence.

## Office staff attendance (delivered, outside the original roadmap)

Office staff (`Employee.employeeType === "general"`) previously had no attendance path at
all. They now have a daily roll call at `/attendance?view=staff`, backed by
`StaffAttendanceDay` and the `/staff-attendance` API module.

Deliberate boundaries:

- **It is not payroll data.** Office staff are paid `monthlySalaryForPayPeriod`, a fixed
  amount independent of hours. `aggregateTimesheets` and `findSitesNeedingApproval` must
  never read `StaffAttendanceDay`; `staff-attendance-payroll-isolation.test.ts` pins this.
- **Separate table, not a nullable `siteId` on `SiteTimesheetRow`.** Reusing the site
  timesheet would make salaried staff payable, break the `siteId:date` coverage keys, drag
  the mandatory OB rules onto people with no occurrence book, and defeat the row unique key
  (Postgres does not enforce uniqueness across nulls).
- **No approval or lock state.** Nothing downstream consumes it, so a payroll-style lock
  would add a blocker with no benefit.
- **Never feed it into `AttendanceException` detection.** Open critical exceptions block
  payroll; office attendance has no payroll consequence and must not become a gate.
- Leave stays authoritative: a person with approved leave cannot be marked present.

Reporting that spans both populations should union the two tables behind a read model
rather than merging storage (see Phase 3B).

## Success measures

- Median time to complete a site’s routine attendance.
- Percentage of sites reviewed by the daily cut-off.
- Number and age of attendance issues at payroll cut-off.
- Percentage of manual changes with a complete audit reason.
- Correction rate after timesheet approval.
- Reminder-to-completion conversion and reminder opt-out rate.
