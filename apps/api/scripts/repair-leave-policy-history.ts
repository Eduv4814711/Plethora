/**
 * Repair leave policy history so past leave can still be approved.
 *
 * Two faults are fixed, both of which block approval of leave dated before the
 * current policy version:
 *
 *   1. **Unconfigurable active placeholders.** The original seed wrote a
 *      version 1 with no entitlement and a `POLICY_CONFIRMATION_REQUIRED`
 *      accrual method. Where that row was left ACTIVE it governs every
 *      historical leave date and can never satisfy the configuration check, so
 *      no leave in that period can be approved. Repeated "configure and
 *      confirm" clicks also leave behind one-day versions that serve no
 *      purpose.
 *
 *   2. **No active policy before the current version.** Superseding a version
 *      leaves earlier dates governed by whatever preceded it. Collapsing to a
 *      single statutory version that reaches back over the whole history gives
 *      every date one clear, compliant policy.
 *
 * Superseded versions are retained as RETIRED rather than deleted, so the
 * provenance of every historical decision survives.
 *
 * It also back-fills `cycleKey` on existing ledger entries. Accruals written
 * before cycle scoping carry no cycle, so the pro-rata accrual runner would not
 * count them towards the cycle total and would grant the entitlement a second
 * time. Stamping them closes that hole.
 *
 * Usage:
 *   npx tsx scripts/repair-leave-policy-history.ts
 *   npx tsx scripts/repair-leave-policy-history.ts --apply
 */

import "dotenv/config";
import { prisma } from "../src/lib/prisma.js";
import { STATUTORY_LEAVE_RULES } from "../src/services/leave-statutory-rules.js";
import { leavePolicyConfigurationIssues } from "../src/services/leave-policy.service.js";
import { resolveEmploymentAnchors, resolveGraceMonths } from "../src/services/leave-cycle-context.service.js";
import { resolveLeaveCycle } from "../src/lib/leave-cycles.js";

const apply = process.argv.includes("--apply");
const STATUTORY_DEFAULT_AUTHORITY = "BCEA_STATUTORY_DEFAULT";
const key = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : "open");

async function main() {
  const policies = await prisma.leavePolicy.findMany({
    where: { category: "STATUTORY_BASELINE" },
    include: { versions: { include: { leaveType: true } } },
  });

  let retired = 0;
  let extended = 0;

  for (const policy of policies) {
    console.log(`\nCompany ${policy.companyId}`);
    console.log("-".repeat(88));

    const typeIds = [...new Set(policy.versions.map((v) => v.leaveTypeId))];
    for (const leaveTypeId of typeIds) {
      const versions = policy.versions
        .filter((v) => v.leaveTypeId === leaveTypeId)
        .sort((a, b) => a.version - b.version);
      const leaveType = versions[0]?.leaveType;
      const code = leaveType?.code;
      if (!code || !leaveType) continue;

      // Keep the newest active version that is actually executable. A version
      // can become invalid without being edited — converting a leave type to
      // non-balance leaves its older balance-based versions unusable — so the
      // configuration check, not the authority label, decides what survives.
      const usable = versions.filter(
        (v) =>
          v.reviewStatus === "ACTIVE" &&
          leavePolicyConfigurationIssues({ ...v, leaveType }).length === 0
      );
      const keep =
        [...usable].reverse().find((v) => v.sourceAuthority === STATUTORY_DEFAULT_AUTHORITY) ??
        usable[usable.length - 1];
      if (!keep) {
        const reason = STATUTORY_LEAVE_RULES[code]
          ? "run configure-sa-leave-policies first"
          : "no executable active version exists";
        console.log(`  ${code.padEnd(24)} skipped — ${reason}`);
        continue;
      }

      const supersede = versions.filter(
        (v) => v.id !== keep.id && v.reviewStatus === "ACTIVE"
      );
      const earliest = versions.reduce(
        (min, v) => (v.effectiveFrom < min ? v.effectiveFrom : min),
        keep.effectiveFrom
      );
      const needsExtension = keep.effectiveFrom > earliest;

      if (supersede.length === 0 && !needsExtension) {
        console.log(`  ${code.padEnd(24)} already clean`);
        continue;
      }

      console.log(
        `  ${code.padEnd(24)} keep v${keep.version} (${key(keep.effectiveFrom)} -> ${key(keep.effectiveTo)})` +
          `${needsExtension ? `, extend back to ${key(earliest)}` : ""}` +
          `${supersede.length ? `, retire v${supersede.map((v) => v.version).join(", v")}` : ""}`
      );
      retired += supersede.length;
      if (needsExtension) extended += 1;
      if (!apply) continue;

      await prisma.$transaction(async (tx) => {
        // Retire first: the active-overlap exclusion constraint would reject
        // the widened range while the old versions are still ACTIVE.
        if (supersede.length > 0) {
          await tx.leavePolicyVersion.updateMany({
            where: { id: { in: supersede.map((v) => v.id) } },
            data: { reviewStatus: "RETIRED" },
          });
        }
        if (needsExtension) {
          await tx.leavePolicyVersion.update({
            where: { id: keep.id },
            data: { effectiveFrom: earliest },
          });
        }
        await tx.leaveAuditEvent.create({
          data: {
            companyId: policy.companyId,
            eventType: "POLICY_HISTORY_REPAIRED",
            reason: `Collapsed ${code} to a single statutory version covering the full history`,
            previousValue: {
              retiredVersions: supersede.map((v) => v.version),
              keptEffectiveFrom: key(keep.effectiveFrom),
            },
            newValue: { keptVersion: keep.version, effectiveFrom: key(earliest) },
          },
        });
      });
    }
  }

  const stamped = await backfillCycleKeys();

  console.log("\n" + "=".repeat(88));
  console.log(
    `${retired} version(s) to retire, ${extended} to extend, ${stamped} ledger entr(ies) to stamp with a cycle.`
  );
  if (!apply) console.log("Dry run. Re-run with --apply to write.");
}

