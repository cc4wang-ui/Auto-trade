"""MCP tool implementations.

Each tool is an async function that:
    1. Runs safety guards (rejecting on failure with a clear message for Claude)
    2. Delegates to IBClient for the actual broker call
    3. Returns a plain dict / list / scalar that FastMCP serialises to MCP

Server.py registers these on the FastMCP instance.
"""

from __future__ import annotations

import logging
from typing import Any, Literal

from .client import BracketResult, IBClient, OrderResult
from .safety import SafetyConfig, SafetyReject, assert_order_allowed
from .state import DailyLossTracker

log = logging.getLogger(__name__)

Side = Literal["buy", "sell"]


def _format_reject(e: SafetyReject) -> dict[str, Any]:
    return {"ok": False, "error": "safety_reject", "message": str(e)}


async def get_quote(client: IBClient, symbol: str) -> dict[str, Any]:
    """MCP tool: snapshot bid/ask/last for one US stock."""
    quote = await client.get_quote(symbol)
    return {"ok": True, "quote": quote}


async def get_positions(client: IBClient) -> dict[str, Any]:
    positions = await client.get_positions()
    return {"ok": True, "positions": positions, "count": len(positions)}


async def get_account_summary(client: IBClient) -> dict[str, Any]:
    summary = await client.get_account_summary()
    return {"ok": True, "summary": summary}


async def get_open_orders(client: IBClient) -> dict[str, Any]:
    orders = await client.get_open_orders()
    return {"ok": True, "orders": orders, "count": len(orders)}


async def get_historical_bars(
    client: IBClient,
    symbol: str,
    duration: str = "1 D",
    bar_size: str = "1 hour",
) -> dict[str, Any]:
    bars = await client.get_historical_bars(symbol, duration, bar_size)
    return {"ok": True, "symbol": symbol.upper(), "bars": bars, "count": len(bars)}


async def place_market_order(
    client: IBClient,
    config: SafetyConfig,
    tracker: DailyLossTracker,
    port: int,
    *,
    symbol: str,
    side: Side,
    qty: int,
    reference_price: float,
    stop_price: float,
) -> dict[str, Any]:
    """Standalone market order, with stop_price required for risk-cap calc.

    Use `place_bracket_order` for actual entries; this tool is for ad-hoc moves
    where Claude needs to enter without a target (rare; prefer brackets).
    """
    try:
        assert_order_allowed(
            config,
            port=port,
            symbol=symbol,
            side=side,
            qty=qty,
            entry_price=reference_price,
            stop_price=stop_price,
            realised_loss_today=tracker.current_loss(),
        )
    except SafetyReject as e:
        log.warning("place_market_order rejected: %s", e)
        return _format_reject(e)

    result = await client.place_market_order(symbol, side, qty)
    log.info("place_market_order accepted: %s", result)
    return {"ok": True, "order": result.to_dict()}


async def place_bracket_order(
    client: IBClient,
    config: SafetyConfig,
    tracker: DailyLossTracker,
    port: int,
    *,
    symbol: str,
    side: Side,
    qty: int,
    entry_reference_price: float,
    stop_price: float,
    target_price: float,
) -> dict[str, Any]:
    """Primary entry tool: market parent + OCA stop + OCA target.

    Matches the v2 pattern_detector_v2.pine LAYER 6 output shape.
    """
    try:
        assert_order_allowed(
            config,
            port=port,
            symbol=symbol,
            side=side,
            qty=qty,
            entry_price=entry_reference_price,
            stop_price=stop_price,
            realised_loss_today=tracker.current_loss(),
        )
    except SafetyReject as e:
        log.warning("place_bracket_order rejected: %s", e)
        return _format_reject(e)

    result = await client.place_bracket_order(
        symbol=symbol,
        side=side,
        qty=qty,
        stop_price=stop_price,
        target_price=target_price,
    )
    log.info("place_bracket_order accepted: %s", result)
    return {"ok": True, "bracket": result.to_dict()}


async def cancel_order(client: IBClient, order_id: int) -> dict[str, Any]:
    result = await client.cancel_order(order_id)
    return {"ok": True, **result}


async def cancel_all_orders(client: IBClient) -> dict[str, Any]:
    results = await client.cancel_all_orders()
    return {"ok": True, "cancelled": results, "count": len(results)}


async def get_daily_loss_status(
    config: SafetyConfig, tracker: DailyLossTracker
) -> dict[str, Any]:
    current = tracker.current_loss()
    return {
        "ok": True,
        "current_loss": current,
        "cap": config.max_daily_loss_dollars,
        "remaining_headroom": max(0.0, config.max_daily_loss_dollars - current),
        "halted": current >= config.max_daily_loss_dollars,
    }


def _ensure_order_helpers_in_scope() -> None:
    """Mypy helper to ensure dataclasses are referenced (avoids unused warnings)."""
    _ = (OrderResult, BracketResult)
