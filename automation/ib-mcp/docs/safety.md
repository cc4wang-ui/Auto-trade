# Safety guards — what they do and why

Every order tool runs `assert_order_allowed()` from `safety.py` before any IB call.
The checks run in this order; first failure aborts.

## 1. Pause file kill switch

```python
check_pause(config)
```

If `PAUSE_FILE` exists, all order tools refuse. Default location `/tmp/ib-mcp-pause`.

**Why**: human-triggered stop, faster than editing config. When something looks
wrong (weird fills, unexpected losses), `touch /tmp/ib-mcp-pause` halts every
future order in one command.

**Usage**:
```bash
touch /tmp/ib-mcp-pause       # halt
rm /tmp/ib-mcp-pause          # resume
```

## 2. Read-only mode

```python
check_read_only(config)
```

If `READ_ONLY=true`, order tools aren't even registered on the MCP server. Reads
(quote, positions, summary) still work.

**Why**: when developing/iterating on strategy logic with Claude, you want to be
100% certain no order can fire by mistake. Read-only is the strongest guarantee
because the tool literally doesn't exist for Claude to call.

## 3. Live-trading port refusal

```python
check_live_trading_port(config, port)
```

Live ports: 7496 (TWS live), 4001 (Gateway live). Paper: 7497 (TWS paper), 4002 (Gateway paper).

If the configured `IB_PORT` is a live one AND `ENABLE_LIVE_TRADING=false` (the
default), refuses. This catches the "I accidentally connected to live" mistake.

**Why**: paper port works on a paper IB login; live port works on live. You can
configure either in IB Gateway. This guard prevents the case where the operator
edits `IB_PORT` to 7496 without also flipping `ENABLE_LIVE_TRADING=true`.

## 4. Watchlist whitelist

```python
check_watchlist(config, symbol)
```

If `WATCHLIST` is non-empty, the symbol must be in the comma-separated list.

**Why**: defence in depth. The Pine indicator already filters by watchlist, but
if Claude (or a future signal source) tries to trade an off-list symbol, this
catches it.

**Defaults**: `WATCHLIST=SOFI` — start narrow, expand once paper trading is
validated for one ticker at a time.

**Empty whitelist disables the check** — explicitly choose this if you want
Claude to trade arbitrary symbols (e.g. for one-off manual orders).

## 5. Daily loss cap

```python
check_daily_loss(config, realised_loss_today)
```

`DailyLossTracker` persists today's net realised loss to disk
(`~/.local/state/ib-mcp/daily_loss.json`) and resets at midnight America/New_York.

If today's realised loss has reached `MAX_DAILY_LOSS_DOLLARS`, refuses new orders.

**Why**: caps tail risk on bad days. Paper or live, getting halted after $50 of
losses forces a pause to think before continuing.

**Default**: `MAX_DAILY_LOSS_DOLLARS=50` (10% of $500 budget).

**Note**: existing positions are NOT closed when the cap hits — only new orders
are blocked. Manage open positions manually if you want flat-by-end-of-day.

## 6. Per-trade risk cap

```python
check_risk_dollars(config, side, qty, entry_price, stop_price)
```

Computes `(entry - stop) × qty` and refuses if it exceeds `MAX_RISK_DOLLARS_PER_TRADE`.
Also validates basic invariants (positive qty/prices, long stop < entry, short stop > entry).

**Why**: this is the per-trade safety net that mirrors the Pine indicator's
risk_dollar_amount sizing. Independently re-checked here in case Claude
mis-calculates or the signal source has a bug.

**Default**: `$25` = 5% of $500 budget.

## Bypassing for debugging

Don't. Edit `.env` if you genuinely need looser limits. Never patch the source.

The one exception: in tests, `SafetyConfig.from_env({...})` accepts an explicit
env dict, so tests can construct configs with any values without affecting your
local `.env`.

## What's NOT checked

These are explicitly out of scope:
- **Total exposure cap** — don't have a "max $X of open positions" guard yet.
  Daily loss cap covers the bleeding-out case; absolute exposure is a future add.
- **Market hours** — server doesn't refuse orders outside RTH. IB Gateway
  rejects them at the broker level if extendedHours is off in the order.
- **Position sizing math** — we trust the signal source (Pine, Claude) to
  compute qty. Safety only checks the resulting risk is under cap.
- **Per-symbol concentration** — no "max N shares of SOFI" check.
- **Wash sale / pattern-day-trader rules** — IB handles these at the broker side.

If any of these become important, add them as new `check_*` functions in
`safety.py` and a corresponding call from `assert_order_allowed`. Cover with tests.

## Audit log

Every order tool logs:
- INFO on accept (includes the order result)
- WARN on safety reject (includes the reject message)

Configure with `LOG_LEVEL=DEBUG` in `.env` to see lower-level IB protocol detail.
