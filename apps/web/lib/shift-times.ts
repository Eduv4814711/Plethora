export const SHIFT_TIME_MORNING = "06:00";
export const SHIFT_TIME_EVENING = "18:00";

export const SHIFT_TIME_OPTIONS = [
  { value: SHIFT_TIME_MORNING, label: "6:00" },
  { value: SHIFT_TIME_EVENING, label: "18:00" },
] as const;

export type ShiftTimeValue = (typeof SHIFT_TIME_OPTIONS)[number]["value"];

export function timeValueFromIso(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** Snap any HH:mm value to the allowed shift boundary (6:00 or 18:00). */
export function normalizeShiftTime(time: string | null | undefined): ShiftTimeValue | "" {
  if (!time) return "";
  const hour = Number.parseInt(time.split(":")[0] ?? "", 10);
  if (Number.isNaN(hour)) return "";
  return hour < 12 ? SHIFT_TIME_MORNING : SHIFT_TIME_EVENING;
}

/** Day 06:00–18:00, night 18:00–06:00 — matches site shift defaults. */
export function defaultShiftTime(shiftType: "day" | "night" | null, which: "start" | "end"): string {
  if (shiftType === "night") return which === "start" ? SHIFT_TIME_EVENING : SHIFT_TIME_MORNING;
  if (shiftType === "day") return which === "start" ? SHIFT_TIME_MORNING : SHIFT_TIME_EVENING;
  return "";
}

export function displayShiftTime(
  iso: string | null | undefined,
  shiftType: "day" | "night" | null,
  which: "start" | "end"
): string {
  const stored = normalizeShiftTime(timeValueFromIso(iso));
  if (stored) return stored;
  return defaultShiftTime(shiftType, which);
}
