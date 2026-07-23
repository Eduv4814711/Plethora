# Plethora Architecture Improvement Plan

**Status:** Audit complete (documentation-only phase)  
**Date:** 2026-05-21  
**Scope:** `apps/api`, `apps/web` — no runtime or database behaviour changes in this phase.

> **Security model update (2026-07-23):** The role-based design described in
> the original audit has been replaced by live, deny-by-default module
> capabilities in `middleware/authorization.ts`. Roles and `moduleAccess` no
> longer exist. Each company has one transferable owner; all other access is
> granted explicitly through `view`, `create`, `edit`, `delete`, `approve`,
> `export`, and `manage_access`.

---

## 1. Current architecture summary

### Monorepo layout

| Workspace | Stack | Role |
|-----------|-------|------|
| `apps/api` | Fastify 4, Prisma 5, PostgreSQL, Zod, Vitest | REST API, WhatsApp webhook/integration, payroll/roster/attendance domain logic |
| `apps/web` | Next.js (App Router), React, Tailwind | Dashboard UI; calls the configured API origin |

Root scripts (`package.json`): `npm run build` builds all workspaces; `npm run test --workspace=api` runs Vitest in the API only. **The web app has no automated test suite.**

### API request flow

```
Client (browser / WhatsApp)
  → Fastify route (apps/api/src/routes/**)
    → preHandler: authMiddleware → explicit capability guard
    → Zod safeParse on body/query (inline per route file)
    → prisma.* and/or domain service (apps/api/src/services/**)
    → JSON response / audit log
```

- **Composition:** `apps/api/src/app.ts` registers ~40 route modules plus WhatsApp under `/whatsapp`.
- **Auth:** JWT access tokens (`middleware/auth.ts`); refresh tokens and password hashing in `services/auth.service.ts` + `services/refresh-token.service.ts`.
- **Authorization:** `middleware/authorization.ts` — a single owner bypass plus explicit per-module capabilities for every other user. Current access is loaded from the database on every authenticated request.
- **Tenant isolation:** Single-company-per-user model; `companyId` on JWT (`JWTPayload`). Queries typically filter `where: { companyId: user.companyId }`. Helpers in `lib/tenant.ts` (`companyScopedWhere`, `requireTenantRecord`) exist but are **not used consistently** across routes.
- **Persistence:** Single shared `PrismaClient` (`lib/prisma.ts`). No repository or unit-of-work abstraction.

### Web architecture

- **Routing:** Next.js App Router under `app/(dashboard)/*` and `app/(auth)/*`.
- **API access:** Large typed client in `lib/api.ts` (~1,500+ lines) calling the configured API origin.
- **Auth state:** `lib/auth-context.tsx` (localStorage tokens, proactive refresh).
- **Permissions (client-only):** `lib/permissions.ts` mirrors server module paths for navigation and route guards; **must stay aligned with** `middleware/authorization.ts`.

### Domain modules (product)

| Module | API prefix | Primary route files | Service layer |
|--------|------------|---------------------|---------------|
| Auth / users | `/auth`, `/users` | `auth.ts`, `users.ts` | Partial (`auth.service`) |
| Employees / sites | `/employees`, `/sites` | `employees.ts`, `sites.ts` | Partial (`employee.service`) |
| Rostering | `/shifts` | `shifts.ts` (1,106 LOC) | Strong (`rostering.service`, `roster-engine.service`) |
| Attendance | `/attendance` | `attendance.ts` (720 LOC) | Partial (`attendance.service` — geofence/validation only) |
| Payroll | `/payroll/*` | `payroll.ts`, rules routes, `payroll-intelligence.ts` | Mixed (`payroll.service` + inline Prisma) |
| WhatsApp | `/whatsapp/*` | `whatsapp/routes/*`, `handler.service.ts` | Handler service + route-level Prisma |
| Academy | `/academy/*` | 20+ route files under `routes/academy/` | Partial (finance, compliance) |
| Tasks | `/tasks`, `/task-*` | `tasks.ts`, etc. | Mostly inline Prisma |

---

## 2. Strengths

