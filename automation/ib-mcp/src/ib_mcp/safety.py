"""Safety guards for IB MCP tools.

All checks are pure functions on plain inputs — no IB connection required.
Tools call these BEFORE every order so Claude can never bypass them.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path
from typing import Literal


class SafetyReject(Exception):
    """Raised when a guard rejects an order. Tools surface this back to Claude."""


@dataclass(frozen=True)
class SafetyConfig:
    enable_live_trading: bool
    read_only: bool
    max_risk_dollars_per_trade: float
    max_daily_loss_dollars: float
    watchlist: frozenset[str]
    pause_file: Path

    @classmethod
    def from_env(cls, env: dict[str, str] | None = None) -> SafetyConfig:
        env = env if env is not None else dict(os.environ)
        watchlist = frozenset(
            sym.strip().upper()
            for sym in env.get("WATCHLIST", "").split(",")
            if sym.strip()
        )
        return cls(
            enable_live_trading=_parse_bool(env.get("ENABLE_LIVE_TRADING", "false")),
            read_only=_parse_bool(env.get("READ_ONLY", "false")),
            max_risk_dollars_per_trade=float(env.get("MAX_RISK_DOLLARS_PER_TRADE", "25")),
            max_daily_loss_dollars=float(env.get("MAX_DAILY_LOSS_DOLLARS", "50")),
            watchlist=watchlist,
            pause_file=Path(env.get("PAUSE_FILE", "/tmp/ib-mcp-pause")),
        )


def _parse_bool(val: str) -> bool:
    return val.strip().lower() in {"1", "true", "yes", "on"}


Side = Literal["buy", "sell"]


def check_pause(config: SafetyConfig) -> None:
    """Kill switch — touch the pause file to halt all order tools instantly."""
    if config.pause_file.exists():
        raise SafetyReject(
            f"Trading paused: {config.pause_file} exists. "
            f"Remove the file to resume."
        )


def check_read_only(config: SafetyConfig) -> None:
    if config.read_only:
        raise SafetyReject("READ_ONLY=true; order tools are disabled.")


def check_live_trading_port(config: SafetyConfig, port: int) -> None:
    """Refuse to send orders to a live-trading port unless explicitly enabled."""
    live_ports = {7496, 4001}
    if port in live_ports and not config.enable_live_trading:
        raise SafetyReject(
            f"Refusing to use live-trading port {port}; "
            f"set ENABLE_LIVE_TRADING=true to override."
        )


def check_watchlist(config: SafetyConfig, symbol: str) -> None:
    if not config.watchlist:
        return  # empty whitelist = no restriction (must be explicitly chosen)
    if symbol.upper() not in config.watchlist:
        raise SafetyReject(
            f"Symbol {symbol} not in WATCHLIST={sorted(config.watchlist)}. "
            f"Add it to .env to allow."
        )


def check_risk_dollars(
    config: SafetyConfig,
    side: Side,
    qty: int,
    entry_price: float,
    stop_price: float,
) -> None:
    """Reject the order if (entry - stop) × qty exceeds the per-trade cap.

    Both prices are absolute. The direction is inferred from `side`:
        buy  → stop must be below entry
        sell → stop must be above entry
    """
    if qty <= 0:
        raise SafetyReject(f"qty must be positive, got {qty}")
    if entry_price <= 0 or stop_price <= 0:
        raise SafetyReject(f"prices must be positive (entry={entry_price}, stop={stop_price})")

    if side == "buy":
        if stop_price >= entry_price:
            raise SafetyReject(
                f"Long order requires stop ({stop_price}) below entry ({entry_price})."
            )
        risk_per_share = entry_price - stop_price
    elif side == "sell":
        if stop_price <= entry_price:
            raise SafetyReject(
                f"Short order requires stop ({stop_price}) above entry ({entry_price})."
            )
        risk_per_share = stop_price - entry_price
    else:
        raise SafetyReject(f"unknown side: {side}")

    total_risk = risk_per_share * qty
    if total_risk > config.max_risk_dollars_per_trade:
        raise SafetyReject(
            f"Order risk ${total_risk:.2f} exceeds cap "
            f"${config.max_risk_dollars_per_trade:.2f} "
            f"(qty={qty} × |entry-stop|={risk_per_share:.4f})."
        )


def check_daily_loss(config: SafetyConfig, realised_loss_today: float) -> None:
    """Reject new orders once today's realised loss has reached the cap.

    `realised_loss_today` is a positive number representing $ lost.
    """
    if realised_loss_today >= config.max_daily_loss_dollars:
        raise SafetyReject(
            f"Daily loss ${realised_loss_today:.2f} has reached cap "
            f"${config.max_daily_loss_dollars:.2f}. Trading halted until tomorrow."
        )


def assert_order_allowed(
    config: SafetyConfig,
    *,
    port: int,
    symbol: str,
    side: Side,
    qty: int,
    entry_price: float,
    stop_price: float,
    realised_loss_today: float,
) -> None:
    """Run every guard in sequence; raises SafetyReject on the first failure."""
    check_pause(config)
    check_read_only(config)
    check_live_trading_port(config, port)
    check_watchlist(config, symbol)
    check_daily_loss(config, realised_loss_today)
    check_risk_dollars(config, side, qty, entry_price, stop_price)
