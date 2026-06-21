"""Tests for the DailyLossTracker.

Uses an injectable clock so we can simulate midnight rollover without sleeping.
"""

from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

from ib_mcp.state import DailyLossState, DailyLossTracker


def _tracker(tmp_path: Path, now_iso: str) -> DailyLossTracker:
    ny = ZoneInfo("America/New_York")
    fixed = datetime.fromisoformat(now_iso).replace(tzinfo=ny)
    return DailyLossTracker(
        timezone="America/New_York",
        path=tmp_path / "loss.json",
        clock=lambda: fixed,
    )


def test_no_file_returns_zero(tmp_path: Path) -> None:
    t = _tracker(tmp_path, "2026-04-29T10:00:00")
    state = t.load()
    assert state.realised_loss_dollars == 0.0
    assert state.session_date.isoformat() == "2026-04-29"


def test_loss_accumulates(tmp_path: Path) -> None:
    t = _tracker(tmp_path, "2026-04-29T10:00:00")
    t.record_realised_pnl(-30.0)  # lost $30
    assert t.current_loss() == 30.0
    t.record_realised_pnl(-15.0)  # lost another $15
    assert t.current_loss() == 45.0


def test_profit_offsets_loss_but_not_below_zero(tmp_path: Path) -> None:
    t = _tracker(tmp_path, "2026-04-29T10:00:00")
    t.record_realised_pnl(-30.0)
    t.record_realised_pnl(20.0)  # win $20
    assert t.current_loss() == 10.0
    t.record_realised_pnl(100.0)  # big win
    assert t.current_loss() == 0.0  # never negative


def test_new_day_resets(tmp_path: Path) -> None:
    # Day 1: lost $40
    t1 = _tracker(tmp_path, "2026-04-29T15:00:00")
    t1.record_realised_pnl(-40.0)
    assert t1.current_loss() == 40.0

    # Day 2: should reset to 0
    t2 = _tracker(tmp_path, "2026-04-30T09:30:00")
    assert t2.current_loss() == 0.0


def test_corrupt_state_file_safe_default(tmp_path: Path) -> None:
    path = tmp_path / "loss.json"
    path.write_text("not valid json {{{")
    t = DailyLossTracker(path=path, clock=lambda: datetime.now(ZoneInfo("America/New_York")))
    assert t.current_loss() == 0.0


def test_persisted_state_roundtrip(tmp_path: Path) -> None:
    t = _tracker(tmp_path, "2026-04-29T10:00:00")
    t.record_realised_pnl(-25.0)

    # Read file directly to verify shape
    data = json.loads((tmp_path / "loss.json").read_text())
    assert data["session_date"] == "2026-04-29"
    assert data["realised_loss_dollars"] == 25.0

    # Reload a fresh tracker against the same file → sees same loss
    t2 = _tracker(tmp_path, "2026-04-29T11:00:00")
    assert t2.current_loss() == 25.0


def test_dataclass_serialisation_symmetry() -> None:
    s = DailyLossState(
        session_date=datetime(2026, 4, 29).date(),
        realised_loss_dollars=42.5,
    )
    assert DailyLossState.from_dict(s.to_dict()) == s
