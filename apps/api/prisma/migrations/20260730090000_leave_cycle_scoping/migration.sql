-- Cycle scoping for the leave ledger.
--
-- BCEA entitlement is granted per cycle, not as one running total: annual leave
-- is forfeited six months after its cycle ends (s20(4)), sick leave resets on
-- the 36-month boundary (s22), and termination pays only the current and
-- immediately preceding cycles (s40). None of that is computable while every
-- movement sits in one undifferentiated sum, so each ledger row now records the
-- cycle that funded it.
BEGIN;

-- Stamp on the entitlement cycle. NULL means "written before cycle scoping" --
-- the allocator falls back to the cycle containing the effective date, so old
-- rows keep reconciling without a rewrite.
ALTER TABLE "LeaveLedgerEntry" ADD COLUMN "cycleKey" TEXT;

CREATE INDEX "LeaveLedgerEntry_cycle_idx"
  ON "LeaveLedgerEntry" ("companyId", "employeeId", "leaveTypeId", "cycleKey");

-- Per-company switch for the statutory engine. Cycle scoping and automatic
-- forfeiture change what an existing tenant's balances say, so each company is
-- cut over on an agreed date instead of retroactively.
CREATE TABLE "LeaveCompanySettings" (
    "companyId" TEXT NOT NULL,
    "statutoryEngineEnabledFrom" DATE,
    "defaultGraceMonths" INTEGER NOT NULL DEFAULT 6,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeaveCompanySettings_pkey" PRIMARY KEY ("companyId")
);

ALTER TABLE "LeaveCompanySettings" ADD CONSTRAINT "LeaveCompanySettings_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "LeaveCompanySettings"
  ADD CONSTRAINT "LeaveCompanySettings_grace_months_range"
  CHECK ("defaultGraceMonths" >= 0 AND "defaultGraceMonths" <= 24);

-- Policy assignments become per-leave-type.
--
-- The old exclusion constraint allowed exactly one policy per employee per
-- date, which made it impossible to put an employee on a sector annual-leave
-- policy while leaving their sick leave on the statutory baseline. A NULL
-- leaveTypeId still means "every type"; a value narrows the assignment to one
-- type and wins over the company-wide row for that type.
ALTER TABLE "EmployeeLeavePolicyAssignment" ADD COLUMN "leaveTypeId" TEXT;

ALTER TABLE "EmployeeLeavePolicyAssignment" ADD CONSTRAINT "EmployeeLeavePolicyAssignment_leaveTypeId_fkey" FOREIGN KEY ("leaveTypeId") REFERENCES "LeaveTypeDefinition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "EmployeeLeavePolicyAssignment_leaveTypeId_idx" ON "EmployeeLeavePolicyAssignment"("leaveTypeId");

-- Drop the old three-column unique by its column signature rather than by name.
-- Prisma truncates generated index names to 63 characters, so the name differs
-- between environments depending on when the index was created; matching on the
-- columns is the only reliable way to find it.
DO $$
DECLARE
  target text;
BEGIN
  FOR target IN
    SELECT i.relname
    FROM pg_index x
    JOIN pg_class i ON i.oid = x.indexrelid
    JOIN pg_class t ON t.oid = x.indrelid
    WHERE t.relname = 'EmployeeLeavePolicyAssignment'
      AND x.indisunique
      AND NOT x.indisprimary
      AND (
        -- attname is `name`, which has no equality operator against text[].
        SELECT array_agg(a.attname::text ORDER BY a.attname::text)
        FROM unnest(x.indkey) AS k(attnum)
        JOIN pg_attribute a ON a.attrelid = x.indrelid AND a.attnum = k.attnum
      ) = ARRAY['effectiveFrom', 'employeeId', 'policyId']
  LOOP
    -- The index may be backed by a UNIQUE constraint, which must be dropped
    -- through the constraint rather than the index.
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = target) THEN
      EXECUTE format('ALTER TABLE "EmployeeLeavePolicyAssignment" DROP CONSTRAINT %I', target);
    ELSE
      EXECUTE format('DROP INDEX %I', target);
    END IF;
  END LOOP;
END $$;

CREATE UNIQUE INDEX "EmployeeLeavePolicyAssignment_scope_effective_key"
  ON "EmployeeLeavePolicyAssignment"("employeeId", "policyId", "leaveTypeId", "effectiveFrom");

-- Overlap is now scoped to the leave type. COALESCE keeps NULL (all types) in
-- its own bucket, so a type-specific assignment can coexist with a broad one
-- and the application layer resolves the most specific match.
ALTER TABLE "EmployeeLeavePolicyAssignment"
  DROP CONSTRAINT IF EXISTS "EmployeeLeavePolicyAssignment_no_overlap";

ALTER TABLE "EmployeeLeavePolicyAssignment"
  ADD CONSTRAINT "EmployeeLeavePolicyAssignment_no_overlap"
  EXCLUDE USING gist (
    "employeeId" WITH =,
    (COALESCE("leaveTypeId", '')) WITH =,
    daterange("effectiveFrom", COALESCE("effectiveTo", 'infinity'::date), '[]') WITH &&
  );

COMMIT;
