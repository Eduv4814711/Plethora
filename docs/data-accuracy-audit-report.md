# Plethora Data Accuracy Audit Report

**Date:** 10 July 2026  
**Scope:** Core operations (Attendance → Site Timesheets → Rostering → Payroll → Dashboard) plus cross-cutting schema, security, and remaining modules (high-level).  
**Status:** Phase 0–4 implemented; fixes applied for confirmed high-risk code defects; read-only audit scripts delivered.

---

## Release re-verification — 23 July 2026

This section supersedes the historical status assessments below for the current
release candidate. The older findings remain in this document as audit history.

- All 26 migrations applied successfully to a new empty PostgreSQL database.
- The complete API suite passed: 77 test files and 522 tests, including payroll
  lifecycle, tenant isolation, capability delegation, leave, rostering,
  attendance, and private-file access.
- The clean database audit reported zero findings.
- API and web production builds passed, and the local readiness endpoint
  reported `ready`.
- Payroll now freezes pay frequency per run, enforces one item per employee,
  blocks invalid payment values, serializes overlapping run creation, and
  performs paid-state/SDL tracking atomically.
- Authorization is capability-based and deny-by-default. Job titles and account
  types do not grant access.

The current company database has no critical or high findings, but the following
medium findings must be reconciled before approving the first live payroll:

| Finding | Count |
|---------|------:|
| Timesheet rows whose source shift/attendance record is missing | 32 |
| Duplicate legacy leave groups for the same employee/date/type | 5 |
| Legacy leave records overlapping a working roster shift | 70 |
| Site-timesheet periods not aligned to the configured 26–25 cycle | 52 |
| Reviewed/approved working rows missing Duty ON/OFF OB numbers | At least 500 |

**Release decision:** the application code is suitable for staging deployment.
Production payroll go-live remains gated on an owner-reviewed data reconciliation,
a verified database restore point, and a tested backup/restore procedure for the
uploads volume.

---

## Executive Summary

| Module | RAG Status | Notes |
|--------|------------|-------|
| Database schema | **Amber** | 71 models; strong Decimal/date usage; gaps in FK enforcement and string statuses |
| Attendance / Site Timesheets | **Green** (post-fix) | Shift-type inference aligned to company TZ; approval logic well-tested |
| Rostering | **Amber** | 26–25 period logic sound; client/API pattern parity risk |
| Payroll | **Amber** | Calculation engine tested; dual hour sources; no PayrollItem unique constraint |
| Dashboard / Alerts | **Green** (post-fix) | Payroll readiness uses pay period; pending metrics clarified |
| Leave / Employees / Sites | **Amber** | No duplicate prevention on LeaveRecord; pay rate nullable at DB |
| Academy / Billing | **Green** | Isolated subdomain; AcademyInvoice has proper constraints |
| Security / capability access | **Green** | API enforces live per-module capabilities; tenant isolation integration tests exist |

**Overall:** Data accuracy for core payroll chain is **substantially trustworthy** after fixes to shift-type inference and payroll-readiness period alignment. Remaining risks are documented below with recommended follow-ups.

---

## Deliverables Completed

| Deliverable | Location | Status |
|-------------|----------|--------|
| Read-only audit scripts | `apps/api/scripts/data-audit/` | Created |
| Orchestrator | `npm run db:audit` in `apps/api` | Created |
| Core-ops test fixture | `apps/api/src/test-utils/core-ops.fixture.ts` | Created |
| Regression tests | See Test Additions section | Added |
| Code fixes | See Fixed Issues section | Applied |
| This report | `docs/data-accuracy-audit-report.md` | Complete |

**Run audit (any Postgres with Plethora schema):**
```bash
cd apps/api
DATABASE_URL="postgresql://..." npm run db:audit
DATABASE_URL="postgresql://..." npm run db:audit -- --json
DATABASE_URL="postgresql://..." npm run db:audit -- --category orphans
```

---

## Critical Issues

### C1 — Shift type inferred with server-local hour and 12:00 boundary (FIXED)

