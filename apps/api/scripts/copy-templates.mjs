import { cp } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
await cp(join(root, "src", "templates"), join(root, "dist", "templates"), {
  recursive: true,
});
