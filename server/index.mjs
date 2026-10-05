import fs from "node:fs";
import { Workspace } from "./workspace.mjs";
import { Printers } from "./printers.mjs";
import { createApp } from "./app.mjs";
const configDir = process.env.SPOOLSIDE_CONFIG_DIR || "/run/spoolside";
const woo = fs.existsSync(configDir + "/woocommerce.json")
  ? JSON.parse(fs.readFileSync(configDir + "/woocommerce.json"))
  : null;
const workspace = woo
  ? new Workspace(process.env.SPOOLSIDE_DB || "/data/spoolside.sqlite", { woo })
  : null;
const printers = new Printers(
  fs.existsSync(configDir + "/printers.json")
    ? JSON.parse(fs.readFileSync(configDir + "/printers.json"))
    : [],
);
printers.start();
workspace?.sync();
const syncTimer = setInterval(() => workspace?.sync(), 60000);
const backupDir = process.env.SPOOLSIDE_BACKUP_DIR || "/backups";
const backup = () => {
  if (!workspace) return;
  try {
    fs.mkdirSync(backupDir, { recursive: true, mode: 0o700 });
    const file = backupDir + "/workspace-" + Date.now() + ".sqlite";
    workspace.backup(file);
    fs.chmodSync(file, 0o600);
    const files = fs
      .readdirSync(backupDir)
      .filter((f) => f.startsWith("workspace-") && f.endsWith(".sqlite"))
      .sort();
    for (const old of files.slice(0, -48)) fs.unlinkSync(backupDir + "/" + old);
  } catch {
    console.error("Workspace backup failed");
  }
};
const backupTimer = setInterval(backup, 3600000);
const { app, close } = createApp({
  workspace,
  printers,
  database: process.env.SPOOLSIDE_DB || "/data/spoolside.sqlite",
  username: process.env.SPOOLSIDE_USERNAME,
  passwordHash: process.env.SPOOLSIDE_PASSWORD_HASH,
  origin: process.env.SPOOLSIDE_ORIGIN || "https://spoolside.shelbyklein.com",
  secure: true,
  proxyAddress: process.env.SPOOLSIDE_PROXY_ADDRESS,
});
const server = app.listen(Number(process.env.PORT || 3000), "0.0.0.0", () =>
  console.log("Spoolside server listening"),
);
for (const signal of ["SIGTERM", "SIGINT"])
  process.on(signal, () =>
    server.close(() => {
      clearInterval(syncTimer);
      clearInterval(backupTimer);
      backup();
      printers.close();
      workspace?.close();
      close();
      process.exit(0);
    }),
  );
