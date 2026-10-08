// Durable metadata-only usage; telemetry failure must never change app behavior.
import { appendFileSync, mkdirSync } from 'node:fs';
import { homedir, hostname, platform } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
export function reportAnthropicUsage({ usage, requestId, model, sessionId, taskId, app = 'spoolside' }, env = process.env) {
  if (!usage || !Number.isSafeInteger(usage.input_tokens) || !Number.isSafeInteger(usage.output_tokens)) return false;
  const event = { version: 1, event_id: requestId || randomUUID(), app, machine: hostname(),
    session_id: sessionId || 'printer-checks', task_id: taskId || null, provider: 'anthropic', model: model || null,
    timestamp: new Date().toISOString(), source: 'native', input_includes_cache: false,
    input_tokens: usage.input_tokens, output_tokens: usage.output_tokens,
    cached_input_tokens: usage.cache_read_input_tokens ?? 0, cache_write_tokens: usage.cache_creation_input_tokens ?? 0 };
  try {
    const root = env.TOKENLEDGER_EVENTS_DIR || (platform() === 'darwin'
      ? join(homedir(), 'Library/Application Support/TokenLedger/events')
      : join(homedir(), '.local/state/tokenledger/events'));
    mkdirSync(root, { recursive: true, mode: 0o700 });
    appendFileSync(join(root, `${app}.jsonl`), JSON.stringify(event) + '\n', { mode: 0o600 });
    return true;
  } catch { return false; }
}
