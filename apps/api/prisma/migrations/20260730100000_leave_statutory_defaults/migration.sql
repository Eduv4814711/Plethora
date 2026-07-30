-- Statutory rule engine support.
--
-- Two capabilities the BCEA needs that the policy model could not express:
--
--   1. the s20(2)(b) / s22(2) ratio methods, which grant one day of leave for
--      every N days worked (17 for annual, 26 for sick) rather than a flat
--      cycle amount; and
--   2. per-type control over whether a public holiday inside a leave period
--      draws down the balance. It should not: s21(3) excludes public holidays
--      from annual leave, and an employee cannot be sick on a day they were
--      never due to work.
BEGIN;

ALTER TABLE "LeavePolicyVersion" ADD COLUMN "accrualRatioDays" INTEGER;

ALTER TABLE "LeavePolicyVersion"
  ADD CONSTRAINT "LeavePolicyVersion_positive_accrual_ratio"
  CHECK ("accrualRatioDays" IS NULL OR "accrualRatioDays" > 0);

ALTER TABLE "LeaveTypeDefinition"
  ADD COLUMN "publicHolidayConsumesBalance" BOOLEAN NOT NULL DEFAULT false;

COMMIT;
