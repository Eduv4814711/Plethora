#!/usr/bin/env node
/**
 * Pre-migration cleanup for 20260709180000_attendance_uniqueness.
 *
 * Detects and removes duplicate Attendance (per shiftId) and SiteTimesheetRow
 * (per siteTimesheetId + workDate + plannedGuardId + plannedShiftType) records.
 *
 * Usage:
 *   node scripts/cleanup-attendance-duplicates.mjs --dry-run
 *   node scripts/cleanup-attendance-duplicates.mjs --apply
 *
 * Requires DATABASE_URL in apps/api/.env or environment.
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const dryRun = !process.argv.includes("--apply");

function attendanceScore(row) {
  let score = 0;
  if (row.clockIn) score += 4;
  if (row.clockOut) score += 4;
  if (row.hoursWorked != null) score += 2;
  if (row.status && row.status !== "pending") score += 1;
  return score;
}

function rowScore(row) {
  const approvalRank = { approved: 4, reviewed: 3, pending: 1 };
  let score = approvalRank[row.approvalStatus] ?? 0;
  if (row.occurrenceBookNumber) score += 2;
  if (row.actualGuardId) score += 1;
  if (row.attendanceStatus && row.attendanceStatus !== "pending") score += 1;
  if (row.clockIn) score += 1;
  if (row.clockOut) score += 1;
  return score;
}

function pickKeeper(rows, scoreFn) {
  return [...rows].sort((a, b) => {
    const diff = scoreFn(b) - scoreFn(a);
    if (diff !== 0) return diff;
    return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
  })[0];
}

async function findAttendanceDuplicates() {
  const rows = await prisma.attendance.findMany({
    select: {
      id: true,
      shiftId: true,
      clockIn: true,
      clockOut: true,
      hoursWorked: true,
      status: true,
      updatedAt: true,
    },
    orderBy: { updatedAt: "desc" },
  });
  const byShift = new Map();
  for (const row of rows) {
    const list = byShift.get(row.shiftId) ?? [];
    list.push(row);
    byShift.set(row.shiftId, list);
  }
  const groups = [];
  for (const [shiftId, list] of byShift) {
    if (list.length > 1) groups.push({ shiftId, rows: list });
  }
  return groups;
}

async function findTimesheetRowDuplicates() {
  const rows = await prisma.siteTimesheetRow.findMany({
    where: { plannedGuardId: { not: null } },
    select: {
      id: true,
      siteTimesheetId: true,
      workDate: true,
      plannedGuardId: true,
      plannedShiftType: true,
      approvalStatus: true,
      occurrenceBookNumber: true,
      actualGuardId: true,
      attendanceStatus: true,
      clockIn: true,
      clockOut: true,
      updatedAt: true,
    },
    orderBy: { updatedAt: "desc" },
  });
  const key = (r) =>
    `${r.siteTimesheetId}|${r.workDate.toISOString().slice(0, 10)}|${r.plannedGuardId}|${r.plannedShiftType ?? ""}`;
  const byKey = new Map();
  for (const row of rows) {
    const k = key(row);
    const list = byKey.get(k) ?? [];
    list.push(row);
    byKey.set(k, list);
  }
  const groups = [];
  for (const [groupKey, list] of byKey) {
    if (list.length > 1) groups.push({ groupKey, rows: list });
  }
  return groups;
}

async function main() {
  console.log(dryRun ? "DRY RUN — no deletes" : "APPLY — deleting duplicate rows");

  const attendanceGroups = await findAttendanceDuplicates();
  console.log(`\nAttendance duplicate groups: ${attendanceGroups.length}`);
  let attendanceDeletes = 0;
  for (const group of attendanceGroups) {
    const keeper = pickKeeper(group.rows, attendanceScore);
    const toDelete = group.rows.filter((r) => r.id !== keeper.id);
    console.log(
      `  shiftId=${group.shiftId}: keep ${keeper.id}, delete ${toDelete.map((r) => r.id).join(", ")}`
    );
    attendanceDeletes += toDelete.length;
    if (!dryRun) {
      await prisma.attendance.deleteMany({ where: { id: { in: toDelete.map((r) => r.id) } } });
    }
  }

  const rowGroups = await findTimesheetRowDuplicates();
  console.log(`\nSiteTimesheetRow duplicate groups: ${rowGroups.length}`);
  let rowDeletes = 0;
  for (const group of rowGroups) {
    const keeper = pickKeeper(group.rows, rowScore);
    const toDelete = group.rows.filter((r) => r.id !== keeper.id);
    console.log(
      `  ${group.groupKey}: keep ${keeper.id}, delete ${toDelete.map((r) => r.id).join(", ")}`
    );
    rowDeletes += toDelete.length;
    if (!dryRun) {
      await prisma.siteTimesheetRow.deleteMany({
        where: { id: { in: toDelete.map((r) => r.id) } },
      });
    }
  }

  console.log(`\nSummary: ${attendanceDeletes} attendance + ${rowDeletes} timesheet rows ${dryRun ? "would be" : ""} deleted`);
  if (dryRun && (attendanceDeletes > 0 || rowDeletes > 0)) {
    console.log("Re-run with --apply to execute cleanup.");
    process.exitCode = 2;
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