1. **Clear product modularisation** — Payroll, rostering, attendance, academy, and WhatsApp are separated by URL prefix and nav module paths.
2. **Capability model is explicit** — Module/action grants and the owner bypass are documented in code and mirrored on the web (`permissions.ts`).
3. **High-value domain logic is already extracted** — Roster engine, payroll run creation, statutory/cost/compliance calculations, and attendance geofence checks live in `services/` with **meaningful unit tests**.
4. **Operational guardrails** — Production JWT/CORS assertions in `app.ts`, rate limits on auth, Helmet, request IDs, centralized error handler.
5. **Multi-tenant schema** — Prisma models are `companyId`-scoped; comment in schema notes multi-tenant readiness.
6. **CI pipeline** — `.github/workflows/ci.yml` runs `db:generate`, `build`, and API tests on PRs.

---

## 3. Risks

| Risk | Evidence | Impact |
|------|----------|--------|
| **Prisma in route handlers** | 57 of 59 route modules import and call `prisma` directly | Hard to test HTTP layer; business rules scattered; duplicate queries |
| **Oversized route files** | `shifts.ts` (1,106), `academy/instructors.ts` (1,153), `sites.ts` (785), `attendance.ts` (720), `employees.ts`/`payroll.ts`/`enrolments.ts` (~530 each) | Mixed HTTP, validation, orchestration, and persistence |
| **Duplicated Zod schemas** | Payroll rule pairs, employee CSV vs API create, inline schemas in large files | Drift between endpoints and import paths |
| **Thin / partial service layer** | Only ~12 route files import services; attendance/shifts still heavy inline DB | Inconsistent patterns for new features |
| **Tenant scoping by convention** | `companyScopedWhere` tested once; many routes use ad-hoc `where` | Cross-tenant ID leakage if a query omits `companyId` |
| **API integration coverage** | Vitest covers route, authorization, service, and tenant-isolation behavior | Keep capability and route-wiring regressions in CI |
| **No web tests** | No Vitest/Jest in `apps/web` | Permission UI drift, broken flows undetected |
| **Monolithic web API client** | Single `lib/api.ts` | Merge conflicts, duplicated fetch patterns |
| **WhatsApp handler complexity** | `handler.service.ts` — many Prisma calls, clock-in/out state machine | Bugs affect payroll and attendance data |

---

## 4. Direct Prisma usage in route files

**Definition:** Any `import { prisma } from ".../lib/prisma.js"` and/or `prisma.<model>` call inside `apps/api/src/routes/**` or `apps/api/src/whatsapp/routes/**`.

### Route modules with direct Prisma (57 files)

**Core workforce**

- `auth.ts`, `users.ts`, `companies.ts`, `employees.ts`, `employee-groups.ts`
- `sites.ts`, `shifts.ts`, `attendance.ts`
- `dashboard.ts`, `search.ts`, `audit.ts`, `settings.ts`, `reports.ts`, `migrations.ts`

**Payroll**

- `payroll.ts`, `payroll-intelligence.ts`, `pay-rules.ts`, `pay-grades.ts`
- `earnings-rules.ts`, `deduction-rules.ts`, `public-holidays.ts`, `timesheets.ts`
- `leave-records.ts`, `leave-requests.ts`
- `group-pay-rules.ts`, `group-earnings-rules.ts`, `group-deduction-rules.ts`

**Tasks**

- `tasks.ts`, `task-projects.ts`, `task-comments.ts`, `task-attachments.ts`, `task-reminders.ts`

**Academy** (`routes/academy/`)

- `students.ts`, `student-documents.ts`, `branches.ts`, `courses.ts`, `course-runs.ts`
- `fee-plans.ts`, `enrolments.ts`, `invoices.ts`, `payments.ts`, `receipts.ts`
- `instructors.ts`, `classrooms.ts`, `attendance.ts`, `assessments.ts`, `certificates.ts`
- `compliance-documents.ts`, `policies.ts`, `renewals.ts`, `reports.ts`, `audit.ts`
- `profile.ts`, `hub.ts`, `activity.ts`, `finance-dashboard.ts`

**WhatsApp routes**

- `whatsapp/routes/webhook.ts`, `contacts.ts`, `messages.ts`, `send.ts`

### Route modules without direct Prisma (2 + router)

| File | Notes |
|------|-------|
| `routes/uploads.ts` | Filesystem only; uses `companyId` from JWT for path |
| `routes/academy/constants.ts` | Shared authorization/MIME constants only |
| `routes/academy/index.ts` | Route registration only |

### Routes that use services *and* still call Prisma

Partial extraction — business logic split across layers:

