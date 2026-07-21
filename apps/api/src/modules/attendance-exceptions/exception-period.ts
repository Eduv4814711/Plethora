const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function parseDateOnly(value: string): Date | null {
  if (!DATE_ONLY_PATTERN.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    return null;
  }
  return parsed;
}

export function isValidExceptionPeriodValue(value: string): boolean {
  if (DATE_ONLY_PATTERN.test(value)) return parseDateOnly(value) !== null;
  return !Number.isNaN(new Date(value).getTime());
}

/**
 * Date-only filters represent calendar-day boundaries. In particular, an end
 * value such as 2026-07-31 must include records throughout that final day.
 * Explicit timestamps retain their exact instant.
 */
export function parseExceptionPeriodBoundary(
  value: string,
  boundary: "start" | "end"
): Date {
  const dateOnly = parseDateOnly(value);
  if (dateOnly) {
    if (boundary === "end") dateOnly.setUTCHours(23, 59, 59, 999);
    return dateOnly;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new RangeError(`Invalid attendance exception ${boundary} date`);
  }
  return parsed;
}
