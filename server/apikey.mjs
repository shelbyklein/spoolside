// Manage Spoolside API keys (used by the Spoolside MCP).
//   node server/apikey.mjs create <name>   prints a new key once; only its hash is stored
//   node server/apikey.mjs list
//   node server/apikey.mjs revoke <name>
import { DatabaseSync } from "node:sqlite";
import { createHash, randomBytes } from "node:crypto";

const db = new DatabaseSync(process.env.SPOOLSIDE_DB || "/data/spoolside.sqlite");
db.exec("CREATE TABLE IF NOT EXISTS api_keys (hash TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, created INTEGER NOT NULL, used INTEGER)");
const [command, name] = process.argv.slice(2);
if (command === "create" && name) {
  const key = "sps_" + randomBytes(32).toString("hex");
  db.prepare("INSERT INTO api_keys VALUES (?,?,?,NULL)").run(createHash("sha256").update(key).digest("hex"), name, Date.now());
  process.stdout.write(key + "\n");
} else if (command === "list") {
  for (const k of db.prepare("SELECT name, created, used FROM api_keys ORDER BY created").all())
    console.log(`${k.name}\tcreated ${new Date(k.created).toISOString()}\tlast used ${k.used ? new Date(k.used).toISOString() : "never"}`);
} else if (command === "revoke" && name) {
  console.log(db.prepare("DELETE FROM api_keys WHERE name=?").run(name).changes ? `Revoked ${name}` : `No key named ${name}`);
} else {
  console.error("Usage: node server/apikey.mjs create <name> | list | revoke <name>");
  process.exit(1);
}
