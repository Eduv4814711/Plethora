-- Apply SARS PAYE schema changes manually
-- Run with: psql -U postgres -d plethora -f prisma/apply-sars-paye-columns.sql
-- Or execute in your PostgreSQL client

-- Company: add PAYE/SDL tracking columns
ALTER TABLE "Company" ADD COLUMN IF NOT EXISTS "payeReference" TEXT;
ALTER TABLE "Company" ADD COLUMN IF NOT EXISTS "sdlReference" TEXT;
ALTER TABLE "Company" ADD COLUMN IF NOT EXISTS "sdlLiableFrom" TIMESTAMP(3);
ALTER TABLE "Company" ADD COLUMN IF NOT EXISTS "monthlyPayrollTotals" JSONB;

-- Payslip: add tax fields
ALTER TABLE "Payslip" ADD COLUMN IF NOT EXISTS "tax" DECIMAL(12,2);
ALTER TABLE "Payslip" ADD COLUMN IF NOT EXISTS "taxableEarnings" DECIMAL(12,2);
ALTER TABLE "Payslip" ADD COLUMN IF NOT EXISTS "uifEmployee" DECIMAL(12,2);
ALTER TABLE "Payslip" ADD COLUMN IF NOT EXISTS "uifEmployer" DECIMAL(12,2);
ALTER TABLE "Payslip" ADD COLUMN IF NOT EXISTS "sdl" DECIMAL(12,2);
