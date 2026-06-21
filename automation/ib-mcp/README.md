# ib-mcp — Interactive Brokers ↔ Claude Code MCP server

Lets Claude (Code or Desktop) place orders, read positions, and pull market data
from your IB account by calling MCP tools. Built specifically for Cross's
$500 auto-trade workflow: SOFI-only watchlist, $25 per-trade risk cap, $50
daily loss cap, paper-only by default, kill-switch file, full audit logging.

## What this is

```
┌───────────────────┐  MCP tools  ┌──────────────┐  ib_async  ┌───────────────┐
│  Claude Code      │ ─────────▶  │  ib-mcp      │ ─────────▶ │  IB Gateway   │
│  (chat / Routine) │             │  server.py   │            │  (paper:7497) │
└───────────────────┘             └──────────────┘            └───────────────┘
                                          │
                                          ▼
                                  safety guards
                              (watchlist, risk cap,
                               daily loss, kill switch)
```

## Tools exposed

Read-only (always available):
- `get_quote(symbol)` — bid/ask/last snapshot
- `get_positions()` — current holdings
- `get_account_summary()` — NetLiquidation, BuyingPower, etc.
- `get_open_orders()` — working orders
- `get_historical_bars(symbol, duration, bar_size)` — OHLCV
- `get_daily_loss_status()` — today's realised loss vs cap

Order tools (skipped when `READ_ONLY=true`):
- `place_market_order(symbol, side, qty, reference_price, stop_price)`
- `place_bracket_order(symbol, side, qty, entry_reference_price, stop_price, target_price)` — primary entry
- `cancel_order(order_id)`
- `cancel_all_orders()`

Every order tool runs through the safety guards in `safety.py` before the IB call.

## Quick start (Mac)

See [docs/setup-mac.md](docs/setup-mac.md) for the full walkthrough. Three steps:

1. Install IB Gateway, enable API, set paper auto-login
2. `pip install -e '.[dev]'` in this directory
3. Copy `.env.example` → `.env`, register in `~/.claude.json` (see [docs/claude-config.md](docs/claude-config.md))

## Safety contract

Every order tool, before any IB call:
- Refuses if `/tmp/ib-mcp-pause` exists (kill switch)
- Refuses if `READ_ONLY=true`
- Refuses live ports (7496, 4001) unless `ENABLE_LIVE_TRADING=true`
- Refuses if symbol not in `WATCHLIST`
- Refuses if today's realised loss ≥ `MAX_DAILY_LOSS_DOLLARS`
- Refuses if `(entry - stop) × qty > MAX_RISK_DOLLARS_PER_TRADE`

Tests cover every reject branch. See [docs/safety.md](docs/safety.md) for rationale and edge cases.

## Development

```bash
cd automation/ib-mcp
python3 -m venv .venv && source .venv/bin/activate
pip install -e '.[dev]'
PYTHONPATH=src pytest -v
ruff check src tests
mypy src
```

CI runs all three on every push (see `.github/workflows/validate.yml`).

## What this is NOT

- Not a strategy engine — it executes orders, doesn't decide them
- Not a backtester — use `pattern_detector_v2_strategy.pine` in TradingView for that
- Not a market data warehouse — it streams snapshots, doesn't persist bars
- Not a multi-account router — single IB account per server instance

Strategy decisions live in:
- `strategies/*.yaml` — declarative DSL (this PR adds the prototype)
- Claude itself, reading those YAMLs + market data via MCP

## Status

**Phase 0 (this PR)**: scaffolded server + safety + tools + 45 mocked tests passing.
**Phase 1 (next)**: Cross installs IB Gateway on Mac, we wire it up end-to-end.
**Phase 2+**: Signal ingestion (TradingView webhook → MCP), NL strategy DSL execution, AI alpha analysis loops.