| Field | Detail |
|-------|--------|
| **Files** | `apps/api/src/modules/rosters/site-timesheets.service.ts` (`seedRows`, `resyncRows`) |
| **Models** | `SiteTimesheetRow`, `Shift` |
| **Root cause** | `shift.startTime.getHours() >= 12` used server timezone and noon boundary instead of company TZ and 18:00 |
| **Business impact** | Day shifts seeded as night (or vice versa); wrong pending day/night counts; payroll hour classification mismatch |
| **Fix** | Added `inferShiftTypeFromStartTime()` in `apps/api/src/lib/timezone.ts`; `seedRows`/`resyncRows` now use `getCompanyTimezone` + 18:00 boundary |
| **Tests** | `apps/api/src/lib/__tests__/shift-type-inference.test.ts` |
| **Status** | **Fixed** |

### C2 — Payroll readiness used calendar month instead of 26–25 pay period (FIXED)

| Field | Detail |
|-------|--------|
| **Files** | `apps/api/src/modules/attendance-exceptions/exceptions.service.ts` (`getPayrollReadiness`) |
| **Models** | `PayrollPeriodReadiness`, `AttendanceException` |
| **Root cause** | `getPayrollReadiness` defaulted to `1st–last day of calendar month` |
| **Business impact** | Dashboard "Payroll blocked" and readiness gate could reference wrong exception window vs attendance timesheets |
| **Fix** | Uses `parsePayrollCalendarSettings` + `getCurrentPayPeriod` for period bounds |
| **Tests** | `apps/api/src/modules/attendance-exceptions/__tests__/payroll-readiness-period.test.ts` |
| **Status** | **Fixed** |

---

## High-Risk Issues

### H1 — No unique constraint on PayrollItem per run + employee

| Field | Detail |
|-------|--------|
| **Files** | `apps/api/prisma/schema.prisma` (`PayrollItem`) |
| **Root cause** | Only indexes on `payrollRunId` and `employeeId`; no `@@unique([payrollRunId, employeeId])` |
| **Business impact** | Duplicate payroll lines for same employee in one run |
| **Recommended fix** | Add migration with unique constraint after `db:audit --category duplicates` confirms no dupes |
| **Status** | **Identified** — audit script `duplicates.mjs` detects |

### H2 — Missing FK on lineage IDs (AttendanceException, SiteTimesheetRow sources)

| Field | Detail |
|-------|--------|
| **Files** | `schema.prisma`; `apps/api/scripts/data-audit/orphans.mjs` |
| **Models** | `AttendanceException`, `SiteTimesheetRow`, `WhatsAppClockPending` |
| **Business impact** | Orphan references after shift/attendance delete; misleading exception links |
| **Recommended fix** | Add optional FK with `onDelete: SetNull` or periodic orphan cleanup |
| **Status** | **Identified** |

### H3 — Dual payroll hour sources (site timesheet vs raw attendance fallback)

| Field | Detail |
|-------|--------|
| **Files** | `apps/api/src/services/timesheet.service.ts` (`aggregateTimesheets`) |
| **Root cause** | Approved `SiteTimesheetRow` primary; `Shift`+`Attendance` fallback per site without approved sheet |
| **Business impact** | Same physical shift could produce different hours if timesheet edited vs clock data |
| **Recommended fix** | Document policy; add reconciliation audit comparing row hours vs `calculateHours` |
| **Status** | **Identified** — business confirmation needed |

### H4 — Dashboard `pending_approvals` conflated with site timesheet pending (PARTIALLY FIXED)

| Field | Detail |
|-------|--------|
| **Files** | `apps/api/src/routes/dashboard.ts`, `apps/web/app/(dashboard)/payroll/page.tsx` |
| **Root cause** | Alert type `pending_approvals` counted payroll runs in `calculated` status, not site timesheet row reviews |
| **Fix** | Renamed alert to `pending_payroll_run_approvals`; added `pendingPayrollRunApprovals` and `pendingSiteTimesheetRows` response fields |
| **Status** | **Fixed** (API + payroll page); attendance capture dashboard unchanged (already correct) |

### H5 — Active guards without pay rates

| Field | Detail |
|-------|--------|
| **Files** | `schema.prisma` (`Employee`); `status-consistency.mjs` |
| **Business impact** | Payroll skips or miscalculates employees with null `hourlyRate` and `monthlySalary` |
| **Status** | **Identified** — run `db:audit --category status-consistency` |

