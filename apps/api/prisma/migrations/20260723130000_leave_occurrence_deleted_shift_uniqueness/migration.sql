-- Roster-backed leave occurrences retain siteId when their source shift is
-- deleted. Limit NULL-shift uniqueness to genuinely unrostered occurrences so
-- deleting multiple source shifts from the same leave day cannot collide.
DROP INDEX IF EXISTS "LeaveOccurrence_applicationId_leaveDate_unrostered_key";

CREATE UNIQUE INDEX "LeaveOccurrence_applicationId_leaveDate_unrostered_key"
  ON "LeaveOccurrence"("applicationId", "leaveDate")
  WHERE "shiftId" IS NULL AND "siteId" IS NULL;
