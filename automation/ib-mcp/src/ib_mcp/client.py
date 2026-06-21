"""Thin wrapper around ib_async.IB.

Designed so tools.py can be unit-tested with a mock IBClient (MagicMock or fake).
All public methods are async and return plain dicts so MCP serialisation is trivial.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any, Literal

if TYPE_CHECKING:
    from ib_async import IB  # type: ignore[import-not-found]

log = logging.getLogger(__name__)

Side = Literal["buy", "sell"]


@dataclass
class OrderResult:
    order_id: int
    symbol: str
    action: str
    qty: int
    order_type: str
    status: str

    def to_dict(self) -> dict[str, Any]:
        return {
            "order_id": self.order_id,
            "symbol": self.symbol,
            "action": self.action,
            "qty": self.qty,
            "order_type": self.order_type,
            "status": self.status,
        }


@dataclass
class BracketResult:
    parent: OrderResult
    stop: OrderResult
    target: OrderResult

    def to_dict(self) -> dict[str, Any]:
        return {
            "parent": self.parent.to_dict(),
            "stop": self.stop.to_dict(),
            "target": self.target.to_dict(),
        }


class IBClient:
    """Wraps `ib_async.IB` with the small subset of operations we need.

    The constructor accepts any object that quacks like ib_async.IB. Real usage
    passes a real `IB()` instance; tests pass a MagicMock or a hand-written fake.
    """

    def __init__(self, ib: Any):
        self._ib = ib

    @classmethod
    def with_real_ib(cls) -> IBClient:
        """Create an IBClient backed by a real `ib_async.IB()` (deferred import)."""
        try:
            from ib_async import IB  # type: ignore[import-not-found]
        except ImportError as e:
            raise RuntimeError(
                "ib_async is not installed. Run `pip install -e '.'` from automation/ib-mcp/"
            ) from e
        return cls(IB())

    async def connect(self, host: str, port: int, client_id: int) -> None:
        log.info("Connecting to IB Gateway at %s:%s (clientId=%s)", host, port, client_id)
        await self._ib.connectAsync(host, port, clientId=client_id)

    async def disconnect(self) -> None:
        if getattr(self._ib, "isConnected", lambda: False)():
            self._ib.disconnect()

    # ─── Read ──────────────────────────────────────────────────────────────

    async def get_quote(self, symbol: str) -> dict[str, Any]:
        from ib_async import Stock  # type: ignore[import-not-found]

        contract = Stock(symbol.upper(), "SMART", "USD")
        await self._ib.qualifyContractsAsync(contract)
        ticker = self._ib.reqMktData(contract, "", False, False)
        # ib_async populates the ticker asynchronously; wait briefly for a snapshot
        await self._ib.sleep(1.0)
        result = {
            "symbol": symbol.upper(),
            "bid": _none_if_nan(ticker.bid),
            "ask": _none_if_nan(ticker.ask),
            "last": _none_if_nan(ticker.last),
            "close": _none_if_nan(ticker.close),
            "volume": _none_if_nan(ticker.volume),
            "time": str(ticker.time) if ticker.time else None,
        }
        self._ib.cancelMktData(contract)
        return result

    async def get_positions(self) -> list[dict[str, Any]]:
        positions = self._ib.positions()
        return [
            {
                "symbol": p.contract.symbol,
                "qty": int(p.position),
                "avg_cost": float(p.avgCost),
                "currency": p.contract.currency,
                "exchange": p.contract.exchange,
            }
            for p in positions
        ]

    async def get_account_summary(self) -> dict[str, Any]:
        summary = self._ib.accountSummary()
        return {
            item.tag: {"value": item.value, "currency": item.currency}
            for item in summary
        }

    async def get_open_orders(self) -> list[dict[str, Any]]:
        trades = self._ib.openTrades()
        return [
            {
                "order_id": t.order.orderId,
                "symbol": t.contract.symbol,
                "action": t.order.action,
                "qty": int(t.order.totalQuantity),
                "order_type": t.order.orderType,
                "limit_price": getattr(t.order, "lmtPrice", None) or None,
                "stop_price": getattr(t.order, "auxPrice", None) or None,
                "status": t.orderStatus.status,
            }
            for t in trades
        ]

    async def get_historical_bars(
        self,
        symbol: str,
        duration: str = "1 D",
        bar_size: str = "1 hour",
    ) -> list[dict[str, Any]]:
        from ib_async import Stock  # type: ignore[import-not-found]

        contract = Stock(symbol.upper(), "SMART", "USD")
        await self._ib.qualifyContractsAsync(contract)
        bars = await self._ib.reqHistoricalDataAsync(
            contract,
            endDateTime="",
            durationStr=duration,
            barSizeSetting=bar_size,
            whatToShow="TRADES",
            useRTH=True,
            formatDate=1,
        )
        return [
            {
                "time": str(b.date),
                "open": b.open,
                "high": b.high,
                "low": b.low,
                "close": b.close,
                "volume": b.volume,
            }
            for b in bars
        ]

    # ─── Write ─────────────────────────────────────────────────────────────

    async def place_market_order(
        self, symbol: str, side: Side, qty: int
    ) -> OrderResult:
        from ib_async import MarketOrder, Stock  # type: ignore[import-not-found]

        contract = Stock(symbol.upper(), "SMART", "USD")
        await self._ib.qualifyContractsAsync(contract)
        action = "BUY" if side == "buy" else "SELL"
        order = MarketOrder(action, qty)
        trade = self._ib.placeOrder(contract, order)
        await self._wait_for_status(trade)
        return OrderResult(
            order_id=order.orderId,
            symbol=symbol.upper(),
            action=action,
            qty=qty,
            order_type="MKT",
            status=trade.orderStatus.status,
        )

    async def place_bracket_order(
        self,
        symbol: str,
        side: Side,
        qty: int,
        stop_price: float,
        target_price: float,
    ) -> BracketResult:
        """Submits parent market + OCA child stop and target.

        Uses ib_async.IB.bracketOrder() which returns 3 Order objects (parent,
        takeProfit, stopLoss). All three share a parent group so a fill on either
        child cancels the other.
        """
        from ib_async import Stock  # type: ignore[import-not-found]

        contract = Stock(symbol.upper(), "SMART", "USD")
        await self._ib.qualifyContractsAsync(contract)
        action = "BUY" if side == "buy" else "SELL"
        bracket = self._ib.bracketOrder(
            action,
            qty,
            limitPrice=0,  # market entry, but ib_async signature requires a value
            takeProfitPrice=target_price,
            stopLossPrice=stop_price,
        )
        # bracketOrder returns LMT parent by default; swap parent to MarketOrder.
        bracket[0].orderType = "MKT"
        bracket[0].lmtPrice = 0
        trades = [self._ib.placeOrder(contract, o) for o in bracket]
        # Wait briefly for status updates.
        for t in trades:
            await self._wait_for_status(t)
        parent, target, stop = trades
        return BracketResult(
            parent=OrderResult(
                order_id=bracket[0].orderId,
                symbol=symbol.upper(),
                action=action,
                qty=qty,
                order_type="MKT",
                status=parent.orderStatus.status,
            ),
            target=OrderResult(
                order_id=bracket[1].orderId,
                symbol=symbol.upper(),
                action="SELL" if side == "buy" else "BUY",
                qty=qty,
                order_type="LMT",
                status=target.orderStatus.status,
            ),
            stop=OrderResult(
                order_id=bracket[2].orderId,
                symbol=symbol.upper(),
                action="SELL" if side == "buy" else "BUY",
                qty=qty,
                order_type="STP",
                status=stop.orderStatus.status,
            ),
        )

    async def cancel_order(self, order_id: int) -> dict[str, Any]:
        for trade in self._ib.openTrades():
            if trade.order.orderId == order_id:
                self._ib.cancelOrder(trade.order)
                await self._wait_for_status(trade)
                return {"order_id": order_id, "status": trade.orderStatus.status}
        return {"order_id": order_id, "status": "not_found"}

    async def cancel_all_orders(self) -> list[dict[str, Any]]:
        self._ib.reqGlobalCancel()
        return [
            {"order_id": t.order.orderId, "status": "cancel_requested"}
            for t in self._ib.openTrades()
        ]

    async def _wait_for_status(self, trade: Any, timeout: float = 3.0) -> None:
        """Poll briefly until the trade has a non-empty status string."""
        # ib_async fires events; for simplicity poll with sleep.
        elapsed = 0.0
        step = 0.1
        while elapsed < timeout:
            if trade.orderStatus.status:
                return
            await self._ib.sleep(step)
            elapsed += step


def _none_if_nan(value: Any) -> Any:
    """ib_async uses float('nan') for missing fields; convert to None for JSON."""
    try:
        import math

        if isinstance(value, float) and math.isnan(value):
            return None
    except Exception:
        pass
    return value
