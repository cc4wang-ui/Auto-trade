# Strategy DSL schema (v0.1)

YAML file = one strategy. Fields and types below. Required unless marked optional.

## Top-level

| Field | Type | Notes |
|---|---|---|
| `name` | str | Unique identifier, snake-or-kebab case. Filename should match. |
| `description` | str (optional) | One-line human summary |
| `universe` | list[str] | Tradeable tickers, uppercase |
| `timeframe` | str | TradingView interval syntax (`1`, `5`, `15`, `60`, `1H`, `D`, `W`) |
| `entry` | object | See [entry block](#entry) |
| `risk` | object | See [risk block](#risk) |
| `exit` | object | See [exit block](#exit) |
| `filters` | object (optional) | Additional gating, e.g. macro score thresholds |
| `enabled` | bool (default `false`) | Master toggle. False = read-only/observe-only |

## entry

| Field | Type | Notes |
|---|---|---|
| `source` | enum | `tradingview-alert` (Phase 1) or `claude-analysis` (Phase 2+) |
| `direction` | enum (default `both`) | `long`, `short`, or `both` |
| `filters` | object | See [entry.filters](#entryfilters) |

### entry.filters

Pattern-specific filters. Keys depend on `source`:

For `source: tradingview-alert` (pattern_detector_v2.pine):
- `min_quality`: int (0-100), minimum pattern quality score
- `min_rr`: float, minimum risk-reward ratio
- `patterns`: list[str] (optional), restrict to specific pattern names (e.g. `["雙重底", "反轉頭肩底"]`)

For `source: claude-analysis` (Phase 2):
- `claude_prompt_template`: path to a prompt file Claude evaluates per bar

## risk

| Field | Type | Notes |
|---|---|---|
| `per_trade_dollars` | float | Maximum loss if stop hits. MUST be ≤ `MAX_RISK_DOLLARS_PER_TRADE` env var. |
| `daily_loss_cap` | float | MUST be ≤ `MAX_DAILY_LOSS_DOLLARS` env var. Strategy-specific lower cap is allowed. |
| `max_concurrent` | int (default 1) | Max simultaneous open positions for this strategy |

## exit

| Field | Type | Notes |
|---|---|---|
| `type` | enum | `bracket` (Phase 1) or `manual` (Phase 2) |
| `stop` | str / float | For `bracket`: either `signal.stop_price` (use signal payload) or a fixed price |
| `target` | str / float | Same — `signal.target_price` or fixed |

## filters (top-level, optional)

For cross-cutting gates that apply before any entry. Examples:

```yaml
filters:
  macro_score_min: -10        # only trade when v10 macro score above this
  vix_below: 25                # only trade when VIX < 25
  market_hours_only: true      # only RTH, no extended hours
```

These are advisory — `loader.py` parses them into a structured `filters` object
that Claude consults before any entry. The IB MCP server's safety guards remain
the hard floor regardless.

## Example: minimum viable

```yaml
name: sofi-pattern-v2
universe: [SOFI]
timeframe: 1H
entry:
  source: tradingview-alert
  filters:
    min_quality: 70
    min_rr: 1.5
risk:
  per_trade_dollars: 25
  daily_loss_cap: 50
exit:
  type: bracket
  stop: signal.stop_price
  target: signal.target_price
```

## Example: with macro gate

```yaml
name: sofi-pattern-v2-macro-gated
description: SOFI v2 patterns but only when macro tailwind is positive
universe: [SOFI]
timeframe: 1H
entry:
  source: tradingview-alert
  direction: long
  filters:
    min_quality: 75      # tighter than default
    min_rr: 1.8
    patterns: [雙重底, 反轉頭肩底]
risk:
  per_trade_dollars: 20
  daily_loss_cap: 40
exit:
  type: bracket
  stop: signal.stop_price
  target: signal.target_price
filters:
  macro_score_min: 0     # only trade when macro score >= 0
```

## Validation

`loader.py` runs every YAML through `pydantic` models and returns a typed
`Strategy` object. Invalid YAMLs raise `ValidationError` with field-level detail.

Run `pytest strategies/tests/` to validate every file in this directory.
