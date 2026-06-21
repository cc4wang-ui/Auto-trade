"""Shared fixtures.

`fake_ib` is the hand-written stand-in for `ib_async.IB`. It records every call
so tests can assert tools sent the right things. Adding new methods is fine —
keep the fake minimal but realistic.
"""

from __future__ import annotations

# Stub ib_async before client.py's lazy imports run. Real ib_async (when installed)
# takes precedence; this only kicks in for the test/CI env where ib_async is absent.
import sys
import types

if "ib_async" not in sys.modules:
    _stub = types.ModuleType("ib_async")

    class _StubContract:
        def __init__(self, symbol: str = "", *args: object, **kwargs: object):
            self.symbol = symbol
            self.currency = kwargs.get("currency", "USD")
            self.exchange = kwargs.get("exchange", "SMART")

    class _StubOrder:
        def __init__(self, action: str = "BUY", totalQuantity: int = 0, *args: object, **kwargs: object):
            self.action = action
            self.totalQuantity = totalQuantity
            self.orderId = 0
            self.orderType = "MKT"
            self.lmtPrice = kwargs.get("lmtPrice", 0)
            self.auxPrice = kwargs.get("auxPrice", 0)

    for _name in ("Stock", "Contract", "Forex", "Future"):
        setattr(_stub, _name, _StubContract)
    for _name in ("Order", "MarketOrder", "LimitOrder", "StopOrder"):
        setattr(_stub, _name, _StubOrder)
    setattr(_stub, "IB", _StubContract)  # only used by IBClient.with_real_ib() — not in tests
    sys.modules["ib_async"] = _stub

import asyncio
from dataclasses import dataclass, field
from pathlib import Path
from types import SimpleNamespace
from typing import Any
from unittest.mock import MagicMock

import pytest

from ib_mcp.client import IBClient
from ib_mcp.safety import SafetyConfig
from ib_mcp.state import DailyLossTracker


# ─── Fake IB ────────────────────────────────────────────────────────────────


@dataclass
class FakeIB:
    """Minimal fake of `ib_async.IB` sufficient for our tool tests."""

    placed_orders: list[tuple[Any, Any]] = field(default_factory=list)
    cancelled_orders: list[int] = field(default_factory=list)
    next_order_id: int = 1000
    _positions: list[Any] = field(default_factory=list)
    _account_summary: list[Any] = field(default_factory=list)
    _open_trades: list[Any] = field(default_factory=list)
    _historical_bars: list[Any] = field(default_factory=list)
    _connected: bool = False

    async def connectAsync(self, host: str, port: int, clientId: int) -> None:
        self._connected = True

    def disconnect(self) -> None:
        self._connected = False

    def isConnected(self) -> bool:
        return self._connected

    async def qualifyContractsAsync(self, *contracts: Any) -> list[Any]:
        return list(contracts)

    def reqMktData(
        self, contract: Any, gen: str, snapshot: bool, regulatory: bool
    ) -> SimpleNamespace:
        return SimpleNamespace(
            bid=15.50,
            ask=15.52,
            last=15.51,
            close=15.40,
            volume=1_000_000,
            time="2026-04-29T13:30:00Z",
        )

    def cancelMktData(self, contract: Any) -> None:
        pass

    def positions(self) -> list[Any]:
        return self._positions

    def accountSummary(self) -> list[Any]:
        return self._account_summary

    def openTrades(self) -> list[Any]:
        return self._open_trades

    async def reqHistoricalDataAsync(self, *args: Any, **kwargs: Any) -> list[Any]:
        return self._historical_bars

    def placeOrder(self, contract: Any, order: Any) -> SimpleNamespace:
        order.orderId = self.next_order_id
        self.next_order_id += 1
        self.placed_orders.append((contract, order))
        return SimpleNamespace(
            order=order,
            contract=contract,
            orderStatus=SimpleNamespace(status="Submitted"),
        )

    def cancelOrder(self, order: Any) -> None:
        self.cancelled_orders.append(order.orderId)

    def reqGlobalCancel(self) -> None:
        self.cancelled_orders.extend(t.order.orderId for t in self._open_trades)

    def bracketOrder(
        self,
        action: str,
        qty: int,
        limitPrice: float,
        takeProfitPrice: float,
        stopLossPrice: float,
    ) -> list[Any]:
        parent = SimpleNamespace(
            orderId=0,
            action=action,
            totalQuantity=qty,
            orderType="LMT",
            lmtPrice=limitPrice,
        )
        target = SimpleNamespace(
            orderId=0,
            action="SELL" if action == "BUY" else "BUY",
            totalQuantity=qty,
            orderType="LMT",
            lmtPrice=takeProfitPrice,
        )
        stop = SimpleNamespace(
            orderId=0,
            action="SELL" if action == "BUY" else "BUY",
            totalQuantity=qty,
            orderType="STP",
            auxPrice=stopLossPrice,
        )
        return [parent, target, stop]

    async def sleep(self, seconds: float) -> None:
        await asyncio.sleep(0)  # no-op for tests


# ─── Fixtures ───────────────────────────────────────────────────────────────


@pytest.fixture
def fake_ib() -> FakeIB:
    return FakeIB()


@pytest.fixture
def client(fake_ib: FakeIB) -> IBClient:
    return IBClient(fake_ib)


@pytest.fixture
def safety_config(tmp_path: Path) -> SafetyConfig:
    """Default safety config: paper, SOFI watchlist, $25 risk, $50 daily loss."""
    return SafetyConfig.from_env({
        "ENABLE_LIVE_TRADING": "false",
        "READ_ONLY": "false",
        "MAX_RISK_DOLLARS_PER_TRADE": "25",
        "MAX_DAILY_LOSS_DOLLARS": "50",
        "WATCHLIST": "SOFI",
        "PAUSE_FILE": str(tmp_path / "pause"),
    })


@pytest.fixture
def tracker(tmp_path: Path) -> DailyLossTracker:
    return DailyLossTracker(
        timezone="America/New_York",
        path=tmp_path / "loss.json",
    )


@pytest.fixture
def mock_client() -> MagicMock:
    """A MagicMock IBClient for tool tests that don't care about IB internals."""
    return MagicMock(spec=IBClient)
