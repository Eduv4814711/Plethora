-- Add reliever employment status for guards who primarily cover relief shifts
ALTER TYPE "EmployeeStatus" ADD VALUE IF NOT EXISTS 'reliever';
