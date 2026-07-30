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
- BCEA statutory minimums are seeded ACTIVE and enforced as a floor; a policy version stating less than the Act cannot be confirmed.
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

## Statutory rule engine (BCEA)

The module previously encoded no South African leave law: every entitlement was
left to per-company manual configuration, and `cycleMonths` was stored but never
read. Statutory rules are now built in, and act as a **floor** under the
configured policy — BCEA s4-5 allow an agreement to improve on the Act, never to
undercut it. The effective entitlement is
`max(configured policy, statutory minimum for this employee's working pattern)`,
so a six-day-a-week officer and a Monday-to-Friday administrator each get the
correct figure rather than a hard-coded day count.

Encoded in `apps/api/src/services/leave-statutory-rules.ts`:

| Rule | Behaviour |
| --- | --- |
| s20 annual | Days ordinarily worked in three weeks per 12-month cycle (15 for a five-day week). s20(2)(b) one-day-per-17-days-worked available as `DAYS_WORKED_RATIO`. |
| s20(4) | Leave stays usable for six months after the cycle ends, then is forfeited — the 18-month window from *Jooste v Kohler Packaging* and *Hartley v SMD Trading*. |
| s22 sick | Days ordinarily worked in six weeks per 36-month cycle (30 for a five-day week), with no carry-over between cycles. |
| s22(2) | First six months of employment: one day per 26 days worked. |
| s27 family responsibility | Three days per 12-month cycle; eligibility helpers for the four-months' service and four-days-a-week tests. |
| s21(3) | A public holiday inside any leave period is paid but does not draw down the balance, per leave type. |

Supporting machinery:

- `apps/api/src/lib/leave-cycles.ts` — employment-anchored cycles with grace
  periods, month-clamping date arithmetic, and pro-rata employment fractions.
- `apps/api/src/lib/leave-allocation.ts` — FIFO attribution of ledger movements
  to the cycle that funded them, so forfeiture and s40 payout are computable.
- `apps/api/src/lib/leave-accrual-plan.ts` — the accrual planner.
- `LeaveLedgerEntry.cycleKey` records the cycle behind every movement.

Accrual is now a **catch-up runner**: it computes every period from the
employment anchor to `asOf` and posts whatever is missing, so a month nobody ran
is back-filled rather than lost forever. Re-running it is a no-op. Accrual is
suspended for months covered by approved unpaid leave, and `PRORATED_CYCLE_GRANT`
accrues towards the cycle entitlement in proportion to the part of the cycle
actually worked, so mid-cycle joiners and leavers are correct.

`runLeaveCycleClose` closes cycles whose grace period has lapsed, writing a
`CARRY_OVER` for whatever the policy permits the employee to keep and an
`EXPIRY` for the rest, plus an audit event. It is idempotent per employee,
leave type and cycle. `POST /leave/cycles/close` defaults to a dry run.

Cycle scoping, carry-over and forfeiture are gated per company by
`LeaveCompanySettings.statutoryEngineEnabledFrom`. Until a company is cut over
its balances read exactly as before and nothing is ever expired.

New companies are seeded with the BCEA minimums as **ACTIVE** policy versions
(version 2, effective from the seeding date so history is never re-priced). The
original empty `PENDING_HR_LEGAL_CONFIRMATION` version 1 is retained for
provenance and closed the day before.

## Policy and calculation behaviour

- Policy lookup is effective-dated and honours an employee assignment before the company statutory baseline.
- Pending statutory/sector versions may be previewed for review, but an application cannot be approved unless one confirmed active policy version covers the complete leave period.
- Once a version is confirmed, negative-balance and maximum-consecutive-day rules are enforced.
- Opening balances require a reason and are posted as immutable `OPENING_BALANCE` ledger entries.
- Accrual runs only execute an explicitly confirmed method/rate, use the employee's employment-cycle anchor for annual grants, and are idempotent per employee, leave type, and period. Unsupported or incomplete formulas are reported as skipped rather than inferred.
- Carry-over and expiry are executed by the cycle-close engine (see “Statutory rule engine” below). Notice enforcement and automatic conversion to unpaid are accepted as configuration but are not yet enforced at approval.
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
- Confirm IOD/COIDA treatment and payroll rates. Accrual formulas, carry-over, expiry and pro-rating are now engine-enforced against the BCEA floor; confirm only where the company intends terms more generous than the Act.

### Still outstanding in the leave engine

- BCEA s40 termination payout is not implemented. `PAYOUT` ledger entries are read but never written, so an offboarded employee's residual balance is still orphaned.
- BCEA s23 proof-of-incapacity rules are available as helpers but are not yet wired into approval; the blanket per-type `requiresDocument` flag still governs.
- BCEA s27 eligibility helpers exist but are not yet enforced at application creation, and there is no qualifying-event capture.
- Parental leave is still four separate uncapped types. The Van Wyk shared pool of four months and ten days, the inter-parent election, and the six weeks reserved to the birth parent are not modelled.
- Public holidays remain hard-coded for 2025–2026 inside the factory-reset handler, with no Sunday→Monday observance rule and nothing seeded for 2027 onward.
- Approval is still a single hard-coded step: no multi-level chain, line-manager routing, delegation, escalation, or self-approval bar.
- There is still no email delivery, and the reviewer notification is skipped when leave is captured inside an outer transaction.
- The legacy sick-note upload still marks its own document `VERIFIED` without a second reviewer.
- `EmploymentTerm` has no UI, yet `normalDaysPerWeek` and `normalMinutesPerShift` now drive every statutory entitlement — capture them before cutting a company over.
- Supply employee working patterns where a roster is not available.
- Before enabling WhatsApp, reconcile duplicate active employee phone numbers across every tenant. Ambiguous normalized numbers fail closed because an inbound WhatsApp message carries no tenant identifier.
- Approve opening balances; the system will not infer them.
- Determine monetary treatment and approval of locked-payroll reversal adjustments before the first production cutover.
- Complete staging shadow reconciliation. “Works consistently across Teams, Rostering, Attendance, and Payroll” is not a production claim until those company-specific gates pass.