---

## Medium-Risk Issues

### M1 — Dashboard default date range is calendar month, not pay period

| **Files** | `apps/api/src/routes/dashboard.ts` (`parseDateRange`) |
| **Impact** | KPI charts (guards on duty, shift trends) may not align with 26–25 operational period |
| **Status** | **Identified** — `currentPayPeriod` now exposed in dashboard response for UI alignment |

### M2 — Frontend shift times use browser local TZ, not company TZ

| **Files** | `apps/web/lib/shift-times.ts`, `SiteTimesheetsSection.tsx` |
| **Impact** | Display/editing mismatch for users outside South Africa |
| **Status** | **Identified** |

### M3 — Duplicated approval helpers (API vs web)

| **Files** | `site-timesheets.service.ts`, `apps/web/lib/site-timesheet-utils.ts` |
| **Impact** | Drift risk if one side changes |
| **Status** | **Identified** — consider shared package or contract tests |

### M4 — SiteTimesheetRow unique constraint allows NULL plannedGuardId duplicates

| **Files** | `schema.prisma` |
| **Impact** | Multiple reliever/manual rows per date/shift type (PostgreSQL NULL semantics) |
| **Status** | **By design** — documented in migration comments |

### M5 — Leave overlapping working roster

| **Files** | `date-ranges.mjs` |
| **Status** | **Identified** — audit script flags; confirm if half-day leave is valid |

### M6 — Roster calendar can differ from pay calendar

| **Files** | `payroll-calendar-settings.ts`, rostering UI vs attendance page |
| **Impact** | Roster period ≠ timesheet period if separate `calendarId` used |
| **Status** | **Identified** |

---

## Low-Risk Issues

- String statuses instead of DB enums (`LeaveRecord.type`, `Attendance.status`)
- `Employee.employeeNumber` defaults to opaque `cuid()` unless app overrides
- Payslip `earnings`/`deductions` JSON not schema-validated at DB
- Dashboard merges inline alerts with operational alerts (possible duplicate messaging)
- Frontend has minimal test coverage (1 Vitest file for site-timesheet utils)

---

## Traceability Matrix (Core Metrics)

| Metric | Source Tables | Backend Function | Frontend Display | Formula / Rule |
|--------|---------------|------------------|------------------|----------------|
| Guards on duty | `Shift` | `dashboard.ts` count | `page.tsx` KPI | `status=active`, now ∈ [startTime, endTime] |
| Pending payroll approvals | `PayrollRun` | `dashboard.ts` | `payroll/page.tsx` | `status=calculated` |
| Pending site timesheet rows | `SiteTimesheetRow` | `dashboard.ts` (new) | — | `approvalStatus ∈ {pending, partially_reviewed}` |
| Payroll readiness | `PayrollPeriodReadiness`, `AttendanceException` | `getPayrollReadiness` | Dashboard badge | Critical open exceptions in **pay period** |
| Pending day/night rows | `SiteTimesheetRow` | `computeSiteCaptureFromRows` | `attendance-capture-dashboard.tsx` | `isRowPendingReview` per shift type |
| Basic / OT hours | `SiteTimesheetRow`, `Shift`, `Attendance` | `aggregateTimesheets`, `classifyShiftHours` | Payroll run items | Shift start day in company TZ; multipliers from `PayRule` |
| Net pay | `PayrollItem` | `computePayrollLines` | `payroll/page.tsx` | gross − deductions − PAYE − UIF (+ SDL employer) |
| Operational alert counts | `OperationalAlert` | `getAlertCounts` | Dashboard alerts section | OPEN/ACKNOWLEDGED by priority |
| Pay period bounds | `Company.settings` | `getCurrentPayPeriod` | `pay-period-select.tsx` | 26–25 spanning month default |

---

## Module Audit Notes

### Phase 1 — Attendance & Site Timesheets

- **Schema:** `SiteTimesheet` unique on `(companyId, siteId, periodStart, periodEnd)` — correct.
- **Approval:** Shift-scoped `approveSiteTimesheet` only locks when all shifts reviewed — tested in `site-timesheet-approve.test.ts`.
- **OB numbers:** Duty ON/OFF required for working rows before `reviewed` — tested in duty-ob tests.
- **Fix applied:** Shift-type inference (C1).

