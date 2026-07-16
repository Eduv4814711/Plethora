import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const API_SRC = join(process.cwd(), "src");
const EXEMPT_STATE_CHANGE_FILES = new Set([
  // Login/setup endpoints have their own credential, CSRF and rate-limit boundary.
  "routes/auth.ts",
  // Authenticated with a separately rotated CRON_SECRET, not a user grant.
  "routes/internal-cron.ts",
]);

function routeFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return routeFiles(path);
    return entry.name.endsWith(".ts") && (path.includes(`${join("src", "routes")}`) || entry.name.endsWith(".routes.ts"))
      ? [path]
      : [];
  });
}

describe("endpoint permission matrix", () => {
  it("requires every state-changing route file to declare fine-grained access enforcement", () => {
    const missing = routeFiles(API_SRC)
      .filter((file) => /app\.(post|put|patch|delete)\s*\(/.test(readFileSync(file, "utf8")))
      .filter((file) => !EXEMPT_STATE_CHANGE_FILES.has(relative(API_SRC, file).replaceAll("\\", "/")))
      .filter((file) => {
        const source = readFileSync(file, "utf8");
        return !/requirePermission|requireAnyPermission|accessMiddleware|requireSystemOwner|academyProtect|platformProtect/.test(source);
      })
      .map((file) => relative(API_SRC, file).replaceAll("\\", "/"));

    expect(missing, `State-changing route files without an explicit capability:\n${missing.join("\n")}`).toEqual([]);
  });
});
