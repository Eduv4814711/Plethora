# Plethora ERP — Master Operational & Engineering Rules

This repository implements **Plethora ERP**, a workforce operations, compliance, attendance, rostering, and payroll platform built for the **South African private security industry**.

All agentic pair-programming, refactoring, feature work, and architecture decisions in this repository are strictly governed by [PLETHORA_CONTEXT.md](file:///c:/Users/nkagi/Downloads/Plethora-main/Plethora-main/PLETHORA_CONTEXT.md).

---

## 1. The Central Operational Chain
Never build features in isolation. Every feature belongs to the continuous operational chain:
```
Employee
   ↓
Employment & Compliance Profile
   ↓
Client
   ↓
Site
   ↓
Post (Staffing Requirement)
   ↓
Roster (Planned Schedule)
   ↓
Actual Attendance / Site Timesheet (Actual Reality)
   ↓
Approved Hours / Exception Resolution
   ↓
Payroll (Statutory Deductions & Payslip)
   ↓
Client Billing (Service Delivery Reconciliation)
   ↓
Management & Compliance Reporting
```

---

## 2. Fundamental Invariants
1. **Roster vs. Attendance**:
   - Roster = *what was supposed to happen*.
   - Attendance = *what actually happened*.
   - Payroll must derive from **approved actual attendance**, never solely scheduled roster data.
2. **Roster Cycle**:
   - 26th of one month → 25th of following month.
   - Labelled by the month in which the period ends (e.g. 26 Aug – 25 Sep = September Roster).
3. **Source of Truth**:
   - Single authoritative identity for `Employee`.
   - Never duplicate master data or maintain conflicting representations.
4. **South African Statutory Compliance**:
   - PAYE, UIF, SDL, provident fund, bargaining council, PSIRA, and BCEA rules must be strictly adhered to and auditable.
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

A visually impressive screen with inaccurate payroll, roster, or attendance logic is unacceptable.

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
8. **Test** unit, integration, and type checks (`npm run build:api`, `npm run build:web`, `npm run test:api`).
9. **Regression Check** upstream and downstream modules.
10. **Clean** dead code, unused imports, and temporary debug logs.
11. **Report** changes, business impact, and verification results.
