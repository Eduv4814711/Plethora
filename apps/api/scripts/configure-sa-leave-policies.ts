/**
 * Configure a company's leave policies to South African law.
 *
 * Sources encoded here, which agree with each other:
 *   - BCEA ss20, 22, 23, 25-25C, 27, 40
 *   - Sectoral Determination 6 (Private Security Sector), clauses 9-12 and 19
 *
 * Both instruments prescribe the same leave floors, so a private-security
 * employer and an ordinary employer get the same statutory minimum:
 *
 *   annual                 21 consecutive days per 12-month cycle, being the
 *                          days ordinarily worked in three weeks. Must be taken
 *                          within six months of the cycle ending (SD6 cl 9(4)),
 *                          then forfeited.
 *   sick                   the days ordinarily worked in six weeks, per
 *                          36-month cycle. No carry-over between cycles.
 *   family responsibility  three days per 12-month cycle; unused entitlement
 *                          lapses at cycle end (SD6 cl 11(6)), so no grace.
 *
 * The stored figure is a *reference* for a standard eight-hour day. It is not a
 * cap: the rule engine recomputes the floor from each employee's own working
 * pattern, so a twelve-hour guard on a six-day roster automatically receives
 * more than an eight-hour administrator from this same policy.
 *
 * Two safety rules govern what this script will change:
 *
 *   1. It never reduces a deliberate entitlement. A company may agree terms
 *      more generous than the Act, and those stand.
 *   2. It does replace values that are not a whole number of shifts, which are
 *      data-entry artefacts rather than agreed benefits.
 *
 * Usage:
 *   npx tsx scripts/configure-sa-leave-policies.ts
 *   npx tsx scripts/configure-sa-leave-policies.ts --apply
 *   npx tsx scripts/configure-sa-leave-policies.ts --company-id <id> --apply
 */

import "dotenv/config";
import { prisma } from "../src/lib/prisma.js";
import {
  DEFAULT_MINUTES_PER_SHIFT,
  statutoryPolicyDefaults,
  STATUTORY_LEAVE_RULES,
} from "../src/services/leave-statutory-rules.js";

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const companyIdArg = args[args.indexOf("--company-id") + 1];
const companyId = args.includes("--company-id") ? companyIdArg : undefined;

/**
 * Leave types with no statutory entitlement in either the BCEA or SD6.
 *
 * These are converted to non-balance leave: still capturable and payable, but
 * carrying no entitlement balance, because inventing a figure would grant a
 * benefit the company never agreed to.
 */
const NON_STATUTORY_BALANCE_TYPES = ["study", "special"];

/** Shift lengths a deliberate entitlement is likely to be a multiple of. */
const PLAUSIBLE_SHIFT_MINUTES = [480, 540, 600, 720];

/**
 * Whether a stored entitlement looks like a real decision.
 *
 * A deliberate figure is a whole number of shifts — 36 days at eight hours is
 * 17 280. A value like 8 638 is not a whole number of anything and is a slider
 * artefact, so it carries no benefit worth preserving.
 */
function looksDeliberate(minutes: number | null): boolean {
  if (minutes == null || minutes <= 0) return false;
  return PLAUSIBLE_SHIFT_MINUTES.some((shift) => minutes % shift === 0);
}

function days(minutes: number): string {
  return `${(minutes / DEFAULT_MINUTES_PER_SHIFT).toFixed(2)}d`;
}

