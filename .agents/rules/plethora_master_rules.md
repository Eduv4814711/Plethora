# Plethora ERP — Master Operational & Engineering Rules

This repository implements **Plethora ERP**, a streamlined workforce operations, operational compliance, attendance, rostering, client billing (`/billing`), WhatsApp, and external payroll export (`/payroll-exports`) platform built for the **South African private security industry**.

All agentic pair-programming, refactoring, feature work, and architecture decisions in this repository are strictly governed by [PLETHORA_CONTEXT.md](../../PLETHORA_CONTEXT.md).

---

## 1. The Central Operational Chain
Never build features in isolation. Every feature belongs to the continuous operational chain:
```
Employee (with External Payroll Code)
   ↓
Employment & Compliance Profile
   ↓
Client
   ↓
Site (with Cost Center Code)
   ↓
Post (Staffing Requirement)
   ↓
Roster (Planned Schedule)
   ↓
Actual Attendance / Site Timesheet (Actual Reality)
   ↓
Approved Hours / Exception Resolution / Approved Leave
   ↓
External Payroll Export (/payroll-exports: Sage Business Cloud ZA, Sage VIP, Sage 300 People, CSV, JSON)
   ↓
Client Billing (/billing: Quotes, Invoices, Receipts & Service Delivery Reconciliation)
   ↓
Management & Compliance Reporting
```

Retired modules (do not re-introduce): Internal Payroll Engine & Payslips, Academy, Tasks & Projects, Client Portal, and Compliance Finance (`Statutory`, `Funds`, `Cash Control`).

---

## 2. Fundamental Invariants
1. **Roster vs. Attendance**:
   - Roster = *what was supposed to happen*.
   - Attendance = *what actually happened*.
   - External payroll exports and client billing must derive from **approved actual attendance** (and approved leave), never solely scheduled roster data.
2. **Roster Cycle**:
   - 26th of one month → 25th of following month.
   - Labelled by the month in which the period ends (e.g. 26 Aug – 25 Sep = September Roster).
3. **Source of Truth**:
   - Single authoritative identity for `Employee` (linked to Sage/external payroll via `externalPayrollCode`) and `Site` (linked via `costCenterCode`).
   - Never duplicate master data or maintain conflicting representations.
4. **South African BCEA, PSIRA & Operational Compliance**:
   - Attendance hour buckets (ordinary, overtime, Sunday, public holiday, night shift), BCEA leave entitlements, PSIRA grades/registrations, obligations register, legal cases, and POPIA privacy/RBAC rules must be strictly adhered to and auditable.
   - Gross-to-net pay, PAYE/UIF/SDL calculations, and employee payslips are calculated externally in **Sage** (or the configured payroll software) from Plethora's exported approved-hours batches.
5. **Exception-Driven Design**:
   - Normal operations should be quiet; exceptions must demand attention.
6. **Backend-Enforced Authorization**:
   - Never rely on frontend UI hiding for security. Enforce RBAC/capabilities on the backend.

---

## 3. Engineering Priorities (§48)
When prioritising engineering decisions:
1. **Data integrity**
2. **Security**
3. **Correct business behaviour**
4. **Reliability**
5. **Operational efficiency**
6. **User experience**
7. **Performance**
8. **Architectural elegance**

A visually impressive screen with inaccurate payroll export, billing, roster, or attendance logic is unacceptable.

---

## 4. 11-Step Antigravity Repository Workflow (§34)
For every development task:
1. **Understand** the business process.
2. **Inspect** relevant routes, models, services, and tests.
3. **Trace** the complete flow (UI → API → Auth → Controller → Service → DB → Response).
4. **Evaluate** downstream effects and data integrity.
5. **Plan** the smallest coherent change.
6. **Implement** following repository conventions.
7. **Validate** inputs, state transitions, and edge cases.
8. **Test** unit, integration, and type checks (`npm run build --workspace=api`, `npm run build --workspace=web`, `npm test --workspace=api`, `npm test --workspace=web`).
9. **Regression Check** upstream and downstream modules.
10. **Clean** dead code, unused imports, and temporary debug logs.
11. **Report** changes, business impact, and verification results.
