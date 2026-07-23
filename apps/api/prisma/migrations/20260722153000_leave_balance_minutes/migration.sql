ALTER TABLE "LeaveOccurrence"
  ADD COLUMN "balanceMinutes" INTEGER NOT NULL DEFAULT 0;

-- Existing authoritative occurrences predate the distinction between absence
-- duration and balance consumption. Preserve their current ledger semantics.
UPDATE "LeaveOccurrence" AS occurrence
SET "balanceMinutes" = CASE
  WHEN leave_type."requiresBalance" THEN occurrence."requestedMinutes"
  ELSE 0
END
FROM "LeaveApplication" AS application,
     "LeaveTypeDefinition" AS leave_type
WHERE application."id" = occurrence."applicationId"
  AND leave_type."id" = application."leaveTypeId";

ALTER TABLE "LeaveOccurrence"
  ADD CONSTRAINT "LeaveOccurrence_balance_minutes_within_request" CHECK (
    "balanceMinutes" >= 0 AND "balanceMinutes" <= "requestedMinutes"
  );
