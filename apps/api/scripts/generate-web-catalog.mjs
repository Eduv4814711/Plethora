/**
 * Regenerates apps/web/lib/capability-catalog.generated.ts from the API catalog,
 * which is the single source of truth for grantable modules.
 *
 * Run: npm run gen:catalog --workspace api
 */
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const source = join(here, "..", "src", "lib", "capabilities.ts");
const target = join(here, "..", "..", "web", "lib", "capability-catalog.generated.ts");

const contents = await readFile(source, "utf8");

const capabilitiesMatch = contents.match(/export const CAPABILITIES = \[([\s\S]*?)\] as const;/);
const catalogMatch = contents.match(
  /export const CAPABILITY_CATALOG: readonly CapabilityDefinition\[\] = \[([\s\S]*?)\n\] as const;/
);

if (!capabilitiesMatch || !catalogMatch) {
  throw new Error("Could not locate CAPABILITIES or CAPABILITY_CATALOG in capabilities.ts");
}

// `standard` is a local shorthand in the API file; inline it so the generated
// file stands alone.
const standardMatch = contents.match(/const standard = \[([\s\S]*?)\] as const;/);
const standard = standardMatch ? standardMatch[1].trim() : '"view", "create", "edit", "delete", "export"';

const catalogBody = catalogMatch[1]
  .split("\n")
  .filter((line) => line.trim())
  .map((line) => line.replace(/capabilities: standard\b/, `capabilities: [${standard}]`))
  .join("\n");

const output = `// GENERATED FILE — do not edit by hand.
// Mirrors CAPABILITY_CATALOG in apps/api/src/lib/capabilities.ts.
// Regenerate with: npm run gen:catalog --workspace api
// apps/api/src/routes/__tests__/module-consistency.integration.test.ts fails if
// this file drifts from the API catalog.

export const CAPABILITIES = [${capabilitiesMatch[1]}] as const;

export type CatalogCapability = (typeof CAPABILITIES)[number];

export interface CapabilityDefinition {
  path: string;
  label: string;
  capabilities: readonly CatalogCapability[];
  parent?: string;
}

export const CAPABILITY_CATALOG: readonly CapabilityDefinition[] = [
${catalogBody}
] as const;

export const CATALOG_PATHS: readonly string[] = CAPABILITY_CATALOG.map((d) => d.path);
`;

await writeFile(target, output, "utf8");
console.log(`Wrote ${target}`);
