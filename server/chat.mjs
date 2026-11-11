import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const IMAGE = /^[0-9a-f-]{36}\.(jpg|png|webp)$/;
const EXT = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
const KEY_NAME = "spoolside-chat";

export const SYSTEM = `You are Claude, built into Spoolside: Shelby's app for running a print farm of Bambu Lab A1 mini printers (AMS 2, AMS 3, Conductive, Desk, Membrane) and printing PlayCase orders. Shelby is writing to you from the Spoolside app, often on a phone between prints.

Use the spoolside tools to look things up and to act. Check the farm's state with them instead of guessing. Prints you start go through Spoolside's camera bed check: if it holds a start, say what the camera saw, and pass bed_is_clear once Shelby says the bed is clear or to print anyway. Never stop a print, or change auto-print or repeating, unless Shelby asks.

Keep replies short and plain, for a small screen: a sentence or two, or a short list. Say what you did and what happened, not how you did it.`;

// Talks to Claude through Shelby's Claude subscription: Claude Code runs headless (Agent SDK) with a sign-in token
// from `claude setup-token`, and its only tools are the Spoolside MCP's, which go through Spoolside's own API and
// safety checks. One ongoing conversation, resumed on each message, until "New chat".
export class ClaudeChat {
  constructor(dbFile, dir, { token = () => process.env.CLAUDE_CODE_OAUTH_TOKEN, query = null, port = 3000, model = process.env.SPOOLSIDE_CHAT_MODEL || undefined, now = Date.now } = {}) {
    Object.assign(this, { dir, token, loadQuery: query, port, model, now });
    this.images = path.join(dir, "images");
    this.work = path.join(dir, "work");
    for (const d of [this.images, this.work]) fs.mkdirSync(d, { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(dbFile);
    this.db.exec(`CREATE TABLE IF NOT EXISTS chat_items (id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, body TEXT NOT NULL, created INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS chat_state (key TEXT PRIMARY KEY, value TEXT);
      CREATE TABLE IF NOT EXISTS api_keys (hash TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, created INTEGER NOT NULL, used INTEGER);`);
    this.running = null;
    this.limit = null;
    this.gen = 0; // bumped by New chat, so an answer still finishing can't write into the fresh conversation
  }
  close() {
    this.running?.abort.abort();
    this.db.close();
  }
  state(key, value) {
    if (value === undefined) return this.db.prepare("SELECT value FROM chat_state WHERE key=?").get(key)?.value ?? null;
    if (value === null) this.db.prepare("DELETE FROM chat_state WHERE key=?").run(key);
    else this.db.prepare("INSERT INTO chat_state VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(key, value);
  }
  add(kind, body) {
    return Number(this.db.prepare("INSERT INTO chat_items (kind, body, created) VALUES (?,?,?)").run(kind, JSON.stringify(body), this.now()).lastInsertRowid);
  }
  items() {
    return this.db.prepare("SELECT id, kind, body, created FROM chat_items ORDER BY id").all().map((r) => ({ id: r.id, kind: r.kind, created: r.created, ...JSON.parse(r.body) }));
  }
  view() {
    const available = !!this.token();
    return {
      available,
      reason: available ? null : "Claude isn't connected yet. Create a sign-in token with `claude setup-token` and add it to the server as CLAUDE_CODE_OAUTH_TOKEN.",
      running: !!this.running,
      partial: this.running?.partial || "",
      limit: this.limit,
      items: this.items(),
    };
  }
  // The MCP inside the container signs in with a key made for it at startup; only its hash is stored.
  apiKey() {
    if (this.key) return this.key;
    this.key = "sps_" + randomBytes(32).toString("hex");
    this.db.prepare("DELETE FROM api_keys WHERE name=?").run(KEY_NAME);
    this.db.prepare("INSERT INTO api_keys VALUES (?,?,?,NULL)").run(createHash("sha256").update(this.key).digest("hex"), KEY_NAME, this.now());
    return this.key;
  }
  send(text) {
    if (typeof text !== "string" || !text.trim()) throw Error("Write a message");
    if (text.length > 4000) throw Error("Keep messages under 4,000 characters");
    if (!this.token()) throw Object.assign(Error(this.view().reason), { status: 503 });
    if (this.running) throw Object.assign(Error("Claude is still answering. Wait, or stop it first."), { status: 409 });
    this.add("user", { text: text.trim() });
    this.running = { abort: new AbortController(), partial: "" };
    this.done = this.run(text.trim()).finally(() => (this.running = null));
    return this.view();
  }
  stop() {
    this.running?.abort.abort();
    return this.view();
  }
  reset() {
    this.gen++;
    this.running?.abort.abort();
    this.db.exec("DELETE FROM chat_items");
    this.state("session", null);
    for (const f of fs.readdirSync(this.images)) fs.rmSync(path.join(this.images, f), { force: true });
    return this.view();
  }
  image(file) {
    if (!IMAGE.test(file)) throw Object.assign(Error("Unknown image"), { status: 404 });
    return path.join(this.images, file);
  }
  options(resume) {
    const env = { ...process.env, CLAUDE_CODE_OAUTH_TOKEN: this.token(), CLAUDE_CONFIG_DIR: path.join(this.dir, "config"), CLAUDE_AGENT_SDK_CLIENT_APP: "spoolside" };
    // An API key would take precedence over the subscription token and bill the API instead.
    delete env.ANTHROPIC_API_KEY;
    delete env.ANTHROPIC_AUTH_TOKEN;
    return {
      ...(resume ? { resume } : {}),
      ...(this.model ? { model: this.model } : {}),
      cwd: this.work,
      tools: [],
      mcpServers: {
        spoolside: {
          type: "stdio",
          command: process.execPath,
          args: [path.resolve(here, "../mcp/server.mjs")],
          env: { PATH: process.env.PATH || "", SPOOLSIDE_URL: `http://127.0.0.1:${this.port}`, SPOOLSIDE_API_KEY: this.apiKey() },
          alwaysLoad: true,
        },
      },
      strictMcpConfig: true,
      settingSources: [],
      allowedTools: ["mcp__spoolside"],
      permissionMode: "dontAsk",
      systemPrompt: SYSTEM,
      includePartialMessages: true,
      maxTurns: 30,
      abortController: this.running.abort,
      env,
    };
  }
  async run(text, retried = false) {
    const gen = this.gen, current = () => gen === this.gen;
    const add = (kind, body) => current() && this.add(kind, body);
    const resume = this.state("session");
    let answered = false, reported = false;
    // Only a lost conversation is worth starting over; a sign-in or usage-limit failure would just fail again.
    const lost = (t) => resume && !answered && !retried && !this.running.abort.signal.aborted && /no conversation|session/i.test(t);
    try {
      const query = this.loadQuery || (await import("@anthropic-ai/claude-agent-sdk")).query;
      for await (const m of query({ prompt: text, options: this.options(resume) })) {
        if (current() && m.session_id && m.session_id !== this.state("session")) this.state("session", m.session_id);
        if (m.parent_tool_use_id) continue;
        if (m.type === "stream_event") {
          const e = m.event;
          if (e.type === "content_block_start") this.running.partial = "";
          if (e.type === "content_block_delta" && e.delta?.type === "text_delta") this.running.partial += e.delta.text;
        } else if (m.type === "assistant") {
          // An API failure arrives as a stand-in reply too; the result that follows explains it once.
          if (m.error) continue;
          for (const b of m.message.content || []) {
            if (b.type === "text" && b.text.trim()) {
              answered = true;
              add("assistant", { text: b.text });
              this.running.partial = "";
            } else if (b.type === "tool_use") {
              answered = true;
              add("tool", { toolId: b.id, name: String(b.name).replace(/^mcp__spoolside__/, ""), input: b.input || {}, status: "running" });
            }
          }
        } else if (m.type === "user") {
          for (const b of Array.isArray(m.message.content) ? m.message.content : []) if (b.type === "tool_result" && current()) this.toolResult(b);
        } else if (m.type === "rate_limit_event") {
          const r = m.rate_limit_info;
          this.limit = r.status === "allowed" ? null : { status: r.status, resetsAt: r.resetsAt ? r.resetsAt * (r.resetsAt < 1e12 ? 1000 : 1) : null };
        } else if (m.type === "result" && (m.is_error || m.subtype !== "success")) {
          // A conversation the server can't find anymore (its files were cleared) starts over once.
          if (lost(m.result || (m.errors || []).join(" "))) {
            this.state("session", null);
            return this.run(text, true);
          }
          reported = true;
          add("error", { text: this.errorText(m) });
        }
      }
    } catch (e) {
      if (this.running.abort.signal.aborted) add("notice", { text: "Stopped." });
      else if (lost(e.message)) {
        this.state("session", null);
        return this.run(text, true);
      } else if (!reported) add("error", { text: `Claude couldn't answer: ${e.message}` });
    } finally {
      // Tools still marked running when the turn ends were cut off.
      if (current()) for (const t of this.items().filter((i) => i.kind === "tool" && i.status === "running")) this.update(t.toolId, { status: "error", result: "Didn't finish." });
    }
  }
  errorText(m) {
    if (m.subtype === "error_max_turns") return "Claude took too many steps on that and stopped. Ask again, more specifically.";
    const text = m.result || (m.errors || []).join(" ") || "Something went wrong.";
    if (/rate.?limit|usage limit|limit reached/i.test(text)) return `Your Claude usage limit is reached. ${text}`;
    if (/auth|token|401|log ?in/i.test(text)) return `Claude couldn't sign in with the token on the server: ${text}`;
    return text;
  }
  update(toolId, fields) {
    const row = this.db.prepare("SELECT id, body FROM chat_items WHERE kind='tool' AND json_extract(body,'$.toolId')=? ORDER BY id DESC LIMIT 1").get(toolId);
    if (row) this.db.prepare("UPDATE chat_items SET body=? WHERE id=?").run(JSON.stringify({ ...JSON.parse(row.body), ...fields }), row.id);
  }
  toolResult(b) {
    const parts = typeof b.content === "string" ? [{ type: "text", text: b.content }] : b.content || [];
    const images = [];
    for (const p of parts) {
      const data = p.type === "image" ? p.source?.data || p.data : null;
      const type = p.source?.media_type || p.mimeType || "image/jpeg";
      if (!data || !EXT[type]) continue;
      const file = `${randomUUID()}.${EXT[type]}`;
      fs.writeFileSync(path.join(this.images, file), Buffer.from(data, "base64"), { mode: 0o600 });
      images.push(file);
    }
    const text = parts.filter((p) => p.type === "text").map((p) => p.text).join("\n").trim();
    this.update(b.tool_use_id, { status: b.is_error ? "error" : "done", result: text.length > 600 ? text.slice(0, 600) + "…" : text, images });
  }
}
