-- Weekdays each shift needs cover, as JS day-of-week numbers (0=Sunday … 6=Saturday).
-- Existing sites keep today's behaviour: full seven-day cover.
ALTER TABLE "Site"
  ADD COLUMN "rosterDayShiftDays" INTEGER[] NOT NULL DEFAULT ARRAY[0, 1, 2, 3, 4, 5, 6],
  ADD COLUMN "rosterNightShiftDays" INTEGER[] NOT NULL DEFAULT ARRAY[0, 1, 2, 3, 4, 5, 6];