| Route | Service imports | Prisma still in route |
|-------|-----------------|------------------------|
| `auth.ts` | `auth.service` | Onboard transaction, `/me` lookup |
| `employees.ts` | `employee.service` | CRUD, list, delete |
| `attendance.ts` | `attendance.service` | List, clock-in/out persistence, reports |
| `shifts.ts` | `rostering.service`, `roster-engine.service` | CRUD, bulk create, roster apply |
| `payroll.ts` | `payroll.service`, payslip/statutory/SDL | Run listing, approvals, exports |
| `leave-requests.ts` | `leave-request.service` | findMany / findUnique after service calls |
| `timesheets.ts` | `timesheet.service` | Reads/updates |
| `migrations.ts` | `migration.service` | Import orchestration |
| Academy finance/compliance | `academy-finance`, `academy-compliance` | Invoices, payments, certificates still heavy |

### Prisma outside routes (acceptable targets for later consolidation)

- `services/*.ts` (26 modules) — intended persistence layer but incomplete
- `lib/timezone.ts`, `lib/audit.ts`, `whatsapp/services/handler.service.ts`
- Scripts / seed — out of scope for route refactor

---

## 5. Duplicated validation schemas

Schemas are **inline per route file** (no shared `schemas/` package). Notable duplication:

### Near-identical pairs (company vs group payroll rules)

| Company route | Group route | Shared shape |
|---------------|-------------|--------------|
| `deduction-rules.ts` → `createDeductionRuleSchema` | `group-deduction-rules.ts` → `createGroupDeductionRuleSchema` | `name`, `type`, `amount`, `rate`, `appliesTo`, `employeeIds`, `isOptional` |
| `earnings-rules.ts` → `createEarningsRuleSchema` | `group-earnings-rules.ts` → `createGroupEarningsRuleSchema` | `name`, `type`, `amount`, `rate`, `appliesTo` |
| `pay-rules.ts` → `updatePayRuleSchema` | `group-pay-rules.ts` → `updateGroupPayRuleSchema` | `ruleType`, `multiplier` (+ shared `RULE_TYPES` constant) |

**Recommendation:** `packages/shared` or `apps/api/src/schemas/payroll-rules.ts` with `deductionRuleBodySchema`, `earningsRuleBodySchema`, `payRuleUpdateSchema`.

### Employee data — API vs CSV import

| Location | Schema | Overlap |
|----------|--------|---------|
| `routes/employees.ts` | `createEmployeeSchema` + `superRefine` (PSIRA, grade, group) | ~40 fields |
| `services/migration.service.ts` | `employeeRowBaseSchema` + strict/relaxed refinements | Same labour-law/PSIRA fields; different status enum (`reliever` only in API) |

**Risk:** Import allows records API would reject (and vice versa).

### Repeated patterns (copy-paste variants)

- **`createSchema` / `updateSchema`** — `academy/classrooms.ts`, `certificates.ts`, `branches.ts`, `courses.ts` (similar CRUD shapes, different fields).
- **Document upload types** — `academy/student-documents.ts` (`documentTypeSchema`), instructor documents in `instructors.ts` (overlapping MIME/size rules with `academy/constants.ts`).
- **Task vs academy document MIME lists** — `ACADEMY_DOCUMENT_ALLOWED_TYPES` vs task attachment allowlists in `task-attachments.ts`.
- **Inline route-level schemas** — `shifts.ts` defines 7+ schemas inside the file (including nested `resetSchema`, `rosterPlanSchema` mid-file); `attendance.ts` defines `recordMissedShiftSchema` inside a handler.
- **Settings vs company** — `settings.ts` (`businessDetailsSchema`, `updateSettingsSchema`) vs `companies.ts` (`updateCompanySchema`) — overlapping company profile fields.

### Web

No Zod on the web; validation is ad hoc in page components (regex email, ID number, etc.). Duplication with API rules is **implicit**, not shared.

---

## 6. Large route files (mixed concerns)

**Threshold:** ≥400 LOC and/or Prisma + validation + business rules in one file.

