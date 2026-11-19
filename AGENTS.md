# AGENTS.md — Plethora ERP Agent Instructions

This repository contains **Plethora ERP**, a streamlined workforce operations, operational compliance, attendance, rostering, client billing, WhatsApp, and external payroll export platform engineered primarily for the **South African private security industry**.

All AI agents, pair programmers, and automated tooling working in this codebase **must** read and adhere to:
1. **Master Blueprint**: [PLETHORA_CONTEXT.md](./PLETHORA_CONTEXT.md)
2. **Operational Rules**: [.agents/rules/plethora_master_rules.md](./.agents/rules/plethora_master_rules.md)

---

## Core Invariants

- **The Central Operational Chain**:
  `Employee (External Payroll Code) → Employment & Compliance Profile → Client → Site (Cost Center Code) → Post → Roster → Scheduled Shift → Actual Attendance / Site Timesheet → Approved Hours & Approved Leave → External Payroll Export (/payroll-exports: Sage / CSV / JSON) → Client Billing (/billing) → Management & Compliance Reporting`
- **Scope Boundary (Streamlined Operations + External Payroll)**:
  - Internal payroll calculation, tax/payslips, Academy, Tasks & Projects, Client Portal, and Compliance Finance (`Statutory`, `Funds`, `Cash Control`) have been retired.
  - Downstream gross-to-net pay, PAYE/UIF/SDL calculations, and employee payslips execute in **Sage** (or the configured external payroll system) fed strictly by Plethora's `/payroll-exports` module.
  - **Client Billing** is preserved as a top-level operational module at `/billing`.
- **Roster vs. Attendance**:
  - Roster = What was supposed to happen.
  - Attendance = What actually happened.
  - External payroll export and client billing **must** rely on approved actual attendance (and approved leave), never scheduled shifts alone.
- **Roster Cycle**:
  - 26th of one month → 25th of the following month (configurable via company payroll calendar settings).
  - Labelled by the month in which the period ends (e.g. 26 Aug – 25 Sep = September Roster).
- **South African Operational & BCEA Compliance**:
  - BCEA attendance classifications (ordinary, overtime, Sunday, public holiday, night shift), leave balances/rules, PSIRA registrations, company compliance obligations, legal cases, and POPIA access controls must remain auditable and explainable.
- **Engineering Priorities (§48)**:
  1. Data integrity
  2. Security
  3. Correct business behaviour
  4. Reliability
  5. Operational efficiency
  6. User experience
  7. Performance
  8. Architectural elegance
- **11-Step Antigravity Workflow (§34)**:
  Always execute: Understand → Inspect → Trace → Evaluate → Plan → Implement → Validate → Test → Regression Check → Clean → Report.
