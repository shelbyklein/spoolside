# Spoolside MCP

Lets Claude and Codex see and run the print farm through Spoolside's own API, so every action gets the app's
safety checks (camera bed check before starts, AMS validation, order reservations).

## Tools

| Tool | What it does |
|---|---|
| `printers` | Every printer: state, job, progress, temps, filament, repeat status, alerts, reviews waiting |
| `camera` | A fresh camera photo from a printer |
| `check_bed` | The camera bed check: is the plate clear? |
| `print_queue` | Order pieces still to print, what's blocking them, auto-print on/off |
| `library` | Search sliced prints (ids for `start_print`) |
| `start_print` | Start a library print or the last print again; refused if the camera sees something on the bed |
| `control_print` | Pause, resume or stop |
| `repeat` | Repeat a printer's print each time the bed is cleared, or stop repeating |
| `auto_print` | Auto-print on or off |
| `reviews` / `review_print` | Finished prints waiting for review; mark fine, failed, or delete |

Printers can be named loosely ("membrane", "ams3") or by serial.

## Setup

1. `npm install` in this folder.
2. Create a key on the server and save it privately (it's printed once; only its hash is stored):
   `ssh beelink 'docker exec -w /app spoolside-app-1 node server/apikey.mjs create mcp-mac' > ~/.config/spoolside/api-key && chmod 600 ~/.config/spoolside/api-key`
   (`list` and `revoke <name>` manage keys.)
3. Register it:
   - Claude Code: `claude mcp add --scope user spoolside -- node /path/to/Spoolside/mcp/server.mjs`
   - Codex (`~/.codex/config.toml`): `[mcp_servers.spoolside]` with `command = "node"` and `args = ["/path/to/Spoolside/mcp/server.mjs"]`

`SPOOLSIDE_URL` overrides the server (default `https://spoolside.shelbyklein.com`); `SPOOLSIDE_API_KEY` overrides the key file.