| File | LOC | Concerns mixed |
|------|-----|----------------|
| `routes/academy/instructors.ts` | 1,153 | Zod (incl. bulk actions), Prisma CRUD, documents, compliance, transactions |
| `routes/shifts.ts` | 1,106 | Shift CRUD, bulk patterns, roster preview/apply, PDF, Prisma, roster services |
| `routes/sites.ts` | 785 | Site/post/guard CRUD, geofence, imports, assignments, Prisma |
| `routes/attendance.ts` | 720 | Clock-in/out, manual entry, missed shifts, listings, geofence service + Prisma |
| `routes/settings.ts` | 551 | Company settings, theme, factory reset, transactional deletes, Prisma |
| `routes/academy/enrolments.ts` | 527 | Enrolment lifecycle, finance status, compliance gates, Prisma transactions |
| `routes/employees.ts` | 530 | Employee CRUD, sensitive field policy, status machine, Prisma |
| `routes/payroll.ts` | 530 | Runs, approvals, payslips, EMP201/IRP5, Prisma + many services |
| `routes/tasks.ts` | 496 | Task CRUD, assignments, filters, Prisma |
| `routes/academy/invoices.ts` | 440 | Invoicing + finance service |
| `routes/academy/students.ts` | 409 | Student CRUD + documents |
| `routes/users.ts` | User access management, capability validation, ownership transfer, Prisma |

**Smaller but same anti-pattern (200–400 LOC):** `dashboard.ts`, `payroll-intelligence.ts`, `migrations.ts`, `academy/course-runs.ts`, `academy/payments.ts`, `auth.ts`.

---

## 7. Test coverage gaps

### Current API tests (14 files, all under `src/**/__tests__`)

| Area | Covered | Test files |
|------|---------|------------|
| Roster engine / scheduler | Yes (extensive) | `roster-engine.service.test.ts`, `roster-scheduler.test.ts`, `rostering-*.test.ts`, `site-shift-staffing.test.ts` |
| Payroll cost / statutory / compliance rules | Yes (unit, mocked Prisma) | `payroll-cost`, `payroll-statutory`, `payroll-compliance`, `contract-labour-cost` |
| Attendance geofence | Partial (service only) | `attendance-geofence.service.test.ts` |
| Employee DTO / sensitive fields | Partial | `employee-dto.test.ts` |
| Password policy | Yes | `password-policy.test.ts` |
| Geo helpers | Yes | `geo.test.ts` |
| Tenant helper | Minimal (1 test) | `tenant.test.ts` |

### Gaps by required domain

| Domain | Gap | Priority tests to add |
|--------|-----|------------------------|
| **Auth** | No tests for login, refresh, onboard, setup-password, token revocation | Service tests for `auth.service` / `refresh-token.service`; HTTP tests for `/auth/*` rate limit and 401/403 |
| **Capability access** | Guard and tenant-isolation tests | Matrix tests: module × action × route; assert 403 without the exact capability |
| **Tenant isolation** | Only `companyScopedWhere` unit test | Integration tests: user A cannot read/update company B resource by ID; webhook company resolution |
| **Rostering** | Strong engine tests; **no route tests** for shift CRUD, bulk create, apply plan | Service tests for `validateShiftAssignment` edges; API tests for `POST /shifts` roster apply |
| **Attendance** | Geofence only; no clock-in/out, hours, missed shift | Service tests for `validateClockIn` / `calculateHours`; API tests with mocked shifts |
| **Payroll** | Compliance/cost units only; no run lifecycle, approvals, payslip endpoints | Tests for `payroll.service` run transitions; API smoke for `POST /payroll/runs` |
| **WhatsApp** | **Zero tests** | Handler state machine (clock pending), webhook signature, tenant binding by phone |
| **Web** | **No test runner configured** | Optional: `permissions.test.ts` for `canAccessRoute`; E2E later |

---

## 8. Proposed target architecture

```
┌─────────────────────────────────────────────────────────────┐
│  apps/web — Pages / components                              │
│    lib/api-client/ (split by domain)                        │
│    lib/permissions.ts (generated or shared constants)       │
└──────────────────────────┬──────────────────────────────────┘
                           │ HTTP /api
┌──────────────────────────▼──────────────────────────────────┐
│  apps/api                                                   │
│  ┌─────────────┐   ┌──────────────┐   ┌──────────────────┐  │
│  │ routes/     │──▶│ services/    │──▶│ repositories/    │  │
│  │ (HTTP only) │   │ (domain logic)│   │ (Prisma queries) │  │
│  └─────────────┘   └──────────────┘   └──────────────────┘  │
│         │                  │                    │           │
│         ▼                  ▼                    ▼           │
│  middleware/         schemas/ (Zod)      lib/prisma.ts      │
│  auth, authorization shared validation                      │
└─────────────────────────────────────────────────────────────┘
```

