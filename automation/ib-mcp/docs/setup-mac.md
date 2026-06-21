# Setup ib-mcp on macOS — Step by Step

Goal: Claude Code on your Mac can place orders against your IB **paper** account
via this MCP server. Estimated time: 60 minutes the first time.

## Prerequisites

- Mac with macOS 13+
- IB paper account already funded (you've done this)
- Python 3.10+ (`python3 --version`)
- Claude Code installed locally (`claude --version`)

## Part 1 — Install IB Gateway (~20 min)

IB Gateway is the small headless app that handles the IB connection. You'll run it
during US market hours (21:30–04:00 Taipei time).

1. Download **IB Gateway latest stable** from
   https://www.interactivebrokers.com/en/trading/ibgateway-stable.php
   → choose macOS version

2. Run the installer. Default path is fine.

3. First launch:
   - Login mode: **Paper Trading**
   - Username/password: your IB paper credentials
   - Trading mode: Paper
   - Sign in

4. Once logged in, open **Configure** → **Settings**:
   - **API → Settings**:
     - ✅ Enable ActiveX and Socket Clients
     - ✅ Read-Only API: **OFF** (we need to place orders)
     - Socket port: **7497** (paper) — keep default
     - ✅ Allow connections from localhost only
     - Trusted IPs: leave empty (we only connect from localhost)
   - **API → Precautions**:
     - ⬜ Bypass Order Precautions for API Orders (leave OFF — extra IB-side safety)
   - **Lock and Exit** options:
     - ✅ Auto restart (so a crash recovers)

5. Confirm port is listening:
   ```bash
   nc -zv 127.0.0.1 7497
   # expect: Connection to 127.0.0.1 port 7497 [tcp/*] succeeded!
   ```

6. **Optional but recommended — Auto-restart**:
   - Configure → Settings → Lock and Exit → **Auto restart** every 24h at 11:45 ET
   - Without this, IB Gateway logs you out daily at 22:00 ET

## Part 2 — Install ib-mcp (~10 min)

```bash
cd /path/to/Auto-trade/automation/ib-mcp
python3 -m venv .venv
source .venv/bin/activate
pip install -e '.[dev]'
```

Verify the install:
```bash
PYTHONPATH=src pytest -v
# expect: 45 passed in <0.1s
```

Create your env file:
```bash
cp .env.example .env
# Edit .env if you want to tighten any limits.
# Defaults: paper-only, SOFI watchlist, $25 risk, $50 daily loss
```

Smoke test the IB connection (only do this when IB Gateway is logged in):
```bash
source .venv/bin/activate
python -c "
import asyncio
from ib_mcp.client import IBClient
async def main():
    c = IBClient.with_real_ib()
    await c.connect('127.0.0.1', 7497, 17)
    q = await c.get_quote('SOFI')
    print(q)
    await c.disconnect()
asyncio.run(main())
"
# expect: dict with bid/ask/last/etc.
```

If the smoke test prints SOFI quote → ✅ ready for Part 3. If it errors out, see Troubleshooting below.

## Part 3 — Register with Claude Code (~5 min)

Tell Claude Code about your MCP server. Edit `~/.claude.json` and add:

```json
{
  "mcpServers": {
    "ib": {
      "command": "/absolute/path/to/Auto-trade/automation/ib-mcp/.venv/bin/python",
      "args": ["-m", "ib_mcp.server"],
      "env": {
        "PYTHONPATH": "/absolute/path/to/Auto-trade/automation/ib-mcp/src"
      }
    }
  }
}
```

Replace `/absolute/path/to/Auto-trade` with the real path (`pwd` in the repo root).

See `claude-config.md` for the project-scoped alternative (`.mcp.json` in the repo).

Restart Claude Code. In the chat, type `/mcp` — you should see `ib` listed.

## Part 4 — First end-to-end test

In Claude Code chat:

```
You: 用 IB MCP 看一下 SOFI 現在的報價
Claude: [calls mcp__ib__get_quote(symbol="SOFI")]
Result: bid 15.50, ask 15.52, last 15.51, ...

You: 我目前有什麼部位？
Claude: [calls mcp__ib__get_positions()]
Result: (empty if you haven't traded yet)

You: 幫我下一筆 SOFI bracket order，buy 20 股 market，stop 14.50，target 17.00
Claude: [calls mcp__ib__place_bracket_order(...)]
Result: parent + stop + target order IDs
```

In IB Gateway you should see 3 working orders (parent BUY, child SELL stop, child SELL limit).

Cancel them to keep the paper account clean:
```
You: 全部取消
Claude: [calls mcp__ib__cancel_all_orders()]
```

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| `nc -zv 127.0.0.1 7497` connection refused | IB Gateway not running OR API not enabled |
| Smoke test hangs forever | IB Gateway is showing a popup (e.g. login warning) — click through |
| Smoke test errors with "TimeoutError" | Client ID conflict; try `IB_CLIENT_ID=42` in `.env` |
| Claude doesn't see `ib` in `/mcp` | Path in `~/.claude.json` is wrong; use `python -m ib_mcp.server` from inside the venv to verify it starts |
| Orders rejected with "exceeds cap" | qty × (entry-stop) > $25; reduce qty or raise `MAX_RISK_DOLLARS_PER_TRADE` |
| Orders rejected with "not in WATCHLIST" | Symbol not in `WATCHLIST=...`; add to .env and restart server |

## Daily routine

When US market opens:
1. Open IB Gateway (auto-launches if you set Login at boot)
2. Verify Claude Code can see `ib` MCP (`/mcp`)
3. Do whatever — Claude can now trade

When you want to pause everything quickly:
```bash
touch /tmp/ib-mcp-pause
```
All order tools will refuse until you `rm /tmp/ib-mcp-pause`.

When you go to live trading (much later):
- Set `ENABLE_LIVE_TRADING=true` in `.env`
- Change `IB_PORT` to `7496`
- Re-run smoke test against a live login (extra care!)
- Strongly recommended: set `MAX_RISK_DOLLARS_PER_TRADE=12.5` for the first week
