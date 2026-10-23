// Issue an API key: node scripts/new-key.mjs <name> [--local]
// Prints the key once. Only its SHA-256 is stored, so a leaked KV dump opens nothing.
import { execFileSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";

const name = process.argv[2];
if (!name) {
  console.error("usage: node scripts/new-key.mjs <name> [--local]");
  process.exit(1);
}
const key = "qi_" + randomBytes(24).toString("hex");
const hash = createHash("sha256").update(key).digest("hex");
const value = JSON.stringify({ name, created: new Date().toISOString() });
const where = process.argv.includes("--local") ? "--local" : "--remote";
execFileSync("npx", ["wrangler", "kv", "key", "put", "--binding", "API_KEYS", hash, value, where], { stdio: "ignore" });
console.log(key);