### Layer rules

1. **Routes:** Parse/validate input, call one service method, map errors to HTTP, no `prisma.*`.
2. **Services:** Business rules, transactions, orchestration; depend on repositories.
3. **Repositories:** Prisma only; every query includes `companyId` (or documents why not).
4. **Schemas:** Shared Zod definitions imported by routes and services (and optionally a future `packages/shared` for web).
5. **Authorization:** Declarative route metadata (module + action) to avoid copy-pasted `protect` arrays.

### Non-goals for early phases

- Database schema changes
- New product features
- Microservices split

---

## 9. Phased migration plan

### Phase 0 — Baseline (complete)

- Document architecture (this file).
- Confirm `npm run build` and `npm run test --workspace=api` pass.

### Phase 1 — Shared validation (low risk)

- Extract duplicated payroll rule schemas and employee field schemas.
- Add schema unit tests (parse valid/invalid fixtures).
- **No** route behaviour changes beyond import paths.

### Phase 2 — Repository scaffolding (medium risk)

- Introduce `repositories/` per aggregate: `employee`, `shift`, `attendance`, `payrollRun`, `user`, `company`.
- Move Prisma calls from **one vertical slice** (e.g. `employee-groups.ts` + `pay-grades.ts`) as a template.
- Enforce `companyId` in repository constructors.

### Phase 3 — Thin routes for critical domains (higher risk)

Order by incident impact and test payoff:

1. Auth + users  
2. Attendance + shifts (rostering)  
3. Payroll runs + leave  
4. WhatsApp handler  
5. Academy (batch per submodule)

### Phase 4 — Web client split (low API risk)

- Split `lib/api.ts` into domain modules (`api/employees.ts`, `api/payroll.ts`, …).
- Add lightweight tests for `permissions.ts`.

### Phase 5 — Integration / contract tests

- Fastify `inject()` tests per module with test DB or transactional rollback.
- Capability matrix and tenant isolation suites in CI.

---

## 10. Files likely to change per phase

### Phase 1 — Schemas

| Action | Files |
|--------|-------|
| Create | `apps/api/src/schemas/payroll-rules.ts`, `apps/api/src/schemas/employee.ts`, `apps/api/src/schemas/index.ts` |
| Update imports | `deduction-rules.ts`, `group-deduction-rules.ts`, `earnings-rules.ts`, `group-earnings-rules.ts`, `pay-rules.ts`, `group-pay-rules.ts`, `employees.ts`, `migration.service.ts` |
| Tests | `apps/api/src/schemas/__tests__/*.test.ts` |

### Phase 2 — Repositories (pilot)

| Action | Files |
|--------|-------|
| Create | `apps/api/src/repositories/employee-group.repository.ts`, `pay-grade.repository.ts`, `base.repository.ts` |
| Refactor | `employee-groups.ts`, `pay-grades.ts` |
| Extend pattern | `repositories/shift.repository.ts`, `attendance.repository.ts`, `user.repository.ts` |

### Phase 3 — Service extraction (by domain)

| Domain | Route files | New/expanded services |
|--------|-------------|------------------------|
| Auth | `auth.ts`, `users.ts` | Expand `auth.service`, add `user.service` |
| Rostering | `shifts.ts` | `shift.service`, `roster-application.service` |
| Attendance | `attendance.ts` | Expand `attendance.service` |
| Payroll | `payroll.ts`, `leave-requests.ts`, `leave-records.ts` | Expand `payroll.service`, `leave-request.service` |
| Sites | `sites.ts` | `site.service` |
| WhatsApp | `whatsapp/routes/*`, `handler.service.ts` | `whatsapp-attendance.service`, `whatsapp-leave.service` |
| Academy | `academy/instructors.ts`, `enrolments.ts`, `students.ts` | `academy-instructor.service`, etc. |

### Phase 4 — Web

| Action | Files |
|--------|-------|
| Split | `apps/web/lib/api.ts` → `apps/web/lib/api/*.ts` |
| Tests | `apps/web/lib/__tests__/permissions.test.ts` |
| Config | `apps/web/package.json` (add vitest script, optional) |

### Phase 5 — Integration tests

