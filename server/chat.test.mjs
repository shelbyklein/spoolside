import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ClaudeChat } from "./chat.mjs";

const JPEG = Buffer.from("fake-jpeg").toString("base64");

function setup(script, { token = "oat-token" } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "spoolside-chat-"));
  const calls = [];
  const chat = new ClaudeChat(":memory:", dir, {
    token: () => token,
    query: ({ prompt, options }) => {
      calls.push({ prompt, options });
      return script(calls.length, options);
    },
  });
  return { chat, calls, dir, done: () => { chat.close(); fs.rmSync(dir, { recursive: true, force: true }); } };
}

test("a message runs Claude on the subscription with only the Spoolside tools, and records the answer", async () => {
  process.env.ANTHROPIC_API_KEY = "sk-should-not-leak";
  const s = setup(async function* (n) {
    yield { type: "system", subtype: "init", session_id: "sess-1", parent_tool_use_id: null };
    yield { type: "stream_event", event: { type: "content_block_start" }, parent_tool_use_id: null, session_id: "sess-1" };
    yield { type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text: "Checking" } }, parent_tool_use_id: null, session_id: "sess-1" };
    yield { type: "assistant", parent_tool_use_id: null, session_id: "sess-1", message: { content: [{ type: "tool_use", id: "t1", name: "mcp__spoolside__camera", input: { printer: "Desk" } }] } };
    yield { type: "user", parent_tool_use_id: null, session_id: "sess-1", message: { content: [{ type: "tool_result", tool_use_id: "t1", content: [{ type: "image", source: { type: "base64", media_type: "image/jpeg", data: JPEG } }, { type: "text", text: "Desk · Ready" }] }] } };
    // A subagent's chatter isn't shown.
    yield { type: "assistant", parent_tool_use_id: "t1", session_id: "sess-1", message: { content: [{ type: "text", text: "inner" }] } };
    yield { type: "assistant", parent_tool_use_id: null, session_id: "sess-1", message: { content: [{ type: "text", text: `Desk's bed is clear (${n}).` }] } };
    yield { type: "result", subtype: "success", is_error: false, result: "Desk's bed is clear.", session_id: "sess-1" };
  });
  try {
    const v = s.chat.send("  Is Desk clear?  ");
    assert.equal(v.running, true);
    assert.deepEqual(v.items.map((i) => [i.kind, i.text]), [["user", "Is Desk clear?"]]);
    await s.chat.done;
    const { options } = s.calls[0];
    assert.deepEqual(options.tools, [], "no built-in tools");
    assert.deepEqual(Object.keys(options.mcpServers), ["spoolside"]);
    assert.equal(options.strictMcpConfig, true);
    assert.deepEqual(options.settingSources, []);
    assert.deepEqual(options.allowedTools, ["mcp__spoolside"]);
    assert.equal(options.permissionMode, "dontAsk");
    assert.equal(options.env.CLAUDE_CODE_OAUTH_TOKEN, "oat-token");
    assert.equal(options.env.ANTHROPIC_API_KEY, undefined, "an API key would bill the API instead of the subscription");
    assert.match(options.mcpServers.spoolside.env.SPOOLSIDE_API_KEY, /^sps_/);
    assert.equal(options.resume, undefined);
    const view = s.chat.view();
    assert.equal(view.running, false);
    assert.deepEqual(view.items.map((i) => i.kind), ["user", "tool", "assistant"]);
    const tool = view.items[1];
    assert.equal(tool.name, "camera");
    assert.equal(tool.status, "done");
    assert.equal(tool.result, "Desk · Ready");
    assert.equal(fs.readFileSync(s.chat.image(tool.images[0]), "utf8"), "fake-jpeg");
    assert.equal(view.items[2].text, "Desk's bed is clear (1).");
    // The next message resumes the same conversation.
    s.chat.send("Thanks");
    await s.chat.done;
    assert.equal(s.calls[1].options.resume, "sess-1");
    assert.throws(() => s.chat.image("../chat.sqlite"), /Unknown image/);
  } finally {
    delete process.env.ANTHROPIC_API_KEY;
    s.done();
  }
});

test("one answer at a time; errors and limits are explained; New chat starts over", async () => {
  let release;
  const s = setup(async function* (n) {
    if (n === 1) {
      yield { type: "system", subtype: "init", session_id: "sess-a", parent_tool_use_id: null };
      await new Promise((r) => (release = r));
      yield { type: "rate_limit_event", rate_limit_info: { status: "rejected", resetsAt: 1_800_000_000 }, session_id: "sess-a" };
      yield { type: "result", subtype: "success", is_error: true, result: "Claude AI usage limit reached", session_id: "sess-a" };
    }
  });
  try {
    s.chat.send("Hello");
    assert.throws(() => s.chat.send("Again"), (e) => e.status === 409);
    while (!release) await new Promise((r) => setTimeout(r, 1));
    release();
    await s.chat.done;
    const v = s.chat.view();
    assert.equal(v.limit.status, "rejected");
    assert.equal(v.limit.resetsAt, 1_800_000_000_000);
    assert.match(v.items.at(-1).text, /usage limit is reached/);
    const fresh = s.chat.reset();
    assert.deepEqual(fresh.items, []);
    assert.equal(s.chat.state("session"), null);
  } finally {
    s.done();
  }
});

test("a conversation the server lost starts over once; Stop says so; no token means not connected", async () => {
  const s = setup(async function* (n, options) {
    if (options.resume === "gone") {
      yield { type: "result", subtype: "error_during_execution", is_error: true, errors: ["No conversation found"], session_id: "x" };
      return;
    }
    yield { type: "system", subtype: "init", session_id: "sess-new", parent_tool_use_id: null };
    if (n === 3) {
      yield { type: "assistant", parent_tool_use_id: null, session_id: "sess-new", message: { content: [{ type: "tool_use", id: "t9", name: "mcp__spoolside__printers", input: {} }] } };
      await new Promise((_, reject) => options.abortController.signal.addEventListener("abort", () => reject(Error("aborted"))));
    }
    yield { type: "assistant", parent_tool_use_id: null, session_id: "sess-new", message: { content: [{ type: "text", text: "Hi again." }] } };
  });
  try {
    s.chat.state("session", "gone");
    s.chat.send("Hi");
    await s.chat.done;
    assert.equal(s.calls[0].options.resume, "gone");
    assert.equal(s.calls[1].options.resume, undefined);
    assert.equal(s.chat.state("session"), "sess-new");
    assert.deepEqual(s.chat.view().items.map((i) => i.kind), ["user", "assistant"]);
    // Stop mid-tool: the tool is marked unfinished and the chat says it stopped.
    s.chat.send("Check the printers");
    await new Promise((r) => setTimeout(r, 10));
    s.chat.stop();
    await s.chat.done;
    const items = s.chat.view().items;
    assert.equal(items.at(-2).status, "error");
    assert.equal(items.at(-1).text, "Stopped.");
  } finally {
    s.done();
  }
  const off = setup(async function* () {}, { token: "" });
  try {
    assert.equal(off.chat.view().available, false);
    assert.match(off.chat.view().reason, /claude setup-token/);
    assert.throws(() => off.chat.send("Hi"), (e) => e.status === 503);
  } finally {
    off.done();
  }
});
