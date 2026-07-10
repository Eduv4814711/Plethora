/**
 * Shared utilities for read-only Plethora data audit scripts.
 * All queries are SELECT-only — safe on any environment.
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";

export const SEVERITY = {
  CRITICAL: "critical",
  HIGH: "high",
  MEDIUM: "medium",
  LOW: "low",
};

/**
 * @typedef {{ id: string; category: string; severity: string; message: string; count?: number; sample?: unknown[] }} AuditFinding
 */

/** @returns {PrismaClient} */
export function createPrisma() {
  if (!process.env.DATABASE_URL?.trim()) {
    throw new Error("DATABASE_URL is not set. Point it at the target Postgres database.");
  }
  return new PrismaClient();
}

/**
 * @param {AuditFinding} finding
 * @returns {AuditFinding}
 */
export function finding(finding) {
  return finding;
}

/**
 * @param {AuditFinding[]} findings
 * @param {{ json?: boolean; category?: string }} opts
 */
export function printFindings(findings, opts = {}) {
  const filtered = opts.category
    ? findings.filter((f) => f.category === opts.category)
    : findings;

  if (opts.json) {
    console.log(JSON.stringify({ findings: filtered, total: filtered.length }, null, 2));
    return;
  }

  if (filtered.length === 0) {
    console.log("  No issues found.");
    return;
  }

  for (const f of filtered) {
    const countStr = f.count != null ? ` (${f.count})` : "";
    console.log(`  [${f.severity.toUpperCase()}] ${f.message}${countStr}`);
    if (f.sample?.length) {
      console.log(`    sample: ${JSON.stringify(f.sample.slice(0, 3))}`);
    }
  }
}

/**
 * @param {AuditFinding[]} findings
 * @returns {number} exit code (critical count)
 */
export function exitCodeFromFindings(findings) {
  return findings.filter((f) => f.severity === SEVERITY.CRITICAL).length > 0 ? 1 : 0;
}

/** Parse company settings JSON for pay period bounds (26–25 defaults). */
export function parsePayPeriodDays(settings) {
  const raw = settings && typeof settings === "object" ? settings : {};
  let startDay = typeof raw.payPeriodStartDay === "number" ? raw.payPeriodStartDay : 26;
  let endDay = typeof raw.payPeriodEndDay === "number" ? raw.payPeriodEndDay : 25;
  if (raw.payrollRunDay != null && raw.payPeriodStartDay == null) {
    const runDay = Number(raw.payrollRunDay);
    endDay = runDay;
    startDay = runDay >= 31 ? 1 : runDay + 1;
  }
  return { startDay, endDay };
}

/** Spanning period length in days for startDay/endDay config (e.g. 26→25 ≈ 31 days). */
export function expectedSpanDays(startDay, endDay) {
  if (startDay > endDay) {
    // crosses month boundary e.g. 26–25
    const daysInStartMonth = 31 - startDay + 1;
    return daysInStartMonth + endDay;
  }
  return endDay - startDay + 1;
}