| Create | `apps/api/src/routes/__tests__/auth.integration.test.ts`, capability authorization tests, `tenant-isolation.integration.test.ts`, `shifts.integration.test.ts` |
| CI | `.github/workflows/ci.yml` (test DB service if needed) |

---

## 11. Test plan

### Per phase gates

| Phase | Gate |
|-------|------|
| 0 | `npm run build`, `npm run test --workspace=api` green |
| 1 | New schema tests; no regression in existing 14 test files |
| 2 | Repository tests with mocked Prisma; pilot routes unchanged HTTP contract |
| 3 | + domain service tests; + Fastify `inject()` smoke per refactored route |
| 4 | Web Vitest for permissions; smoke-test representative module/action grants |
| 5 | CI job with Postgres service; tenant + capability matrix required on PR |

### Domain test backlog (acceptance criteria)

1. **Auth** — Invalid password → 401; refresh rotation; onboard creates exactly one company + admin; setup token single-use.
2. **Capability access** — A user with only `/rostering:view` receives 403 on `DELETE /employees/:id` and on rostering edits.
3. **Tenant** — UUID from company B on company A token → 404 (not 403) for get-by-id endpoints.
4. **Rostering** — `generateRosterPlan` + `applyRosterPlan` integration; gender rule conflicts returned not thrown.
5. **Attendance** — Clock-in outside geofence → 400; duplicate clock-in rejected.
6. **Payroll** — Run state machine illegal transition → 409/400; compliance issues attached to run summary.
7. **WhatsApp** — Clock pending timeout; clock-in links to correct `shiftId` for employee phone.

---

## 12. Rollback strategy

| Phase | Rollback mechanism |
|-------|-------------------|
| **General** | One PR per phase/subdomain; no big-bang merge. Revert PR restores behaviour. |
| **Phase 1 (schemas)** | Pure refactor — revert commit if any parse behaviour changes. |
| **Phase 2–3 (repos/services)** | Keep route HTTP contracts identical; revert PR if integration tests fail. Feature flags **not required** if endpoints unchanged. |
| **Database** | No migrations in Phases 1–3 — rollback is code-only. |
| **Phase 5 (CI DB)** | New CI job is additive; disable job without blocking merge if flaky. |
| **Production deploy** | Deploy API and web together when route contracts change; monitor `/health`, auth error rate, WhatsApp webhook 5xx. |
| **Emergency** | Redeploy previous Railway/release artifact; no schema rollback needed for code-only phases. |

### Verification before merge (each PR)

```bash
npm run build
npm run test --workspace=api
# Manual smoke (staging): login, one CRUD per touched module, WhatsApp webhook test mode if applicable
```

---

## Appendix A — Route files without Prisma import

- `apps/api/src/routes/uploads.ts`
- `apps/api/src/routes/academy/constants.ts`
- `apps/api/src/routes/academy/index.ts`

## Appendix B — API test inventory

```
apps/api/src/lib/__tests__/employee-dto.test.ts
apps/api/src/lib/__tests__/geo.test.ts
apps/api/src/lib/__tests__/password-policy.test.ts
apps/api/src/lib/__tests__/tenant.test.ts
apps/api/src/services/__tests__/attendance-geofence.service.test.ts
apps/api/src/services/__tests__/contract-labour-cost.service.test.ts
apps/api/src/services/__tests__/payroll-compliance.service.test.ts
apps/api/src/services/__tests__/payroll-cost.service.test.ts
apps/api/src/services/__tests__/payroll-statutory.service.test.ts
apps/api/src/services/__tests__/roster-engine.service.test.ts
apps/api/src/services/__tests__/roster-scheduler.test.ts
apps/api/src/services/__tests__/rostering-shift-gender.service.test.ts
apps/api/src/services/__tests__/rostering-site-assignment.service.test.ts
apps/api/src/services/__tests__/site-shift-staffing.test.ts
```

## Appendix C — Web structure (reference)

| Path | Purpose |
|------|---------|
| `app/(auth)/` | Login, register, setup-password |
| `app/(dashboard)/` | Module pages (employees, sites, rostering, attendance, payroll, whatsapp, academy, …) |
| `lib/api.ts` | Monolithic API client |
| `lib/auth-context.tsx` | Session state |
| `lib/permissions.ts` | Nav + route access |
| `components/dashboard-layout.tsx` | Shell + nav |

---

*End of architecture improvement plan.*
