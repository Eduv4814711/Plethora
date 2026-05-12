import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** HTML templates: `src/templates` in dev (tsx), `dist/templates` after build + copy step */
export const templatesDir = join(__dirname, "../templates");

export function templatePath(name: string): string {
  return join(templatesDir, name);
}
