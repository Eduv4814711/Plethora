import { z } from "zod";

const dateKey = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Date must use YYYY-MM-DD")
  .refine((val) => {
    const parsed = new Date(`${val}T00:00:00.000Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === val;
  }, "Date must be a valid calendar date");
const timeOfDay = z
  .string()
  .regex(/^([01]\d|2[0-3]):([0-5]\d)$/, "Time must use HH:mm (00:00–23:59)")
  .nullish();

export const staffAttendanceStatusSchema = z.enum([
  "present",
  "absent",
  "leave",
  "sick_leave",
  "public_holiday",
  "off",
]);

export const staffAttendanceDayQuerySchema = z
  .object({
    date: dateKey,
    q: z.string().trim().max(120).optional(),
  })
  .strict();

const entryShape = {
  employeeId: z.string().min(1),
  status: staffAttendanceStatusSchema,
  timeIn: timeOfDay,
  timeOut: timeOfDay,
  notes: z.string().trim().max(500).nullish(),
};

export const setStaffAttendanceDaySchema = z
  .object({ date: dateKey, ...entryShape })
  .strict();

export const bulkSetStaffAttendanceDaySchema = z
  .object({
    date: dateKey,
    entries: z.array(z.object(entryShape).strict()).min(1).max(500),
  })
  .strict();
