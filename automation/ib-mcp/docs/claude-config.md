# Registering ib-mcp with Claude Code

Two options: **global** (works in any directory) or **project-scoped**
(only when Claude Code is run from this repo). Pick one.

## Option A — Global (`~/.claude.json`)

Best if you want to use ib-mcp from anywhere on your Mac.

```json
{
  "mcpServers": {
    "ib": {
      "command": "/Users/cross/Auto-trade/automation/ib-mcp/.venv/bin/python",
      "args": ["-m", "ib_mcp.server"],
      "env": {
        "PYTHONPATH": "/Users/cross/Auto-trade/automation/ib-mcp/src"
      }
    }
  }
}
```

Replace `/Users/cross/Auto-trade` with your actual path (run `pwd` in the repo root).

## Option B — Project-scoped (`.mcp.json` in repo root)

Best if you want this MCP only loaded when Claude Code is run from the repo.
Creates a `.mcp.json` at `/home/user/Auto-trade/.mcp.json`:

```json
{
  "mcpServers": {
    "ib": {
      "command": "./automation/ib-mcp/.venv/bin/python",
      "args": ["-m", "ib_mcp.server"],
      "env": {
        "PYTHONPATH": "./automation/ib-mcp/src"
      }
    }
  }
}
```

Relative paths resolve from the repo root when Claude Code starts there.

## Env vars override .env

If you want different limits per project, you can pass env vars directly:

```json
{
  "mcpServers": {
    "ib": {
      "command": "/path/.venv/bin/python",
      "args": ["-m", "ib_mcp.server"],
      "env": {
        "PYTHONPATH": "/path/src",
        "MAX_RISK_DOLLARS_PER_TRADE": "10",
        "WATCHLIST": "SOFI,SOXL",
        "READ_ONLY": "true"
      }
    }
  }
}
```

These take precedence over `.env`.

## Verifying

In Claude Code:
```
/mcp
```

Expected output includes `ib` server with these tools:
- get_quote, get_positions, get_account_summary, get_open_orders,
- get_historical_bars, get_daily_loss_status,
- place_market_order, place_bracket_order, cancel_order, cancel_all_orders
  (the last 4 are absent if READ_ONLY=true)

If `ib` is missing:
1. Try running the server manually: `cd automation/ib-mcp && .venv/bin/python -m ib_mcp.server`
2. If that errors → fix the install (see setup-mac.md)
3. If it runs but Claude doesn't see it → check the path in `~/.claude.json` is absolute, and that the JSON is valid (run `cat ~/.claude.json | python -m json.tool`)

## Multiple environments

Want a paper-only "read-only analysis" mode + a separate "paper trading" mode?
Register both with different names:

```json
{
  "mcpServers": {
    "ib-readonly": {
      "command": "...",
      "args": ["-m", "ib_mcp.server"],
      "env": { "PYTHONPATH": "...", "READ_ONLY": "true", "IB_CLIENT_ID": "20" }
    },
    "ib-paper": {
      "command": "...",
      "args": ["-m", "ib_mcp.server"],
      "env": { "PYTHONPATH": "...", "READ_ONLY": "false", "IB_CLIENT_ID": "21" }
    }
  }
}
```

⚠ Use different `IB_CLIENT_ID` values — IB Gateway rejects duplicate client IDs.

## Production hardening (Phase 2)

For autonomous Routines (Claude Code on the web), you'll need an HTTP/SSE
transport instead of stdio, exposed via Cloudflare Tunnel or similar.
That's Phase 2 work — out of scope for this PR.
