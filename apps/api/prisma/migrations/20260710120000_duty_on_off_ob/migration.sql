-- Duty ON / Duty OFF OB workflow: add partial approval status (must be its own migration for PostgreSQL).
ALTER TYPE "SiteTimesheetRowStatus" ADD VALUE IF NOT EXISTS 'partially_reviewed';
