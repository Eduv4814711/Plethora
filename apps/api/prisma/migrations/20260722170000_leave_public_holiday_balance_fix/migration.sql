-- Annual leave that falls on a configured public holiday remains payable and
-- roster-relevant, but it must not consume the employee's annual balance.
UPDATE "LeaveOccurrence" occurrence
SET "balanceMinutes" = 0
FROM "LeaveApplication" application
JOIN "LeaveTypeDefinition" leave_type
  ON leave_type."id" = application."leaveTypeId"
WHERE occurrence."applicationId" = application."id"
  AND leave_type."code" = 'annual'
  AND EXISTS (
    SELECT 1
    FROM "PublicHoliday" holiday
    WHERE holiday."companyId" = occurrence."companyId"
      AND holiday."date" = occurrence."leaveDate"
  );
