# strategies/

Declarative strategy definitions in YAML. Each file describes one trading
strategy in a structured format that Claude reads and acts on.

This is **Phase 0 / DSL prototype** — only declarative fields, no code execution.

## Why a DSL instead of writing Python directly?

- **Reviewable by you** (the human) — no Python required to see what's running
- **Version-controlled diff-friendly** — change `min_quality: 70 → 75` in one line
- **Type-safe via schema** — `loader.py` validates before Claude sees it
- **Future-proof for NL input** — Phase 2 lets Claude write/edit these YAMLs from
  chat ("change the SOFI strategy to risk $15 per trade")

## Current schema

See [`schema.md`](schema.md) for the full spec. Minimum viable example
([`sofi-pattern-v2.yaml`](sofi-pattern-v2.yaml)):

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

## How Claude uses this

1. You ask: "trade the sofi strategy"
2. Claude calls `strategies.loader.load("sofi-pattern-v2")` (or reads the YAML)
3. Claude gets a typed `Strategy` object describing what's allowed
4. Claude decides whether incoming signals (from Pine alerts / its own analysis)
   match the entry criteria
5. Claude calls `mcp__ib__place_bracket_order(...)` with the parameters derived
   from the matched signal

The strategy DSL is **prescriptive intent**, not execution code. Execution lives
in the IB MCP server's tools.

## Adding a new strategy

```bash
cp sofi-pattern-v2.yaml my-new-strategy.yaml
# edit the fields
pytest tests/  # confirms loader still parses every yaml in the dir
```

If you add a new field, update `schema.md` AND `loader.py` AND a test.

## Phase 2 vision

Future Cross interaction:

```
You: I want to short SOXL whenever the macro score drops below 5
You: Cap risk at $20 per trade, daily loss cap $40
Claude: [writes strategies/soxl-macro-short.yaml]
Claude: Strategy created. Want me to enable it?
You: Yes
Claude: [updates strategies/active.txt to include soxl-macro-short]
```

The YAML stays human-readable so you can audit and edit at any time.