### Phase 2 — Rostering

- **26–25 cycle:** `payroll-period.service.ts` + `payroll-calendar-settings.ts` — unit tested.
- **Pattern publish:** UI expands patterns client-side (`roster-pattern-utils.ts`) then saves via `applyManualOverridesBulk` — parity risk if API pattern engine diverges.
- **Rest rules:** `roster-scheduler.ts` blocks day-after-night violations.
- **Audit script:** `roster-periods.mjs` validates period alignment.

### Phase 3 — Payroll

- **Chain:** `aggregateTimesheets` → `computePayrollLines` — engine well unit-tested.
- **Gates:** `findSitesNeedingApproval`, `assertPayrollNotBlocked` — integration tested (flaky when DB unreachable).
- **Fix applied:** `getPayrollReadiness` period alignment (C2).

### Phase 4 — Dashboard

- **Fix applied:** Clarified payroll vs timesheet pending (H4); exposed `currentPayPeriod`.
- **Remaining:** Default chart date range still calendar month (M1).

### Phase 5 — Remaining Modules (high-level)

| Module | Key risk | Audit coverage |
|--------|----------|----------------|
| Leave | Duplicate `LeaveRecord` per date | `duplicates.mjs` |
| Employees | Nullable pay fields | `status-consistency.mjs` |
| Sites | ACTIVE without posts | `relationships.mjs` |
| Exceptions | Open CRITICAL blocks payroll | `attendance-payroll.mjs` |
| Reports/Exports | CSV vs UI parity | Manual test plan needed |
| Academy | Separate billing models | Schema constraints OK |
| Capability access | API middleware | `tenant-isolation.integration.test.ts` |

### Phase 6 — Security

- API routes use `authMiddleware` plus explicit capability guards — verified on dashboard, payroll, and rosters.
- Frontend `permissions.ts` is not sole control — API enforces.
- Client portal isolation tested in `client-isolation.test.ts`.

---

## Test Additions

| Test file | Coverage |
|-----------|----------|
| `lib/__tests__/shift-type-inference.test.ts` | 18:00 TZ boundary |
| `modules/attendance-exceptions/__tests__/payroll-readiness-period.test.ts` | 26–25 readiness period |
| `modules/rosters/__tests__/site-timesheet-capture-counts.test.ts` | Day/night pending counts |
| `test-utils/__tests__/core-ops.fixture.integration.test.ts` | End-to-end fixture (skips if no DB) |

**Existing coverage leveraged:** `site-timesheet-approve.test.ts`, `payroll-calculation.engine.test.ts`, `payroll-attendance-gate.test.ts`, `payroll-period.service.test.ts`, `timesheet-classification.test.ts`.

---

## Verification Commands Run

```bash
cd apps/api && npx prisma validate          # OK
cd apps/api && npx vitest run <new tests>   # 7 passed
cd apps/web && npm run test                 # 6 passed
cd apps/api && npm run test                 # 321 passed, 4 failed (payroll-lifecycle.integration — DB connectivity flake to Railway)
```

**Blocked:** Full `db:audit` against production requires `DATABASE_URL`. Scripts are SELECT-only and safe on any environment.

---

## Open Questions for Business

1. Should dashboard KPI default range switch from calendar month to current pay period?
2. When day shift is approved but night pending, should payroll block the whole site or only night?
3. Is raw Shift+Attendance fallback intentional for sites without site timesheets?
4. Are duplicate `LeaveRecord` rows per employee+date ever valid (half-day)?
5. Is Academy finance in scope for "billing" audits, or only ops payroll?

---

## Recommended Next Steps

1. Run `npm run db:audit` against staging/production and attach JSON output to this report.
2. Add `@@unique([payrollRunId, employeeId])` on `PayrollItem` after duplicate check.
3. Add optional FKs on `AttendanceException.shiftId` / `SiteTimesheetRow.sourceShiftId`.
4. Extend frontend tests for `site-timesheet-utils.ts` parity with API.
5. Consider company-TZ-aware display in `shift-times.ts` (M2).

---

*Report generated as part of the Plethora Database & Data Accuracy Audit Plan. Plan file not modified.*
