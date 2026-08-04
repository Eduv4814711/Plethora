/**
 * One-time data migration for the explicit-grants change.
 *
 * Capability lookup used to prefix-match, and several route groups accepted a
 * union of modules, so people held access that was never written down. Both
 * mechanisms are now closed. This script writes every previously implied grant
 * into User.capabilities so the stored matrix matches what people could
 * actually do the day before the change, and records the expansion in the audit
 * log so it can be reviewed and trimmed afterwards.
 *
 * Run:  npm run db:expand-grants -- --dry-run     (prints the diff, writes nothing)
 *       npm run db:expand-grants                  (applies)
 *
 * Idempotent: re-running after a successful pass changes nothing.
 */
import { config } from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, "..", ".env") });

import { Prisma, PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import {
  capabilityDefinition,
  diffCapabilities,
  normalizeCapabilities,
  type Capability,
  type CapabilityMap,
} from "../src/lib/capabilities.js";
import {
  LEGACY_MODULE_FALLBACKS,
  LEGACY_PARENT_INHERITANCE,
  MIGRATION_MODULE_SEED,
} from "../src/lib/legacy-access-fallbacks.js";

const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required to expand implicit grants.");
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: databaseUrl }),
});

const dryRun = process.argv.includes("--dry-run");

interface Expansion {
  path: string;
  capabilities: Capability[];
  reason: string;
}

/** Restrict a capability list to those the target module actually supports. */
function supported(path: string, capabilities: readonly Capability[]): Capability[] {
  const definition = capabilityDefinition(path);
  if (!definition) return [];
  // manage_access is never inherited or back-filled. It is the escalation
  // surface and must always be granted deliberately.
  return capabilities.filter(
    (capability) => capability !== "manage_access" && definition.capabilities.includes(capability)
  );
}

function expandFor(existing: CapabilityMap): { next: CapabilityMap; expansions: Expansion[] } {
  const next: CapabilityMap = Object.fromEntries(
    Object.entries(existing).map(([path, capabilities]) => [path, [...capabilities]])
  );
  const expansions: Expansion[] = [];

  const add = (path: string, capabilities: Capability[], reason: string) => {
    const allowed = supported(path, capabilities);
    if (!allowed.length) return;
    const current = new Set(next[path] ?? []);
    const added = allowed.filter((capability) => !current.has(capability));
    if (!added.length) return;
    next[path] = [...current, ...added];
    expansions.push({ path, capabilities: added, reason });
  };

  // 1. Sub-modules that used to be inherited from their parent by prefix match.
  //    /settings/access is deliberately excluded (see legacy-access-fallbacks.ts).
  for (const { parent, child } of LEGACY_PARENT_INHERITANCE) {
    const inherited = existing[parent];
    if (inherited?.length) {
      add(child, [...inherited], `inherited from ${parent} by prefix matching`);
    }
  }

  // 2. Cross-module route guards that accepted a union of modules.
  for (const fallback of LEGACY_MODULE_FALLBACKS) {
    const held = existing[fallback.from];
    if (!held?.length) continue;
    const carried = fallback.capabilities.filter((capability) => held.includes(capability));
    if (carried.length) add(fallback.to, carried, fallback.reason);
  }

  // 3. Data Import / Export is new to the catalog; seed it from the grants that
  //    used to make the tooling reachable.
  const seeded = MIGRATION_MODULE_SEED.grant(existing);
  if (seeded.length) add(MIGRATION_MODULE_SEED.path, seeded, MIGRATION_MODULE_SEED.reason);

  return { next, expansions };
}

function sortMap(map: CapabilityMap): CapabilityMap {
  return Object.fromEntries(
    Object.keys(map)
      .sort()
      .map((path) => [path, [...map[path]].sort()])
  );
}

async function main() {
  const users = await prisma.user.findMany({
    select: {
      id: true,
      name: true,
      email: true,
      companyId: true,
      isActive: true,
      capabilities: true,
      company: { select: { ownerUserId: true } },
    },
    orderBy: [{ companyId: "asc" }, { email: "asc" }],
  });

  // Users already expanded by a previous run. Rules are meant to fire once,
  // against the pre-change state: re-running would let a grant awarded in the
  // first pass satisfy a second rule and hand out access nobody ever had.
  const alreadyMigrated = new Set(
    (
      await prisma.auditLog.findMany({
        where: { action: "user.access.migrated" },
        select: { entityId: true },
      })
    )
      .map((row) => row.entityId)
      .filter((id): id is string => Boolean(id))
  );

  console.log(`${dryRun ? "[dry run] " : ""}Reviewing ${users.length} user(s).\n`);

  let changed = 0;
  let skippedOwners = 0;
  let skippedMigrated = 0;

  for (const user of users) {
    // Owners bypass the capability map entirely; expanding it would be noise.
    if (user.company.ownerUserId === user.id) {
      skippedOwners += 1;
      continue;
    }
    if (alreadyMigrated.has(user.id)) {
      skippedMigrated += 1;
      continue;
    }

    const before = normalizeCapabilities(user.capabilities);
    const { next, expansions } = expandFor(before);
    if (!expansions.length) continue;

    changed += 1;
    const beforeSorted = sortMap(before);
    const afterSorted = sortMap(next);

    console.log(`${user.name} <${user.email}>${user.isActive ? "" : "  (deactivated)"}`);
    for (const expansion of expansions) {
      const label = capabilityDefinition(expansion.path)?.label ?? expansion.path;
      console.log(`    + ${label} [${expansion.capabilities.join(", ")}]  — ${expansion.reason}`);
    }
    console.log("");

    if (dryRun) continue;

    await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: user.id },
        data: { capabilities: afterSorted },
      });
      await tx.auditLog.create({
        data: {
          userId: null,
          companyId: user.companyId,
          action: "user.access.migrated",
          entityType: "user",
          entityId: user.id,
          actorLabel: "system:expand-implicit-grants",
          // Round-tripped through JSON so Prisma sees plain values rather than
          // our interface types, which it will not accept as InputJsonObject.
          metadata: JSON.parse(
            JSON.stringify({
              before: beforeSorted,
              after: afterSorted,
              expansions,
              // Rendered by the audit page the same way a manual access change is.
              ...diffCapabilities(beforeSorted, afterSorted),
              note:
                "Previously implied access made explicit when prefix inheritance and cross-module route fallbacks were retired.",
            })
          ) as Prisma.InputJsonObject,
        },
      });
    });
  }

  console.log("—".repeat(60));
  console.log(`${dryRun ? "Would update" : "Updated"}: ${changed} user(s)`);
  console.log(`Owners skipped (full access by ownership): ${skippedOwners}`);
  console.log(`Already expanded by an earlier run: ${skippedMigrated} user(s)`);
  console.log(
    `Unchanged: ${users.length - changed - skippedOwners - skippedMigrated} user(s)`
  );
  if (dryRun) {
    console.log("\nNothing was written. Re-run without --dry-run to apply.");
  } else if (changed) {
    console.log("\nEach change is recorded in the audit log as user.access.migrated.");
    console.log("Review Settings → User Access and trim any grant nobody actually needs.");
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
