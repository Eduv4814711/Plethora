-- Payroll calculation traceability: frozen inputs/rules/outputs at calculate time
ALTER TABLE "PayrollRun" ADD COLUMN "calculatedAt" TIMESTAMP(3);
ALTER TABLE "PayrollRun" ADD COLUMN "calculationSnapshot" JSONB;
