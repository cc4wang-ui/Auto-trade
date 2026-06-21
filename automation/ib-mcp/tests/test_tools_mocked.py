"""Tool-level tests using FakeIB (the IB stand-in defined in conftest.py).

Verifies:
- Tools call the correct underlying IB methods
- Safety rejects flow back as {"ok": False, "error": "safety_reject", ...}
- Bracket order results have the expected shape and IB calls
"""

from __future__ import annotations

import pytest

from ib_mcp import tools as t
from ib_mcp.client import IBClient
from ib_mcp.safety import SafetyConfig
from ib_mcp.state import DailyLossTracker

# Tests are async; conftest sets asyncio_mode=auto.


# ─── Read-only tools ─────────────────────────────────────────────────────


async def test_get_quote_returns_normalised_snapshot(client: IBClient) -> None:
    res = await t.get_quote(client, "SOFI")
    assert res["ok"] is True
    quote = res["quote"]
    assert quote["symbol"] == "SOFI"
    assert quote["bid"] == 15.50
    assert quote["ask"] == 15.52


async def test_get_positions_empty(client: IBClient) -> None:
    res = await t.get_positions(client)
    assert res == {"ok": True, "positions": [], "count": 0}


async def test_get_account_summary_empty(client: IBClient) -> None:
    res = await t.get_account_summary(client)
    assert res == {"ok": True, "summary": {}}


async def test_get_open_orders_empty(client: IBClient) -> None:
    res = await t.get_open_orders(client)
    assert res == {"ok": True, "orders": [], "count": 0}


async def test_get_historical_bars_empty(client: IBClient) -> None:
    res = await t.get_historical_bars(client, "SOFI", "1 D", "1 hour")
    assert res == {"ok": True, "symbol": "SOFI", "bars": [], "count": 0}


# ─── Order tools — happy path ─────────────────────────────────────────────


async def test_place_market_order_happy(
    client: IBClient,
    fake_ib,
    safety_config: SafetyConfig,
    tracker: DailyLossTracker,
) -> None:
    res = await t.place_market_order(
        client,
        safety_config,
        tracker,
        port=7497,
        symbol="SOFI",
        side="buy",
        qty=20,
        reference_price=15.50,
        stop_price=14.50,
    )
    assert res["ok"] is True
    order = res["order"]
    assert order["symbol"] == "SOFI"
    assert order["action"] == "BUY"
    assert order["qty"] == 20
    assert order["order_type"] == "MKT"
    assert len(fake_ib.placed_orders) == 1


async def test_place_bracket_order_happy(
    client: IBClient,
    fake_ib,
    safety_config: SafetyConfig,
    tracker: DailyLossTracker,
) -> None:
    res = await t.place_bracket_order(
        client,
        safety_config,
        tracker,
        port=7497,
        symbol="SOFI",
        side="buy",
        qty=20,
        entry_reference_price=15.50,
        stop_price=14.50,
        target_price=17.00,
    )
    assert res["ok"] is True
    bracket = res["bracket"]
    # parent (MKT BUY), stop (STP SELL), target (LMT SELL) — three IB placeOrder calls
    assert len(fake_ib.placed_orders) == 3
    assert bracket["parent"]["action"] == "BUY"
    assert bracket["parent"]["order_type"] == "MKT"
    assert bracket["target"]["action"] == "SELL"
    assert bracket["target"]["order_type"] == "LMT"
    assert bracket["stop"]["action"] == "SELL"
    assert bracket["stop"]["order_type"] == "STP"


# ─── Order tools — safety rejection paths ─────────────────────────────────


async def test_place_bracket_rejected_when_off_watchlist(
    client: IBClient,
    fake_ib,
    safety_config: SafetyConfig,
    tracker: DailyLossTracker,
) -> None:
    res = await t.place_bracket_order(
        client,
        safety_config,
        tracker,
        port=7497,
        symbol="AAPL",  # not in WATCHLIST=SOFI
        side="buy",
        qty=10,
        entry_reference_price=200.0,
        stop_price=190.0,
        target_price=220.0,
    )
    assert res["ok"] is False
    assert res["error"] == "safety_reject"
    assert "WATCHLIST" in res["message"]
    assert fake_ib.placed_orders == []  # no IB call attempted


async def test_place_bracket_rejected_when_risk_too_high(
    client: IBClient,
    fake_ib,
    safety_config: SafetyConfig,
    tracker: DailyLossTracker,
) -> None:
    # qty 30 × $1 risk per share = $30, cap is $25
    res = await t.place_bracket_order(
        client,
        safety_config,
        tracker,
        port=7497,
        symbol="SOFI",
        side="buy",
        qty=30,
        entry_reference_price=15.50,
        stop_price=14.50,
        target_price=17.00,
    )
    assert res["ok"] is False
    assert "exceeds cap" in res["message"]
    assert fake_ib.placed_orders == []


async def test_place_bracket_rejected_on_live_port(
    client: IBClient,
    fake_ib,
    safety_config: SafetyConfig,
    tracker: DailyLossTracker,
) -> None:
    res = await t.place_bracket_order(
        client,
        safety_config,
        tracker,
        port=7496,  # live TWS
        symbol="SOFI",
        side="buy",
        qty=10,
        entry_reference_price=15.50,
        stop_price=14.50,
        target_price=17.00,
    )
    assert res["ok"] is False
    assert "live-trading port" in res["message"]
    assert fake_ib.placed_orders == []


async def test_place_bracket_rejected_when_paused(
    client: IBClient,
    fake_ib,
    safety_config: SafetyConfig,
    tracker: DailyLossTracker,
) -> None:
    safety_config.pause_file.touch()
    res = await t.place_bracket_order(
        client,
        safety_config,
        tracker,
        port=7497,
        symbol="SOFI",
        side="buy",
        qty=10,
        entry_reference_price=15.50,
        stop_price=14.50,
        target_price=17.00,
    )
    assert res["ok"] is False
    assert "Trading paused" in res["message"]
    assert fake_ib.placed_orders == []


async def test_place_bracket_rejected_when_daily_loss_hit(
    client: IBClient,
    fake_ib,
    safety_config: SafetyConfig,
    tracker: DailyLossTracker,
) -> None:
    tracker.record_realised_pnl(-60.0)  # exceed $50 cap
    res = await t.place_bracket_order(
        client,
        safety_config,
        tracker,
        port=7497,
        symbol="SOFI",
        side="buy",
        qty=10,
        entry_reference_price=15.50,
        stop_price=14.50,
        target_price=17.00,
    )
    assert res["ok"] is False
    assert "Daily loss" in res["message"]
    assert fake_ib.placed_orders == []


# ─── Cancel + daily loss reporter ─────────────────────────────────────────


async def test_cancel_order_not_found(client: IBClient) -> None:
    res = await t.cancel_order(client, 9999)
    assert res["ok"] is True
    assert res["status"] == "not_found"


async def test_get_daily_loss_status_clean(
    safety_config: SafetyConfig, tracker: DailyLossTracker
) -> None:
    res = await t.get_daily_loss_status(safety_config, tracker)
    assert res["current_loss"] == 0.0
    assert res["cap"] == 50.0
    assert res["remaining_headroom"] == 50.0
    assert res["halted"] is False


async def test_get_daily_loss_status_halted(
    safety_config: SafetyConfig, tracker: DailyLossTracker
) -> None:
    tracker.record_realised_pnl(-55.0)
    res = await t.get_daily_loss_status(safety_config, tracker)
    assert res["halted"] is True
    assert res["remaining_headroom"] == 0.0
