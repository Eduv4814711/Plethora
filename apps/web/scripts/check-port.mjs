/**
 * Pre-dev port diagnostic for apps/web.
 * Must run BEFORE clean:web so a live next-server's .next is not deleted.
 */
import net from "node:net";
import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const PORT = Number(process.env.PORT || 3000);
const NEXT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", ".next");

function listListeners(port) {
  try {
    return execSync(`ss -tlnp 2>/dev/null | grep ':${port}' || true`, {
      encoding: "utf8",
    }).trim();
  } catch {
    return "";
  }
}

function canBind(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", (err) => {
      resolve({ ok: false, code: err && err.code });
    });
    server.once("listening", () => {
      server.close(() => resolve({ ok: true }));
    });
    server.listen(port, "0.0.0.0");
  });
}

const nextExists = existsSync(NEXT_DIR);
const listeners = listListeners(PORT);
const bind = await canBind(PORT);

if (!bind.ok) {
  console.error(
    `\nPort ${PORT} is already in use — this is expected if npm run dev:all is already running.\n` +
      `Use the existing app at http://localhost:${PORT}\n` +
      `Only run npm run dev:web after stopping that process (Ctrl+C in the dev:all terminal).\n` +
      `Note: .next was NOT deleted (port check runs before clean).\n` +
      (listeners ? `Listener: ${listeners}\n` : "")
  );
  process.exit(1);
}

console.log(`Port ${PORT} is free.`);
