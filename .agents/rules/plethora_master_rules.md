# Plethora ERP — Master Operational & Engineering Rules

This repository implements **Plethora ERP**, an **AI-powered workforce management and operational intelligence platform** purpose-built for the South African private security industry.

Plethora is powered by **Amazon Bedrock, running Kimi 3.1**, providing the AI intelligence layer across workforce operations, rostering, attendance, compliance, billing, reporting and business decision-making.

All agentic development, architecture decisions, refactoring and feature implementations must follow [`PLETHORA_CONTEXT.md`](../../PLETHORA_CONTEXT.md).

---

## 1. Product Vision

Build a unified, intelligent operating system that helps security companies manage their entire workforce and operational lifecycle.

Plethora must be:
- **AI-powered:** Use Amazon Bedrock (Kimi 3.1) as the central intelligence layer, not AI as an afterthought.
- **Operationally intelligent:** Automate repetitive work, identify anomalies and surface actionable insights.
- **Compliance-driven:** Designed around South African BCEA, PSIRA and POPIA requirements.
- **Exception-driven:** Normal operations should be quiet; problems requiring intervention should be visible.
- **Data-driven:** Management decisions must be supported by reliable, traceable operational data.

AI may recommend, analyse and automate approved workflows, but must never independently override authoritative records, financial controls or compliance decisions.

## 2. The Operational Chain

Every feature must support the complete operational lifecycle:

```text
Employee & Employment Compliance
        ↓
Client & Site Management
        ↓
Posts & Staffing Requirements
        ↓
Roster (Planned Operations)
        ↓
Attendance & Timesheets (Actual Operations)
        ↓
Approved Hours & Leave
        ↓
External Payroll Exports (Sage)
        ↓
Client Billing & Invoicing
        ↓
Management Reporting & AI Intelligence
```

**Core rule:** Payroll exports and client billing must derive from approved actual attendance and approved leave, never from scheduled roster data alone.

Retired modules must not be reintroduced: Internal Payroll Engine, Payslips, Academy, Tasks & Projects, Client Portal and Compliance Finance.

## 3. Non-Negotiable Business Rules

1. **Data integrity:** Employee and Site records must remain authoritative, linked through `externalPayrollCode` and `costCenterCode` respectively.
2. **Roster cycles:** 26th to 25th, labelled according to the month in which the cycle ends.
3. **External payroll:** Sage or configured payroll software remains responsible for gross-to-net calculations, PAYE, UIF, SDL and payslips.
4. **Compliance:** Respect BCEA, PSIRA, POPIA and applicable South African employment legislation.
5. **Security:** Enforce authentication, tenant isolation, RBAC and permissions at the backend level.
6. **Auditability:** Important changes, approvals, exports and AI-assisted actions must be traceable.
7. **Human oversight:** Financial, employment and compliance decisions requiring authorization must retain appropriate approval controls.

## 4. AI & Architecture Principles

- Amazon Bedrock with Kimi 3.1 is Plethora's designated AI foundation.
- Build AI into workflows where it delivers measurable operational value.
- Prioritise intelligent rostering, anomaly detection, operational insights, document understanding, automated reporting and decision support.
- Keep AI integrations modular, secure and reusable.
- Never allow AI-generated outputs to silently modify authoritative business records.
- Protect employee, client and company information through strict tenant isolation and data-access controls.
- Maintain reliable fallbacks when AI services are unavailable.

## 5. Engineering Priorities

Always prioritise:

1. Data integrity
2. Security and privacy
3. Business correctness
4. South African regulatory compliance
5. Reliability
6. Operational efficiency and automation
7. User experience
8. Performance and maintainability

Never sacrifice operational correctness for visual appeal or unnecessary architectural complexity.

## 6. Mandatory Development Workflow

For every engineering task:

1. Understand the business requirement.
2. Inspect the existing architecture, code and database models.
3. Trace the complete UI-to-database workflow.
4. Identify security, AI, data-integrity and downstream impacts.
5. Plan the smallest coherent implementation.
6. Implement using existing repository conventions.
7. Validate permissions, business rules and edge cases.
8. Run relevant tests, builds and type checks.
9. Check for regressions across connected modules.
10. Remove dead code, unused imports and debugging artefacts.
11. Report changes, business impact and verification results.

---

**The ultimate objective:** Build Plethora into South Africa's leading AI-powered operating system for private security companies — a platform that does more than record operations; it intelligently coordinates, automates, monitors and improves them.

---

## 7. Frontend Design System Coherence (§50)
All UI work in `apps/web` must follow [apps/web/DESIGN_SYSTEM.md](../../apps/web/DESIGN_SYSTEM.md):
- Always compose pages and features from `@/components/ui` (`PageShell`, `PageHeader`, `Section`, `KpiStrip`, `Toolbar`, `SearchInput`, `Button`, `Field`, `Input`, `Select`, `Modal`, `Drawer`, `Tabs`, `TableShell`, `StatusBadge`, `AlertBanner`, `EmptyState`).
- Never hand-roll one-off `fixed inset-0` modals, custom status badge color maps, or competing module navigation menus.
- Preserve the single unified Left Sidebar navigation in `DashboardLayout` and the calm Operations Home on `/`.
