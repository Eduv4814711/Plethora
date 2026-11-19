## Summary
<!-- Describe what this PR changes and where it fits in the Plethora operational chain. -->

## 11-Step Antigravity & Core Invariants Checklist
- [ ] **Roster vs. Attendance**: Payroll continues to derive strictly from approved actual attendance, never scheduled shifts alone.
- [ ] **26th-25th Roster Cycle**: Any rostering/payroll period logic preserves the 26th-25th cycle invariant.
- [ ] **Tenant Isolation**: Every DB query, S3 key, and WhatsApp/AI handler is strictly scoped by `companyId`.
- [ ] **Database Migrations**: Any schema change uses `prisma migrate dev` (no `db:push`), is transaction-safe, and is backward-compatible with running EC2 instances.
- [ ] **Tests & Builds Verified Locally**: `npm test` and `npm run build` pass locally.
- [ ] **Secrets & AWS Safety**: No secrets, tokens, or credentials committed; runtime secrets live in AWS Secrets Manager.
