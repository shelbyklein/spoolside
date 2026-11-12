import React, { useEffect, useRef, useState } from "react";
import { AlertTriangle, ArrowUp, Check, Loader2, Square, SquarePen, Sparkles } from "lucide-react";
import { Dialog } from "./Dialog";

type Item = {
  id: number;
  kind: "user" | "assistant" | "tool" | "error" | "notice";
  created: number;
  text?: string;
  name?: string;
  input?: Record<string, unknown>;
  status?: "running" | "done" | "error";
  result?: string;
  images?: string[];
};
type Chat = { available: boolean; reason: string | null; running: boolean; partial: string; limit: { status: string; resetsAt: number | null } | null; items: Item[] };

async function call(method: string, url: string, body?: unknown): Promise<Chat> {
  const r = await fetch(url, { method, cache: "no-store", headers: body ? { "Content-Type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw Error(d.error || "Couldn't reach Claude");
  return d;
}

// What a Spoolside tool call did, in words.
export function toolLabel(item: Item): string {
  const i = item.input || {}, p = typeof i.printer === "string" ? i.printer : "";
  const failed = item.status === "error";
  switch (item.name) {
    case "printers": return "Checked the printers";
    case "camera": return `Looked through ${p ? `${p}'s` : "the"} camera`;
    case "check_bed": return `Checked ${p ? `${p}'s` : "the"} bed`;
    case "print_queue": return "Checked the print queue";
    case "library": return i.query ? `Searched the library for “${i.query}”` : "Looked through the library";
    case "start_print": return failed ? `Couldn't start the print${p ? ` on ${p}` : ""}` : `Started a print${p ? ` on ${p}` : ""}`;
    case "control_print": return `${{ pause: "Paused", resume: "Resumed", stop: "Stopped" }[String(i.action)] || "Controlled"} the print${p ? ` on ${p}` : ""}`;
    case "repeat": return `${i.action === "stop" ? "Stopped repeating" : "Started repeating"}${p ? ` on ${p}` : ""}`;
    case "auto_print": return `Turned auto-print ${i.on ? "on" : "off"}`;
    case "reviews": return "Checked print reviews";
    case "review_print": return "Reviewed a print";
    default: return String(item.name || "Used a tool").replace(/_/g, " ");
  }
}

// Just enough Markdown for chat replies: paragraphs, lists, **bold** and `code`. Built as elements, never HTML.
function inline(text: string): React.ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((part, i) =>
    part.startsWith("**") && part.endsWith("**") && part.length > 4 ? <strong key={i}>{part.slice(2, -2)}</strong>
      : part.startsWith("`") && part.endsWith("`") && part.length > 2 ? <code key={i}>{part.slice(1, -1)}</code>
      : part);
}
export function Markdown({ text }: { text: string }) {
  const blocks: React.ReactNode[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  const flush = () => {
    if (!list) return;
    const Tag = list.ordered ? "ol" : "ul";
    blocks.push(<Tag key={blocks.length}>{list.items.map((t, i) => <li key={i}>{inline(t)}</li>)}</Tag>);
    list = null;
  };
  for (const para of text.replace(/\r/g, "").split(/\n{2,}/)) {
    for (const line of para.split("\n")) {
      const m = /^\s*(?:([-*•])|(\d+)[.)])\s+(.*)$/.exec(line);
      if (m) {
        const ordered = !!m[2];
        if (list && list.ordered !== ordered) flush();
        (list ||= { ordered, items: [] }).items.push(m[3]);
      } else if (line.trim()) {
        flush();
        const heading = /^#{1,4}\s+(.*)$/.exec(line);
        blocks.push(heading ? <p key={blocks.length}><strong>{inline(heading[1])}</strong></p> : <p key={blocks.length}>{inline(line)}</p>);
      }
    }
    flush();
  }
  return <div className="chat-markdown">{blocks}</div>;
}

function ToolStep({ item }: { item: Item }) {
  return (
    <div className={`chat-tool ${item.status}`} role="status" aria-label={toolLabel(item)}>
      <span className="chat-tool-head">
        {item.status === "running" ? <Loader2 size={13} className="spin" /> : item.status === "error" ? <AlertTriangle size={13} /> : <Check size={13} />}
        {toolLabel(item)}
      </span>
      {item.status === "error" && item.result && <small>{item.result}</small>}
      {!!item.images?.length && (
        <span className="chat-tool-images">
          {item.images.map((f) => <a key={f} href={`/api/chat/images/${f}`} target="_blank" rel="noreferrer"><img src={`/api/chat/images/${f}`} alt={`Photo from ${toolLabel(item).toLowerCase()}`} /></a>)}
        </span>
      )}
    </div>
  );
}

const STARTERS = ["What's printing right now?", "Is anything waiting on me?", "Which orders are ready to ship?"];

function ChatPanel({ onClose }: { onClose: () => void }) {
  const [chat, setChat] = useState<Chat | null>(null), [text, setText] = useState(""), [error, setError] = useState(""), [sending, setSending] = useState(false);
  const list = useRef<HTMLDivElement>(null), input = useRef<HTMLTextAreaElement>(null);
  const load = () => call("GET", "/api/chat").then((d) => { setChat(d); setError(""); }).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);
  // While Claude is answering, follow along closely; otherwise just stay fresh.
  useEffect(() => {
    const timer = window.setInterval(load, chat?.running ? 700 : 15000);
    return () => clearInterval(timer);
  }, [chat?.running]);
  useEffect(() => {
    const el = list.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [chat?.items.length, chat?.partial, chat?.running]);
  const act = async (p: Promise<Chat>) => {
    try { setChat(await p); setError(""); return true; } catch (e) { setError((e as Error).message); return false; }
  };
  // `starter` sends a suggested question exactly as if it had been typed and sent.
  const send = async (e?: React.FormEvent, starter?: string) => {
    e?.preventDefault();
    const message = starter ?? text;
    if (!message.trim() || sending || chat?.running) return;
    setSending(true);
    if (await act(call("POST", "/api/chat", { text: message })) && starter === undefined) setText("");
    setSending(false);
    input.current?.focus();
  };
  const busy = !!chat?.running;
  const resets = chat?.limit?.resetsAt ? new Date(chat.limit.resetsAt).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" }) : "";
  return (
    <Dialog size="panel" className="chat-panel" bodyClassName="chat-body" title={<><Sparkles size={17} /> Claude</>} label="Claude" closeLabel="Close Claude" onClose={onClose}
      headExtra={<button className="text-button" disabled={!chat?.items.length && !busy} onClick={() => act(call("DELETE", "/api/chat"))}><SquarePen size={14} /> New chat</button>}>
        <div className="chat-list" ref={list} aria-live="polite">
          {chat && !chat.available && (
            <div className="chat-setup">
              <p><strong>Claude isn't connected yet.</strong></p>
              <p>On a computer signed in to Claude, run <code>claude setup-token</code>, then add the token to Spoolside's <code>.env</code> on the Beelink as <code>CLAUDE_CODE_OAUTH_TOKEN</code> and restart Spoolside.</p>
            </div>
          )}
          {chat?.available && !chat.items.length && !busy && (
            <div className="chat-empty">
              <Sparkles size={22} />
              <p>Ask about the farm, or have Claude do something, like starting a print.</p>
              <div className="chat-starters" role="group" aria-label="Suggested questions">
                {STARTERS.map((q) => <button key={q} type="button" className="secondary" disabled={sending} onClick={() => send(undefined, q)}>{q}</button>)}
              </div>
              <small>Uses your Claude subscription. Claude works through Spoolside, with the same camera bed checks.</small>
            </div>
          )}
          {chat?.items.map((item) =>
            item.kind === "user" ? <div key={item.id} className="chat-msg user">{item.text}</div>
              : item.kind === "assistant" ? <div key={item.id} className="chat-msg assistant"><Markdown text={item.text || ""} /></div>
              : item.kind === "tool" ? <ToolStep key={item.id} item={item} />
              : <div key={item.id} className={`chat-note ${item.kind}`} role={item.kind === "error" ? "alert" : undefined}>{item.text}</div>,
          )}
          {busy && (chat.partial ? <div className="chat-msg assistant streaming"><Markdown text={chat.partial} /></div> : <div className="chat-thinking" aria-label="Claude is working"><span /><span /><span /></div>)}
        </div>
        {chat?.limit?.status === "rejected" && <p className="chat-limit" role="status">Your Claude usage limit is reached{resets ? `; it resets ${resets}` : ""}.</p>}
        {chat?.limit?.status === "allowed_warning" && <p className="chat-limit warn" role="status">You're close to your Claude usage limit{resets ? ` (resets ${resets})` : ""}.</p>}
        {error && <p className="chat-error" role="alert">{error}</p>}
        <form className="chat-compose" onSubmit={send}>
          <textarea
            ref={input}
            aria-label="Message Claude"
            rows={1}
            maxLength={4000}
            placeholder={chat && !chat.available ? "Connect Claude first" : "Message Claude"}
            disabled={!!chat && !chat.available}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                send();
              }
            }}
          />
          {busy
            ? <button type="button" className="chat-send stop" aria-label="Stop Claude" onClick={() => act(call("POST", "/api/chat/stop"))}><Square size={14} /></button>
            : <button className="chat-send" aria-label="Send" disabled={!text.trim() || sending || !chat?.available}><ArrowUp size={17} /></button>}
        </form>
    </Dialog>
  );
}

// The header's Claude button; the panel opens over whatever page you're on.
export function ClaudeButton({ compact = false }: { compact?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className={`secondary claude-button${compact ? " icon-only" : ""}`} aria-label="Ask Claude" aria-haspopup="dialog" onClick={() => setOpen(true)}>
        <Sparkles size={16} />{!compact && " Claude"}
      </button>
      {open && <ChatPanel onClose={() => setOpen(false)} />}
    </>
  );
}