async function main() {
  const policies = await prisma.leavePolicy.findMany({
    where: { category: "STATUTORY_BASELINE", ...(companyId ? { companyId } : {}) },
    include: { versions: { include: { leaveType: true } } },
  });

  if (policies.length === 0) {
    console.log("No statutory baseline policy found.");
    return;
  }

  const today = new Date();
  const effectiveFrom = new Date(
    Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate())
  );
  const supersedeAt = new Date(effectiveFrom.getTime() - 86_400_000);
  const changes: string[] = [];

  for (const policy of policies) {
    console.log(`\nCompany ${policy.companyId}`);
    console.log("-".repeat(96));

    const leaveTypes = await prisma.leaveTypeDefinition.findMany({
      where: { companyId: policy.companyId },
    });

    for (const leaveType of leaveTypes) {
      const versions = policy.versions
        .filter((version) => version.leaveTypeId === leaveType.id)
        .sort((a, b) => b.version - a.version);
      const active = versions.find((version) => version.reviewStatus === "ACTIVE");
      const nextVersion = (versions[0]?.version ?? 0) + 1;

      const statutory = statutoryPolicyDefaults(leaveType.code);
      const isNonStatutoryBalance =
        NON_STATUTORY_BALANCE_TYPES.includes(leaveType.code) && leaveType.requiresBalance;

      if (!statutory && !isNonStatutoryBalance) {
        console.log(`  ${leaveType.code.padEnd(24)} no change (not balance-controlled)`);
        continue;
      }

      if (isNonStatutoryBalance) {
        const line = `  ${leaveType.code.padEnd(24)} ${String(active?.entitlementMinutes ?? 0).padStart(6)}min -> non-balance leave (no statutory entitlement)`;
        console.log(line);
        changes.push(`${leaveType.code}: converted to non-balance leave`);
        if (!apply) continue;

        await prisma.$transaction(async (tx) => {
          await tx.leaveTypeDefinition.update({
            where: { id: leaveType.id },
            data: { requiresBalance: false },
          });
          await tx.leavePolicyVersion.updateMany({
            where: { policyId: policy.id, leaveTypeId: leaveType.id, reviewStatus: "ACTIVE", effectiveTo: null },
            data: { effectiveTo: supersedeAt },
          });
          await tx.leavePolicyVersion.create({
            data: {
              companyId: policy.companyId,
              policyId: policy.id,
              leaveTypeId: leaveType.id,
              version: nextVersion,
              effectiveFrom,
              reviewStatus: "ACTIVE",
              sourceAuthority: "COMPANY_POLICY",
              legalReference: "No BCEA or Sectoral Determination 6 entitlement; company discretion",
              entitlementMinutes: null,
              accrualMethod: "NONE",
              cycleMonths: 0,
              approvalFlow: [{ order: 1, module: "/employees/leave", capability: "approve", required: true }],
              documentRules: { required: leaveType.requiresDocument },
              calculationRules: { note: "Captured and paid, but carries no entitlement balance." },
              confirmedAt: new Date(),
            },
          });
        });
        continue;
      }

      if (!statutory) continue;
      const rule = STATUTORY_LEAVE_RULES[leaveType.code];
      const current = active?.entitlementMinutes ?? null;
      const floor = statutory.entitlementMinutes ?? 0;

      // Keep a deliberate benefit that beats the Act; otherwise use the floor.
      const target = looksDeliberate(current) ? Math.max(current!, floor) : floor;
      const verdict = current == null
        ? "unset"
        : !looksDeliberate(current)
          ? "data artefact"
          : current < floor
            ? "below the statutory floor"
            : "already compliant";

      const unchanged =
        active != null &&
        active.entitlementMinutes === target &&
        active.cycleMonths === statutory.cycleMonths &&
        active.accrualMethod === statutory.accrualMethod &&
        active.carryOverLimitMinutes === statutory.carryOverLimitMinutes &&
        active.expiryMonths === statutory.graceMonths;

      console.log(
        `  ${leaveType.code.padEnd(24)} ${String(current ?? "-").padStart(6)}min (${current ? days(current) : "-"}) -> ${String(target).padStart(6)}min (${days(target)})  ${rule.reference.padEnd(12)} ${unchanged ? "no change" : verdict}`
      );
      if (unchanged) continue;
      changes.push(
        `${leaveType.code}: ${current ?? "unset"} -> ${target} minutes (${verdict})`
      );
      if (!apply) continue;

      await prisma.$transaction(async (tx) => {
        // Close the running version so the active-overlap exclusion constraint
        // never sees two ACTIVE versions covering the same day.
        await tx.leavePolicyVersion.updateMany({
          where: { policyId: policy.id, leaveTypeId: leaveType.id, reviewStatus: "ACTIVE", effectiveTo: null },
          data: { effectiveTo: supersedeAt },
        });
        await tx.leavePolicyVersion.create({
          data: {
            companyId: policy.companyId,
            policyId: policy.id,
            leaveTypeId: leaveType.id,
            version: nextVersion,
            effectiveFrom,
            reviewStatus: "ACTIVE",
            sourceAuthority: "BCEA_STATUTORY_DEFAULT",
            legalReference: `${rule.reference}; Sectoral Determination 6 (Private Security Sector)`,
            entitlementMinutes: target,
            accrualMethod: statutory.accrualMethod,
            cycleMonths: statutory.cycleMonths,
            carryOverLimitMinutes: statutory.carryOverLimitMinutes,
            expiryMonths: statutory.graceMonths,
            negativeBalanceAllowed: false,
            approvalFlow: [{ order: 1, module: "/employees/leave", capability: "approve", required: true }],
            documentRules: { required: leaveType.requiresDocument },
            calculationRules: {
              statutoryFloor: true,
              reference: rule.reference,
              note: "Reference figure for an eight-hour day. Each employee's entitlement is recomputed from their own working pattern, so longer shifts and longer weeks receive proportionally more.",
            },
            confirmedAt: new Date(),
          },
        });
        await tx.leaveAuditEvent.create({
          data: {
            companyId: policy.companyId,
            eventType: "POLICY_VERSION_CONFIRMED",
            reason: `Configured to ${rule.reference} / Sectoral Determination 6`,
            previousValue: { entitlementMinutes: current },
            newValue: { entitlementMinutes: target, cycleMonths: statutory.cycleMonths },
          },
        });
      });
    }
  }

  console.log("\n" + "=".repeat(96));
  if (changes.length === 0) {
    console.log("Every policy already matches South African law. Nothing to do.");
  } else if (apply) {
    console.log(`Applied ${changes.length} change(s).`);
  } else {
    console.log(`${changes.length} change(s) pending. Re-run with --apply to write them.`);
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
