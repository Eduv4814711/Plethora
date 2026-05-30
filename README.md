# Plethora — Workforce & Payroll Management Platform

Plethora is an internal, multi-tenant workforce operations platform purpose-built
for South African security and labour-intensive businesses (originally Quick
Bopha Security). It unifies the day-to-day operations that traditionally live
across spreadsheets, WhatsApp groups and standalone payroll systems into a
single, auditable application.

The platform covers the complete lifecycle of a workforce member — from hire
and onboarding, through site assignment, rostering, attendance via WhatsApp,
all the way to SARS-compliant payroll, payslip generation and audit reporting.

---

## Table of Contents

1. [System Overview](#1-system-overview)
2. [Capability Map](#2-capability-map)
3. [High-Level Architecture](#3-high-level-architecture)
4. [Technology Stack](#4-technology-stack)
5. [Repository Layout](#5-repository-layout)
6. [Domain Model](#6-domain-model)
7. [Identity, Authentication & RBAC](#7-identity-authentication--rbac)
8. [API Surface](#8-api-surface)
9. [Frontend Module Map](#9-frontend-module-map)
10. [Payroll Engine](#10-payroll-engine)
11. [WhatsApp Integration](#11-whatsapp-integration)
12. [Local Development Setup](#12-local-development-setup)
13. [Environment Variables](#13-environment-variables)
14. [Database & Migrations](#14-database--migrations)
15. [Development Workflow](#15-development-workflow)
16. [Build, Deployment & Operations](#16-build-deployment--operations)
17. [Testing](#17-testing)
18. [Security Notes](#18-security-notes)
19. [Further Documentation](#19-further-documentation)
20. [License](#20-license)

---

## 1. System Overview

Plethora is structured as a **monorepo** with two deployable workspaces:

| Workspace  | Role                                         | Stack                                |
| ---------- | -------------------------------------------- | ------------------------------------ |
| `apps/api` | Stateless HTTP API and business logic        | Fastify · Prisma · PostgreSQL · Zod  |
| `apps/web` | Operator UI (multi-page dashboard)           | Next.js 16 (App Router) · React 19 · Tailwind |

Both apps are built with TypeScript end-to-end. The API exposes a domain
model rooted at `Company`, providing strict tenant isolation. The web app is a
thin client that calls the API through a `/api/*` rewrite to avoid CORS in
local development.

Data ingress also occurs through a **WhatsApp Cloud API webhook** so that
guards in the field can clock in/out, request leave, and receive shift
notifications without ever opening the web app.

---

## 2. Capability Map

| Domain                | What Plethora Does                                                                                                                                       |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Tenancy**           | Onboards a new company plus its first admin in a single transaction; every record is scoped by `companyId`.                                              |
| **People**            | Tracks security guards (PSIRA fields) and office staff (BCEA fields) with full HR profile, next-of-kin, banking and tax data.                            |
| **Sites & Posts**     | Models physical sites, posts within a site, and geofences for GPS-validated clock-in.                                                                    |
| **Rostering**         | Builds weekly/monthly rosters, supports custom recurrence patterns, assigns guards to posts, and exports printable roster PDFs. See [docs/ROSTER_ENGINE.md](./docs/ROSTER_ENGINE.md) for auto-roster (Site → Post → Shift) behavior. |
| **Attendance**        | Records clock-in/out from WhatsApp or web, validates against site geofence, and aggregates into timesheets.                                              |
| **Pay Configuration** | Per-company and per-group pay grades, overtime/Sunday/public-holiday multipliers, recurring earnings (transport, allowances) and deductions.             |
| **Payroll**           | Calculates timesheets → payroll items → payslips with PAYE, UIF, SDL, IRP5 and EMP201 numbers aligned with SARS rules.                                   |
| **Compliance**        | A pluggable compliance rule engine flags missing tax IDs, zero-pay actives, abnormal overtime, missing UIF fields, etc.                                  |
| **Leave**             | Self-service leave requests with approval workflow plus authoritative leave-record ledger consumed by payroll.                                           |
| **Tasks**             | Lightweight project/task tracker with comments, attachments, recurrences and reminders for ops handovers.                                                |
| **Academy**           | Training-academy management: branches, students, instructors, courses & runs, classrooms, enrolments, attendance, assessments, certificates, compliance documents, invoices/payments and renewals. |
| **Reports**           | Operational and statutory reports (payroll registers, contract labour cost, SDL tracking, etc.).                                                         |
| **Audit**             | Append-only audit log keyed on company, entity and user; visible to administrators only.                                                                 |
| **WhatsApp**          | Two-way messaging, templated outbound notifications, contact management, geofence-aware clock-in flow.                                                   |

---

## 3. High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                                Browser (Operator)                           │
│   Next.js 16 App Router · Tailwind · React 19 · client-side auth context    │
└──────────────┬──────────────────────────────────────────────────────────────┘
               │ /api/*  (Next.js rewrite)
               ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                            Fastify HTTP API (apps/api)                      │
│                                                                             │
│   ┌────────────┐  ┌─────────────┐  ┌────────────┐  ┌──────────────────────┐ │
│   │  Plugins   │  │ Middleware  │  │   Routes   │  │   Domain Services    │ │
│   │ cors,      │  │ authMiddle  │  │ /auth      │  │ payroll, payroll-    │ │
│   │ helmet,    │─▶│ ware →      │─▶│ /employees │─▶│ statutory, payroll-  │ │
│   │ rateLimit, │  │ requireRole │  │ /sites     │  │ compliance, tax,     │ │
│   │ multipart, │  │ (RBAC)      │  │ /shifts …  │  │ rostering, employee, │ │
│   │ static     │  │             │  │            │  │ migration …          │ │
│   └────────────┘  └─────────────┘  └─────┬──────┘  └──────────┬───────────┘ │
│                                          │                    │             │
│                                          ▼                    ▼             │
│                                   ┌────────────────────────────────────┐    │
│                                   │       Prisma Client (singleton)    │    │
│                                   └────────────────┬───────────────────┘    │
└────────────────────────────────────────────────────┼────────────────────────┘
                                                     ▼
                                          ┌────────────────────┐
                                          │  PostgreSQL        │
                                          │  (multi-tenant by  │
                                          │   companyId)       │
                                          └────────────────────┘

                ▲                                         ▲
                │                                         │
                │ webhook + outbound calls                │ JWT bearer
                │                                         │
       ┌────────┴─────────────┐                  ┌────────┴────────┐
       │  WhatsApp Cloud API  │                  │  Operator UI     │
       │  (Meta) — guards     │                  │  (Browser)       │
       └──────────────────────┘                  └──────────────────┘
```

**Key architectural properties**

- **Single source of truth.** Prisma owns the schema; every service speaks to the
  database via `prisma` (`apps/api/src/lib/prisma.ts`), never raw SQL except in
  schema migrations.
- **Stateless API.** All session state lives in JWTs (access + refresh).
  Horizontal scaling requires no sticky sessions.
- **Tenant isolation at the query boundary.** Every authenticated request
  includes `companyId` in its JWT payload, and routes filter all reads/writes by
  that value.
- **Module-based authorization.** A user's `moduleAccess` array (e.g.
  `["/rostering","/employees"]`) gates each route group at the middleware layer
  and each link in the UI navigation. A *full admin* (role `admin` with
  `moduleAccess === null`) bypasses module checks; everyone else — including
  scoped admins — must have an explicit grant.
- **Cross-module reads are explicit.** Where a UI module legitimately needs data
  from a sibling domain (e.g. Rostering needs `/employees` and `/sites` reads),
  the API route uses `requireRole(..., { anyOfModules: [...] })` to permit the
  read without granting the destination module.
- **WhatsApp is a first-class ingress.** Webhook traffic is processed by
  `apps/api/src/whatsapp` and reuses the same domain services as the web UI.

---

## 4. Technology Stack

### Backend (`apps/api`)

| Concern              | Library                                                        |
| -------------------- | -------------------------------------------------------------- |
| HTTP framework       | `fastify` 4                                                    |
| Security             | `@fastify/helmet`, `@fastify/cors`, `@fastify/rate-limit`      |
| File uploads         | `@fastify/multipart`, `@fastify/static`                        |
| Object storage       | `@aws-sdk/client-s3` (+ presigner) for S3, or local disk       |
| ORM / DB             | `@prisma/client` 5 + `prisma` migrate/seed                     |
| Validation           | `zod`                                                          |
| AuthN                | `jsonwebtoken`, `bcrypt`                                       |
| Date / TZ            | `date-fns`, `date-fns-tz`                                      |
| PDF generation       | `puppeteer`, `pdf-lib`, `jspdf`, `jspdf-autotable`             |
| CSV import           | `csv-parse`                                                    |
| Tests                | `vitest`                                                       |
| Dev runtime          | `tsx watch`                                                    |

### Frontend (`apps/web`)

| Concern         | Library                              |
| --------------- | ------------------------------------ |
| Framework       | `next` 16 (App Router) · React 19    |
| UI / Styling    | Tailwind CSS, custom design tokens   |
| Charts          | `recharts`                           |
| Date pickers    | `@daypicker/react` via shared `DateInput` (`apps/web/components/date-input.tsx`) |
| PDFs (client)   | `jspdf`, `jspdf-autotable`           |
| Utilities       | `clsx`, `date-fns`                   |

---

## 5. Repository Layout

```
plethora/
├── apps/
│   ├── api/                       # Fastify backend
│   │   ├── prisma/                # schema.prisma + migrations + seeds
│   │   ├── src/
│   │   │   ├── index.ts           # bootstrap: builds the app and listens
│   │   │   ├── app.ts             # buildApp(): Fastify + plugins + route registration
│   │   │   ├── lib/               # prisma, env, storage (local/S3), audit, geo, tz
│   │   │   ├── middleware/        # authMiddleware, requireRole (RBAC)
│   │   │   ├── modules/           # feature modules (e.g. rostering → /shifts)
│   │   │   ├── routes/            # one file per resource (incl. routes/academy/*)
│   │   │   ├── services/          # domain logic (payroll, tax, rostering…)
│   │   │   │   └── payroll-compliance/
│   │   │   │       └── rules/     # pluggable compliance checks
│   │   │   └── whatsapp/          # webhook + send/contacts/messages/templates
│   │   ├── uploads/               # local upload root (when STORAGE_DRIVER=local)
│   │   ├── package.json
│   │   └── tsconfig.json
│   └── web/                       # Next.js frontend
│       ├── app/
│       │   ├── (auth)/            # login, register, setup-password
│       │   └── (dashboard)/       # operator UI: employees, rostering, academy, …
│       ├── components/            # layout, search, WhatsApp widget, etc.
│       ├── lib/                   # api client, auth-context, permissions
│       ├── next.config.js         # /api/* → API rewrite
│       └── tailwind.config.ts
├── docs/
│   ├── PLETHORA-USER-MANUAL.md            # end-user manual
│   ├── WHATSAPP_PRODUCTION.md             # Meta WhatsApp Cloud API setup
│   ├── ROSTER_ENGINE.md                   # auto-roster (Site → Post → Shift) behaviour
│   ├── SECURITY.md                        # security model & hardening notes
│   ├── AWS_EC2_NON_DOCKER_DEPLOYMENT.md   # EC2 + PM2 + ALB + RDS + S3 guide
│   ├── AWS_EC2_DEPLOYMENT_CHECKLIST.md    # go-live checklist for the EC2 path
│   ├── AWS_S3_STORAGE.md                  # S3 upload storage reference
│   ├── AWS_ENVIRONMENT_VARIABLES.md       # AWS env-var reference
│   └── AWS_DEPLOYMENT_READINESS.md        # readiness assessment
├── ecosystem.config.cjs           # PM2 process config for the EC2 deployment
├── package.json                   # root workspace + dev/prod scripts
└── README.md
```

---

## 6. Domain Model

Plethora's persistence is defined entirely in
`apps/api/prisma/schema.prisma`. The simplified entity-relationship view:

```
Company ──┬── User (admin / ops_manager / hr_payroll / supervisor / controller)
          ├── Employee ──┬── PayGrade
          │              ├── EmployeeGroup ── GroupPayRule / GroupEarningsRule / GroupDeductionRule
          │              ├── EmployeeDeduction ── DeductionRule
          │              ├── LeaveRecord / LeaveRequest
          │              └── WhatsAppMessage / WhatsAppClockPending
          ├── Site ── Post ── Shift ── Attendance
          │     └── SiteAssignment / PostAssignment
          ├── PayRule / EarningsRule / DeductionRule / PublicHoliday
          ├── PayrollRun ── PayrollItem ── Payslip
          ├── Timesheet
          ├── TaskProject ── Task ── (TaskComment / TaskAttachment / TaskReminder)
          └── AuditLog
```

Highlights:

- **Multi-tenancy.** Every primary entity has `companyId` and a cascading
  relation back to `Company`. Deleting a company cleanly removes all child rows.
- **Security vs. office staff.** `Employee.employeeType` (`security` | `office`)
  switches between PSIRA and BCEA field sets within a single table; only the
  relevant fields are validated/displayed per type.
- **Pay grades and groups.** A `PayGrade` may be company-default
  (`groupId = null`) or scoped to an `EmployeeGroup`. Rules can be defined
  globally (`PayRule`, `EarningsRule`, `DeductionRule`) or per-group
  (`GroupPayRule`, `GroupEarningsRule`, `GroupDeductionRule`); the payroll
  engine resolves the most specific rule per employee.
- **Geofencing.** `Site.latitude / longitude / geofenceRadiusMeters` together
  enable enforced GPS clock-in via WhatsApp.
- **SARS integration.** `Company` carries `payeReference`, `sdlReference`,
  `uifReference`, `monthlyPayrollTotals` (rolling SDL liability tracking);
  `Payslip` stores PAYE/UIF/SDL line items; `PayrollItem` stores the disaggregated
  hours.
- **Auditing.** Mutations write to `AuditLog` (`action`, `entityType`,
  `entityId`, optional metadata) for the Audit module to display.

---

## 7. Identity, Authentication & RBAC

### Authentication

- Stateless **JWT bearer tokens**. The API issues an access token and a
  refresh token from `apps/api/src/services/auth.service.ts`.
- The web app stores tokens in `auth-context` (React context) and forwards them
  via the `Authorization: Bearer …` header through `authFetch`
  (`apps/web/lib/api.ts`).
- New tenants self-onboard at `POST /auth/onboard`, which atomically creates a
  `Company` plus its first `admin` user.
- Existing companies invite users; the invitee completes signup via a one-time
  password-setup link (`/auth/setup-password/*`).

### Authorization model

The system distinguishes three classes of identity:

| Class            | Definition                                                                          | Effective access                              |
| ---------------- | ----------------------------------------------------------------------------------- | --------------------------------------------- |
| **Full admin**   | `role === "admin"` AND `moduleAccess` is `null`.                                    | All modules; only class allowed on admin-only routes (e.g. `/audit`, user CRUD). |
| **Scoped admin** | `role === "admin"` AND `moduleAccess` is a non-empty list of module paths.          | Only the listed modules; no admin-only routes. |
| **Other roles**  | `operations_manager`, `hr_payroll`, `supervisor`, `controller`. **Must** have an explicit `moduleAccess` list. | Only the listed modules; otherwise sent to `/access-pending`. |

Module paths mirror the navigation in `apps/web/lib/permissions.ts`:

```
/, /employees, /sites, /rostering, /attendance, /payroll,
/tasks, /whatsapp, /reports, /audit, /settings
```

### `requireRole` middleware

Defined in `apps/api/src/middleware/rbac.ts`. Each protected route declares
which roles *and* which module(s) it covers:

```ts
const protect = [authMiddleware, requireRole(
  ["admin", "operations_manager", "supervisor", "controller"],
  { module: "/rostering" }
)];

const readProtect = [authMiddleware, requireRole(
  ["admin", "operations_manager", "hr_payroll", "supervisor", "controller"],
  { anyOfModules: ["/employees", "/rostering"] }
)];
```

- `module` requires the user to hold that exact module (or a child of it).
- `anyOfModules` permits the call if the user holds **any** of the listed
  modules. This is how cross-module reads (e.g. a controller in Rostering being
  able to list all employees) are granted without expanding write privileges.
- A full admin bypasses the check; a scoped admin is treated like any other
  role.
- Admin-only routes use `roles: ["admin"]` and additionally reject scoped
  admins.

### Frontend mirroring

`apps/web/lib/permissions.ts` keeps the navigation and route guards aligned
with the backend:

- `canAccessRoute(pathname, role, moduleAccess)` decides whether to render a
  page or redirect to `/access-pending`.
- `getDefaultRouteForUser` picks the landing page based on the first granted
  module.
- `defaultModulesForRole` provides the suggested default module set used by the
  Settings UI when an admin is assigning access.

---

## 8. API Surface

The API is composed of small, resource-oriented Fastify route modules
registered in `apps/api/src/app.ts` (via `buildApp()`, which `src/index.ts`
then starts). All routes (except `/health`,
`/auth/onboard`, `/auth/login`, `/auth/refresh` and the WhatsApp webhook) sit
behind `authMiddleware` and a `requireRole(...)` guard.

### Public

| Method | Path                                           | Purpose                                 |
| ------ | ---------------------------------------------- | --------------------------------------- |
| GET    | `/health`                                      | Liveness probe                          |
| POST   | `/auth/onboard`                                | Create new tenant + admin user          |
| POST   | `/auth/login`                                  | Issue access + refresh tokens           |
| POST   | `/auth/refresh`                                | Rotate access token                     |
| GET    | `/auth/setup-password/:token`                  | Validate password-setup invite          |
| POST   | `/auth/setup-password`                         | Complete password setup                 |
| ANY    | `/whatsapp/webhook`                            | Meta WhatsApp Cloud webhook (signed)    |

### Authenticated module routes (selected)

| Prefix                                | File                              | Notes                                                                      |
| ------------------------------------- | --------------------------------- | -------------------------------------------------------------------------- |
| `/auth/me`                            | `routes/auth.ts`                  | Current user profile + module access                                        |
| `/users`                              | `routes/users.ts`                 | User CRUD; mostly admin-only                                                |
| `/companies`                          | `routes/companies.ts`             | Company profile, branding, SARS references                                  |
| `/employees`                          | `routes/employees.ts`             | Reads allow `anyOfModules: ["/employees","/rostering"]`                     |
| `/sites`                              | `routes/sites.ts`                 | Reads allow `anyOfModules: ["/sites","/rostering"]`                         |
| `/shifts`                             | `modules/rostering/rostering.routes.ts` | Roster management                                                    |
| `/attendance`                         | `routes/attendance.ts`            | Clock-in/out + manual corrections                                           |
| `/payroll` (and sub-routes)           | `routes/payroll*.ts`              | Runs, items, intelligence, intelligence reports                             |
| `/payroll/pay-grades`                 | `routes/pay-grades.ts`            | Reads allow `anyOfModules: ["/payroll","/employees"]`                       |
| `/payroll/pay-rules`                  | `routes/pay-rules.ts`             | Overtime / Sunday / public-holiday multipliers                              |
| `/payroll/earnings-rules`             | `routes/earnings-rules.ts`        | Recurring earnings                                                          |
| `/payroll/deduction-rules`            | `routes/deduction-rules.ts`       | Recurring deductions                                                       |
| `/payroll/timesheets`                 | `routes/timesheets.ts`            | Aggregated employee hours per period                                        |
| `/payroll/leave-records`              | `routes/leave-records.ts`         | Leave ledger consumed by payroll                                            |
| `/payroll/leave-requests`             | `routes/leave-requests.ts`        | Self-service approvals                                                      |
| `/payroll/public-holidays`            | `routes/public-holidays.ts`       | Per-company holiday calendar                                                |
| `/employee-groups`                    | `routes/employee-groups.ts`       | Logical groupings + group-scoped rules                                      |
| `/dashboard`                          | `routes/dashboard.ts`             | KPI tiles                                                                   |
| `/audit`                              | `routes/audit.ts`                 | Admin-only                                                                  |
| `/settings`                           | `routes/settings.ts`              | Company / user settings                                                    |
| `/uploads`                            | `routes/uploads.ts`               | Multipart uploads (logos, attachments)                                      |
| `/search`                             | `routes/search.ts`                | Cross-entity search                                                        |
| `/migrations`                         | `routes/migrations.ts`            | Tenant-side data import (CSV)                                              |
| `/reports`                            | `routes/reports.ts`               | Operational + statutory PDFs/exports                                       |
| `/task-projects`, `/tasks`, `/task-comments`, `/task-attachments`, `/task-reminders` | `routes/task*.ts` | Task manager |
| `/academy/*`                          | `routes/academy/*.ts`             | Training academy: students, instructors, courses, certificates, invoices, etc. |
| `/whatsapp/{send,contacts,messages,templates}` | `whatsapp/routes/*.ts`  | Authenticated WhatsApp operations                                          |

### Cross-cutting plugins

Registered globally in `apps/api/src/app.ts`:

- **CORS** — origin(s) from `CORS_ORIGIN` (comma-separated allowed), credentials enabled.
- **Helmet** — secure HTTP headers (CSP enabled in production; the web app
  proxies through `/api/*`).
- **Cookie** — used for the HttpOnly refresh-token cookie.
- **Rate limit** — 100 requests/minute per IP by default.
- **Multipart** — file uploads up to 10 MB.
- **Static** — serves `uploads/*` only when `STORAGE_DRIVER=local` (S3 serves its own URLs).
- **Trust proxy** — enabled when `TRUST_PROXY=true` (required behind a load balancer such as AWS ALB).

---

## 9. Frontend Module Map

Routes under `apps/web/app/(dashboard)`:

| Route                              | Purpose                                                      |
| ---------------------------------- | ------------------------------------------------------------ |
| `/`                                | Operations dashboard (KPIs, alerts, recent activity)         |
| `/employees`                       | Team list + onboarding form (`PayGradeSelect`, leave links)  |
| `/employees/leave`                 | Leave records ledger                                         |
| `/sites`, `/sites/[id]`            | Sites + posts + geofence editor                              |
| `/rostering`                       | Roster builder, recurrence patterns, PDF export              |
| `/attendance`                      | Live attendance grid, manual edits                           |
| `/payroll`                         | Payroll runs, payslips, configuration tabs                   |
| `/payroll/configuration`           | Pay rules / earnings / deductions / grades configuration     |
| `/payroll/leave-requests`          | Leave approvals queue                                        |
| `/tasks`, `/tasks/[id]`            | Task manager                                                 |
| `/tasks/projects`, `/.../[id]`     | Task projects                                                |
| `/academy/*`                       | Training academy hub (students, instructors, courses, certificates, finance, …) |
| `/whatsapp`                        | Conversation centre                                          |
| `/reports`                         | Operational + statutory reports                              |
| `/audit`                           | Audit log viewer (admin only)                                |
| `/settings`                        | Company, theme, users, modules, holidays, integrations       |
| `/settings/migrate`                | CSV/data migration wizard                                    |
| `/access-pending`                  | Holding page for users without module access                 |

Routes under `apps/web/app/(auth)`:

| Route                              | Purpose                                                      |
| ---------------------------------- | ------------------------------------------------------------ |
| `/login`                           | Email/password login                                         |
| `/register`                        | New tenant onboarding (calls `/auth/onboard`)                |
| `/setup-password`                  | Completes invited-user signup                                |

The dashboard layout (`app/(dashboard)/layout.tsx`) reads the current user
from `auth-context`, evaluates `canAccessRoute`, and renders only modules
present in the user's `moduleAccess` (or all modules for full admins).

---

## 10. Payroll Engine

Payroll is implemented as a chain of services under
`apps/api/src/services/`:

- `timesheet.service.ts` — aggregates `Attendance` + `LeaveRecord` rows into a
  `Timesheet` per employee per period (basic, overtime, Sunday, public-holiday
  hours, leave days).
- `payroll.service.ts` — orchestrates a `PayrollRun`: pulls timesheets, applies
  pay grade rates, multipliers, recurring earnings and deductions, then writes
  `PayrollItem`s.
- `payroll-statutory.service.ts` — computes PAYE (using
  `lib/tax-brackets.ts`), UIF, and SDL.
- `tax.service.ts` — the underlying SARS tax calculator.
- `sdl-tracking.service.ts` — maintains the rolling 12-month payroll total on
  `Company.monthlyPayrollTotals` for SDL liability.
- `deductions.service.ts` — resolves which `DeductionRule` /
  `EmployeeDeduction` rows apply to a given employee.
- `payslip-data.service.ts` + `payslip-pdf.service.ts` — assemble payslip
  earnings/deductions JSON and render printable PDFs (Puppeteer).
- `payroll-cost.service.ts`, `contract-labour-cost.service.ts` — derive cost
  reports per site/contract.
- `irp5.service.ts`, `emp201.service.ts` — SARS submission artefacts.
- `payroll-compliance/` — a rule engine that runs a list of
  `payroll-compliance/rules/*` checks (`zero-pay-active`, `negative-values`,
  `missing-tax-id`, `missing-uif-fields`, `high-overtime`, `premium-checks`)
  against a calculated payroll run and returns issues for the operator to
  resolve before approval.

The end-to-end flow:

```
Attendance + LeaveRecord
        │
        ▼
   timesheet.service ────────────► Timesheet
        │
        ▼
   payroll.service ──┬─► applies PayGrade / GroupPayRule / PayRule
                     ├─► applies EarningsRule / GroupEarningsRule
                     ├─► applies DeductionRule / EmployeeDeduction
                     └─► calls payroll-statutory.service (PAYE, UIF, SDL)
                              │
                              ▼
                       PayrollItem  ───►  Payslip (PDF)
                              │
                              ▼
                  payroll-compliance.service
                              │
                              ▼
                   Issues / Reports / EMP201 / IRP5
```

---

## 11. WhatsApp Integration

The WhatsApp module is mounted in `apps/api/src/whatsapp/index.ts` and serves
two purposes:

1. **Inbound** — Meta posts message events to `/whatsapp/webhook`. The handler
   service (`whatsapp/services/handler.service.ts`) interprets the message,
   matches it to an `Employee` (by phone), and triggers domain actions such as
   clocking in, clocking out, or starting a leave request. When a site has a
   geofence, a follow-up location message is required and tracked via
   `WhatsAppClockPending` until it expires.
2. **Outbound** — Authenticated routes `/whatsapp/send`,
   `/whatsapp/contacts`, `/whatsapp/messages`, `/whatsapp/templates` let
   operators send free-form messages, manage templates, and review
   conversations from the dashboard.

All messages are persisted in `WhatsAppMessage` so the conversation centre can
render full history per employee.

Production setup (Meta phone number, permanent access token, verify token,
template approval) is documented in
[`docs/WHATSAPP_PRODUCTION.md`](docs/WHATSAPP_PRODUCTION.md).

---

## 12. Local Development Setup

### Prerequisites

- **Node.js 24.x** (see repo [`.nvmrc`](.nvmrc); run `nvm use` or `fnm use` before `npm install`)
- **npm** (the repo uses npm workspaces)
- **PostgreSQL ≥ 14** running locally (or accessible via `DATABASE_URL`)

### One-time setup

```bash
# 1. Install all workspace dependencies
npm install

# 2. Create the database
psql -U postgres -c "CREATE DATABASE plethora;"

# 3. Configure the API
cp apps/api/.env.example apps/api/.env
# then edit DATABASE_URL, JWT_SECRET, JWT_REFRESH_SECRET, CORS_ORIGIN

# 4. Apply the schema (dev: db push; prod: migrate deploy)
npm run db:push

# 5. (Optional) Seed sample data
npm run db:seed
```

### Run both apps

```bash
# concurrently runs API + Web together
npm run dev:all

# …or run them in separate terminals
npm run dev:api    # http://localhost:3001
npm run dev:web    # http://localhost:3000
```

The Next.js app rewrites `/api/*` to `http://localhost:3001/*`
(`apps/web/next.config.js`) so the browser only talks to one origin.

### First login

- New deployment? Visit `http://localhost:3000/register` to onboard the first
  company and admin (uses `POST /auth/onboard`).
- Existing tenant? Sign in at `/login`. Additional users are created from
  Settings → Users; they receive a setup-password link.

---

## 13. Environment Variables

`apps/api/.env` — see `apps/api/.env.example` (local dev) and
`apps/api/.env.production.example` (AWS EC2) for complete templates.

| Variable                    | Required | Purpose                                                            |
| --------------------------- | -------- | ------------------------------------------------------------------ |
| `DATABASE_URL`              | yes      | PostgreSQL connection string used by Prisma                        |
| `JWT_SECRET`                | yes      | Signing secret for access tokens (≥32 chars in production)         |
| `JWT_REFRESH_SECRET`        | yes      | Signing secret for refresh tokens (≥32 chars, different from above) |
| `CORS_ORIGIN`               | yes      | Allowed origin(s) for browser calls; comma-separated list supported (e.g. preview + production URLs) |
| `FRONTEND_URL`              | yes      | Used when building absolute URLs (password setup links, etc.)      |
| `PORT`                      | no       | Defaults to `3001`                                                 |
| `HOST`                      | no       | Defaults to `0.0.0.0`                                              |
| `TRUST_PROXY`               | no       | `true`/`false` (default `false`). Set `true` behind a load balancer (AWS ALB) to trust `X-Forwarded-*` |
| `STORAGE_DRIVER`            | no       | `local` (default) or `s3`                                          |
| `AWS_REGION`                | s3       | AWS region of the S3 bucket (required when `STORAGE_DRIVER=s3`)     |
| `S3_BUCKET_NAME`            | s3       | S3 bucket for uploads (required when `STORAGE_DRIVER=s3`)           |
| `S3_PUBLIC_BASE_URL`        | no       | Optional CDN/custom base URL for public S3 objects                 |
| `WHATSAPP_PHONE_NUMBER_ID`  | prod     | Meta phone number ID                                               |
| `WHATSAPP_ACCESS_TOKEN`     | prod     | Permanent system-user token                                        |
| `WHATSAPP_VERIFY_TOKEN`     | prod     | Webhook verify string configured in Meta                           |
| `WHATSAPP_API_VERSION`      | no       | Defaults to `v21.0`                                                |
| `CLOCK_IN_WINDOW_MINUTES`   | no       | Tolerance window for shift clock-in (default 15)                   |
| `ENCRYPTION_KEY`            | no       | Encryption key for stored SMTP/email credentials                   |
| `PUPPETEER_EXECUTABLE_PATH` | no       | Path to Chromium/Chrome for PDF generation (e.g. on EC2)           |

> S3 uploads use the default AWS credential chain — on EC2 attach an **IAM role**
> rather than putting `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY` in `.env`.

`apps/web` — see `apps/web/.env.example` and `apps/web/.env.production.example`:

| Variable                      | Purpose                                                            |
| ----------------------------- | ------------------------------------------------------------------ |
| `NEXT_PUBLIC_API_URL`         | Public API origin the browser/Next.js rewrite proxies to (local default `http://localhost:3001`) |
| `NEXT_PUBLIC_API_PATH_PREFIX` | Optional path prefix; leave empty when the API serves at the origin root |

---

## 14. Database & Migrations

Prisma is the single source of truth (`apps/api/prisma/schema.prisma`).
Common commands (run from repo root):

| Script                          | Description                                                            |
| ------------------------------- | ---------------------------------------------------------------------- |
| `npm run db:generate`           | Regenerate the Prisma client after schema changes                      |
| `npm run db:push`               | **Dev only** — push schema state directly without a migration record   |
| `npm run db:migrate`            | Create a new dev migration (interactive)                               |
| `npm run db:migrate:deploy`     | **Prod** — apply committed migrations                                  |
| `npm run db:seed`               | Run `prisma/seed.ts`                                                   |
| `npm run db:add-module-access`  | Backfills the `User.moduleAccess` column on legacy DBs                 |

Notable migrations:

- `20250314000000_add_sars_paye_fields` — PAYE/UIF/SDL columns
- `20250316000000_add_site_monthly_revenue` — site profitability tracking
- `20250320120000_site_geofence` — geofence columns on `Site`
- `20260328120000_user_module_access` — module-based RBAC column on `User`
- `20260330133000_user_role_label` — display label per user role
- `20260330173000_user_password_setup_link` — invite-by-email flow

A handful of one-off scripts also live in `apps/api/prisma/`:
`backfill-employee-numbers.ts`, `check-duplicate-emails.ts`,
`reset-admin.ts` (run with `tsx`).

---

## 15. Development Workflow

### Adding a new resource

1. Define the model in `apps/api/prisma/schema.prisma` and generate the client
   (`npm run db:migrate -- --name add_my_resource`).
2. Create a service in `apps/api/src/services/<resource>.service.ts` for the
   business logic.
3. Create a route file in `apps/api/src/routes/<resource>.ts`. Use Zod for
   request validation and `requireRole(roles, { module })` for authorization.
4. Register the route in `apps/api/src/app.ts` (inside `buildApp()`) with its prefix.
5. If the resource is exposed in the UI, add it to `NAV_ITEMS` in
   `apps/web/lib/permissions.ts` and create a page under
   `apps/web/app/(dashboard)/<resource>/page.tsx`.
6. Write tests under `apps/api/src/services/__tests__/`.

### Code conventions

- TypeScript with strict mode in both apps.
- Backend uses ESM (`"type": "module"`); imports use `.js` extensions for
  built output compatibility.
- All authenticated reads/writes filter on `companyId` derived from
  `request.user`. **Never** trust a `companyId` in the request body.
- Use `lib/audit.ts` to record significant mutations.

---

## 16. Build, Deployment & Operations

### Build

```bash
# Builds both workspaces (apps/api → dist/, apps/web → .next/)
npm run build
```

The API build (`tsc`) emits to `apps/api/dist`; the web build is a standard
Next.js production build.

### Run in production

```bash
# From the repo root: apply migrations, then build both apps
npm run prod:migrate     # = prisma migrate deploy (never use db:push in prod)
npm run prod:build       # = build:api && build:web

# Manual start (single host):
node apps/api/dist/index.js          # API on :3001
npm run start --workspace=web        # Web on :3000 (next start)
```

Production process management is handled by **PM2** (`ecosystem.config.cjs`):

| Script                      | Action                                  |
| --------------------------- | --------------------------------------- |
| `npm run prod:build`        | Build API then web                      |
| `npm run prod:migrate`      | `prisma migrate deploy`                 |
| `npm run prod:start:pm2`    | `pm2 start ecosystem.config.cjs`        |
| `npm run prod:restart:pm2`  | `pm2 restart ecosystem.config.cjs`      |
| `npm run prod:logs`         | `pm2 logs`                              |
| `npm run prod:status`       | `pm2 status`                            |

Both apps are stateless and horizontally scalable, provided:

- A single shared PostgreSQL instance (e.g. AWS RDS) is reachable by all API replicas.
- Uploads use object storage (`STORAGE_DRIVER=s3`) so files are shared across
  replicas and survive instance replacement.
- All replicas share the same `JWT_SECRET` / `JWT_REFRESH_SECRET`.

### Reverse proxy

If hosting `web` and `api` on different origins, set
`NEXT_PUBLIC_API_URL` for the web app and `CORS_ORIGIN` for the API. The
`/api/*` rewrite in `next.config.js` will continue to proxy through the
Next.js runtime in production. Step-by-step hosting (e.g. **Railway**) is in
[`DEPLOYMENT.md`](DEPLOYMENT.md).

### AWS EC2 non-Docker deployment

For a production AWS deployment without Docker containers, use:

- `docs/AWS_EC2_NON_DOCKER_DEPLOYMENT.md`
- `docs/AWS_EC2_DEPLOYMENT_CHECKLIST.md`

This deployment path runs:

- Next.js on EC2 port `3000`
- Fastify API on EC2 port `3001`
- PostgreSQL on AWS RDS
- File uploads on S3
- HTTPS through AWS ALB + ACM
- DNS through Route 53
- Process management through PM2

---

## 17. Testing

```bash
# Run the API test suite once
npm run test --workspace=api

# Watch mode
npm run test:watch --workspace=api
```

Existing test coverage (Vitest) focuses on the high-risk domain logic:

- `services/__tests__/payroll-compliance.service.test.ts`
- `services/__tests__/payroll-statutory.service.test.ts`
- `services/__tests__/payroll-cost.service.test.ts`
- `services/__tests__/contract-labour-cost.service.test.ts`
- `services/__tests__/attendance-geofence.service.test.ts`
- `lib/__tests__/geo.test.ts`

The frontend uses `next lint` (`npm run lint --workspace=web`); the first run
will perform interactive ESLint setup.

---

## 18. Security Notes

- **Passwords** are hashed with bcrypt (`hashPassword` in
  `services/auth.service.ts`) before storage.
- **Tokens** are JWTs signed with `JWT_SECRET` (access) and `JWT_REFRESH_SECRET`
  (refresh). Rotate these values for production and never commit `.env` files.
- **Tenant isolation** relies on `companyId` from the JWT being applied to
  every Prisma query. Any new route must follow this pattern; resist accepting
  `companyId` from request bodies.
- **RBAC** must be declared on every authenticated route via `requireRole`.
  Use `module` for ownership-style checks and `anyOfModules` for legitimate
  cross-module reads.
- **Rate limiting** is configured at the framework level (100 req/min by IP).
  Adjust in `apps/api/src/app.ts`. Set `TRUST_PROXY=true` behind a load
  balancer so the real client IP (not the ALB's) is used.
- **Helmet** ships secure default headers; a strict CSP is enabled in
  production. The API is consumed via the Next.js `/api/*` proxy.
- **Uploads** are size-limited (10 MB). In production use `STORAGE_DRIVER=s3`
  so files live in S3 (private bucket, IAM-role access); local disk under
  `/uploads/*` is the development default.
- **WhatsApp webhook** must be verified using `WHATSAPP_VERIFY_TOKEN` and
  ideally signature-validated using Meta's app secret (see
  `docs/WHATSAPP_PRODUCTION.md`).
- **Audit log** is append-only at the application level — there is no
  `DELETE /audit` route. Database-level constraints further protect it via
  `onDelete: SetNull` on the user reference.

---

## 19. Further Documentation

- [`docs/PLETHORA-USER-MANUAL.md`](docs/PLETHORA-USER-MANUAL.md) — end-user
  guide covering each module from an operator perspective.
- [`docs/WHATSAPP_PRODUCTION.md`](docs/WHATSAPP_PRODUCTION.md) — Meta
  WhatsApp Cloud API onboarding (phone number, permanent token, webhook,
  template approval).
- [`docs/ROSTER_ENGINE.md`](docs/ROSTER_ENGINE.md) — auto-roster (Site → Post → Shift) behaviour.
- [`docs/SECURITY.md`](docs/SECURITY.md) — security model and hardening notes.
- [`docs/AWS_EC2_NON_DOCKER_DEPLOYMENT.md`](docs/AWS_EC2_NON_DOCKER_DEPLOYMENT.md)
  and [`docs/AWS_EC2_DEPLOYMENT_CHECKLIST.md`](docs/AWS_EC2_DEPLOYMENT_CHECKLIST.md)
  — production AWS EC2 (non-Docker) deployment guide and checklist.
- [`docs/AWS_S3_STORAGE.md`](docs/AWS_S3_STORAGE.md) — S3 upload storage reference.
- `apps/api/prisma/schema.prisma` — authoritative data model.
- `apps/api/src/middleware/rbac.ts` and `apps/web/lib/permissions.ts` —
  authoritative RBAC behaviour for backend and frontend respectively.

---

## 20. License

Proprietary — internal use within Quick Bopha Security and authorised
deployments only. Contact the project maintainers for licensing or
white-label arrangements.
