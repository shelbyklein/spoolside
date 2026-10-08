import {Materials} from "./materials.mjs";
import fs from "node:fs";
import { Notifications } from "./notifications.mjs";
import { Workspace } from "./workspace.mjs";
import { Printers } from "./printers.mjs";
import { createApp } from "./app.mjs";
import { Library } from "./library.mjs";
import { Assets } from "./assets.mjs";
import { PrintWatcher, claudeVision, shrinkFrame } from "./watcher.mjs";
import { OrderPrints } from "./orderprints.mjs";
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
const notifications = workspace ? new Notifications(workspace.db, {vapid: fs.existsSync(configDir + "/vapid.json") ? JSON.parse(fs.readFileSync(configDir + "/vapid.json")) : null}) : null;
if (workspace) workspace.onSync = (previous, next, baseline) => notifications.enqueue(previous, next, baseline);
const pushTimer = setInterval(() => notifications?.drain(), 15000);
printers.start();
workspace?.sync();
const syncTimer = setInterval(() => workspace?.sync(), 60000);
const backupDir = process.env.SPOOLSIDE_BACKUP_DIR || "/backups";
const backup = () => {
  if (!workspace) return;
  try {
    fs.mkdirSync(backupDir, { recursive: true, mode: 0o700 });
    const file = backupDir + "/workspace-" + Date.now() + ".sqlite";
    fs.cpSync(process.env.SPOOLSIDE_ASSET_DIR || "/data/assets", backupDir + "/library-files", {recursive:true,force:true});
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
const library = new Library(
  process.env.SPOOLSIDE_DB || "/data/spoolside.sqlite",
  process.env.SPOOLSIDE_LIBRARY_DIR || "/data/library",
);
const assets = new Assets(
  process.env.SPOOLSIDE_DB || "/data/spoolside.sqlite",
  process.env.SPOOLSIDE_ASSET_DIR || "/data/assets",
);
const orderPrints = new OrderPrints(process.env.SPOOLSIDE_DB || "/data/spoolside.sqlite");
// Watches every print; vision checks run once an Anthropic API key is set in the server's .env.
const watcher = new PrintWatcher(process.env.SPOOLSIDE_DB || "/data/spoolside.sqlite", process.env.SPOOLSIDE_WATCH_DIR || "/data/watch", {
  printers,
  notifications,
  vision: process.env.ANTHROPIC_API_KEY ? claudeVision(process.env.ANTHROPIC_API_KEY) : null,
  shrink: shrinkFrame,
  orderPrints,
});
const watchTimer = setInterval(() => watcher.tick(), 15000);
const pruneTimer = setInterval(() => watcher.prune(), 24 * 60 * 60 * 1000);
const materials = workspace ? new Materials(workspace.db) : null;
materials?.refresh();
const materialTimer=setInterval(()=>materials?.refresh(),6*60*60*1000);
const { app, close } = createApp({
  library,
  materials,
  assets,
  workspace,
  notifications,
  printers,
  watcher,
  orderPrints,
  database: process.env.SPOOLSIDE_DB || "/data/spoolside.sqlite",
  pinHash: process.env.SPOOLSIDE_PIN_HASH,
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
      clearInterval(materialTimer);
      clearInterval(pushTimer);
      clearInterval(backupTimer);
      clearInterval(watchTimer);
      clearInterval(pruneTimer);
      backup();
      printers.close();
      library.close();
      assets.close();
      watcher.close();
      orderPrints.close();
      workspace?.close();
      close();
      process.exit(0);
    }),
  );