/**
 * Stamp `cycleKey` onto ledger entries written before cycle scoping existed.
 *
 * Without this the pro-rata accrual runner sees no minutes recorded against the
 * cycle and grants the whole entitlement again on top of what is already there.
 */
async function backfillCycleKeys(): Promise<number> {
  const entries = await prisma.leaveLedgerEntry.findMany({
    where: { cycleKey: null },
    select: {
      id: true,
      companyId: true,
      employeeId: true,
      leaveTypeId: true,
      effectiveDate: true,
    },
  });
  if (entries.length === 0) return 0;

  const byCompany = new Map<string, typeof entries>();
  for (const entry of entries) {
    byCompany.set(entry.companyId, [...(byCompany.get(entry.companyId) ?? []), entry]);
  }

  let stamped = 0;
  for (const [companyId, companyEntries] of byCompany) {
    const employeeIds = [...new Set(companyEntries.map((e) => e.employeeId))];
    const anchors = await resolveEmploymentAnchors(companyId, employeeIds);
    const leaveTypes = await prisma.leaveTypeDefinition.findMany({
      where: { companyId, id: { in: [...new Set(companyEntries.map((e) => e.leaveTypeId))] } },
      select: { id: true, code: true },
    });
    const typeById = new Map(leaveTypes.map((t) => [t.id, t]));

    // One active version per leave type after the repair above.
    const versions = await prisma.leavePolicyVersion.findMany({
      where: { companyId, reviewStatus: "ACTIVE" },
      select: { leaveTypeId: true, cycleMonths: true, expiryMonths: true },
    });
    const versionByType = new Map(versions.map((v) => [v.leaveTypeId, v]));

    for (const entry of companyEntries) {
      const anchor = anchors.get(entry.employeeId);
      const type = typeById.get(entry.leaveTypeId);
      const version = versionByType.get(entry.leaveTypeId);
      if (!anchor || !type || !version || version.cycleMonths <= 0) continue;

      const cycle = resolveLeaveCycle(
        {
          leaveTypeCode: type.code,
          anchor,
          cycleMonths: version.cycleMonths,
          graceMonths: resolveGraceMonths({
            leaveTypeCode: type.code,
            expiryMonths: version.expiryMonths,
          }),
        },
        entry.effectiveDate
      );
      stamped += 1;
      if (!apply) continue;
      await prisma.leaveLedgerEntry.update({
        where: { id: entry.id },
        data: { cycleKey: cycle.cycleKey },
      });
    }
  }
  return stamped;
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
