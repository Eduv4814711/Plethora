# Leave Management Source-of-Truth Review and Delivery Report

## Delivery status

The leave domain has been rebuilt alongside the legacy tables. New writes flow through `LeaveApplication`, roster-aware `LeaveOccurrence` rows, an immutable minute ledger, effective-dated policies and employment terms, approval/document records, payroll postings, adjustments, and leave-specific audit events. Legacy tables remain in place for reconciliation and rollback reads.

Production cutover is intentionally **not automatic**. Each company still needs HR/legal policy confirmation, approved opening balances, migration anomaly sign-off, and a shadow-payroll comparison using representative data.

## Defects addressed

- Leave requests and approved records now have one authoritative application lifecycle.
- Users with leave create access submit applications; approval requires the separate leave approve capability, version checking, and an audit event.
- Paid, ordinary unpaid, UIF-supported, injury-on-duty, information-only, and split treatment remain distinct through occurrence and payroll inputs.
- Payroll approval and unique leave posting are committed in one database transaction.
- Fixed-salary unpaid/UIF reductions are explicit; hourly unpaid leave is never converted into paid hours.
- Durations are stored in minutes and derived from the employee's roster shift. Overnight leave is anchored to the shift start date in company time.
- Approved leave blocks clock-in, manual attendance, missed-shift capture, and timesheet approval. Leave must be cancelled or corrected through the audited leave workflow before attendance can be changed.
- Original roster duties are preserved as coverage requirements. Approval creates vacancy alerts; cancellation resolves leave-specific alerts without rewriting unrelated shifts.
- Approved/paid payroll leave cannot be hard-deleted. Leave in an approved but unpaid payroll run requires that run to be reverted first. Leave already posted to a paid run becomes `ADJUSTMENT_REQUIRED` and can be completed only after an external payroll-correction reference is recorded.
- Supporting evidence is application-scoped, type/size/content validated, reviewable, auditable, and excluded from the public static-file route. Downloads require authenticated leave-management access, are marked private and non-cacheable, and never expose the storage path. WhatsApp evidence is matched to an application belonging to the verified phone.
- Reports read applications, ledger balances, adjustments, expiries, and payroll postings rather than treating legacy requests as approved leave.
- Hard-coded legal entitlement claims were removed from the employee UI. Seed versions are marked `PENDING_HR_LEGAL_CONFIRMATION`.
- Leave occurrences distinguish payable/requested minutes from balance-consuming minutes, preventing unpaid, parental, IOD, and other non-balance leave from creating negative entitlement balances.
- Site-timesheet leave rows are excluded from worked hours and are reconciled against authoritative/legacy leave, preventing the same absence from being paid twice.
- Exact duplicate legacy leave rows block payroll readiness and are also de-duplicated defensively during calculation.

## New domain and interfaces

The migration adds:

- `EmploymentTerm`
- `LeaveTypeDefinition`
- `LeavePolicy` and `LeavePolicyVersion`
- `EmployeeLeavePolicyAssignment`
- `LeaveApplication` and `LeaveOccurrence`
- `LeaveLedgerEntry`
- `LeaveApprovalStep`
- `LeaveApplicationDocument`
- `LeaveAdjustment`
- `LeavePayrollPosting`
- `LeaveAuditEvent`

The `/leave` API exposes policy/type reads, policy version creation and confirmation, employment terms, assignments, preview, application creation/submission/decision/cancellation, secure documents, balances, calendar, reports, adjustments, accrual runs, and audit history. Existing `/payroll/leave-records` and `/payroll/leave-requests` writes are compatibility adapters or guarded legacy-only mutations.

Database controls include an active-date overlap exclusion constraint, valid range and minute checks, non-zero ledger/adjustment checks, company-scoped idempotency keys, optimistic application versions, and one non-reversal payroll posting per occurrence.

## Policy and calculation behaviour

