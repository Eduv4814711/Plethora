-- Freeze the payroll frequency on each run so a later settings change cannot
-- silently alter salary proration or statutory annualisation.
BEGIN;

ALTER TABLE "PayrollRun"
ADD COLUMN IF NOT EXISTS "payPeriod" TEXT NOT NULL DEFAULT 'monthly';

UPDATE "PayrollRun" AS run
SET "payPeriod" = CASE
  WHEN company."settings"->>'payrollPeriod' IN ('weekly', 'biweekly', 'monthly')
    THEN company."settings"->>'payrollPeriod'
  ELSE 'monthly'
END
FROM "Company" AS company
WHERE company."id" = run."companyId";

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'PayrollRun_payPeriod_check'
  ) THEN
    ALTER TABLE "PayrollRun"
    ADD CONSTRAINT "PayrollRun_payPeriod_check"
    CHECK ("payPeriod" IN ('weekly', 'biweekly', 'monthly'));
  END IF;
END
$$;

-- A run may contain at most one frozen payroll item for an employee. The
-- calculation transaction rebuilds items atomically and its lifecycle CAS
-- prevents concurrent calculations from replacing one another.
CREATE UNIQUE INDEX IF NOT EXISTS "PayrollItem_payrollRunId_employeeId_key"
ON "PayrollItem"("payrollRunId", "employeeId");

COMMIT;
