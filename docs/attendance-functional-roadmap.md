# Attendance Functional Improvement Roadmap

This roadmap follows the workforce attendance UX refresh. It deliberately separates interface improvements from new operational capabilities so attendance and payroll rules can be validated before new automation is introduced.

## Recommended delivery order

| Priority | Capability | User value | Effort | Dependencies | Main risk | Suggested phase |
|---|---|---|---|---|---|---|
| 1 | Bulk “worked as scheduled” confirmation | Lets a controller confirm routine shifts quickly while keeping exceptions and OB validation visible. | Medium | Batch validation endpoint, per-entry error response, audit events | Incorrect bulk confirmation if changed shifts are not excluded | Phase 2A |
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

## Success measures

- Median time to complete a site’s routine attendance.
- Percentage of sites reviewed by the daily cut-off.
- Number and age of attendance issues at payroll cut-off.
- Percentage of manual changes with a complete audit reason.
- Correction rate after timesheet approval.
- Reminder-to-completion conversion and reminder opt-out rate.
