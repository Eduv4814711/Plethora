import { describe, expect, it } from "vitest";
import {
  bucketFormat,
  bucketKey,
  enumerateBuckets,
  resolveDashboardWindow,
} from "../dashboard-window.js";

const SAST = "Africa/Johannesburg"; // UTC+2, no DST
const NY = "America/New_York"; // UTC-4/-5, has DST

describe("resolveDashboardWindow", () => {
  it("falls back to month for missing or unrecognised input", () => {
    const now = new Date("2026-07-15T09:00:00Z");
    expect(resolveDashboardWindow(undefined, now, SAST).range).toBe("month");
    expect(resolveDashboardWindow("", now, SAST).range).toBe("month");
    expect(resolveDashboardWindow("quarter", now, SAST).range).toBe("month");
    expect(resolveDashboardWindow("YEAR", now, SAST).range).toBe("month");
  });

  it("accepts each supported range", () => {
    const now = new Date("2026-07-15T09:00:00Z");
    expect(resolveDashboardWindow("today", now, SAST).range).toBe("today");
    expect(resolveDashboardWindow("week", now, SAST).range).toBe("week");
    expect(resolveDashboardWindow("month", now, SAST).range).toBe("month");
  });

  it("anchors 'today' to local midnight, not UTC midnight", () => {
    // 00:30 UTC on the 16th is 02:30 on the 16th in SAST — same calendar day.
    const w = resolveDashboardWindow("today", new Date("2026-07-16T00:30:00Z"), SAST);
    expect(w.start.toISOString()).toBe("2026-07-15T22:00:00.000Z");
    expect(w.end.toISOString()).toBe("2026-07-16T22:00:00.000Z");
  });

  it("uses the company's calendar day when UTC has already rolled over", () => {
    // 23:30 UTC on the 15th is already 01:30 on the 16th in SAST.
    const w = resolveDashboardWindow("today", new Date("2026-07-15T23:30:00Z"), SAST);
    expect(w.start.toISOString()).toBe("2026-07-15T22:00:00.000Z");

    // The same instant is still the 15th in New York, so the window differs.
    const nyWindow = resolveDashboardWindow("today", new Date("2026-07-15T23:30:00Z"), NY);
    expect(nyWindow.start.toISOString()).toBe("2026-07-15T04:00:00.000Z");
  });

  it("starts the week on Monday", () => {
    // 2026-07-15 is a Wednesday; the week starts Monday 2026-07-13.
    const w = resolveDashboardWindow("week", new Date("2026-07-15T09:00:00Z"), SAST);
    expect(w.start.toISOString()).toBe("2026-07-12T22:00:00.000Z"); // local 07-13 00:00
    expect(w.end.toISOString()).toBe("2026-07-19T22:00:00.000Z"); // local 07-20 00:00
  });

  it("treats Sunday as the last day of the week, not the first", () => {
    // 2026-07-19 is a Sunday; it must still fall in the week starting 07-13.
    const w = resolveDashboardWindow("week", new Date("2026-07-19T09:00:00Z"), SAST);
    expect(w.start.toISOString()).toBe("2026-07-12T22:00:00.000Z");
  });

  it("spans the current calendar month and rolls the year at December", () => {
    const july = resolveDashboardWindow("month", new Date("2026-07-15T09:00:00Z"), SAST);
    expect(july.start.toISOString()).toBe("2026-06-30T22:00:00.000Z"); // local 07-01
    expect(july.end.toISOString()).toBe("2026-07-31T22:00:00.000Z"); // local 08-01

    const december = resolveDashboardWindow("month", new Date("2026-12-10T09:00:00Z"), SAST);
    expect(december.end.toISOString()).toBe("2026-12-31T22:00:00.000Z"); // local 2027-01-01
  });

  it("picks an hourly bucket only for 'today'", () => {
    const now = new Date("2026-07-15T09:00:00Z");
    expect(resolveDashboardWindow("today", now, SAST).bucket).toBe("hour");
    expect(resolveDashboardWindow("week", now, SAST).bucket).toBe("day");
    expect(resolveDashboardWindow("month", now, SAST).bucket).toBe("day");
  });
});

describe("enumerateBuckets", () => {
  it("emits 24 hourly buckets labelled in company-local time for 'today'", () => {
    const w = resolveDashboardWindow("today", new Date("2026-07-15T09:00:00Z"), SAST);
    const buckets = enumerateBuckets(w, SAST);
    expect(buckets).toHaveLength(24);
    expect(buckets[0].label).toBe("00:00");
    expect(buckets[23].label).toBe("23:00");
    expect(buckets[0].key).toBe("2026-07-15 00");
  });

  it("emits Mon–Sun for 'week'", () => {
    const w = resolveDashboardWindow("week", new Date("2026-07-15T09:00:00Z"), SAST);
    const buckets = enumerateBuckets(w, SAST);
    expect(buckets).toHaveLength(7);
    expect(buckets.map((b) => b.label)).toEqual([
      "Mon",
      "Tue",
      "Wed",
      "Thu",
      "Fri",
      "Sat",
      "Sun",
    ]);
    expect(buckets[0].key).toBe("2026-07-13");
  });

  it("emits one bucket per day of the month, labelled by day number", () => {
    const w = resolveDashboardWindow("month", new Date("2026-07-15T09:00:00Z"), SAST);
    const buckets = enumerateBuckets(w, SAST);
    expect(buckets).toHaveLength(31); // July
    expect(buckets[0].label).toBe("1");
    expect(buckets[30].label).toBe("31");
  });

  it("produces keys matching the Postgres to_char pattern it advertises", () => {
    expect(bucketFormat("day")).toBe("YYYY-MM-DD");
    expect(bucketFormat("hour")).toBe("YYYY-MM-DD HH24");

    const instant = new Date("2026-07-15T12:30:00Z"); // 14:30 SAST
    expect(bucketKey(instant, SAST, "day")).toBe("2026-07-15");
    expect(bucketKey(instant, SAST, "hour")).toBe("2026-07-15 14");
  });
});
