# Release runbook — explicit access grants + audit accountability

This release changes **how permissions are evaluated**, so the code change and a
one-time data migration must go out together. Read this before deploying.

## What changes for users

Capability lookup is now exact. A grant on a parent module no longer confers a
sub-module, and route groups that own a module's records require that module:

| Was silently allowed | Now |
|---|---|
| `/settings:view` → read every user and their full grant map | Denied. Needs `/settings/access:view` |
| `/payroll:*` → full Client Billing | Denied. Needs `/payroll/billing:*` |
| `/employees:*` → Leave | Denied. Needs `/employees/leave:*` |
| `/payroll` → Team, Leave | Denied. Needs the module itself |
| `/` (Dashboard), `/sites`, `/reports` → create/edit/delete Incidents | Denied. Needs `/incidents` |
| Team or Site create/export → bulk import/export | Denied. Needs `/settings/migrate` |

`npm run db:expand-grants` writes every one of those previously-implied grants
into `User.capabilities`, so **nobody loses access on deploy**. The point is that
the access then becomes visible and can be trimmed deliberately.

## Order of operations

Steps 1 and 2 must not be separated by a user-facing window — between them, anyone
relying on an implicit grant is locked out.

```bash
# 1. Schema (adds audit columns + indexes; no data change)
npm run db:migrate:deploy --workspace=api

# 2. Data migration — ALWAYS dry-run first and read the output
npm run db:expand-grants --workspace=api -- --dry-run
npm run db:expand-grants --workspace=api

# 3. Deploy the application code
```

`db:expand-grants` runs through `tsx` (a devDependency, same as the existing
`db:seed` and `db:reset-admin`). If your production runtime prunes devDependencies,
run it from a machine that has the repo, with `DATABASE_URL` pointed at production.
That is also the easier way to review the dry-run output before applying.

The script is idempotent: it skips anyone who already has a `user.access.migrated`
audit row. Re-running is a no-op. This matters — without that guard the rules would
cascade on a second pass and grant access nobody ever held.

## Configuration

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `AUDIT_RETENTION_MONTHS` | No | `24` | How long operational audit rows are kept |
| `CRON_SECRET` | Already required | — | Also gates the new retention endpoint |

Optional new scheduled job — safe to add later, nothing breaks without it:

```
POST /internal/cron/audit-retention
Authorization: Bearer $CRON_SECRET
```

Prunes operational audit rows older than the retention window. Rows whose action
starts with `access.`, `auth.`, `user.` or `company.` are never pruned.

No new required environment variables. No breaking API response changes.

## After deploying

1. Sign in and confirm the Audit page shows your `auth.login` entry.
2. Open **Settings → User Access → Export access review** and work through the CSV.
   The expansion preserved yesterday's behaviour rather than guessing, so the
   export is a trim list: revoke anything nobody actually needs. Grants that were
   silently inherited — Client Billing off Payroll especially — are the first to check.
3. Spot-check one non-owner with **View access** and confirm it matches expectation.

## Rollback

Rolling the code back is safe on its own: the expanded grants are a superset of
what the old prefix-matching behaviour would have computed, so the previous code
keeps working against the new data. The schema migration is additive (new nullable
columns plus indexes) and does not need reverting.

To undo the grant expansion itself, the pre-change map for each affected user is in
the `metadata.before` field of their `user.access.migrated` audit row.

## Known pre-existing issues (not introduced here)

- **Migration history drift.** Several migrations exist in the database but not in
  `prisma/migrations` (`20260710140000_user_permissions_rbac`,
  `20260715190000_audit_readiness_foundation`, and others). `migrate deploy` applies
  pending migrations regardless, but the histories should be reconciled.
- **Orphaned `AuditLog` columns** from that abandoned design: `beforeState`,
  `afterState`, `eventHash`, `previousHash`, `riskLevel`, `sessionId`, `source`,
  `result`, `reason`. Prisma ignores them and writes succeed. Note that `result`
  overlaps conceptually with the `outcome` column this release adds — worth a
  cleanup migration eventually.
- **Company deletion still erases its audit trail** (`AuditLog.companyId` cascades).
  Export the audit log and access review before deleting any company.
