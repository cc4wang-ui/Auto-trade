"""Pure-logic tests for safety guards.

No IB connection. No async. Just covers every branch in safety.py.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from ib_mcp.safety import (
    SafetyConfig,
    SafetyReject,
    assert_order_allowed,
    check_daily_loss,
    check_live_trading_port,
    check_pause,
    check_read_only,
    check_risk_dollars,
    check_watchlist,
)


def _config(tmp_path: Path, **overrides: str) -> SafetyConfig:
    env = {
        "ENABLE_LIVE_TRADING": "false",
        "READ_ONLY": "false",
        "MAX_RISK_DOLLARS_PER_TRADE": "25",
        "MAX_DAILY_LOSS_DOLLARS": "50",
        "WATCHLIST": "SOFI,SOXL",
        "PAUSE_FILE": str(tmp_path / "pause"),
    }
    env.update(overrides)
    return SafetyConfig.from_env(env)


# ─── pause file ─────────────────────────────────────────────────────────────


def test_check_pause_passes_when_no_file(tmp_path: Path) -> None:
    check_pause(_config(tmp_path))


def test_check_pause_rejects_when_file_exists(tmp_path: Path) -> None:
    cfg = _config(tmp_path)
    cfg.pause_file.touch()
    with pytest.raises(SafetyReject, match="Trading paused"):
        check_pause(cfg)


# ─── read-only ──────────────────────────────────────────────────────────────


def test_check_read_only_passes_when_disabled(tmp_path: Path) -> None:
    check_read_only(_config(tmp_path, READ_ONLY="false"))


def test_check_read_only_rejects_when_enabled(tmp_path: Path) -> None:
    with pytest.raises(SafetyReject, match="READ_ONLY"):
        check_read_only(_config(tmp_path, READ_ONLY="true"))


# ─── live port refusal ─────────────────────────────────────────────────────


def test_paper_port_always_ok(tmp_path: Path) -> None:
    check_live_trading_port(_config(tmp_path), 7497)
    check_live_trading_port(_config(tmp_path), 4002)


def test_live_port_rejected_by_default(tmp_path: Path) -> None:
    with pytest.raises(SafetyReject, match="live-trading port"):
        check_live_trading_port(_config(tmp_path), 7496)
    with pytest.raises(SafetyReject, match="live-trading port"):
        check_live_trading_port(_config(tmp_path), 4001)


def test_live_port_allowed_when_explicitly_enabled(tmp_path: Path) -> None:
    cfg = _config(tmp_path, ENABLE_LIVE_TRADING="true")
    check_live_trading_port(cfg, 7496)
    check_live_trading_port(cfg, 4001)


# ─── watchlist ──────────────────────────────────────────────────────────────


def test_watchlist_allows_listed_symbol(tmp_path: Path) -> None:
    check_watchlist(_config(tmp_path), "SOFI")
    check_watchlist(_config(tmp_path), "sofi")  # case-insensitive
    check_watchlist(_config(tmp_path), "SOXL")


def test_watchlist_rejects_unlisted_symbol(tmp_path: Path) -> None:
    with pytest.raises(SafetyReject, match="not in WATCHLIST"):
        check_watchlist(_config(tmp_path), "AAPL")


def test_empty_watchlist_disables_check(tmp_path: Path) -> None:
    check_watchlist(_config(tmp_path, WATCHLIST=""), "ANYTHING")


# ─── risk cap ──────────────────────────────────────────────────────────────


def test_risk_cap_long_allowed_when_under(tmp_path: Path) -> None:
    # entry 15.50, stop 14.50 → risk per share = 1.00; qty 20 → $20 total
    check_risk_dollars(_config(tmp_path), "buy", 20, 15.50, 14.50)


def test_risk_cap_long_rejected_when_over(tmp_path: Path) -> None:
    # qty 30 × $1 = $30 > $25 cap
    with pytest.raises(SafetyReject, match="exceeds cap"):
        check_risk_dollars(_config(tmp_path), "buy", 30, 15.50, 14.50)


def test_risk_cap_short_allowed_when_under(tmp_path: Path) -> None:
    # short SOFI 15.50, stop 16.50 → risk 1.00; qty 25 → $25 (boundary, allowed)
    check_risk_dollars(_config(tmp_path), "sell", 25, 15.50, 16.50)


def test_risk_cap_long_rejects_stop_at_or_above_entry(tmp_path: Path) -> None:
    with pytest.raises(SafetyReject, match="stop .* below entry"):
        check_risk_dollars(_config(tmp_path), "buy", 10, 15.00, 15.00)
    with pytest.raises(SafetyReject, match="stop .* below entry"):
        check_risk_dollars(_config(tmp_path), "buy", 10, 15.00, 16.00)


def test_risk_cap_short_rejects_stop_at_or_below_entry(tmp_path: Path) -> None:
    with pytest.raises(SafetyReject, match="stop .* above entry"):
        check_risk_dollars(_config(tmp_path), "sell", 10, 15.00, 14.00)


def test_risk_cap_rejects_non_positive_qty(tmp_path: Path) -> None:
    with pytest.raises(SafetyReject, match="qty must be positive"):
        check_risk_dollars(_config(tmp_path), "buy", 0, 15.00, 14.00)


def test_risk_cap_rejects_non_positive_prices(tmp_path: Path) -> None:
    with pytest.raises(SafetyReject, match="prices must be positive"):
        check_risk_dollars(_config(tmp_path), "buy", 10, 0.0, 14.00)


def test_risk_cap_unknown_side(tmp_path: Path) -> None:
    with pytest.raises(SafetyReject, match="unknown side"):
        check_risk_dollars(_config(tmp_path), "long", 10, 15.00, 14.00)  # type: ignore[arg-type]


# ─── daily loss ────────────────────────────────────────────────────────────


def test_daily_loss_under_cap_passes(tmp_path: Path) -> None:
    check_daily_loss(_config(tmp_path), 49.99)


def test_daily_loss_at_cap_rejects(tmp_path: Path) -> None:
    with pytest.raises(SafetyReject, match="Daily loss"):
        check_daily_loss(_config(tmp_path), 50.0)


def test_daily_loss_over_cap_rejects(tmp_path: Path) -> None:
    with pytest.raises(SafetyReject, match="Daily loss"):
        check_daily_loss(_config(tmp_path), 75.0)


# ─── integration: assert_order_allowed ─────────────────────────────────────


def test_assert_order_allowed_happy_path(tmp_path: Path) -> None:
    assert_order_allowed(
        _config(tmp_path),
        port=7497,
        symbol="SOFI",
        side="buy",
        qty=20,
        entry_price=15.50,
        stop_price=14.50,
        realised_loss_today=10.0,
    )


def test_assert_order_allowed_short_circuits_on_first_reject(tmp_path: Path) -> None:
    # Pause file is the first check; it should fire before symbol/risk are evaluated.
    cfg = _config(tmp_path)
    cfg.pause_file.touch()
    with pytest.raises(SafetyReject, match="Trading paused"):
        assert_order_allowed(
            cfg,
            port=7497,
            symbol="MUST_NEVER_BE_CHECKED",
            side="buy",
            qty=1_000_000,
            entry_price=999_999.0,
            stop_price=-1.0,
            realised_loss_today=999_999.0,
        )
