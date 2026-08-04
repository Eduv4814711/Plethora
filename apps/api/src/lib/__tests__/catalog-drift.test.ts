import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const apiRoot = join(here, "..", "..", "..");
const generator = join(apiRoot, "scripts", "generate-web-catalog.mjs");
const generated = join(apiRoot, "..", "web", "lib", "capability-catalog.generated.ts");

/**
 * The web app needs the module catalog too, and a hand-maintained copy drifts —
 * it already had before this file existed. The copy is generated, and this test
 * fails if someone edits the API catalog without regenerating it.
 */
describe("web capability catalog", () => {
  it("is up to date with the API catalog", () => {
    const committed = readFileSync(generated, "utf8");
    execFileSync(process.execPath, [generator], { cwd: apiRoot, stdio: "pipe" });
    const regenerated = readFileSync(generated, "utf8");

    expect(regenerated).toBe(committed);
    if (regenerated !== committed) {
      throw new Error("Run `npm run gen:catalog --workspace api` and commit the result.");
    }
  });
});