- Policy lookup is effective-dated and honours an employee assignment before the company statutory baseline.
- Pending statutory/sector versions may be previewed for review, but an application cannot be approved unless one confirmed active policy version covers the complete leave period.
- Once a version is confirmed, negative-balance and maximum-consecutive-day rules are enforced.
- Opening balances require a reason and are posted as immutable `OPENING_BALANCE` ledger entries.
- Accrual runs only execute an explicitly confirmed method/rate, use the employee's employment-cycle anchor for annual grants, and are idempotent per employee, leave type, and period. Unsupported or incomplete formulas are reported as skipped rather than inferred.
- Carry-over, expiry, notice enforcement, and automatic conversion to unpaid fail closed while they are not automated. HR must use an audited adjustment rather than relying on a stored but unenforced field.
- Annual public holidays remain paid and roster-relevant but consume zero annual-leave balance minutes. Rotating/security employees require rostered shifts or an effective executable working pattern; the service does not assume an eight-hour day.

## Migration and rollout

Run the reconciliation report first:

```text
npm run db:migrate-leave-source --workspace=api -- --company-id <company-id>
```

After resolving duplicate/overlap/missing-policy/payroll anomalies, confirming the target database, and approving opening balances:

```text
npm run db:migrate-leave-source --workspace=api -- --company-id <company-id> --apply --expected-host <database-host> --expected-port <database-port> --expected-database <database-name>
```

The importer is idempotent, never changes or deletes legacy rows, matches only reliable approved request/record pairs, and imports unmatched rows with provenance. Apply mode fails closed when duplicate, overlap, missing-policy, or locked-payroll conflicts remain, and it never rewrites payroll history.

Recommended company cutover gates:

1. Apply the PostgreSQL migration.
2. Dry-run and reconcile legacy anomalies.
3. Capture effective employment terms and employee-policy assignments.
4. Enter HR-approved opening balances.
5. Have HR/labour counsel confirm policy versions and payroll treatment.
6. Run legacy/new shadow calculations and resolve every unexplained difference.
7. Verify permissions and secure-document access in staging.
8. Complete day, night, rotating, weekend, holiday, retrospective, unpaid, and cancellation scenarios.
9. Cut over one company and retain legacy reads through the observation period.

## Permission model

- Leave access is granted per user through explicit `view`, `create`, `edit`, `delete`, `approve`, and `export` capabilities on `/employees/leave` or the applicable payroll capability.
- The most-specific capability assignment wins, so a dedicated leave assignment can narrow broader Team access.
- The active company owner has the documented owner bypass; all other users are denied capabilities they were not granted.
- No cross-company bypass was introduced.

## Tests and verification

Coverage added or retained for strict dates, leap dates, range insertion, overlap detection, payroll paid/unpaid/UIF treatment, versioned snapshots, roster/timesheet behaviour, tenant isolation, missing-capability denial, overnight shift anchoring, balance impact, idempotent applications, attendance blocking, unique payroll posting, and locked-run adjustment creation.

Payroll-critical integration tests use PostgreSQL. The production-readiness workflow provisions PostgreSQL, applies every migration, and supplies `TEST_DATABASE_URL`; in CI, absence of that variable is a hard failure rather than a silent skip.

Verification commands:

```text
npm test --workspace apps/api
npm test --workspace apps/web
npm run build --workspace apps/api
npm run build --workspace apps/web
npx prisma validate --schema apps/api/prisma/schema.prisma
```

## Outstanding HR/legal and operational gates

- Confirm BCEA/NBCPSS precedence and company-specific more-favourable benefits.
- Confirm current parental, adoption, commissioning-parent, maternity/birth-parent, and UIF treatment.
- Confirm family-responsibility entitlement for each covered employee category.
- Confirm sick-leave proof rules, IOD/COIDA treatment, accrual formulas, carry-over, expiry, pro-rating, termination treatment, and payroll rates.
- Supply employee working patterns where a roster is not available.
- Before enabling WhatsApp, reconcile duplicate active employee phone numbers across every tenant. Ambiguous normalized numbers fail closed because an inbound WhatsApp message carries no tenant identifier.
- Approve opening balances; the system will not infer them.
- Determine monetary treatment and approval of locked-payroll reversal adjustments before the first production cutover.
- Complete staging shadow reconciliation. “Works consistently across Teams, Rostering, Attendance, and Payroll” is not a production claim until those company-specific gates pass.
