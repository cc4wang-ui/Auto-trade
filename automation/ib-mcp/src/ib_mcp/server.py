"""FastMCP server entry point.

Run as:
    python -m ib_mcp.server          # stdio mode (used by Claude Code)
    ib-mcp                            # same, via the console script

Reads config from .env (loaded by python-dotenv if present), then env vars.
Connects to IB Gateway on startup, exposes the tools from tools.py.
"""

from __future__ import annotations

import asyncio
import logging
import os
from typing import Any, Literal

from dotenv import load_dotenv
from fastmcp import FastMCP

from .client import IBClient
from .safety import SafetyConfig
from .state import DailyLossTracker
from . import tools as t

log = logging.getLogger(__name__)
Side = Literal["buy", "sell"]


def _build_server() -> tuple[FastMCP, IBClient, SafetyConfig, DailyLossTracker, int]:
    load_dotenv()
    config = SafetyConfig.from_env()
    tracker = DailyLossTracker(
        timezone=os.environ.get("RESET_TIMEZONE", "America/New_York")
    )
    host = os.environ.get("IB_HOST", "127.0.0.1")
    port = int(os.environ.get("IB_PORT", "7497"))
    client_id = int(os.environ.get("IB_CLIENT_ID", "17"))

    log.info(
        "IB MCP starting | host=%s port=%s client_id=%s read_only=%s live=%s watchlist=%s",
        host,
        port,
        client_id,
        config.read_only,
        config.enable_live_trading,
        sorted(config.watchlist) or "ALL",
    )

    client = IBClient.with_real_ib()
    mcp = FastMCP("ib-mcp")

    # ─── Read-only tools (always registered) ────────────────────────────────
    @mcp.tool()
    async def get_quote(symbol: str) -> dict[str, Any]:
        """Snapshot quote (bid/ask/last/close/volume) for one US stock."""
        return await t.get_quote(client, symbol)

    @mcp.tool()
    async def get_positions() -> dict[str, Any]:
        """List all open positions across the connected IB account."""
        return await t.get_positions(client)

    @mcp.tool()
    async def get_account_summary() -> dict[str, Any]:
        """Account-level summary (NetLiquidation, BuyingPower, CashBalance, etc.)."""
        return await t.get_account_summary(client)

    @mcp.tool()
    async def get_open_orders() -> dict[str, Any]:
        """List currently working orders (parents + brackets)."""
        return await t.get_open_orders(client)

    @mcp.tool()
    async def get_historical_bars(
        symbol: str, duration: str = "1 D", bar_size: str = "1 hour"
    ) -> dict[str, Any]:
        """OHLCV bars. duration uses IB syntax (e.g. '1 D', '1 W', '6 M')."""
        return await t.get_historical_bars(client, symbol, duration, bar_size)

    @mcp.tool()
    async def get_daily_loss_status() -> dict[str, Any]:
        """Today's realised loss against the safety cap."""
        return await t.get_daily_loss_status(config, tracker)

    # ─── Order tools (skipped in READ_ONLY mode) ───────────────────────────
    if not config.read_only:

        @mcp.tool()
        async def place_market_order(
            symbol: str,
            side: Side,
            qty: int,
            reference_price: float,
            stop_price: float,
        ) -> dict[str, Any]:
            """Standalone market order with safety checks.

            Prefer place_bracket_order for entries that should auto-attach stop+target.
            stop_price is required so the safety cap can compute risk = (entry-stop) * qty.
            """
            return await t.place_market_order(
                client,
                config,
                tracker,
                port,
                symbol=symbol,
                side=side,
                qty=qty,
                reference_price=reference_price,
                stop_price=stop_price,
            )

        @mcp.tool()
        async def place_bracket_order(
            symbol: str,
            side: Side,
            qty: int,
            entry_reference_price: float,
            stop_price: float,
            target_price: float,
        ) -> dict[str, Any]:
            """Market entry + OCA stop + OCA target (the standard v2 entry).

            All safety guards apply: watchlist, per-trade risk cap, daily loss cap,
            pause file, live-port refusal. Returns the three order IDs.
            """
            return await t.place_bracket_order(
                client,
                config,
                tracker,
                port,
                symbol=symbol,
                side=side,
                qty=qty,
                entry_reference_price=entry_reference_price,
                stop_price=stop_price,
                target_price=target_price,
            )

        @mcp.tool()
        async def cancel_order(order_id: int) -> dict[str, Any]:
            """Cancel one order by IB order_id."""
            return await t.cancel_order(client, order_id)

        @mcp.tool()
        async def cancel_all_orders() -> dict[str, Any]:
            """Global cancel — drops every working order in the account."""
            return await t.cancel_all_orders(client)

    return mcp, client, config, tracker, port


async def _startup(client: IBClient, host: str, port: int, client_id: int) -> None:
    await client.connect(host, port, client_id)


def main() -> None:
    logging.basicConfig(
        level=os.environ.get("LOG_LEVEL", "INFO"),
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    )
    mcp, client, _config, _tracker, _port = _build_server()

    host = os.environ.get("IB_HOST", "127.0.0.1")
    port = int(os.environ.get("IB_PORT", "7497"))
    client_id = int(os.environ.get("IB_CLIENT_ID", "17"))

    # Connect to IB Gateway, then hand control to FastMCP (which manages stdio loop).
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    try:
        loop.run_until_complete(_startup(client, host, port, client_id))
        log.info("IB connected; entering MCP stdio loop")
        mcp.run()
    except KeyboardInterrupt:
        log.info("Interrupted")
    finally:
        loop.run_until_complete(client.disconnect())
        loop.close()


if __name__ == "__main__":
    main()
