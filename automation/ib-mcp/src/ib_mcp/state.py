"""Daily loss tracker for the safety cap.

Persists across MCP server restarts in a JSON file under XDG_STATE_HOME
(falls back to ~/.local/state/ib-mcp/). Resets at the configured timezone's midnight.
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass
from datetime import date, datetime
from pathlib import Path
from zoneinfo import ZoneInfo


def state_file_path() -> Path:
    base = os.environ.get("XDG_STATE_HOME") or str(Path.home() / ".local" / "state")
    p = Path(base) / "ib-mcp"
    p.mkdir(parents=True, exist_ok=True)
    return p / "daily_loss.json"


@dataclass
class DailyLossState:
    session_date: date  # date in the configured timezone
    realised_loss_dollars: float  # cumulative positive number (e.g. 35.0 = lost $35)

    def to_dict(self) -> dict[str, object]:
        return {
            "session_date": self.session_date.isoformat(),
            "realised_loss_dollars": self.realised_loss_dollars,
        }

    @classmethod
    def from_dict(cls, d: dict[str, object]) -> DailyLossState:
        return cls(
            session_date=date.fromisoformat(str(d["session_date"])),
            realised_loss_dollars=float(d["realised_loss_dollars"]),  # type: ignore[arg-type]
        )


class DailyLossTracker:
    """Tracks today's realised loss against the cap; persists to disk."""

    def __init__(
        self,
        timezone: str = "America/New_York",
        path: Path | None = None,
        clock: "callable[[], datetime] | None" = None,
    ):
        self._tz = ZoneInfo(timezone)
        self._path = path or state_file_path()
        self._clock = clock or (lambda: datetime.now(self._tz))

    def _today(self) -> date:
        return self._clock().astimezone(self._tz).date()

    def load(self) -> DailyLossState:
        today = self._today()
        if not self._path.exists():
            return DailyLossState(session_date=today, realised_loss_dollars=0.0)
        try:
            data = json.loads(self._path.read_text())
            state = DailyLossState.from_dict(data)
        except (json.JSONDecodeError, KeyError, ValueError):
            # Corrupt state file → safe default; do not block trading on this.
            return DailyLossState(session_date=today, realised_loss_dollars=0.0)
        if state.session_date != today:
            # New trading day — reset.
            return DailyLossState(session_date=today, realised_loss_dollars=0.0)
        return state

    def save(self, state: DailyLossState) -> None:
        self._path.write_text(json.dumps(state.to_dict()))

    def record_realised_pnl(self, pnl_dollars: float) -> DailyLossState:
        """Apply a realised P&L (positive = profit, negative = loss).

        We track ONLY net loss as a positive accumulator; profits offset prior loss
        down to zero but never go negative (loss cap is a one-directional gate).
        """
        state = self.load()
        new_loss = max(0.0, state.realised_loss_dollars - pnl_dollars)
        new_state = DailyLossState(
            session_date=state.session_date,
            realised_loss_dollars=new_loss,
        )
        self.save(new_state)
        return new_state

    def current_loss(self) -> float:
        return self.load().realised_loss_dollars
