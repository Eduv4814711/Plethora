# AGENTS.md — Plethora ERP Agent Instructions

This repository contains **Plethora ERP**, a workforce operations, compliance, attendance, rostering, and payroll platform engineered primarily for the **South African private security industry**.

All AI agents, pair programmers, and automated tooling working in this codebase **must** read and adhere to:
1. **Master Blueprint**: [PLETHORA_CONTEXT.md](file:///c:/Users/nkagi/Downloads/Plethora-main/Plethora-main/PLETHORA_CONTEXT.md)
2. **Operational Rules**: [.agents/rules/plethora_master_rules.md](file:///c:/Users/nkagi/Downloads/Plethora-main/Plethora-main/.agents/rules/plethora_master_rules.md)

---

## Core Invariants

- **The Central Operational Chain**:
  `Employee → Employment & Compliance Profile → Client → Site → Post → Roster → Scheduled Shift → Actual Attendance / Site Timesheet → Approved Hours → Payroll → Employee Payslip / Statutory Contributions → Client Billing → Management Reporting`
- **Roster vs. Attendance**:
  - Roster = What was supposed to happen.
  - Attendance = What actually happened.
  - Payroll **must** rely on approved actual attendance, never scheduled shifts alone.
- **Roster Cycle**:
  - 26th of one month → 25th of the following month.
  - Labelled by the month in which the period ends (e.g. 26 Aug – 25 Sep = September Roster).
- **South African Statutory Compliance**:
  - All statutory deductions (PAYE, UIF, SDL, provident fund, PSIRA) must be auditable, explainable, and compliant with SARS / BCEA / Bargaining Council regulations.
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
