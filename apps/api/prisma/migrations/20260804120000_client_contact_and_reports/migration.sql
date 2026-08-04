-- Client operational contact details and month-end report recipients.
-- Purely additive: nullable columns plus one defaulted array column on Client.
-- No existing column, table, index or constraint is altered or dropped.

-- AlterTable
ALTER TABLE "Client" ADD COLUMN     "contactPersonMobile" TEXT,
ADD COLUMN     "contactPersonName" TEXT,
ADD COLUMN     "contactPersonRole" TEXT,
ADD COLUMN     "notes" TEXT,
ADD COLUMN     "physicalAddress" TEXT,
ADD COLUMN     "reportRecipients" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
