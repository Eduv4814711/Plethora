-- Adds only User.moduleAccess (JSONB). Use when `prisma db push` fails because duplicate
-- emails block adding the email @unique constraint — this script does not touch email.
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "moduleAccess" JSONB;
